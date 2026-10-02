package discordsync

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// EvLink is the gateway event a person's own devices get whenever their link
// changes: made, dropped, out of the activity server or back in it.
const EvLink = "discord_link"

// How long a person has to finish on Discord's page after asking to link.
const stateTTL = 10 * time.Minute

// callbackPath is where Discord sends people back to, under any of Nexa's addresses.
const callbackPath = "/api/v1/connections/discord/callback"

// How long what Discord last said its listed redirects are is taken as it
// stands: a redirect added in the Developer Portal is in use a minute later,
// and whoever is looking at the bot's settings sees it sooner than that.
const (
	listedTTL       = time.Minute
	listedTTLAdmin  = 10 * time.Second
	listedAskWithin = 4 * time.Second
)

// How long the bot may be away from Discord before what it last heard stops
// being shown: it would otherwise go on showing a song that ended long ago.
const staleAfter = 2 * time.Minute

var (
	ErrNotConfigured = errors.New("discord activity sync is not set up")
	ErrNotLinked     = errors.New("no discord account is linked")
	// ErrReauthorize means Discord no longer accepts the link's tokens: the
	// person has to go through Discord's page again.
	ErrReauthorize = errors.New("discord needs the account linked again")
)

// Hub is what the service needs of the gateway hub.
type Hub interface {
	SetLinkedActivities(uid ids.ID, raw []json.RawMessage)
	EmitUsers(uids []ids.ID, event string, payload any)
}

// Config is what the service needs to talk to Discord.
type Config struct {
	ClientID     string
	ClientSecret string
	BotToken     string
	// GuildID is the activity server. Empty: the bot's only server.
	GuildID   string
	PublicURL string
	// Origins are every address this Nexa answers at, PublicURL first: a
	// callback under any of them reaches this server. Empty: PublicURL alone.
	Origins []string
	// RedirectURL names the callback outright (DISCORD_REDIRECT_URL). Empty,
	// it is chosen from the ones Discord lists: see redirectFor.
	RedirectURL string
	// API is Discord's REST API (DefaultAPI); tests point it at a fake.
	API  string
	HTTP *http.Client
}

// Service links accounts and mirrors their Discord activity.
type Service struct {
	cfg   Config
	st    *store.Store
	hub   Hub
	seal  func(string) ([]byte, error)
	open  func([]byte) (string, error)
	proxy func(string) string
	log   *slog.Logger
	api   *rest
	gw    *Gateway

	mu        sync.Mutex
	guild     string
	owner     string
	watched   map[string]*watch            // linked Discord accounts, by Discord id
	presence  map[string][]discordActivity // what everyone in the activity server is doing, by Discord id
	states    map[string]oauthState        // links being made, by OAuth state
	chunks    map[string]map[string]bool   // members seen so far per member request
	connected bool
	lastErr   string
	stale     *time.Timer
	// the redirects Discord lists for the application, when it last said
	// (zero: it never has) and when it was last asked
	listed      []string
	listedAt    time.Time
	listedAsked time.Time

	// listMu is held while Discord is asked for its redirects, so several
	// people linking at once ask it once
	listMu sync.Mutex

	pubMu sync.Mutex
	pubs  map[ids.ID]*pending
}

type watch struct {
	uid   ids.ID
	show  bool
	kinds int
	in    bool
}

type oauthState struct {
	uid     ids.ID
	expires time.Time
	// back is the address the person started from, to return them to
	back string
	// redirect is the callback Discord was asked to come back through, which
	// swapping the code for tokens has to name again, to the letter
	redirect string
	// app says the link was started in the desktop app, which sends the
	// system's browser to Discord and stays where it is
	app bool
}

type pending struct {
	next *[]json.RawMessage
	busy bool
}

