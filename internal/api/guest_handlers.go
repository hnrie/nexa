package api

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// Guest links let someone without an account into one call: a voice channel
// or a DM call. They give a name and pass the captcha, and what they get is a
// guest, not an account: a token that works on the call's own routes and a
// gateway connection that carries their call and nothing else. They see who
// is in the call and what they share, and never the server, the conversation,
// its messages or its members.
//
// The link's fragment carries the call's key for the epoch it was made in, so
// the SFU still forwards only what it cannot read, and this server never sees
// that key. People in the call hand a guest newer keys when the conversation's
// key changes, sealed under the one the guest came with.

const (
	guestLinkDefaultAge = 24 * time.Hour
	guestLinkMinAge     = 30 * time.Minute
	guestLinkMaxAge     = 7 * 24 * time.Hour
	// guestSessionTTL is the longest a guest stays, however long the link lasts.
	guestSessionTTL = 12 * time.Hour
	// A guest with no connection this long has closed the page.
	guestAwayGrace  = 2 * time.Minute
	guestSweepEvery = 20 * time.Second

	maxGuestsPerLink    = 10
	maxGuestsPerChannel = 25
	maxGuestLinks       = 50
)

// guestPerms is what a guest may do in a DM call; in a voice channel they get
// what @everyone gets there, within the same bounds.
const guestPerms = perms.ViewChannel | perms.Connect | perms.Speak | perms.Stream | perms.UseVAD

func (s *Server) guestRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/channels/{id}/guest-links", s.authed(s.handleGuestLinkCreate))
	mux.Handle("GET /api/v1/channels/{id}/guest-links", s.authed(s.handleGuestLinks))
	mux.Handle("DELETE /api/v1/channels/{id}/guest-links", s.authed(s.handleGuestLinksRevoke))
	mux.Handle("DELETE /api/v1/channels/{id}/guest-links/{code}", s.authed(s.handleGuestLinkRevoke))
	mux.Handle("DELETE /api/v1/channels/{id}/guests/{gid}", s.authed(s.handleGuestRemove))
	mux.Handle("GET /api/v1/guest/links/{code}", ipLimited(s.limAuthIP, s.handleGuestLinkCheck))
	mux.Handle("POST /api/v1/guest/join", ipLimited(s.limGuest, s.handleGuestJoin))
	mux.Handle("DELETE /api/v1/guest/me", s.guestAuthed(s.handleGuestLeave))
}

// guestsOn says whether this server takes guests at all. A link's key only
// protects a call that goes through the SFU: peer to peer, its code alone
// would let someone hear the call, and every guest would learn members'
// addresses. Such a server takes guests only when told to.
func (s *Server) guestsOn() bool {
	return s.Realtime != nil || s.Cfg.GuestLinksP2P
}

var errGuestsOff = E(http.StatusForbidden, "guests_off", "This server does not take guests in calls.")

// guestCallChannel loads the path's channel for managing its guest links and
// returns the caller's permissions there. Only calls take guests.
func (s *Server) guestCallChannel(w http.ResponseWriter, r *http.Request) (*store.Channel, *store.User, perms.Perm) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return nil, nil, 0
	}
	switch ch.Type {
	case "dm", "group_dm":
		return ch, me, perms.All
	case "voice":
		p, _, err := s.Store.ChannelPerms(r.Context(), ch.ID, me.ID)
		if err != nil {
			WriteError(w, err)
			return nil, nil, 0
		}
		return ch, me, p
	}
	WriteError(w, E(http.StatusBadRequest, "no_call", "Guest links are for voice channels and calls."))
	return nil, nil, 0
}

// managesGuests says whether someone may revoke anyone's links and remove any
// guest here: everyone in a DM or group, and moderators of a voice channel.
func managesGuests(ch *store.Channel, p perms.Perm) bool {
	return store.IsDMLike(ch.Type) || p.Has(perms.MoveMembers) || p.Has(perms.ManageChannels)
}

