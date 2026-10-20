package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
)

// Interactions: someone using what an application made, a slash command, an
// entry in a person's or a message's menu, a button or select menu on its
// message, or a form it opened. The person's app sends it here (POST
// /api/v1/interactions); the server checks it against what the application
// defined, builds it as the protocol has it, hands it to the application
// (over the bot gateway, or to the application's interactions endpoint,
// signed with its key) and waits up to three seconds for the first answer,
// which the application gives at /interactions/{id}/{token}/callback, or in
// its endpoint's reply. What that answer made goes back to the person's app
// at once. For fifteen minutes the interaction's token then lets the
// application follow up, and change or remove what it said, at the webhook
// paths (/webhooks/{application}/{token}/...), as the protocol has it.
//
// Interactions are not end-to-end encrypted: what someone types into a
// command reaches the application readable, as does everything the
// application answers. The apps say so where commands are used.

// Interaction types.
const (
	itPing         = 1
	itCommand      = 2
	itComponent    = 3
	itAutocomplete = 4
	itModalSubmit  = 5
)

// Answer (callback) types.
const (
	cbPong            = 1
	cbMessage         = 4
	cbDeferredMessage = 5
	cbDeferredUpdate  = 6
	cbUpdateMessage   = 7
	cbAutocomplete    = 8
	cbModal           = 9
	cbPremiumRequired = 10
	cbLaunchActivity  = 12
)

const (
	// interactionWait is how long an application has to give its first answer
	interactionWait = 3 * time.Second
	// interactionLife is how long an interaction's token lasts
	interactionLife = 15 * time.Minute
	// interactionBody bounds what the person's app sends
	interactionBody = 256 << 10
)

var (
	errAppUnavailable = E(http.StatusBadGateway, "app_unavailable", "This app is not connected right now.")
	errAppNoAnswer    = E(http.StatusGatewayTimeout, "app_no_response", "The app did not respond.")
	errAppBadAnswer   = E(http.StatusBadGateway, "app_bad_response", "The app gave an answer that could not be shown.")
)

// interactionAnswer is an application's first answer to an interaction, as
// the person's app is told it: what it made, or what to show.
type interactionAnswer struct {
	ID      ids.ID          `json:"id"`
	Type    int             `json:"type"`
	Message *store.Message  `json:"message,omitempty"`
	Choices []commandChoice `json:"choices,omitempty"`
	Modal   *modalDef       `json:"modal,omitempty"`
	// err is an answer that could not be applied, for the waiting app
	err error
}

// awaitAnswer registers an interaction that is waiting for its first answer.
func (rt *botRuntime) awaitAnswer(id ids.ID) chan *interactionAnswer {
	ch := make(chan *interactionAnswer, 1)
	rt.mu.Lock()
	rt.answers[id] = ch
	rt.mu.Unlock()
	return ch
}

// forgetAnswer stops waiting for an interaction's answer.
func (rt *botRuntime) forgetAnswer(id ids.ID) {
	rt.mu.Lock()
	delete(rt.answers, id)
	rt.mu.Unlock()
}

// answered hands an interaction's first answer to whoever waits for it.
func (rt *botRuntime) answered(id ids.ID, a *interactionAnswer) {
	rt.mu.Lock()
	ch := rt.answers[id]
	delete(rt.answers, id)
	rt.mu.Unlock()
	if ch != nil {
		ch <- a
	}
}

// --- the protocol's objects ---------------------------------------------------------------

type dInteractionGuild struct {
	ID       snow     `json:"id"`
	Locale   string   `json:"locale"`
	Features []string `json:"features"`
}

type dInteraction struct {
	ID                           snow               `json:"id"`
	ApplicationID                snow               `json:"application_id"`
	Type                         int                `json:"type"`
	Data                         any                `json:"data,omitempty"`
	Guild                        *dInteractionGuild `json:"guild,omitempty"`
	GuildID                      *snow              `json:"guild_id,omitempty"`
	Channel                      *dChannel          `json:"channel,omitempty"`
	ChannelID                    *snow              `json:"channel_id,omitempty"`
	Member                       *dMember           `json:"member,omitempty"`
	User                         *dUser             `json:"user,omitempty"`
	Token                        string             `json:"token"`
	Version                      int                `json:"version"`
	Message                      *dMessage          `json:"message,omitempty"`
	AppPermissions               string             `json:"app_permissions"`
	Locale                       string             `json:"locale,omitempty"`
	GuildLocale                  *string            `json:"guild_locale,omitempty"`
	Entitlements                 []any              `json:"entitlements"`
	AuthorizingIntegrationOwners map[string]snow    `json:"authorizing_integration_owners"`
	Context                      *int               `json:"context,omitempty"`
	AttachmentSizeLimit          int64              `json:"attachment_size_limit"`
}

// dOptionValue is one option as used: its value, or the options under it.
type dOptionValue struct {
	Name    string         `json:"name"`
	Type    int            `json:"type"`
	Value   any            `json:"value,omitempty"`
	Options []dOptionValue `json:"options,omitempty"`
	Focused bool           `json:"focused,omitempty"`
}

// dResolved holds the objects an interaction's ids name.
type dResolved struct {
	Users       map[string]dUser       `json:"users,omitempty"`
	Members     map[string]dMember     `json:"members,omitempty"`
	Roles       map[string]dRole       `json:"roles,omitempty"`
	Channels    map[string]dChannel    `json:"channels,omitempty"`
	Messages    map[string]dMessage    `json:"messages,omitempty"`
	Attachments map[string]dAttachment `json:"attachments,omitempty"`
}

func (r *dResolved) empty() bool {
	return len(r.Users)+len(r.Members)+len(r.Roles)+len(r.Channels)+len(r.Messages)+len(r.Attachments) == 0
}

type dCommandData struct {
	ID       snow           `json:"id"`
	Name     string         `json:"name"`
	Type     int            `json:"type"`
	GuildID  *snow          `json:"guild_id,omitempty"`
	Options  []dOptionValue `json:"options,omitempty"`
	Resolved *dResolved     `json:"resolved,omitempty"`
	TargetID *snow          `json:"target_id,omitempty"`
}

type dComponentData struct {
	CustomID      string     `json:"custom_id"`
	ComponentType int        `json:"component_type"`
	Values        []string   `json:"values,omitempty"`
	Resolved      *dResolved `json:"resolved,omitempty"`
}

type dModalData struct {
	CustomID   string           `json:"custom_id"`
	Components []map[string]any `json:"components"`
	Resolved   *dResolved       `json:"resolved,omitempty"`
}

// --- what the person's app sends ------------------------------------------------------------

type interactRequest struct {
	Type          int             `json:"type"`
	ApplicationID ids.ID          `json:"application_id"`
	ChannelID     ids.ID          `json:"channel_id"`
	MessageID     *ids.ID         `json:"message_id"`
	ModalOf       *ids.ID         `json:"modal_of"`
	Data          json.RawMessage `json:"data"`
	Locale        string          `json:"locale"`
	// Copy is, for a message command on a message the application cannot
	// read, that message sealed to the application's bot by the person's app
	Copy []byte `json:"copy"`
}

type interactOption struct {
	Name    string           `json:"name"`
	Value   json.RawMessage  `json:"value"`
	Options []interactOption `json:"options"`
	Focused bool             `json:"focused"`
}

type interactCommand struct {
	ID       ids.ID           `json:"id"`
	Options  []interactOption `json:"options"`
	TargetID *ids.ID          `json:"target_id"`
}

type interactComponent struct {
	CustomID      string   `json:"custom_id"`
	ComponentType int      `json:"component_type"`
	Values        []string `json:"values"`
}

type interactField struct {
	CustomID string   `json:"custom_id"`
	Value    *string  `json:"value"`
	Values   []string `json:"values"`
	Checked  *bool    `json:"checked"`
}

type interactModal struct {
	CustomID string          `json:"custom_id"`
	Fields   []interactField `json:"fields"`
}

// interactionScene is everything an interaction happens in, read once.
type interactionScene struct {
	me      *store.User
	ch      *store.Channel
	app     *store.Application
	bot     *store.User
	how     []int
	where   int
	guild   *ids.ID
	myPerms perms.Perm
	locale  string
	b       *dBuilder
}

// --- routes ---------------------------------------------------------------------------------

func (s *Server) interactionRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/interactions", s.userLimited(s.limInteract, s.handleInteract))
	mux.Handle("POST /api/v1/interactions/files", s.userLimited(s.limUpload, s.handleInteractionFile))
	mux.Handle("GET /api/v1/channels/{id}/commands", s.authed(s.handleChannelCommands))
	mux.Handle("DELETE /api/v1/ephemeral/{id}", s.authed(s.handleEphemeralDismiss))
	s.botHandle(mux, "POST", "/interactions/{interaction}/{token}/callback", authNone, s.botInteractionCallback, bucketed("interaction"))
}

// handleInteract is someone using what an application made.
func (s *Server) handleInteract(w http.ResponseWriter, r *http.Request) {
	var req interactRequest
	if err := ReadJSON(w, r, &req, interactionBody); err != nil {
		WriteError(w, err)
		return
	}
	sc, err := s.interactionScene(r, &req)
	if err != nil {
		WriteError(w, err)
		return
	}
	it := &store.Interaction{ID: ids.New(), ApplicationID: sc.app.ID, Type: req.Type, UserID: sc.me.ID, GuildID: sc.guild, ChannelID: &sc.ch.ID}
	payload := sc.basePayload(it.ID)
	switch req.Type {
	case itCommand, itAutocomplete:
		err = s.commandInteraction(r, sc, &req, it, payload)
	case itComponent:
		err = s.componentInteraction(r, sc, &req, it, payload)
	case itModalSubmit:
		err = s.modalInteraction(r, sc, &req, it, payload)
	default:
		err = E(http.StatusBadRequest, "bad_type", "That is not something an app can be sent.")
	}
	if err != nil {
		WriteError(w, err)
		return
	}
	ans, err := s.runInteraction(r, sc, it, payload)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, ans)
}