// New makes the service. seal and open keep tokens with the server secret;
// proxy puts a picture's address through the media proxy.
func New(cfg Config, st *store.Store, hub Hub, seal func(string) ([]byte, error), open func([]byte) (string, error), proxy func(string) string, log *slog.Logger) *Service {
	if cfg.API == "" {
		cfg.API = DefaultAPI
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	if proxy == nil {
		proxy = func(s string) string { return s }
	}
	s := &Service{
		cfg: cfg, st: st, hub: hub, seal: seal, open: open, proxy: proxy, log: log,
		api:      &rest{base: strings.TrimRight(cfg.API, "/"), client: cfg.HTTP, bot: cfg.BotToken, id: cfg.ClientID, secret: cfg.ClientSecret},
		watched:  map[string]*watch{},
		presence: map[string][]discordActivity{},
		states:   map[string]oauthState{},
		chunks:   map[string]map[string]bool{},
		pubs:     map[ids.ID]*pending{},
	}
	s.gw = &Gateway{
		Token:    cfg.BotToken,
		Intents:  IntentGuilds | IntentGuildMembers | IntentGuildPresences,
		URL:      s.api.gatewayURL,
		Dispatch: s.dispatch,
		OnClose:  s.disconnected,
		Log:      log,
	}
	return s
}

// callbackAt is the callback under one of Nexa's addresses.
func callbackAt(origin string) string {
	return strings.TrimRight(origin, "/") + callbackPath
}

// listedRedirects are the callbacks Discord lists for the application, asked
// of it again once the last answer is older than maxAge. known is false until
// Discord has answered once; when it cannot be reached, what it said before
// stands.
func (s *Service) listedRedirects(ctx context.Context, maxAge time.Duration) (list []string, known bool) {
	s.listMu.Lock()
	defer s.listMu.Unlock()
	s.mu.Lock()
	list, known = s.listed, !s.listedAt.IsZero()
	fresh := !s.listedAsked.IsZero() && time.Since(s.listedAsked) < maxAge
	s.mu.Unlock()
	if fresh {
		return list, known
	}
	ctx, cancel := context.WithTimeout(ctx, listedAskWithin)
	defer cancel()
	got, err := s.api.redirects(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listedAsked = time.Now()
	if err != nil {
		s.log.Warn("discord sync: reading the listed redirects", "err", err)
		return s.listed, !s.listedAt.IsZero()
	}
	s.listed, s.listedAt = got, s.listedAsked
	return got, true
}

// redirectFor is the callback Discord is asked to send someone back through,
// when they started at the address `back` ("" for nobody in particular).
// Discord only opens its page for a callback listed under OAuth2, Redirects in
// the Developer Portal, so it is the first of these that is listed: the one
// under the address they started at, then the one under Nexa's own address,
// then the ones under its other addresses. A person at an address nobody has
// listed still links, through a callback that is, and is returned to where
// they started (api/discord_handlers.go); and linking goes on working through
// a move to a new address before and after that address is listed. With
// nothing listed, or Discord not answering, it is the one under Nexa's own
// address. DISCORD_REDIRECT_URL names it outright.
func (s *Service) redirectFor(ctx context.Context, back string) string {
	return s.pickRedirect(ctx, back, listedTTL)
}

func (s *Service) pickRedirect(ctx context.Context, back string, maxAge time.Duration) string {
	if s.cfg.RedirectURL != "" {
		return s.cfg.RedirectURL
	}
	own := callbackAt(s.cfg.PublicURL)
	listed, known := s.listedRedirects(ctx, maxAge)
	if !known {
		return own
	}
	for _, origin := range append([]string{back, s.cfg.PublicURL}, s.cfg.Origins...) {
		// only ever under an address of Nexa's own, whatever is listed
		if origin == "" || !s.ours(origin) {
			continue
		}
		if as, ok := listedAs(listed, callbackAt(origin)); ok {
			return as
		}
	}
	return own
}

// ours says whether an address is one this Nexa answers at.
func (s *Service) ours(origin string) bool {
	origin = strings.TrimRight(origin, "/")
	for _, o := range append([]string{s.cfg.PublicURL}, s.cfg.Origins...) {
		if strings.EqualFold(strings.TrimRight(o, "/"), origin) {
			return true
		}
	}
	return false
}

// listedAs finds a callback among the listed ones, as Discord has it written:
// it compares what it is sent with its list to the letter.
func listedAs(listed []string, callback string) (string, bool) {
	for _, l := range listed {
		if strings.EqualFold(l, callback) {
			return l, true
		}
	}
	return "", false
}

// Redirect is the callback someone who starts at Nexa's own address comes
// back through, and whether Discord lists it. known is false when Discord has
// not said which it lists.
func (s *Service) Redirect(ctx context.Context) (redirect string, listed, known bool) {
	redirect = s.pickRedirect(ctx, "", listedTTLAdmin)
	list, known := s.listedRedirects(ctx, listedTTLAdmin)
	_, listed = listedAs(list, redirect)
	return redirect, listed && known, known
}

// checkRedirect says in the log which callback is in use, and what to do when
// Discord does not list it: its page would refuse everyone who tries to link.
func (s *Service) checkRedirect(ctx context.Context) {
	redirect, listed, known := s.Redirect(ctx)
	switch {
	case !known:
		s.log.Info("discord sync: redirect", "url", redirect)
	case listed:
		s.log.Info("discord sync: redirect", "url", redirect, "listed", true)
	default:
		s.log.Error("discord sync: Discord does not list this redirect, so nobody can link; add it under OAuth2, Redirects in the Developer Portal", "url", redirect)
	}
}

// Run connects the bot and keeps it connected until ctx ends.
func (s *Service) Run(ctx context.Context) {
	links, err := s.st.DiscordLinks(ctx)
	if err != nil {
		s.log.Error("discord sync: reading links", "err", err)
	}
	s.mu.Lock()
	for _, l := range links {
		s.watched[l.DiscordID] = &watch{uid: l.UserID, show: l.ShowActivity, kinds: l.Kinds, in: l.InGuild}
	}
	s.mu.Unlock()
	go s.sweepStates(ctx)
	go s.checkRedirect(ctx)
	err = s.gw.Run(ctx)
	if ctx.Err() == nil && err != nil {
		s.log.Error("discord sync stopped", "err", err)
		s.mu.Lock()
		s.lastErr = err.Error()
		s.mu.Unlock()
		s.goneStale()
	}
}

func (s *Service) sweepStates(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.mu.Lock()
			for k, v := range s.states {
				if time.Now().After(v.expires) {
					delete(s.states, k)
				}
			}
			s.mu.Unlock()
		}
	}
}