func (s *Server) handleGuestLinkCreate(w http.ResponseWriter, r *http.Request) {
	if !s.guestsOn() {
		WriteError(w, errGuestsOff)
		return
	}
	ch, me, p := s.guestCallChannel(w, r)
	if ch == nil {
		return
	}
	ctx := r.Context()
	if ch.Type == "voice" && !p.Has(perms.Connect|perms.CreateInstantInvite) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Create Invite and Connect in this channel."))
		return
	}
	if ch.Type == "dm" {
		for _, other := range ch.Recipients {
			if other == me.ID {
				continue
			}
			if ab, ba, err := s.Store.Blocked(ctx, me.ID, other); err != nil || ab || ba {
				WriteError(w, E(http.StatusForbidden, "blocked", "You cannot call this user."))
				return
			}
		}
	}
	var req struct {
		Epoch  *int  `json:"epoch"`
		MaxAge int64 `json:"max_age"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	age := guestLinkDefaultAge
	if req.MaxAge > 0 {
		age = time.Duration(req.MaxAge) * time.Second
	}
	if age < guestLinkMinAge || age > guestLinkMaxAge {
		WriteError(w, E(http.StatusBadRequest, "invalid_max_age", "A guest link lasts from 30 minutes to 7 days."))
		return
	}
	// The link carries the call's key for one epoch, which has to be the
	// newest: anything older and the guest could not hear the call.
	conv, err := s.convForChannel(r, ch)
	if err != nil {
		WriteError(w, err)
		return
	}
	latest, has, err := s.Store.LatestEpoch(ctx, conv)
	if err != nil {
		WriteError(w, err)
		return
	}
	if req.Epoch == nil || !has || *req.Epoch != latest {
		WriteError(w, E(http.StatusConflict, "stale_epoch", "This conversation's key just changed. Try again in a moment."))
		return
	}
	existing, err := s.Store.GuestLinksForChannel(ctx, ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if len(existing) >= maxGuestLinks {
		WriteError(w, E(http.StatusBadRequest, "too_many_links", "This call has too many guest links. Revoke some first."))
		return
	}
	link, err := s.Store.CreateGuestLink(ctx, ch.ID, me.ID, latest, age.Milliseconds())
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, link)
}

// handleGuestLinks lists the caller's own links for a call. Nobody is shown
// anyone else's codes, managers included: a code and a key the viewer already
// holds make a working link, which someone removed from the conversation
// later could still use to hear it.
func (s *Server) handleGuestLinks(w http.ResponseWriter, r *http.Request) {
	ch, me, _ := s.guestCallChannel(w, r)
	if ch == nil {
		return
	}
	list, err := s.Store.GuestLinksForChannel(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := []*store.GuestLink{}
	for _, l := range list {
		if l.CreatorID == me.ID {
			out = append(out, l)
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

// handleGuestLinksRevoke revokes every link of a call for whoever manages its
// guests, and otherwise the caller's own; their guests are put out.
func (s *Server) handleGuestLinksRevoke(w http.ResponseWriter, r *http.Request) {
	ch, me, p := s.guestCallChannel(w, r)
	if ch == nil {
		return
	}
	ctx := r.Context()
	list, err := s.Store.GuestLinksForChannel(ctx, ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	revoked := 0
	for _, l := range list {
		if l.CreatorID != me.ID && !managesGuests(ch, p) {
			continue
		}
		// Who came in through the link has to be read before the link goes,
		// and the read has to have worked: deleting the link and then not
		// dropping them leaves people in the call that the operator believes
		// they have just shut out.
		guests, err := s.Store.GuestsForLink(ctx, l.Code)
		if err != nil {
			s.Log.Warn("revoke all guest links", "code", l.Code, "err", err)
			continue
		}
		if err := s.Store.DeleteGuestLink(ctx, l.Code); err != nil {
			continue
		}
		revoked++
		for _, g := range guests {
			s.dropGuest(ctx, g.ID, "revoked")
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"revoked": revoked})
}

func (s *Server) handleGuestLinkRevoke(w http.ResponseWriter, r *http.Request) {
	ch, me, p := s.guestCallChannel(w, r)
	if ch == nil {
		return
	}
	ctx := r.Context()
	link, err := s.Store.GuestLinkByCode(ctx, r.PathValue("code"))
	if err != nil || link.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if link.CreatorID != me.ID && !managesGuests(ch, p) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You can only revoke your own guest links here."))
		return
	}
	// Who came in through it is read first: the rows go with the link, and a
	// read that failed would leave them in the call after the operator was
	// told the link was revoked.
	guests, err := s.Store.GuestsForLink(ctx, link.Code)
	if err != nil {
		WriteError(w, err)
		return
	}
	if err := s.Store.DeleteGuestLink(ctx, link.Code); err != nil {
		WriteError(w, err)
		return
	}
	for _, g := range guests {
		s.dropGuest(ctx, g.ID, "revoked")
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGuestRemove(w http.ResponseWriter, r *http.Request) {
	ch, me, p := s.guestCallChannel(w, r)
	if ch == nil {
		return
	}
	ctx := r.Context()
	gid, err := ids.Parse(r.PathValue("gid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	g, err := s.Store.GuestByID(ctx, gid)
	if err != nil || g.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if !managesGuests(ch, p) {
		link, err := s.Store.GuestLinkByCode(ctx, g.LinkCode)
		if err != nil || link.CreatorID != me.ID {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Move Members to remove a guest."))
			return
		}
	}
	s.endGuest(ctx, g, "removed")
	w.WriteHeader(http.StatusNoContent)
}

// handleGuestLinkCheck tells the page a link opens whether it still works,
// before asking anyone for a name. It says nothing about where it leads.
func (s *Server) handleGuestLinkCheck(w http.ResponseWriter, r *http.Request) {
	if !s.guestsOn() {
		WriteError(w, errGuestLinkInvalid)
		return
	}
	if _, _, state := s.guestLink(r.Context(), r.PathValue("code"), true); state != linkUsable {
		WriteError(w, errGuestLinkInvalid)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

var errGuestLinkInvalid = E(http.StatusNotFound, "invalid_guest_link", "This link is invalid or has expired.")

func (s *Server) handleGuestJoin(w http.ResponseWriter, r *http.Request) {
	if !s.guestsOn() {
		WriteError(w, errGuestLinkInvalid)
		return
	}
	if !s.requireCaptcha(w, r, "guest_join") {
		return
	}
	var req struct {
		Code        string `json:"code"`
		DisplayName string `json:"display_name"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	name, ok := CleanDisplayName(req.DisplayName)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "invalid_display_name", "Names are 1–32 characters."))
		return
	}
	if reservedDisplayName(name) {
		WriteError(w, E(http.StatusBadRequest, "reserved_display_name", "That name belongs to the official Nexa account."))
		return
	}
	ctx := r.Context()
	link, ch, state := s.guestLink(ctx, req.Code, true)
	if state == linkUnknown {
		WriteError(w, E(http.StatusServiceUnavailable, "unavailable", "Could not check the link just now. Try again in a moment."))
		return
	}
	if state != linkUsable {
		WriteError(w, errGuestLinkInvalid)
		return
	}
	if s.Meter != nil && !s.Meter.CallsAllowed(ctx) {
		WriteError(w, E(http.StatusForbidden, "calls_paused", "Calls are paused until next month to keep them free."))
		return
	}
	byLink, err := s.Store.GuestsForLink(ctx, link.Code)
	if err != nil {
		WriteError(w, err)
		return
	}
	inCall, err := s.Store.GuestsForChannel(ctx, ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if len(byLink) >= maxGuestsPerLink || len(inCall) >= maxGuestsPerChannel {
		WriteError(w, E(http.StatusForbidden, "guest_limit", "This call has all the guests it can take right now."))
		return
	}
	token, hash := auth.NewToken()
	g := &store.Guest{LinkCode: link.Code, ChannelID: ch.ID, DisplayName: name, Epoch: link.Epoch, TokenHash: hash, IP: auth.ClientIP(r), ExpiresAt: time.Now().Add(guestSessionTTL).UnixMilli()}
	if err := s.Store.CreateGuest(ctx, g); err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"token": token, "guest": guestView(g, s.Realtime != nil)})
}