// interactionScene reads and checks where an interaction happens: the
// channel, the application, how it is installed for this person there.
func (s *Server) interactionScene(r *http.Request, req *interactRequest) (*interactionScene, error) {
	ctx := r.Context()
	me := botUserOf(r)
	ch, err := s.Store.ChannelByID(ctx, req.ChannelID)
	if err != nil {
		return nil, ErrNotFound
	}
	if ok, err := s.canAccess(r, me, ch, NeedView); err != nil || !ok {
		return nil, ErrNotFound
	}
	if !s.unlocked(r, ch) {
		return nil, E(http.StatusForbidden, "locked", "This subchat asks for its password first.")
	}
	apps, how, where, err := s.usableApps(ctx, ch, me)
	if err != nil {
		return nil, err
	}
	app := apps[req.ApplicationID]
	if app == nil {
		return nil, E(http.StatusNotFound, "unknown_app", "That app is not available here.")
	}
	bot, err := s.Store.UserByID(ctx, app.ID)
	if err != nil {
		return nil, ErrNotFound
	}
	sc := &interactionScene{me: me, ch: ch, app: app, bot: bot, how: how[app.ID], where: where, guild: ch.ServerID, locale: discordLocale(req.Locale)}
	if p, err := s.Store.PermsIn(ctx, ch, me.ID); err == nil {
		sc.myPerms = p
	}
	sc.b = s.builder(ctx, bot, app)
	return sc, nil
}

// botUserOf is the signed-in account of a request.
func botUserOf(r *http.Request) *store.User { return auth.UserFrom(r.Context()) }

// discordLocale is the protocol's name for one of the app's languages.
func discordLocale(l string) string {
	switch l {
	case "", "en":
		return "en-US"
	case "es":
		return "es-ES"
	case "sv":
		return "sv-SE"
	}
	if discordLocales[l] {
		return l
	}
	return l
}

// owners says where the application is installed for this interaction:
// "0" the server it happens in (or "0" in a conversation with the bot
// itself), "1" the account of the person using it.
func (sc *interactionScene) owners(byGuild, byUser bool) map[string]snow {
	out := map[string]snow{}
	if byGuild {
		if sc.guild != nil {
			out["0"] = snow(*sc.guild)
		} else {
			out["0"] = snow(0)
		}
	}
	if byUser {
		out["1"] = snow(sc.me.ID)
	}
	return out
}

// basePayload is the part of an interaction that does not depend on its type.
func (sc *interactionScene) basePayload(id ids.ID) *dInteraction {
	b := sc.b
	where := sc.where
	p := &dInteraction{ID: snow(id), ApplicationID: snow(sc.app.ID), Version: 1, Locale: sc.locale, Entitlements: []any{},
		AuthorizingIntegrationOwners: map[string]snow{}, Context: &where, AttachmentSizeLimit: b.s.Cfg.MaxUploadBytes}
	cid := snow(sc.ch.ID)
	p.ChannelID = &cid
	if dc, ok := b.channelObj(sc.ch); ok {
		perm := permString(sc.myPerms)
		dc.Permissions = &perm
		p.Channel = &dc
	}
	if sc.guild != nil {
		gid := snow(*sc.guild)
		p.GuildID = &gid
		loc := "en-US"
		p.GuildLocale = &loc
		p.Guild = &dInteractionGuild{ID: gid, Locale: loc, Features: []string{}}
		if srv, err := b.s.Store.ServerByID(b.ctx, *sc.guild); err == nil {
			p.Guild.Features = guildFeatures(srv)
		}
		if m, err := b.s.Store.Member(b.ctx, *sc.guild, sc.me.ID); err == nil {
			dm := b.memberObj(m, true)
			perm := permString(sc.myPerms)
			dm.Permissions = &perm
			p.Member = &dm
		}
	} else {
		u := b.userObj(sc.me)
		p.User = &u
	}
	p.AppPermissions = permString(sc.appPermissions())
	return p
}

// appPermissions is what the application may do in the channel: its bot's
// permissions there, or, where its bot is not a member, those of @everyone,
// which is what an application added to someone's account gets.
func (sc *interactionScene) appPermissions() perms.Perm {
	ctx, st := sc.b.ctx, sc.b.s.Store
	if sc.guild == nil {
		if hasID(sc.ch.Recipients, sc.bot.ID) {
			return perms.ViewChannel | perms.SendMessages | perms.ReadMessageHistory | perms.AddReactions | perms.AttachFiles | perms.EmbedLinks | perms.UseExternalEmojis
		}
		return perms.ViewChannel | perms.SendMessages | perms.EmbedLinks | perms.AttachFiles | perms.UseExternalEmojis
	}
	if member, _ := st.IsMember(ctx, *sc.guild, sc.bot.ID); member {
		p, _ := st.PermsIn(ctx, sc.ch, sc.bot.ID)
		return p
	}
	p, _ := st.EveryonePermsIn(ctx, sc.ch)
	return p
}

// --- commands ---------------------------------------------------------------------------------

// commandInteraction checks a command (or what is being typed into one, for
// autocomplete) and fills in the interaction.
func (s *Server) commandInteraction(r *http.Request, sc *interactionScene, req *interactRequest, it *store.Interaction, p *dInteraction) error {
	ctx := r.Context()
	var in interactCommand
	if err := json.Unmarshal(req.Data, &in); err != nil {
		return E(http.StatusBadRequest, "bad_data", "The command could not be read.")
	}
	c, err := s.Store.CommandByID(ctx, in.ID)
	if err != nil || c.ApplicationID != sc.app.ID {
		return E(http.StatusNotFound, "unknown_command", "That command is not there anymore.")
	}
	d := readCommandDef(c)
	var access *commandAccess
	if sc.guild != nil {
		access = s.newCommandAccess(ctx, sc.app.ID, sc.ch, sc.me.ID)
	}
	byGuild, byUser := commandUsable(c, d, sc.app, sc.how, sc.where, sc.guild, access)
	if !byGuild && !byUser {
		return E(http.StatusForbidden, "command_forbidden", "You cannot use that command here.")
	}
	if d.NSFW && !channelAgeRestricted(sc.ch) {
		return E(http.StatusForbidden, "command_nsfw", "That command is only for age-restricted channels.")
	}
	p.AuthorizingIntegrationOwners = sc.owners(byGuild, byUser)
	data := &dCommandData{ID: snow(c.ID), Name: c.Name, Type: c.Type, GuildID: botproto.SP(c.GuildID)}
	res := &dResolved{}
	switch c.Type {
	case cmdChatInput:
		opts, err := s.commandOptions(sc, d.Options, in.Options, req.Type == itAutocomplete, res, 0)
		if err != nil {
			return err
		}
		data.Options = opts
		if req.Type == itAutocomplete && !hasFocus(opts) {
			return E(http.StatusBadRequest, "bad_option", "Nothing is being typed into.")
		}
	case cmdUser:
		if req.Type == itAutocomplete || in.TargetID == nil {
			return E(http.StatusBadRequest, "bad_target", "Pick someone to use that on.")
		}
		u, err := s.Store.UserByID(ctx, *in.TargetID)
		if err != nil || u.Flags&store.FlagDeleted != 0 {
			return E(http.StatusNotFound, "unknown_user", "That person is not here.")
		}
		sc.resolveUser(res, u)
		t := snow(u.ID)
		data.TargetID = &t
	case cmdMessage:
		if req.Type == itAutocomplete || in.TargetID == nil {
			return E(http.StatusBadRequest, "bad_target", "Pick a message to use that on.")
		}
		m, err := s.Store.MessageByID(ctx, *in.TargetID, sc.me.ID)
		if err != nil || m.ChannelID != sc.ch.ID {
			return E(http.StatusNotFound, "unknown_message", "That message is not there anymore.")
		}
		s.withServerExtras(ctx, sc.ch, []*store.Message{m})
		opts := msgOpts{content: true}
		if sc.bot.Flags&store.FlagBotReadsAll == 0 {
			opts.copy = req.Copy
		}
		res.Messages = map[string]dMessage{botproto.OutString(m.ID): sc.b.messageObj(m, sc.ch, opts)}
		t := snow(m.ID)
		data.TargetID = &t
	default:
		return E(http.StatusBadRequest, "bad_command", "That command cannot be used.")
	}
	if !res.empty() {
		data.Resolved = res
	}
	p.Type = req.Type
	p.Data = data
	return nil
}

// channelAgeRestricted reports whether a channel is marked for adults.
func channelAgeRestricted(ch *store.Channel) bool { return ch.NSFW }

func hasFocus(list []dOptionValue) bool {
	for _, o := range list {
		if o.Focused || hasFocus(o.Options) {
			return true
		}
	}
	return false
}