// --- what Discord says ------------------------------------------------------

func (s *Service) dispatch(event string, data json.RawMessage) {
	switch event {
	case "READY":
		s.onReady(data)
	case "RESUMED":
		s.alive()
	case "GUILD_CREATE":
		s.onGuild(data)
	case "GUILD_MEMBERS_CHUNK":
		s.onChunk(data)
	case "PRESENCE_UPDATE":
		var p presenceUpdate
		if json.Unmarshal(data, &p) == nil && p.GuildID == s.guildID() {
			s.onPresence(p)
		}
	case "GUILD_MEMBER_ADD", "GUILD_MEMBER_REMOVE":
		var m struct {
			GuildID string `json:"guild_id"`
			User    struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if json.Unmarshal(data, &m) == nil && m.GuildID == s.guildID() && m.User.ID != "" {
			s.membership(m.User.ID, event == "GUILD_MEMBER_ADD")
		}
	}
}

type presenceUpdate struct {
	User struct {
		ID string `json:"id"`
	} `json:"user"`
	GuildID    string            `json:"guild_id"`
	Status     string            `json:"status"`
	Activities []discordActivity `json:"activities"`
}

func (s *Service) guildID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.guild
}

func (s *Service) onReady(data json.RawMessage) {
	var r struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		Guilds []struct {
			ID string `json:"id"`
		} `json:"guilds"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return
	}
	guild := s.cfg.GuildID
	if guild == "" {
		if len(r.Guilds) == 1 {
			guild = r.Guilds[0].ID
		} else {
			s.log.Error("discord sync: the bot has to be in exactly one server, or DISCORD_ACTIVITY_GUILD_ID has to name one", "servers", len(r.Guilds))
		}
	} else {
		found := false
		for _, g := range r.Guilds {
			found = found || g.ID == guild
		}
		if !found {
			s.log.Error("discord sync: the bot is not in the server DISCORD_ACTIVITY_GUILD_ID names", "guild", guild)
		}
	}
	s.mu.Lock()
	s.guild = guild
	s.mu.Unlock()
	s.alive()
	s.log.Info("discord sync connected", "bot", r.User.ID, "guild", guild)
}

// alive marks the bot connected; stale activities are kept after all.
func (s *Service) alive() {
	s.mu.Lock()
	s.connected = true
	s.lastErr = ""
	if s.stale != nil {
		s.stale.Stop()
		s.stale = nil
	}
	s.mu.Unlock()
}

// Disconnected starts the clock on what the bot last heard.
func (s *Service) disconnected() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	if s.stale == nil {
		s.stale = time.AfterFunc(staleAfter, s.goneStale)
	}
}

// goneStale stops showing everything the bot heard, now that it cannot hear.
func (s *Service) goneStale() {
	s.mu.Lock()
	s.stale = nil
	var uids []ids.ID
	for _, w := range s.watched {
		uids = append(uids, w.uid)
	}
	s.presence = map[string][]discordActivity{}
	s.mu.Unlock()
	for _, uid := range uids {
		s.publish(uid, nil)
	}
}

func (s *Service) onGuild(data json.RawMessage) {
	var g struct {
		ID        string           `json:"id"`
		OwnerID   string           `json:"owner_id"`
		Presences []presenceUpdate `json:"presences"`
	}
	if json.Unmarshal(data, &g) != nil || g.ID != s.guildID() {
		return
	}
	s.mu.Lock()
	s.owner = g.OwnerID
	s.mu.Unlock()
	for _, p := range g.Presences {
		s.onPresence(p)
	}
	// Everyone, with what they are doing: who left or stopped while the bot was away comes out of it.
	nonce := randomString(12)
	s.mu.Lock()
	s.chunks[nonce] = map[string]bool{}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.gw.RequestMembers(ctx, g.ID, nil, nonce); err != nil {
		s.log.Warn("discord sync: asking for members", "err", err)
	}
}

func (s *Service) onChunk(data json.RawMessage) {
	var c struct {
		GuildID string `json:"guild_id"`
		Members []struct {
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"members"`
		Presences []presenceUpdate `json:"presences"`
		Index     int              `json:"chunk_index"`
		Count     int              `json:"chunk_count"`
		Nonce     string           `json:"nonce"`
	}
	if json.Unmarshal(data, &c) != nil || c.GuildID != s.guildID() {
		return
	}
	s.mu.Lock()
	seen, whole := s.chunks[c.Nonce]
	if whole {
		for _, m := range c.Members {
			seen[m.User.ID] = true
		}
	}
	s.mu.Unlock()
	online := map[string]bool{}
	for _, p := range c.Presences {
		p.GuildID = c.GuildID
		online[p.User.ID] = true
		s.onPresence(p)
	}
	// someone in the answer with no presence is offline, so doing nothing
	for _, m := range c.Members {
		if !online[m.User.ID] {
			s.onPresence(presenceUpdate{User: m.User, GuildID: c.GuildID, Status: "offline"})
		}
	}
	if !whole || c.Index < c.Count-1 {
		return
	}
	s.mu.Lock()
	delete(s.chunks, c.Nonce)
	var ins, outs []string
	for id := range s.watched {
		if seen[id] {
			ins = append(ins, id)
		} else {
			outs = append(outs, id)
		}
	}
	s.mu.Unlock()
	for _, id := range ins {
		s.membership(id, true)
	}
	for _, id := range outs {
		s.membership(id, false)
	}
}