// guestView is what a guest is told about their own stay.
func guestView(g *store.Guest, sfu bool) map[string]any {
	return map[string]any{"id": g.ID, "display_name": g.DisplayName, "channel_id": g.ChannelID, "epoch": g.Epoch, "expires_at": g.ExpiresAt, "sfu": sfu}
}

// handleGuestLeave ends the caller's time as a guest.
func (s *Server) handleGuestLeave(w http.ResponseWriter, r *http.Request) {
	s.endGuest(r.Context(), auth.GuestFrom(r.Context()), "left")
	w.WriteHeader(http.StatusNoContent)
}

type linkState int

const (
	linkUsable linkState = iota
	linkGone
	// linkUnknown is a lookup that failed for another reason than the link
	// being gone, which must not throw anyone out
	linkUnknown
)

// guestLink loads a link and says whether it still lets people in: it exists,
// its call does, and whoever made it could still make it. An expired link
// takes nobody new (forJoin) but keeps the guests it already let in.
func (s *Server) guestLink(ctx context.Context, code string, forJoin bool) (*store.GuestLink, *store.Channel, linkState) {
	if code == "" || len(code) > 64 {
		return nil, nil, linkGone
	}
	link, err := s.Store.GuestLinkByCode(ctx, code)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil, linkGone
	}
	if err != nil {
		return nil, nil, linkUnknown
	}
	if forJoin && link.ExpiresAt <= time.Now().UnixMilli() {
		return link, nil, linkGone
	}
	ch, err := s.Store.ChannelByID(ctx, link.ChannelID)
	if errors.Is(err, store.ErrNotFound) {
		return link, nil, linkGone
	}
	if err != nil {
		return link, nil, linkUnknown
	}
	creator, err := s.Store.UserByID(ctx, link.CreatorID)
	if errors.Is(err, store.ErrNotFound) {
		return link, ch, linkGone
	}
	if err != nil {
		return link, ch, linkUnknown
	}
	if creator.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return link, ch, linkGone
	}
	// A guest speaks with the voice of whoever made the link: a muted or
	// banned account's links stop working with it, or a private window
	// would be the way round the mute.
	mute, ban, err := s.Store.ActiveRestrictions(ctx, creator.ID, time.Now().UnixMilli())
	if err != nil {
		return link, ch, linkUnknown
	}
	if mute != nil || ban != nil {
		return link, ch, linkGone
	}
	switch ch.Type {
	case "dm", "group_dm":
		for _, id := range ch.Recipients {
			if id == creator.ID {
				return link, ch, linkUsable
			}
		}
		return link, ch, linkGone
	case "voice":
		p, _, err := s.Store.ChannelPerms(ctx, ch.ID, creator.ID)
		if err != nil {
			return link, ch, linkUnknown
		}
		if p.Has(perms.ViewChannel | perms.Connect | perms.CreateInstantInvite) {
			return link, ch, linkUsable
		}
	}
	return link, ch, linkGone
}