// commandOptions checks the options someone filled in against the
// command's, and turns them into what the application is sent. For
// autocomplete, what is being typed (focused) is sent as typed, and nothing
// has to be complete yet.
func (s *Server) commandOptions(sc *interactionScene, defs []commandOption, in []interactOption, partial bool, res *dResolved, depth int) ([]dOptionValue, error) {
	bad := func(name, msg string) error {
		return E(http.StatusBadRequest, "bad_option", fmt.Sprintf("%s: %s", name, msg))
	}
	if len(in) > cmdMaxOptions {
		return nil, E(http.StatusBadRequest, "bad_option", "Too many options.")
	}
	// a command of subcommands takes exactly one of them
	if len(defs) > 0 && (defs[0].Type == optSubcommand || defs[0].Type == optGroup) {
		if len(in) != 1 {
			return nil, E(http.StatusBadRequest, "bad_option", "Pick one of the command's subcommands.")
		}
		def := findOption(defs, in[0].Name)
		if def == nil || (def.Type != optSubcommand && def.Type != optGroup) {
			return nil, bad(in[0].Name, "there is no such subcommand")
		}
		sub, err := s.commandOptions(sc, def.Options, in[0].Options, partial, res, depth+1)
		if err != nil {
			return nil, err
		}
		return []dOptionValue{{Name: def.Name, Type: def.Type, Options: sub}}, nil
	}
	out := make([]dOptionValue, 0, len(in))
	seen := map[string]bool{}
	focused := 0
	for _, o := range in {
		def := findOption(defs, o.Name)
		if def == nil || def.Type == optSubcommand || def.Type == optGroup {
			return nil, bad(o.Name, "there is no such option")
		}
		if seen[o.Name] {
			return nil, bad(o.Name, "given twice")
		}
		seen[o.Name] = true
		if o.Focused {
			if !partial || !def.Autocomplete {
				return nil, bad(o.Name, "nothing is suggested for it")
			}
			focused++
			// what is being typed goes as typed: a string, for every type
			var typed string
			if err := json.Unmarshal(o.Value, &typed); err != nil {
				var n json.Number
				if json.Unmarshal(o.Value, &n) != nil {
					return nil, bad(o.Name, "could not be read")
				}
				typed = n.String()
			}
			if utf8.RuneCountInString(typed) > cmdMaxStringLen {
				return nil, bad(o.Name, "too long")
			}
			out = append(out, dOptionValue{Name: def.Name, Type: def.Type, Value: typed, Focused: true})
			continue
		}
		v, err := s.optionValue(sc, def, o.Value, res)
		if err != nil {
			if partial {
				// an option not yet valid is left out of a suggestion request
				continue
			}
			return nil, bad(def.Name, err.Error())
		}
		out = append(out, dOptionValue{Name: def.Name, Type: def.Type, Value: v})
	}
	if focused > 1 {
		return nil, E(http.StatusBadRequest, "bad_option", "Only one option can be typed into at a time.")
	}
	if !partial {
		for _, def := range defs {
			if def.Required && !seen[def.Name] {
				return nil, bad(def.Name, "this option is required")
			}
		}
	}
	return out, nil
}

func findOption(defs []commandOption, name string) *commandOption {
	for i := range defs {
		if defs[i].Name == name {
			return &defs[i]
		}
	}
	return nil
}

// optionValue reads one option's value, checks it and resolves what it names.
func (s *Server) optionValue(sc *interactionScene, def *commandOption, raw json.RawMessage, res *dResolved) (any, error) {
	ctx := sc.b.ctx
	readID := func() (ids.ID, error) {
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			var n json.Number
			if json.Unmarshal(raw, &n) != nil {
				return 0, errors.New("not an id")
			}
			str = n.String()
		}
		return ids.Parse(str)
	}
	switch def.Type {
	case optString:
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, errors.New("must be text")
		}
		v = clean(v)
		n := utf8.RuneCountInString(v)
		min, max := 0, cmdMaxStringLen
		if def.MinLength != nil {
			min = *def.MinLength
		}
		if def.MaxLength != nil {
			max = *def.MaxLength
		}
		if n < min || n > max || (n == 0 && min == 0 && def.Required) {
			return nil, fmt.Errorf("must be between %d and %d characters", min, max)
		}
		if len(def.Choices) > 0 && !choiceHas(def.Choices, v) {
			return nil, errors.New("must be one of its choices")
		}
		return v, nil
	case optInteger, optNumber:
		var n json.Number
		if err := json.Unmarshal(raw, &n); err != nil {
			var str string
			if json.Unmarshal(raw, &str) != nil {
				return nil, errors.New("must be a number")
			}
			n = json.Number(strings.TrimSpace(str))
		}
		f, err := n.Float64()
		if err != nil {
			return nil, errors.New("must be a number")
		}
		if def.Type == optInteger {
			i, err := strconv.ParseInt(n.String(), 10, 64)
			if err != nil {
				return nil, errors.New("must be a whole number")
			}
			f = float64(i)
		}
		if f > cmdMaxSafeNumber || f < -cmdMaxSafeNumber {
			return nil, errors.New("is too large")
		}
		if def.MinValue != nil {
			if lo, _ := def.MinValue.Float64(); f < lo {
				return nil, fmt.Errorf("must be at least %s", def.MinValue.String())
			}
		}
		if def.MaxValue != nil {
			if hi, _ := def.MaxValue.Float64(); f > hi {
				return nil, fmt.Errorf("must be at most %s", def.MaxValue.String())
			}
		}
		if len(def.Choices) > 0 && !choiceHas(def.Choices, f) {
			return nil, errors.New("must be one of its choices")
		}
		if def.Type == optInteger {
			return json.Number(strconv.FormatInt(int64(f), 10)), nil
		}
		return json.Number(strconv.FormatFloat(f, 'f', -1, 64)), nil
	case optBoolean:
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, errors.New("must be yes or no")
		}
		return v, nil
	case optUser, optMentionable:
		id, err := readID()
		if err != nil {
			return nil, errors.New("must name someone")
		}
		if u, err := s.Store.UserByID(ctx, id); err == nil && u.Flags&store.FlagDeleted == 0 {
			sc.resolveUser(res, u)
			return botproto.OutString(u.ID), nil
		}
		if def.Type == optMentionable && sc.guild != nil {
			if role, err := s.Store.RoleByID(ctx, id); err == nil && role.ServerID == *sc.guild {
				sc.resolveRole(res, role)
				return botproto.OutString(role.ID), nil
			}
		}
		return nil, errors.New("names nobody here")
	case optRole:
		id, err := readID()
		if err != nil || sc.guild == nil {
			return nil, errors.New("must name a role")
		}
		role, err := s.Store.RoleByID(ctx, id)
		if err != nil || role.ServerID != *sc.guild {
			return nil, errors.New("names no role of this server")
		}
		sc.resolveRole(res, role)
		return botproto.OutString(role.ID), nil
	case optChannel:
		id, err := readID()
		if err != nil {
			return nil, errors.New("must name a channel")
		}
		target, err := s.Store.ChannelByID(ctx, id)
		if err != nil {
			return nil, errors.New("names no channel")
		}
		// a server's channels, or this very conversation
		if sc.guild != nil {
			if target.ServerID == nil || *target.ServerID != *sc.guild {
				return nil, errors.New("names no channel of this server")
			}
		} else if target.ID != sc.ch.ID {
			return nil, errors.New("names no channel here")
		}
		p, err := s.Store.PermsIn(ctx, target, sc.me.ID)
		if err != nil || !p.Has(perms.ViewChannel) {
			return nil, errors.New("names no channel you can see")
		}
		t, ok := sc.b.channelType(target)
		if !ok || (len(def.ChannelTypes) > 0 && !hasInt(def.ChannelTypes, t)) {
			return nil, errors.New("names the wrong kind of channel")
		}
		sc.resolveChannel(res, target, p)
		return botproto.OutString(target.ID), nil
	case optAttachment:
		id, err := readID()
		if err != nil {
			return nil, errors.New("must be a file")
		}
		f, err := s.Store.InteractionFileByBlob(ctx, id)
		if err != nil || f.UserID != sc.me.ID {
			return nil, errors.New("names no file you sent")
		}
		blob, err := s.Store.BlobByID(ctx, id)
		if err != nil || blob.Kind != media.KindWebhookFile {
			return nil, errors.New("names no file you sent")
		}
		sc.resolveFile(res, blob)
		return botproto.OutString(blob.ID), nil
	}
	return nil, errors.New("cannot be used")
}

// choiceHas reports whether v is one of the choices' values.
func choiceHas(list []commandChoice, v any) bool {
	for _, c := range list {
		switch x := c.Value.(type) {
		case string:
			if s, ok := v.(string); ok && s == x {
				return true
			}
		case json.Number:
			if f, ok := v.(float64); ok {
				if cf, err := x.Float64(); err == nil && cf == f {
					return true
				}
			}
		case float64:
			if f, ok := v.(float64); ok && f == x {
				return true
			}
		}
	}
	return false
}

// --- resolved objects ----------------------------------------------------------------------

func (sc *interactionScene) resolveUser(res *dResolved, u *store.User) {
	b := sc.b
	key := botproto.OutString(u.ID)
	if res.Users == nil {
		res.Users = map[string]dUser{}
	}
	res.Users[key] = b.userObj(u)
	if sc.guild == nil {
		return
	}
	m, err := b.s.Store.Member(b.ctx, *sc.guild, u.ID)
	if err != nil {
		return
	}
	dm := b.memberObj(m, false)
	if p, err := b.s.Store.PermsIn(b.ctx, sc.ch, u.ID); err == nil {
		perm := permString(p)
		dm.Permissions = &perm
	}
	if res.Members == nil {
		res.Members = map[string]dMember{}
	}
	res.Members[key] = dm
}