func (s *Service) onPresence(p presenceUpdate) {
	if p.User.ID == "" {
		return
	}
	acts := p.Activities
	if p.Status == "offline" || p.Status == "invisible" {
		acts = nil
	}
	s.mu.Lock()
	if len(acts) == 0 {
		delete(s.presence, p.User.ID)
	} else {
		s.presence[p.User.ID] = acts
	}
	w := s.watched[p.User.ID]
	s.mu.Unlock()
	if w != nil {
		s.refresh(p.User.ID)
	}
}

// membership records a linked account entering or leaving the activity server.
func (s *Service) membership(discordID string, in bool) {
	s.mu.Lock()
	w := s.watched[discordID]
	if w != nil {
		w.in = in
	}
	if !in {
		delete(s.presence, discordID)
	}
	s.mu.Unlock()
	if w == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	changed, err := s.st.SetDiscordInGuild(ctx, discordID, in)
	if err != nil {
		s.log.Warn("discord sync: recording membership", "err", err)
		return
	}
	s.refresh(discordID)
	if changed {
		s.tell(ctx, w.uid)
	}
}

// refresh hands a linked account's activities, as its settings filter them, to the hub.
func (s *Service) refresh(discordID string) {
	s.mu.Lock()
	w := s.watched[discordID]
	var acts []discordActivity
	if w != nil && w.show && w.in {
		acts = s.presence[discordID]
	}
	var uid ids.ID
	kinds := 0
	if w != nil {
		uid, kinds = w.uid, w.kinds
	}
	s.mu.Unlock()
	if w == nil {
		return
	}
	s.publish(uid, toNexa(acts, kinds))
}