// guestVoicePerms is what a guest may do in a server voice channel: what
// @everyone may, within guestPerms. The link is what lets them in, so a
// channel @everyone cannot see or join still takes them.
func (s *Server) guestVoicePerms(ctx context.Context, ch *store.Channel) perms.Perm {
	if ch.ServerID == nil {
		return guestPerms
	}
	var p perms.Perm
	if roles, err := s.Store.Roles(ctx, *ch.ServerID); err == nil {
		for _, ro := range roles {
			if ro.ID == *ch.ServerID {
				p = ro.Permissions
			}
		}
	}
	if p.Has(perms.Administrator) {
		return guestPerms
	}
	if ows, err := s.Store.Overwrites(ctx, ch.ID); err == nil {
		for _, ow := range ows {
			if ow.TargetType == "role" && ow.TargetID == *ch.ServerID {
				p = p&^ow.Deny | ow.Allow
			}
		}
	}
	return (p | perms.ViewChannel | perms.Connect) & guestPerms
}

// canGuestJoinVoice is canJoinVoice for a guest: their own call only, while
// their link still works.
func (s *Server) canGuestJoinVoice(ctx context.Context, me *store.User, ch *store.Channel) (perms.Perm, bool, string, string) {
	g, err := s.Store.GuestByID(ctx, me.ID)
	if err != nil || g.ChannelID != ch.ID || g.ExpiresAt <= time.Now().UnixMilli() || !s.guestsOn() {
		return 0, false, "not_found", "That channel does not exist."
	}
	if _, _, state := s.guestLink(ctx, g.LinkCode, false); state == linkGone {
		return 0, false, "link_revoked", "This guest link no longer works."
	}
	cur, in := s.Voice.Get(me.ID)
	inSame := in && cur.ChannelID == ch.ID
	if s.Meter != nil && !inSame && !s.Meter.CallsAllowed(ctx) {
		return 0, false, "calls_paused", "Calls are paused until next month to keep them free."
	}
	p := guestPerms
	if ch.Type == "voice" {
		p = s.guestVoicePerms(ctx, ch)
		if !inSame && ch.UserLimit > 0 && s.Voice.Count(ch.ID) >= ch.UserLimit {
			return p, false, "channel_full", "That voice channel is full."
		}
	}
	return p, true, "", ""
}