func (sc *interactionScene) resolveRole(res *dResolved, role *store.Role) {
	if res.Roles == nil {
		res.Roles = map[string]dRole{}
	}
	res.Roles[botproto.OutString(role.ID)] = sc.b.roleObj(role)
}

func (sc *interactionScene) resolveChannel(res *dResolved, ch *store.Channel, p perms.Perm) {
	dc, ok := sc.b.channelObj(ch)
	if !ok {
		return
	}
	perm := permString(p)
	dc.Permissions = &perm
	if res.Channels == nil {
		res.Channels = map[string]dChannel{}
	}
	res.Channels[botproto.OutString(ch.ID)] = dc
}

// resolveFile adds a file someone sent with an interaction, which the
// application fetches at its signed address.
func (sc *interactionScene) resolveFile(res *dResolved, blob *store.Blob) {
	if res.Attachments == nil {
		res.Attachments = map[string]dAttachment{}
	}
	name := "file"
	if f, err := sc.b.s.Store.InteractionFileByBlob(sc.b.ctx, blob.ID); err == nil && f.Filename != "" {
		name = f.Filename
	}
	u := sc.b.s.interactionFileURL(sc.app.ID, blob.ID, name)
	a := dAttachment{ID: snow(blob.ID), Filename: name, Size: blob.Size, URL: u, ProxyURL: u, Width: blob.Width, Height: blob.Height, Ephemeral: true, ContentType: blob.Mime}
	res.Attachments[botproto.OutString(blob.ID)] = a
}

// interactionFileURL is where an application fetches a file someone sent it
// with an interaction: signed for that application, for a day.
func (s *Server) interactionFileURL(app, blob ids.ID, name string) string {
	issued := time.Now().Unix()
	expires := issued + 24*3600
	sig := s.fileSig(blob, app, expires)
	return s.absoluteURL("/cdn/ephemeral-attachments/"+botproto.OutString(app)+"/"+botproto.OutString(blob)+"/"+url.PathEscape(name)) +
		"?ex=" + strconv.FormatInt(expires, 16) + "&is=" + strconv.FormatInt(issued, 16) + "&hm=" + sig
}

// --- components -----------------------------------------------------------------------------

// findComponent finds the component with a custom id in a message's.
func findComponent(list []wmComponent, customID string) *wmComponent {
	for i := range list {
		c := &list[i]
		if c.CustomID == customID && c.CustomID != "" {
			return c
		}
		if found := findComponent(c.Components, customID); found != nil {
			return found
		}
		if c.Accessory != nil {
			if c.Accessory.CustomID == customID {
				return c.Accessory
			}
		}
	}
	return nil
}

// interactedMessage is the message an interaction's component is on: the
// application's message in the channel, or one only this person sees.
func (s *Server) interactedMessage(ctx context.Context, sc *interactionScene, id ids.ID) (*store.Message, *wmPlain, bool, error) {
	if m, err := s.Store.MessageByID(ctx, id, sc.me.ID); err == nil {
		if m.ChannelID != sc.ch.ID || len(m.Webhook) == 0 || m.WebhookID != nil {
			return nil, nil, false, ErrNotFound
		}
		var p wmPlain
		if json.Unmarshal(m.Webhook, &p) != nil || p.ApplicationID == nil || *p.ApplicationID != sc.app.ID {
			return nil, nil, false, ErrNotFound
		}
		return m, &p, false, nil
	}
	e, err := s.Store.EphemeralByID(ctx, id)
	if err != nil || e.UserID != sc.me.ID || e.ChannelID != sc.ch.ID || e.ApplicationID != sc.app.ID {
		return nil, nil, false, ErrNotFound
	}
	var p wmPlain
	if json.Unmarshal(e.Plain, &p) != nil {
		return nil, nil, false, ErrNotFound
	}
	return ephemeralAsMessage(e), &p, true, nil
}

// componentInteraction checks a click on a button, or a pick in a select
// menu, on an application's message, and fills in the interaction.
func (s *Server) componentInteraction(r *http.Request, sc *interactionScene, req *interactRequest, it *store.Interaction, p *dInteraction) error {
	ctx := r.Context()
	if req.MessageID == nil {
		return E(http.StatusBadRequest, "bad_message", "That button is not on a message.")
	}
	m, plain, ephemeral, err := s.interactedMessage(ctx, sc, *req.MessageID)
	if err != nil {
		return E(http.StatusNotFound, "unknown_message", "That message is not there anymore.")
	}
	var in interactComponent
	if err := json.Unmarshal(req.Data, &in); err != nil {
		return E(http.StatusBadRequest, "bad_data", "That could not be read.")
	}
	c := findComponent(plain.Components, in.CustomID)
	if c == nil || c.Type != in.ComponentType || c.Disabled {
		return E(http.StatusBadRequest, "unknown_component", "That button cannot be used.")
	}
	data := &dComponentData{CustomID: c.CustomID, ComponentType: c.Type}
	res := &dResolved{}
	switch c.Type {
	case compButton:
		if c.Style == btnLink || c.Style == btnPremium {
			return E(http.StatusBadRequest, "unknown_component", "That button cannot be used.")
		}
	case compStringSel, compUserSel, compRoleSel, compMentionSel, compChannelSel:
		values, err := s.selectValues(sc, c, in.Values, res)
		if err != nil {
			return err
		}
		data.Values = values
	default:
		return E(http.StatusBadRequest, "unknown_component", "That cannot be used.")
	}
	if !res.empty() {
		data.Resolved = res
	}
	it.MessageID = &m.ID
	p.Type = itComponent
	p.Data = data
	dm := sc.b.messageObj(m, sc.ch, msgOpts{content: true})
	if ephemeral {
		dm.Flags |= dMsgEphemeral
	}
	p.Message = &dm
	// the application answers through how it was installed for that message
	byGuild, byUser := sc.installedFor(plain)
	p.AuthorizingIntegrationOwners = sc.owners(byGuild, byUser)
	return nil
}

// installedFor is how the application is installed for a message it made
// in answer to someone: as it was then, if still so, or as it is now.
func (sc *interactionScene) installedFor(plain *wmPlain) (byGuild, byUser bool) {
	byGuild = hasInt(sc.how, installGuild)
	byUser = hasInt(sc.how, installUser)
	if plain != nil && plain.Interaction != nil && len(plain.Interaction.Owners) > 0 {
		_, g := plain.Interaction.Owners["0"]
		_, u := plain.Interaction.Owners["1"]
		if (g && byGuild) || (u && byUser) {
			return g && byGuild, u && byUser
		}
	}
	return byGuild, byUser
}