// publish hands activities to the hub off the gateway's goroutine, the latest
// set replacing one still waiting: the hub looks applications up, which can
// take a moment, and Discord does not wait.
func (s *Service) publish(uid ids.ID, raw []json.RawMessage) {
	s.pubMu.Lock()
	p := s.pubs[uid]
	if p == nil {
		p = &pending{}
		s.pubs[uid] = p
	}
	p.next = &raw
	if p.busy {
		s.pubMu.Unlock()
		return
	}
	p.busy = true
	s.pubMu.Unlock()
	go func() {
		for {
			s.pubMu.Lock()
			next := p.next
			p.next = nil
			if next == nil {
				p.busy = false
				delete(s.pubs, uid)
				s.pubMu.Unlock()
				return
			}
			s.pubMu.Unlock()
			s.hub.SetLinkedActivities(uid, *next)
		}
	}()
}

// --- linking ---------------------------------------------------------------

// AuthorizeURL is Discord's page for linking, for this account. The state in
// it is single use and lasts ten minutes. `back` is the address of Nexa the
// person started from, and `app` says they started in the desktop app; Started
// hands both back when Discord returns them.
func (s *Service) AuthorizeURL(ctx context.Context, uid ids.ID, back string, app bool) string {
	redirect := s.redirectFor(ctx, back)
	state := randomString(32)
	s.mu.Lock()
	for k, v := range s.states {
		if v.uid == uid {
			delete(s.states, k)
		}
	}
	s.states[state] = oauthState{uid: uid, expires: time.Now().Add(stateTTL), back: back, redirect: redirect, app: app}
	s.mu.Unlock()
	q := url.Values{
		"response_type": {"code"},
		"client_id":     {s.cfg.ClientID},
		"scope":         {"identify guilds.join"},
		"state":         {state},
		"redirect_uri":  {redirect},
		"prompt":        {"consent"},
	}
	return "https://discord.com/oauth2/authorize?" + q.Encode()
}

// Started is where the link with this state was started: the address of Nexa
// it was started from ("" when that is not known), and whether that was in the
// desktop app. A state nobody asked for started nowhere.
func (s *Service) Started(state string) (back string, app bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.states[state]
	return st.back, st.app
}

// Callback finishes a link Discord sent the person back from. It says how it
// went in a word the app shows: linked, denied, expired, taken or failed.
func (s *Service) Callback(ctx context.Context, code, state, oauthErr string) (ids.ID, string) {
	s.mu.Lock()
	st, ok := s.states[state]
	delete(s.states, state)
	s.mu.Unlock()
	if !ok || time.Now().After(st.expires) {
		return 0, "expired"
	}
	if oauthErr != "" || code == "" {
		return st.uid, "denied"
	}
	tok, err := s.api.exchange(ctx, code, st.redirect)
	if err != nil {
		s.log.Warn("discord sync: exchanging the code", "err", err)
		return st.uid, "failed"
	}
	if !strings.Contains(" "+tok.Scope+" ", " guilds.join ") || !strings.Contains(" "+tok.Scope+" ", " identify ") {
		_ = s.api.revoke(ctx, tok.Refresh)
		return st.uid, "denied"
	}
	me, err := s.api.me(ctx, tok.Access)
	if err != nil {
		s.log.Warn("discord sync: reading the account", "err", err)
		return st.uid, "failed"
	}
	link := &store.DiscordLink{UserID: st.uid, DiscordID: me.ID, Username: me.Username, GlobalName: me.GlobalName, Avatar: me.Avatar, TokenExpiresAt: tok.ExpiresAt.UnixMilli()}
	if link.AccessSealed, err = s.seal(tok.Access); err != nil {
		return st.uid, "failed"
	}
	if link.RefreshSealed, err = s.seal(tok.Refresh); err != nil {
		return st.uid, "failed"
	}
	// an account that was linked to another Discord account lets that one go first
	if old, err := s.st.DiscordLinkOf(ctx, st.uid); err == nil && old.DiscordID != me.ID {
		s.forget(old.DiscordID)
	}
	if err := s.st.SaveDiscordLink(ctx, link); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return st.uid, "taken"
		}
		s.log.Warn("discord sync: saving the link", "err", err)
		return st.uid, "failed"
	}
	saved, err := s.st.DiscordLinkOf(ctx, st.uid)
	if err != nil {
		return st.uid, "failed"
	}
	s.mu.Lock()
	s.watched[me.ID] = &watch{uid: st.uid, show: saved.ShowActivity, kinds: saved.Kinds, in: saved.InGuild}
	s.mu.Unlock()
	s.join(ctx, me.ID, tok.Access)
	s.tell(ctx, st.uid)
	return st.uid, "linked"
}