// guestReady fills a guest's ready payload: the people in their call and
// which call it is.
func (s *Server) guestReady(ctx context.Context, g *store.Guest, p *gateway.ReadyPayload) error {
	for _, st := range s.Voice.Participants(g.ChannelID) {
		p.VoiceStates = append(p.VoiceStates, statePayload(st))
	}
	p.Guest = guestView(g, s.Realtime != nil)
	return nil
}

// endGuest ends a guest's stay: the row goes, and dropGuest does the rest.
func (s *Server) endGuest(ctx context.Context, g *store.Guest, reason string) {
	if g == nil {
		return
	}
	_ = s.Store.DeleteGuest(ctx, g.ID)
	s.dropGuest(ctx, g.ID, reason)
}

// dropGuest takes a guest whose row is gone out of their call, tells their
// page why and closes its socket.
func (s *Server) dropGuest(ctx context.Context, id ids.ID, reason string) {
	if s.Voice != nil {
		if st, ok := s.Voice.Leave(id); ok {
			s.broadcastVoiceLeave(ctx, st)
		}
	}
	s.Bcast.EmitUsers([]ids.ID{id}, gateway.EvGuestEnded, map[string]any{"reason": reason})
	s.Bcast.CloseUserSessions(id, 0)
	s.guestAway.forget(id)
}

// StartGuests sweeps guests until ctx ends: the ones whose time is up, whose
// link stopped working, or who closed the page.
func (s *Server) StartGuests(ctx context.Context) {
	go func() {
		t := time.NewTicker(guestSweepEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.sweepGuests(ctx, time.Now())
			}
		}
	}()
}

func (s *Server) sweepGuests(ctx context.Context, now time.Time) {
	list, err := s.Store.Guests(ctx)
	if err != nil {
		return
	}
	states := map[string]linkState{}
	present := map[ids.ID]bool{}
	for _, g := range list {
		present[g.ID] = true
		state, checked := states[g.LinkCode]
		if !checked {
			_, _, state = s.guestLink(ctx, g.LinkCode, false)
			states[g.LinkCode] = state
		}
		switch {
		case g.ExpiresAt <= now.UnixMilli():
			s.endGuest(ctx, g, "expired")
		case state == linkGone:
			s.endGuest(ctx, g, "unavailable")
		case s.hub != nil && !s.hub.Online(g.ID):
			if s.guestAway.since(g.ID, now) >= guestAwayGrace {
				s.endGuest(ctx, g, "gone")
			}
		default:
			s.guestAway.forget(g.ID)
		}
	}
	s.guestAway.keepOnly(present)
	_, _ = s.Store.DeleteSpentGuestLinks(ctx, now.UnixMilli())
}

// guestAwayTimes remembers when each guest was first seen without a connection.
type guestAwayTimes struct {
	mu sync.Mutex
	at map[ids.ID]time.Time
}

// since returns how long the guest has been away, starting the clock now if it was not running.
func (a *guestAwayTimes) since(id ids.ID, now time.Time) time.Duration {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.at == nil {
		a.at = map[ids.ID]time.Time{}
	}
	first, ok := a.at[id]
	if !ok {
		a.at[id] = now
		return 0
	}
	return now.Sub(first)
}

func (a *guestAwayTimes) forget(id ids.ID) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.at, id)
}

func (a *guestAwayTimes) keepOnly(present map[ids.ID]bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for id := range a.at {
		if !present[id] {
			delete(a.at, id)
		}
	}
}