// selectValues checks what was picked in a select menu.
func (s *Server) selectValues(sc *interactionScene, c *wmComponent, values []string, res *dResolved) ([]string, error) {
	min, max := 1, 1
	if c.MinValues != nil {
		min = *c.MinValues
	}
	if c.MaxValues != nil {
		max = *c.MaxValues
	}
	if len(values) < min || len(values) > max {
		return nil, E(http.StatusBadRequest, "bad_values", fmt.Sprintf("Pick between %d and %d.", min, max))
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	ctx := sc.b.ctx
	for _, v := range values {
		if seen[v] {
			return nil, E(http.StatusBadRequest, "bad_values", "The same thing was picked twice.")
		}
		seen[v] = true
		if c.Type == compStringSel {
			found := false
			for _, o := range c.Options {
				if o.Value == v {
					found = true
					break
				}
			}
			if !found {
				return nil, E(http.StatusBadRequest, "bad_values", "That is not one of the choices.")
			}
			out = append(out, v)
			continue
		}
		id, err := ids.Parse(v)
		if err != nil {
			return nil, E(http.StatusBadRequest, "bad_values", "That could not be read.")
		}
		switch c.Type {
		case compUserSel, compMentionSel:
			if u, err := s.Store.UserByID(ctx, id); err == nil && u.Flags&store.FlagDeleted == 0 {
				sc.resolveUser(res, u)
				out = append(out, botproto.OutString(id))
				continue
			}
			if c.Type == compMentionSel && sc.guild != nil {
				if role, err := s.Store.RoleByID(ctx, id); err == nil && role.ServerID == *sc.guild {
					sc.resolveRole(res, role)
					out = append(out, botproto.OutString(id))
					continue
				}
			}
			return nil, E(http.StatusBadRequest, "bad_values", "That names nobody here.")
		case compRoleSel:
			role, err := s.Store.RoleByID(ctx, id)
			if err != nil || sc.guild == nil || role.ServerID != *sc.guild {
				return nil, E(http.StatusBadRequest, "bad_values", "That names no role of this server.")
			}
			sc.resolveRole(res, role)
			out = append(out, botproto.OutString(id))
		case compChannelSel:
			target, err := s.Store.ChannelByID(ctx, id)
			if err != nil || (sc.guild != nil && (target.ServerID == nil || *target.ServerID != *sc.guild)) || (sc.guild == nil && target.ID != sc.ch.ID) {
				return nil, E(http.StatusBadRequest, "bad_values", "That names no channel here.")
			}
			p, err := s.Store.PermsIn(ctx, target, sc.me.ID)
			if err != nil || !p.Has(perms.ViewChannel) {
				return nil, E(http.StatusBadRequest, "bad_values", "That names no channel you can see.")
			}
			t, ok := sc.b.channelType(target)
			if !ok || (len(c.ChannelTypes) > 0 && !hasInt(c.ChannelTypes, t)) {
				return nil, E(http.StatusBadRequest, "bad_values", "That is the wrong kind of channel.")
			}
			sc.resolveChannel(res, target, p)
			out = append(out, botproto.OutString(id))
		}
	}
	return out, nil
}

// --- forms --------------------------------------------------------------------------------

// modalInteraction checks a submitted form against the one the application
// opened for this person, and fills in the interaction.
func (s *Server) modalInteraction(r *http.Request, sc *interactionScene, req *interactRequest, it *store.Interaction, p *dInteraction) error {
	ctx := r.Context()
	if req.ModalOf == nil {
		return E(http.StatusBadRequest, "bad_modal", "That form was not opened by the app.")
	}
	opener, err := s.Store.InteractionByID(ctx, *req.ModalOf)
	if err != nil || opener.UserID != sc.me.ID || opener.ApplicationID != sc.app.ID || opener.ResponseType != cbModal || len(opener.Modal) == 0 ||
		opener.ExpiresAt < time.Now().UnixMilli() || opener.ChannelID == nil || *opener.ChannelID != sc.ch.ID {
		return E(http.StatusGone, "modal_expired", "That form has expired. Open it again.")
	}
	var modal modalDef
	if err := json.Unmarshal(opener.Modal, &modal); err != nil {
		return E(http.StatusGone, "modal_expired", "That form has expired. Open it again.")
	}
	var in interactModal
	if err := json.Unmarshal(req.Data, &in); err != nil || in.CustomID != modal.CustomID {
		return E(http.StatusBadRequest, "bad_data", "The form could not be read.")
	}
	res := &dResolved{}
	parts, err := s.modalSubmission(sc, &modal, in.Fields, res)
	if err != nil {
		return err
	}
	data := &dModalData{CustomID: modal.CustomID, Components: parts}
	if !res.empty() {
		data.Resolved = res
	}
	p.Type = itModalSubmit
	p.Data = data
	// a form opened from a button carries that button's message along
	if opener.MessageID != nil {
		if m, plain, ephemeral, err := s.interactedMessage(ctx, sc, *opener.MessageID); err == nil {
			_ = plain
			it.MessageID = &m.ID
			dm := sc.b.messageObj(m, sc.ch, msgOpts{content: true})
			if ephemeral {
				dm.Flags |= dMsgEphemeral
			}
			p.Message = &dm
		}
	}
	var stored dInteraction
	_ = json.Unmarshal(opener.Data, &stored)
	p.AuthorizingIntegrationOwners = stored.AuthorizingIntegrationOwners
	if p.AuthorizingIntegrationOwners == nil {
		p.AuthorizingIntegrationOwners = sc.owners(sc.installedFor(nil))
	}
	// the submission remembers what opened its form, for its messages
	it.TokenHash = "trigger:" + opener.ID.String()
	return nil
}

// --- running it -----------------------------------------------------------------------------

// runInteraction stores an interaction, hands it to its application and
// waits for the first answer.
func (s *Server) runInteraction(r *http.Request, sc *interactionScene, it *store.Interaction, p *dInteraction) (*interactionAnswer, error) {
	ctx := r.Context()
	token := newWebhookToken()
	trigger := ""
	if strings.HasPrefix(it.TokenHash, "trigger:") {
		trigger = strings.TrimPrefix(it.TokenHash, "trigger:")
	}
	it.TokenHash = tokenHash(token)
	p.Token = token
	now := time.Now()
	it.CreatedAt = now.UnixMilli()
	it.ExpiresAt = now.Add(interactionLife).UnixMilli()
	// what is kept is what the application was sent, without its token
	kept := *p
	kept.Token = ""
	raw, err := json.Marshal(storedInteraction{dInteraction: kept, Trigger: trigger})
	if err != nil {
		return nil, err
	}
	it.Data = raw
	if err := s.Store.CreateInteraction(ctx, it); err != nil {
		return nil, err
	}
	wait := s.bots.awaitAnswer(it.ID)
	defer s.bots.forgetAnswer(it.ID)
	if sc.app.InteractionsURL != "" {
		go s.postInteraction(r, sc.app, it, p)
	} else if !s.deliverInteraction(sc.app.ID, sc.guild, p) {
		_, _ = s.Store.DeleteInteraction(ctx, it.ID)
		return nil, errAppUnavailable
	}
	timer := time.NewTimer(interactionWait + 500*time.Millisecond)
	defer timer.Stop()
	select {
	case a := <-wait:
		if a.err != nil {
			return nil, a.err
		}
		return a, nil
	case <-timer.C:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	// too late: the token stops working, unless an answer is just landing
	if gone, _ := s.Store.DeleteInteraction(context.WithoutCancel(ctx), it.ID); gone {
		return nil, errAppNoAnswer
	}
	select {
	case a := <-wait:
		if a.err != nil {
			return nil, a.err
		}
		return a, nil
	case <-time.After(5 * time.Second):
		return nil, errAppNoAnswer
	}
}

// storedInteraction is what an interaction's row keeps: what its
// application was sent, and for a form's submission what opened the form.
type storedInteraction struct {
	dInteraction
	Trigger string `json:"nexa_trigger,omitempty"`
}

// readStored reads an interaction's row back.
func readStored(it *store.Interaction) *storedInteraction {
	var st storedInteraction
	_ = json.Unmarshal(it.Data, &st)
	return &st
}

// --- the interactions endpoint --------------------------------------------------------------

// appSigner is the key an application's interactions are signed with.
func (s *Server) appSigner(app *store.Application) (ed25519.PrivateKey, error) {
	raw, err := s.openBotSecret(app.SignKeySealed)
	if err != nil {
		return nil, err
	}
	switch len(raw) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(raw), nil
	case ed25519.PrivateKeySize:
		return ed25519.PrivateKey(raw), nil
	}
	return nil, errors.New("bot: bad signing key")
}

// endpointClient is the client interactions go to applications' endpoints
// with: through the egress proxy, to public addresses only, never following
// a redirect.
func (s *Server) endpointClient() *http.Client {
	if s.botHTTP != nil {
		return s.botHTTP
	}
	f := &unfurl.Fetcher{Timeout: interactionWait, MaxBytes: 4 << 20}
	if s.Unfurl != nil && s.Unfurl.Fetcher != nil {
		f.Dial, f.Resolver = s.Unfurl.Fetcher.Dial, s.Unfurl.Fetcher.Resolver
	}
	c := f.Client()
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c
}

// signedPost posts a JSON body to an application's endpoint, signed as the
// protocol signs interactions, and returns the reply's status and body.
func (s *Server) signedPost(ctx context.Context, app *store.Application, endpoint string, body []byte, badSignature bool) (int, []byte, error) {
	key, err := s.appSigner(app)
	if err != nil {
		return 0, nil, err
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	sig := ed25519.Sign(key, append([]byte(ts), body...))
	if badSignature {
		sig[0] ^= 0xff
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Discord-Interactions/1.0 (+"+s.Cfg.PublicURL+")")
	req.Header.Set("X-Signature-Ed25519", hex.EncodeToString(sig))
	req.Header.Set("X-Signature-Timestamp", ts)
	resp, err := s.endpointClient().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, out, err
}

// postInteraction hands an interaction to its application's endpoint and
// applies the answer the endpoint replies with.
func (s *Server) postInteraction(r *http.Request, app *store.Application, it *store.Interaction, p *dInteraction) {
	ctx, cancel := context.WithTimeout(r.Context(), interactionWait)
	defer cancel()
	body, err := json.Marshal(p)
	if err != nil {
		s.bots.answered(it.ID, &interactionAnswer{err: errAppUnavailable})
		return
	}
	status, reply, err := s.signedPost(ctx, app, app.InteractionsURL, body, false)
	if err != nil || status < 200 || status >= 300 {
		s.Log.Info("interactions endpoint", "app", app.ID, "status", status, "err", err)
		s.bots.answered(it.ID, &interactionAnswer{err: errAppUnavailable})
		return
	}
	if len(bytes.TrimSpace(reply)) == 0 || status == http.StatusAccepted || status == http.StatusNoContent {
		// the endpoint will answer through the callback route
		return
	}
	dec := json.NewDecoder(bytes.NewReader(reply))
	dec.UseNumber()
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		s.bots.answered(it.ID, &interactionAnswer{err: errAppBadAnswer})
		return
	}
	if _, err := s.answerInteraction(r, it, app, raw, nil); err != nil {
		s.Log.Info("interactions endpoint answer", "app", app.ID, "err", err)
		s.bots.answered(it.ID, &interactionAnswer{err: errAppBadAnswer})
	}
}

// pingEndpoint checks an interactions endpoint the way the protocol does
// before one is accepted: a ping must be answered with a pong, and a request
// with a wrong signature refused.
func (s *Server) pingEndpoint(ctx context.Context, app *store.Application, endpoint string) error {
	ping, _ := json.Marshal(map[string]any{"id": snow(ids.New()), "application_id": snow(app.ID), "type": itPing, "token": newWebhookToken(), "version": 1,
		"entitlements": []any{}, "authorizing_integration_owners": map[string]any{}})
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	status, reply, err := s.signedPost(ctx, app, endpoint, ping, false)
	if err != nil {
		return E(http.StatusBadRequest, "endpoint_unreachable", "That address could not be reached.")
	}
	var pong struct {
		Type int `json:"type"`
	}
	if status != http.StatusOK || json.Unmarshal(reply, &pong) != nil || pong.Type != cbPong {
		return E(http.StatusBadRequest, "endpoint_no_pong", "That address did not answer a ping with a pong.")
	}
	status, _, err = s.signedPost(ctx, app, endpoint, ping, true)
	if err != nil {
		return E(http.StatusBadRequest, "endpoint_unreachable", "That address could not be reached.")
	}
	if status != http.StatusUnauthorized {
		return E(http.StatusBadRequest, "endpoint_unsigned", "That address took a request with a wrong signature. It must refuse those with 401.")
	}
	return nil
}

// --- answers --------------------------------------------------------------------------------

// botInteractionCallback is an application's first answer to an interaction.
func (s *Server) botInteractionCallback(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "interaction")
	if !ok {
		writeBotError(w, dErrUnknownInteract, nil)
		return
	}
	ctx := r.Context()
	it, err := s.Store.InteractionByID(ctx, id)
	token := r.PathValue("token")
	if err != nil || len(token) > 512 || tokenHash(token) != it.TokenHash || it.ExpiresAt < time.Now().UnixMilli() {
		writeBotError(w, dErrUnknownInteract, nil)
		return
	}
	// the first answer must come within three seconds
	if it.ResponseType == 0 && time.Since(time.UnixMilli(it.CreatedAt)) > interactionWait+500*time.Millisecond {
		writeBotError(w, dErrUnknownInteract, nil)
		return
	}
	if it.ResponseType != 0 {
		writeBotError(w, dErrAcknowledged, nil)
		return
	}
	app, err := s.Store.ApplicationByID(ctx, it.ApplicationID)
	if err != nil {
		writeBotError(w, dErrUnknownInteract, nil)
		return
	}
	raw, files, derr := s.readWebhookBody(w, r, app.ID)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	res, err := s.answerInteraction(r, it, app, raw, files)
	if err != nil {
		s.dropFiles(files)
		writeBotError(w, err, dErrUnknownInteract)
		return
	}
	if !boolQuery(r, "with_response", false) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	WriteJSON(w, http.StatusOK, res)
}

// dCallbackResponse is what the callback route answers with_response.
type dCallbackResponse struct {
	Interaction dCallbackInteraction `json:"interaction"`
	Resource    *dCallbackResource   `json:"resource,omitempty"`
}

type dCallbackInteraction struct {
	ID                       snow    `json:"id"`
	Type                     int     `json:"type"`
	ActivityInstanceID       *string `json:"activity_instance_id,omitempty"`
	ResponseMessageID        *snow   `json:"response_message_id,omitempty"`
	ResponseMessageLoading   *bool   `json:"response_message_loading,omitempty"`
	ResponseMessageEphemeral *bool   `json:"response_message_ephemeral,omitempty"`
}

type dCallbackResource struct {
	Type    int       `json:"type"`
	Message *dMessage `json:"message,omitempty"`
}

// allowedAnswers are the answers each kind of interaction takes.
func answerAllowed(itType, cb int, fromComponent bool) bool {
	switch itType {
	case itPing:
		return cb == cbPong
	case itCommand:
		return cb == cbMessage || cb == cbDeferredMessage || cb == cbModal
	case itComponent:
		return cb == cbMessage || cb == cbDeferredMessage || cb == cbDeferredUpdate || cb == cbUpdateMessage || cb == cbModal
	case itAutocomplete:
		return cb == cbAutocomplete
	case itModalSubmit:
		return cb == cbMessage || cb == cbDeferredMessage || ((cb == cbDeferredUpdate || cb == cbUpdateMessage) && fromComponent)
	}
	return false
}

// answerInteraction applies an application's first answer: posts the
// message, opens the form, hands over the suggestions, and tells the person's
// app waiting for it. r is the request it came with (the callback, or the
// person's own when the endpoint answered in its reply).
func (s *Server) answerInteraction(r *http.Request, it *store.Interaction, app *store.Application, raw map[string]any, files []whFile) (*dCallbackResponse, error) {
	ctx := r.Context()
	errs := &formErrors{}
	rd := jsonReader{errs}
	cb, ok := rd.integer(raw, "type", nil)
	if !ok {
		if errs.empty() {
			errs.add(fieldPath("type"), "BASE_TYPE_REQUIRED", "This field is required")
		}
		return nil, errs.err()
	}
	if !answerAllowed(it.Type, int(cb), it.MessageID != nil) {
		if cb == cbPremiumRequired || cb == cbLaunchActivity {
			return nil, dFormError("INTERACTION_RESPONSE_TYPE_UNSUPPORTED", "Nothing is for sale and there are no activities on this server.", "type")
		}
		return nil, dFormError("INTERACTION_RESPONSE_TYPE_INVALID", "Invalid interaction response type", "type")
	}
	data, _ := rd.object(raw, "data", nil)
	if data == nil {
		data = map[string]any{}
	}
	if !errs.empty() {
		return nil, errs.err()
	}
	st := readStored(it)
	out := &dCallbackResponse{Interaction: dCallbackInteraction{ID: snow(it.ID), Type: it.Type}}
	ans := &interactionAnswer{ID: it.ID, Type: int(cb)}
	switch int(cb) {
	case cbPong:
		return out, nil
	case cbAutocomplete:
		choices, err := autocompleteChoices(rd, data, focusedType(st))
		if err != nil {
			return nil, err
		}
		if ok, err := s.Store.AnswerInteraction(ctx, it.ID, cbAutocomplete, nil, false, nil); err != nil {
			return nil, err
		} else if !ok {
			return nil, dErrAcknowledged
		}
		ans.Choices = choices
		out.Resource = &dCallbackResource{Type: cbAutocomplete}
	case cbModal:
		modal, err := parseModal(rd, data)
		if err != nil {
			return nil, err
		}
		stored, err := json.Marshal(modal)
		if err != nil {
			return nil, err
		}
		if ok, err := s.Store.AnswerInteraction(ctx, it.ID, cbModal, nil, false, stored); err != nil {
			return nil, err
		} else if !ok {
			return nil, dErrAcknowledged
		}
		ans.Modal = modal
		out.Resource = &dCallbackResource{Type: cbModal}
	case cbDeferredUpdate:
		if ok, err := s.Store.AnswerInteraction(ctx, it.ID, cbDeferredUpdate, it.MessageID, false, nil); err != nil {
			return nil, err
		} else if !ok {
			return nil, dErrAcknowledged
		}
		out.Resource = &dCallbackResource{Type: cbDeferredUpdate}
	case cbMessage, cbDeferredMessage, cbUpdateMessage:
		m, ephemeral, err := s.answerMessage(r, it, app, st, int(cb), data, files)
		if err != nil {
			return nil, err
		}
		ans.Message = m
		mid := snow(m.ID)
		out.Interaction.ResponseMessageID = &mid
		loading := cb == cbDeferredMessage
		out.Interaction.ResponseMessageLoading = &loading
		out.Interaction.ResponseMessageEphemeral = &ephemeral
		ch, _ := s.Store.ChannelByID(ctx, m.ChannelID)
		b := s.builder(ctx, nil, app)
		bot, _ := s.Store.UserByID(ctx, app.ID)
		b.viewer = bot
		dm := b.messageObj(m, ch, msgOpts{content: true})
		out.Resource = &dCallbackResource{Type: int(cb), Message: &dm}
	}
	s.bots.answered(it.ID, ans)
	return out, nil
}

// focusedType is the type of the option an autocomplete request is about.
func focusedType(st *storedInteraction) int {
	raw, err := json.Marshal(st.Data)
	if err != nil {
		return optString
	}
	var data struct {
		Options []dOptionValue `json:"options"`
	}
	_ = json.Unmarshal(raw, &data)
	var walk func(list []dOptionValue) int
	walk = func(list []dOptionValue) int {
		for _, o := range list {
			if o.Focused {
				return o.Type
			}
			if t := walk(o.Options); t != 0 {
				return t
			}
		}
		return 0
	}
	if t := walk(data.Options); t != 0 {
		return t
	}
	return optString
}

// autocompleteChoices reads the suggestions an application offers.
func autocompleteChoices(rd jsonReader, data map[string]any, t int) ([]commandChoice, error) {
	list, _ := rd.list(data, "choices", fieldPath("data"))
	if len(list) > cmdMaxChoices {
		rd.errs.add(fieldPath("data", "choices"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", cmdMaxChoices))
		return nil, rd.errs.err()
	}
	cr := commandReader{rd}
	out := []commandChoice{}
	for i, v := range list {
		obj, ok := v.(map[string]any)
		if !ok {
			rd.errs.add(fieldPath("data", "choices", i), "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		if c := cr.choice(obj, fieldPath("data", "choices", i), t); c != nil {
			out = append(out, *c)
		}
	}
	if !rd.errs.empty() {
		return nil, rd.errs.err()
	}
	return out, nil
}

// interactionMeta is the interaction a message made in answer to it says it
// answers.
func interactionMeta(it *store.Interaction, st *storedInteraction) *wmInteraction {
	meta := &wmInteraction{ID: it.ID, Type: it.Type, UserID: it.UserID, Owners: map[string]ids.ID{}}
	for k, v := range st.AuthorizingIntegrationOwners {
		meta.Owners[k] = ids.ID(v)
	}
	raw, _ := json.Marshal(st.Data)
	var data struct {
		Name     string `json:"name"`
		Type     int    `json:"type"`
		TargetID snow   `json:"target_id"`
	}
	_ = json.Unmarshal(raw, &data)
	switch it.Type {
	case itCommand:
		meta.Name, meta.CommandType = data.Name, data.Type
		if data.TargetID != 0 {
			t := ids.ID(data.TargetID)
			if data.Type == cmdUser {
				meta.TargetUserID = &t
			} else if data.Type == cmdMessage {
				meta.TargetMessageID = &t
			}
		}
	case itComponent:
		meta.InteractedMessageID = it.MessageID
	}
	return meta
}

// answerMessage makes the message an answer posts (4), the message that
// thinks until the application fills it in (5), or changes the message a
// component is on (7).
func (s *Server) answerMessage(r *http.Request, it *store.Interaction, app *store.Application, st *storedInteraction, cb int, data map[string]any, files []whFile) (*store.Message, bool, error) {
	ctx := r.Context()
	if it.ChannelID == nil {
		return nil, false, dErrUnknownChannel
	}
	ch, err := s.Store.ChannelByID(ctx, *it.ChannelID)
	if err != nil {
		return nil, false, dErrUnknownChannel
	}
	bot, err := s.Store.UserByID(ctx, app.ID)
	if err != nil {
		return nil, false, err
	}
	meta := interactionMeta(it, st)
	if st.Trigger != "" {
		if tid, err := ids.Parse(st.Trigger); err == nil {
			if opener, err := s.Store.InteractionByID(ctx, tid); err == nil {
				meta.Trigger = interactionMeta(opener, readStored(opener))
			}
		}
	}
	if cb == cbUpdateMessage {
		if it.MessageID == nil {
			return nil, false, dErrUnknownMessage
		}
		in, errs := parseWebhookBody(data, whParseOpts{edit: true, app: true, withComponents: true})
		if !errs.empty() {
			return nil, false, errs.err()
		}
		if ok, err := s.Store.AnswerInteraction(ctx, it.ID, cbUpdateMessage, it.MessageID, false, nil); err != nil {
			return nil, false, err
		} else if !ok {
			return nil, false, dErrAcknowledged
		}
		m, ephemeral, err := s.editAnswer(r, it, app, ch, *it.MessageID, in, files, false)
		if err != nil {
			_ = s.Store.ReleaseInteraction(ctx, it.ID)
			return nil, false, err
		}
		return m, ephemeral, nil
	}
	var in *whInput
	if cb == cbDeferredMessage {
		in = &whInput{Present: map[string]bool{}}
		if f, ok := (jsonReader{&formErrors{}}).integer(data, "flags", nil); ok {
			in.Flags = f & MsgFlagEphemeral
		}
	} else {
		var errs *formErrors
		in, errs = parseWebhookBody(data, whParseOpts{app: true, ephemeral: true})
		if !errs.empty() {
			return nil, false, errs.err()
		}
	}
	ephemeral := in.Flags&MsgFlagEphemeral != 0 || s.forcedEphemeral(ctx, ch, it, st)
	if ok, err := s.Store.AnswerInteraction(ctx, it.ID, cb, nil, ephemeral, nil); err != nil {
		return nil, false, err
	} else if !ok {
		return nil, false, dErrAcknowledged
	}
	send := &botSend{ch: ch, in: in, files: files, interaction: meta, skipAccess: true, loading: cb == cbDeferredMessage}
	var m *store.Message
	if ephemeral {
		m, err = s.postEphemeral(r, bot, app, it, send)
	} else {
		m, err = s.postBotMessage(r, bot, app, send)
	}
	if err != nil {
		_ = s.Store.ReleaseInteraction(ctx, it.ID)
		return nil, false, err
	}
	if err := s.Store.SetInteractionMessage(ctx, it.ID, m.ID, ephemeral); err != nil {
		return nil, false, err
	}
	return m, ephemeral, nil
}

// forcedEphemeral reports whether an answer can only be seen by the person
// who asked for it: an application added to their account, answering in a
// server channel where they may not use outside applications.
func (s *Server) forcedEphemeral(ctx context.Context, ch *store.Channel, it *store.Interaction, st *storedInteraction) bool {
	if ch.ServerID == nil {
		return false
	}
	if _, byGuild := st.AuthorizingIntegrationOwners["0"]; byGuild {
		return false
	}
	p, err := s.Store.PermsIn(ctx, ch, it.UserID)
	return err != nil || !p.Has(perms.UseExternalApps)
}

// --- messages only one person sees ---------------------------------------------------------------

// ephemeralAsMessage is an ephemeral message in the shape the apps draw
// messages from, with the ephemeral bit set.
func ephemeralAsMessage(e *store.EphemeralMessage) *store.Message {
	return &store.Message{ID: e.ID, ChannelID: e.ChannelID, AuthorID: e.ApplicationID, Type: "default", Webhook: e.Plain, Flags: e.Flags | store.MsgFlagEphemeral,
		CreatedAt: e.CreatedAt, EditedAt: e.EditedAt, Mentions: []ids.ID{}, MentionRoles: []ids.ID{}, Attachments: []store.Attachment{}, Reactions: []store.ReactionSummary{}}
}

// postEphemeral makes an answer only the person who used the application
// sees, and sends it to their devices.
func (s *Server) postEphemeral(r *http.Request, bot *store.User, app *store.Application, it *store.Interaction, send *botSend) (*store.Message, error) {
	ctx := r.Context()
	pl, rows, err := s.botPlain(ctx, send.ch, bot, app, send)
	if err != nil {
		return nil, err
	}
	if pl.Poll != nil {
		return nil, dFormError("EPHEMERAL_POLL_INVALID", "A poll cannot be seen by one person alone.", "poll")
	}
	plain, err := json.Marshal(pl)
	if err != nil {
		return nil, err
	}
	flags := send.in.Flags & (store.MsgFlagSuppressEmbeds | store.MsgFlagSuppressNotifications | store.MsgFlagComponentsV2)
	if send.loading {
		flags |= store.MsgFlagLoading
	}
	e := &store.EphemeralMessage{ID: ids.New(), ChannelID: send.ch.ID, UserID: it.UserID, ApplicationID: app.ID, InteractionID: &it.ID, Plain: plain, Flags: flags,
		ExpiresAt: time.Now().Add(interactionLife).UnixMilli()}
	for _, a := range rows {
		e.Files = append(e.Files, store.EphemeralFile{ID: a.ID, BlobID: a.BlobID})
	}
	if err := s.Store.InsertEphemeral(ctx, e); err != nil {
		return nil, err
	}
	m := ephemeralAsMessage(e)
	s.Bcast.EmitUsers([]ids.ID{it.UserID}, "message_create", m)
	return m, nil
}

// handleEphemeralDismiss is someone putting away a message only they see.
func (s *Server) handleEphemeralDismiss(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	e, err := s.Store.EphemeralByID(r.Context(), id)
	if err != nil || e.UserID != me.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteEphemeral(r.Context(), id); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers([]ids.ID{me.ID}, "message_delete", map[string]any{"id": id, "channel_id": e.ChannelID, "author_id": e.ApplicationID, "ephemeral": true})
	w.WriteHeader(http.StatusNoContent)
}

// handleInteractionFile takes a file someone sends with a command's file
// option or a form's file field: kept as it came (interactions are not
// end-to-end encrypted) and handed to the application at a signed address.
func (s *Server) handleInteractionFile(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, s.Cfg.MaxUploadBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		WriteError(w, E(http.StatusBadRequest, "bad_upload", "Send the file as multipart form data."))
		return
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			WriteError(w, E(http.StatusBadRequest, "bad_upload", "The upload could not be read."))
			return
		}
		if part.FileName() == "" {
			continue
		}
		b, err := s.Media.PutPlain(r.Context(), part, s.Cfg.MaxUploadBytes, me.ID, part.Header.Get("Content-Type"))
		if err != nil {
			if errors.Is(err, media.ErrTooLarge) {
				WriteError(w, E(http.StatusRequestEntityTooLarge, "too_large", "That file is too large."))
				return
			}
			WriteError(w, err)
			return
		}
		name := cleanFilename(part.FileName())
		if err := s.Store.PutInteractionFile(r.Context(), &store.InteractionFile{BlobID: b.ID, UserID: me.ID, Filename: name}); err != nil {
			WriteError(w, err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"id": b.ID, "filename": name, "size": b.Size, "content_type": b.Mime})
		return
	}
	WriteError(w, E(http.StatusBadRequest, "bad_upload", "No file came with the upload."))
}

// --- following up, with the interaction's token ---------------------------------------------------

// orFollowup routes a webhook path to the interaction followups when the id
// in it is an application's, and to the webhook's own handler otherwise.
func (s *Server) orFollowup(hook, followup http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if id, err := parseBotID(r.PathValue("wid")); err == nil {
			if _, err := s.Store.ApplicationByID(r.Context(), id); err == nil {
				followup(w, r)
				return
			}
		}
		hook(w, r)
	}
}

// followupTarget finds the interaction a followup path's token belongs to.
func (s *Server) followupTarget(w http.ResponseWriter, r *http.Request) (*store.Interaction, *store.Application, *store.User) {
	w.Header().Set("Via", "1.1 nexa")
	appID, err := parseBotID(r.PathValue("wid"))
	if err != nil {
		writeBotError(w, dErrUnknownWebhook, nil)
		return nil, nil, nil
	}
	ctx := r.Context()
	token := r.PathValue("token")
	if len(token) > 512 {
		writeBotError(w, dErrUnknownWebhook, nil)
		return nil, nil, nil
	}
	it, err := s.Store.InteractionByToken(ctx, appID, tokenHash(token))
	if err != nil || it.ExpiresAt < time.Now().UnixMilli() {
		writeBotError(w, dErrUnknownWebhook, nil)
		return nil, nil, nil
	}
	if ok, _, retry := s.botLim.buckets["interaction"].AllowRemaining("it:" + it.ID.String()); !ok {
		writeRateLimited(w, retry, false, "user", s.botLim.buckets["interaction"].Burst())
		return nil, nil, nil
	}
	app, err := s.Store.ApplicationByID(ctx, appID)
	if err != nil {
		writeBotError(w, dErrUnknownWebhook, nil)
		return nil, nil, nil
	}
	bot, err := s.Store.UserByID(ctx, appID)
	if err != nil {
		writeBotError(w, dErrUnknownWebhook, nil)
		return nil, nil, nil
	}
	return it, app, bot
}

// followupMessage loads the {mid} of a followup path: @original (the first
// answer's message, or the message a component was on), or a message the
// application sent in answer to this interaction.
func (s *Server) followupMessage(w http.ResponseWriter, r *http.Request, it *store.Interaction) (*store.Message, bool) {
	ctx := r.Context()
	raw := r.PathValue("mid")
	var id ids.ID
	if raw == "@original" {
		switch {
		case it.ResponseMessageID != nil:
			id = *it.ResponseMessageID
		case it.MessageID != nil && (it.ResponseType == cbDeferredUpdate || it.ResponseType == cbUpdateMessage):
			id = *it.MessageID
		default:
			writeBotError(w, dErrUnknownMessage, nil)
			return nil, false
		}
	} else {
		var err error
		if id, err = parseBotID(raw); err != nil {
			writeBotError(w, dErrUnknownMessage, nil)
			return nil, false
		}
	}
	if m, err := s.Store.MessageByID(ctx, id, 0); err == nil {
		var p wmPlain
		if len(m.Webhook) == 0 || m.WebhookID != nil || json.Unmarshal(m.Webhook, &p) != nil || p.ApplicationID == nil || *p.ApplicationID != it.ApplicationID {
			writeBotError(w, dErrUnknownMessage, nil)
			return nil, false
		}
		mine := raw == "@original" || (p.Interaction != nil && p.Interaction.ID == it.ID)
		if !mine {
			writeBotError(w, dErrUnknownMessage, nil)
			return nil, false
		}
		return m, false
	}
	e, err := s.Store.EphemeralByID(ctx, id)
	if err != nil || e.ApplicationID != it.ApplicationID || e.UserID != it.UserID {
		writeBotError(w, dErrUnknownMessage, nil)
		return nil, false
	}
	if raw != "@original" && (e.InteractionID == nil || *e.InteractionID != it.ID) {
		writeBotError(w, dErrUnknownMessage, nil)
		return nil, false
	}
	return ephemeralAsMessage(e), true
}

// followupView answers with a message as the application sees it.
func (s *Server) followupView(w http.ResponseWriter, r *http.Request, app *store.Application, bot *store.User, m *store.Message, ephemeral bool) {
	ctx := r.Context()
	ch, _ := s.Store.ChannelByID(ctx, m.ChannelID)
	if !ephemeral {
		s.withServerExtras(ctx, ch, []*store.Message{m})
	}
	b := s.builder(ctx, bot, app)
	dm := b.messageObj(m, ch, msgOpts{content: true})
	WriteJSON(w, http.StatusOK, dm)
}

// followupCreate is an application saying more about an interaction.
func (s *Server) followupCreate(w http.ResponseWriter, r *http.Request) {
	it, app, bot := s.followupTarget(w, r)
	if it == nil {
		return
	}
	ctx := r.Context()
	if it.ResponseType == 0 || it.ChannelID == nil {
		writeBotError(w, dErr(http.StatusBadRequest, 40061, "Interaction has not been acknowledged."), nil)
		return
	}
	ch, err := s.Store.ChannelByID(ctx, *it.ChannelID)
	if err != nil {
		writeBotError(w, dErrUnknownChannel, nil)
		return
	}
	raw, files, derr := s.readWebhookBody(w, r, app.ID)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	in, errs := parseWebhookBody(raw, whParseOpts{app: true, ephemeral: true})
	if !errs.empty() {
		s.dropFiles(files)
		writeBotError(w, errs.err(), nil)
		return
	}
	st := readStored(it)
	meta := interactionMeta(it, st)
	meta.OriginalResponseMessageID = it.ResponseMessageID
	send := &botSend{ch: ch, in: in, files: files, interaction: meta, skipAccess: true}
	var m *store.Message
	ephemeral := in.Flags&MsgFlagEphemeral != 0 || s.forcedEphemeral(ctx, ch, it, st)
	if ephemeral {
		m, err = s.postEphemeral(r, bot, app, it, send)
	} else {
		m, err = s.postBotMessage(r, bot, app, send)
	}
	if err != nil {
		s.dropFiles(files)
		writeBotError(w, err, nil)
		return
	}
	s.followupView(w, r, app, bot, m, ephemeral)
}

func (s *Server) followupGet(w http.ResponseWriter, r *http.Request) {
	it, app, bot := s.followupTarget(w, r)
	if it == nil {
		return
	}
	m, ephemeral := s.followupMessage(w, r, it)
	if m == nil {
		return
	}
	s.followupView(w, r, app, bot, m, ephemeral)
}

func (s *Server) followupEdit(w http.ResponseWriter, r *http.Request) {
	it, app, bot := s.followupTarget(w, r)
	if it == nil {
		return
	}
	m, _ := s.followupMessage(w, r, it)
	if m == nil {
		return
	}
	raw, files, derr := s.readWebhookBody(w, r, app.ID)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	in, errs := parseWebhookBody(raw, whParseOpts{edit: true, app: true, withComponents: true})
	if !errs.empty() {
		s.dropFiles(files)
		writeBotError(w, errs.err(), nil)
		return
	}
	ch, err := s.Store.ChannelByID(r.Context(), m.ChannelID)
	if err != nil {
		s.dropFiles(files)
		writeBotError(w, dErrUnknownChannel, nil)
		return
	}
	updated, ephemeral, err := s.editAnswer(r, it, app, ch, m.ID, in, files, true)
	if err != nil {
		s.dropFiles(files)
		writeBotError(w, err, dErrUnknownMessage)
		return
	}
	s.followupView(w, r, app, bot, updated, ephemeral)
}

func (s *Server) followupDelete(w http.ResponseWriter, r *http.Request) {
	it, _, _ := s.followupTarget(w, r)
	if it == nil {
		return
	}
	m, ephemeral := s.followupMessage(w, r, it)
	if m == nil {
		return
	}
	ctx := r.Context()
	if ephemeral {
		if err := s.Store.DeleteEphemeral(ctx, m.ID); err != nil {
			writeBotError(w, err, dErrUnknownMessage)
			return
		}
		s.Bcast.EmitUsers([]ids.ID{it.UserID}, "message_delete", map[string]any{"id": m.ID, "channel_id": m.ChannelID, "author_id": m.AuthorID, "ephemeral": true})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.Store.DeleteMessage(ctx, m.ID); err != nil {
		writeBotError(w, err, dErrUnknownMessage)
		return
	}
	ev := map[string]any{"id": m.ID, "channel_id": m.ChannelID, "author_id": m.AuthorID,
		"mentions": m.Mentions, "mention_roles": m.MentionRoles, "mention_everyone": m.MentionEveryone}
	s.withLastMessage(ctx, ev, m.ChannelID)
	s.Bcast.EmitChannel(m.ChannelID, "message_delete", ev)
	w.WriteHeader(http.StatusNoContent)
}

// editAnswer changes a message an application made in answer to someone:
// one in the channel, or one only they see. The first edit of a message
// still thinking fills it in.
func (s *Server) editAnswer(r *http.Request, it *store.Interaction, app *store.Application, ch *store.Channel, id ids.ID, in *whInput, files []whFile, followup bool) (*store.Message, bool, error) {
	ctx := r.Context()
	if m, err := s.Store.MessageByID(ctx, id, 0); err == nil {
		updated, err := s.editBotMessage(r, ch, m, in, files)
		return updated, false, err
	}
	e, err := s.Store.EphemeralByID(ctx, id)
	if err != nil || e.UserID != it.UserID || e.ApplicationID != app.ID {
		return nil, false, dErrUnknownMessage
	}
	var p wmPlain
	if err := json.Unmarshal(e.Plain, &p); err != nil {
		return nil, false, err
	}
	m := ephemeralAsMessage(e)
	pl, keep, add, err := s.editedPlain(&p, m, in, files)
	if err != nil {
		return nil, false, err
	}
	flags := pl.flags
	plain, err := json.Marshal(pl.plain)
	if err != nil {
		return nil, false, err
	}
	now := time.Now().UnixMilli()
	e.Plain, e.Flags, e.EditedAt = plain, flags&^store.MsgFlagEphemeral, &now
	var files2 []store.EphemeralFile
	for _, a := range add {
		files2 = append(files2, store.EphemeralFile{ID: a.ID, BlobID: a.BlobID})
	}
	if err := s.Store.UpdateEphemeral(ctx, e, keep, files2); err != nil {
		return nil, false, err
	}
	out := ephemeralAsMessage(e)
	s.Bcast.EmitUsers([]ids.ID{e.UserID}, "message_update", out)
	return out, true, nil
}