// join adds the Discord account to the activity server and starts hearing
// what it does. Failing to is not failing to link: the settings page offers
// to try again.
func (s *Service) join(ctx context.Context, discordID, access string) bool {
	guild := s.guildID()
	if guild == "" {
		guild = s.cfg.GuildID
	}
	if guild == "" {
		s.log.Warn("discord sync: no activity server to add the account to yet")
		return false
	}
	if err := s.api.addMember(ctx, guild, discordID, access); err != nil {
		s.log.Warn("discord sync: adding to the activity server", "err", err)
		return false
	}
	s.membership(discordID, true)
	// what they are doing right now, rather than from their next change
	rctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.gw.RequestMembers(rctx, guild, []string{discordID}, randomString(12)); err != nil {
		s.refresh(discordID)
	}
	return true
}

// Rejoin puts a linked account back in the activity server after it left.
func (s *Service) Rejoin(ctx context.Context, uid ids.ID) error {
	link, err := s.st.DiscordLinkOf(ctx, uid)
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotLinked
	}
	if err != nil {
		return err
	}
	access, err := s.accessToken(ctx, link)
	if err != nil {
		return err
	}
	if !s.join(ctx, link.DiscordID, access) {
		return errors.New("discord would not add the account to the activity server")
	}
	return nil
}

// accessToken is a link's access token, refreshed first when it has run out.
func (s *Service) accessToken(ctx context.Context, link *store.DiscordLink) (string, error) {
	if time.Now().Add(time.Minute).UnixMilli() < link.TokenExpiresAt && len(link.AccessSealed) > 0 {
		if access, err := s.open(link.AccessSealed); err == nil && access != "" {
			return access, nil
		}
	}
	refresh, err := s.open(link.RefreshSealed)
	if err != nil || refresh == "" {
		return "", ErrReauthorize
	}
	tok, err := s.api.refresh(ctx, refresh)
	var apiErr *APIError
	if errors.As(err, &apiErr) && (apiErr.OAuth == "invalid_grant" || apiErr.Status == http.StatusUnauthorized) {
		return "", ErrReauthorize
	}
	if err != nil {
		return "", err
	}
	a, err := s.seal(tok.Access)
	if err != nil {
		return "", err
	}
	r, err := s.seal(tok.Refresh)
	if err != nil {
		return "", err
	}
	if err := s.st.SetDiscordTokens(ctx, link.UserID, a, r, tok.ExpiresAt.UnixMilli()); err != nil {
		return "", err
	}
	return tok.Access, nil
}

// Unlink drops an account's link at once: its tokens are deleted, its
// Discord activity stops showing, Discord is told to forget the tokens, and
// the Discord account leaves the activity server.
func (s *Service) Unlink(ctx context.Context, uid ids.ID) error {
	link, err := s.st.DeleteDiscordLink(ctx, uid)
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotLinked
	}
	if err != nil {
		return err
	}
	s.forget(link.DiscordID)
	s.publish(uid, nil)
	s.tell(ctx, uid)
	// what Discord keeps is tidied in the background; the link is already gone here
	go func() {
		bctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if refresh, err := s.open(link.RefreshSealed); err == nil && refresh != "" {
			if err := s.api.revoke(bctx, refresh); err != nil {
				s.log.Warn("discord sync: revoking tokens", "err", err)
			}
		}
		guild := s.guildID()
		s.mu.Lock()
		owner := s.owner
		s.mu.Unlock()
		if guild != "" && link.DiscordID != owner {
			if err := s.api.removeMember(bctx, guild, link.DiscordID); err != nil {
				s.log.Warn("discord sync: removing from the activity server", "err", err)
			}
		}
	}()
	return nil
}

// Forget drops whatever link an account had, for an account being deleted.
func (s *Service) Forget(ctx context.Context, uid ids.ID) {
	if err := s.Unlink(ctx, uid); err != nil && !errors.Is(err, ErrNotLinked) {
		s.log.Warn("discord sync: unlinking a deleted account", "err", err)
	}
}

func (s *Service) forget(discordID string) {
	s.mu.Lock()
	delete(s.watched, discordID)
	s.mu.Unlock()
}

// SetPrefs changes whether an account's Discord activity shows, and which kinds.
func (s *Service) SetPrefs(ctx context.Context, uid ids.ID, show bool, kinds int) error {
	if err := s.st.SetDiscordPrefs(ctx, uid, show, kinds); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return ErrNotLinked
		}
		return err
	}
	link, err := s.st.DiscordLinkOf(ctx, uid)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if w := s.watched[link.DiscordID]; w != nil {
		w.show, w.kinds = link.ShowActivity, link.Kinds
	}
	s.mu.Unlock()
	s.refresh(link.DiscordID)
	s.tell(ctx, uid)
	return nil
}

// --- what the app is told ----------------------------------------------------

// State is the link as the app shows it.
type State struct {
	Available bool           `json:"available"`
	Linked    *LinkedDiscord `json:"linked"`
}

// LinkedDiscord is the Discord account an account is linked to.
type LinkedDiscord struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name,omitempty"`
	AvatarURL  string `json:"avatar_url,omitempty"`
	// InGuild says the Discord account is in the activity server; LeftAt,
	// when it left (0: it did not, it has not joined yet).
	InGuild bool  `json:"in_guild"`
	LeftAt  int64 `json:"left_at"`
	Show    bool  `json:"show"`
	Kinds   int   `json:"kinds"`
	// Watching says the bot is connected and hearing Discord right now.
	Watching bool `json:"watching"`
}

// StateOf is an account's link as the app shows it.
func (s *Service) StateOf(ctx context.Context, uid ids.ID) (State, error) {
	out := State{Available: true}
	link, err := s.st.DiscordLinkOf(ctx, uid)
	if errors.Is(err, store.ErrNotFound) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	watching := s.connected && s.guild != ""
	s.mu.Unlock()
	l := &LinkedDiscord{ID: link.DiscordID, Username: link.Username, GlobalName: link.GlobalName, InGuild: link.InGuild, LeftAt: link.LeftAt, Show: link.ShowActivity, Kinds: link.Kinds, Watching: watching}
	if link.Avatar != "" && safeHash(link.Avatar) {
		ext := "png"
		if strings.HasPrefix(link.Avatar, "a_") {
			ext = "gif"
		}
		l.AvatarURL = s.proxy("https://cdn.discordapp.com/avatars/" + link.DiscordID + "/" + link.Avatar + "." + ext + "?size=128")
	}
	out.Linked = l
	return out, nil
}

// tell sends an account's link as it now stands to its own devices.
func (s *Service) tell(ctx context.Context, uid ids.ID) {
	st, err := s.StateOf(ctx, uid)
	if err != nil {
		return
	}
	s.hub.EmitUsers([]ids.ID{uid}, EvLink, st)
}

// Status is the bot's connection, for the admin page: whether it hears Discord, and why not.
func (s *Service) Status() (connected bool, guild string, lastErr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connected, s.guild, s.lastErr
}

func safeHash(h string) bool {
	if len(h) == 0 || len(h) > 64 {
		return false
	}
	for _, r := range h {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r == '_') {
			return false
		}
	}
	return true
}

func randomString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
