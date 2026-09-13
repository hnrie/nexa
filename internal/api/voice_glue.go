package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	urlpkg "net/url"
	"sync"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/realtime"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/voice"
)

const maxSignalBytes = 64 << 10

// voiceStatePayload is what clients receive; channel_id is null when a user leaves.
type voiceStatePayload struct {
	UserID       ids.ID  `json:"user_id"`
	ChannelID    *ids.ID `json:"channel_id"`
	OldChannelID *ids.ID `json:"old_channel_id,omitempty"`
	SessionID    ids.ID  `json:"session_id"`
	SelfMute     bool    `json:"self_mute"`
	SelfDeaf     bool    `json:"self_deaf"`
	Video        bool    `json:"video"`
	Streaming    bool    `json:"streaming"`
	ServerMute   bool    `json:"server_mute"`
	ServerDeaf   bool    `json:"server_deaf"`
	JoinedAt     int64   `json:"joined_at"`
	// Media lists the kinds this participant publishes through the SFU.
	Media []string `json:"media,omitempty"`
}

func statePayload(st voice.State) voiceStatePayload {
	ch := st.ChannelID
	return voiceStatePayload{UserID: st.UserID, ChannelID: &ch, SessionID: st.SessionID, SelfMute: st.SelfMute, SelfDeaf: st.SelfDeaf, Video: st.Video, Streaming: st.Streaming, ServerMute: st.ServerMute || st.Suppress, ServerDeaf: st.ServerDeaf, JoinedAt: st.JoinedAt, Media: st.Tracks.Kinds()}
}

func leavePayload(st voice.State) voiceStatePayload {
	old := st.ChannelID
	return voiceStatePayload{UserID: st.UserID, ChannelID: nil, OldChannelID: &old, SessionID: st.SessionID}
}

func (s *Server) voiceRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/voice/ice", s.authed(s.handleVoiceICE))
	mux.Handle("GET /api/v1/channels/{id}/voice", s.authed(s.handleVoiceParticipants))
	mux.Handle("POST /api/v1/channels/{id}/call/decline", s.authed(s.handleCallDecline))
	mux.Handle("PATCH /api/v1/servers/{id}/members/{uid}/voice", s.authed(s.handleVoiceModerate))
	s.sfuRoutes(mux)
}

// WireVoice installs the voice registry, the gateway voice ops and cleanup hooks.
// Call it after WireServers so the ready payload gains voice states last.
func (s *Server) WireVoice(hub *gateway.Hub) {
	if s.Voice == nil {
		s.Voice = voice.New()
	}
	if s.Realtime == nil {
		s.Realtime = realtime.New(s.Cfg.RealtimeAppID, s.Cfg.RealtimeAppSecret)
	}
	if s.Realtime != nil && s.Meter == nil {
		s.Meter = realtime.NewMeter(s.Store, s.Cfg.RealtimeMonthlyGB)
	}
	if hub == nil {
		return
	}
	hub.VoiceOp = s.handleVoiceOp
	// Only the socket that holds the call ends it by closing. Another tab of
	// the same session, or a dead socket reaped after a reconnect already
	// rejoined, must leave the live call alone.
	hub.OnConnClose = func(ctx context.Context, uid, connID ids.ID) {
		if st, ok := s.Voice.LeaveConn(uid, connID); ok {
			s.broadcastVoiceLeave(ctx, st)
		}
	}
	prev := hub.ReadyExtras
	hub.ReadyExtras = func(ctx context.Context, u *store.User, p *gateway.ReadyPayload) error {
		if prev != nil {
			if err := prev(ctx, u, p); err != nil {
				return err
			}
		}
		chans := []ids.ID{}
		for _, c := range p.Channels {
			chans = append(chans, c.ID)
		}
		if more, err := s.Store.ChannelsForUser(ctx, u.ID); err == nil {
			chans = append(chans, more...)
		}
		for _, st := range s.Voice.In(chans) {
			p.VoiceStates = append(p.VoiceStates, statePayload(st))
		}
		return nil
	}
}

// voiceAudience lists who should hear about a channel's voice changes.
func (s *Server) voiceAudience(ctx context.Context, ch *store.Channel) []ids.ID {
	if s.isDM(ch) {
		return ch.Recipients
	}
	viewers, _ := s.Store.ChannelViewers(ctx, ch.ID)
	return viewers
}

func (s *Server) broadcastVoiceLeave(ctx context.Context, st voice.State) {
	s.closeSFUSession(st.SFUSession)
	ch, err := s.Store.ChannelByID(ctx, st.ChannelID)
	if err != nil {
		return
	}
	audience := s.voiceAudience(ctx, ch)
	s.Bcast.EmitUsers(audience, "voice_state", leavePayload(st))
	if s.isDM(ch) && s.Voice.Count(ch.ID) == 0 {
		s.Bcast.EmitUsers(audience, "call_end", map[string]any{"channel_id": ch.ID, "reason": "ended"})
	}
}

// emitConn sends to one connection, or to all of the user's when the
// broadcaster cannot address a single one.
func (s *Server) emitConn(uid, connID ids.ID, event string, data any) {
	if h, ok := s.Bcast.(interface {
		EmitConn(uid, connID ids.ID, event string, data any)
	}); ok {
		h.EmitConn(uid, connID, event, data)
		return
	}
	s.Bcast.EmitUsers([]ids.ID{uid}, event, data)
}

type voiceStateReq struct {
	ChannelID *ids.ID `json:"channel_id"`
	SelfMute  bool    `json:"self_mute"`
	SelfDeaf  bool    `json:"self_deaf"`
	Video     bool    `json:"video"`
	Streaming bool    `json:"streaming"`
	// Resume is set when a client rejoins the call it was in after a
	// reconnect; that is not a new call and deserves no new call message.
	Resume bool `json:"resume"`
}

type voiceSignalReq struct {
	To      ids.ID          `json:"to"`
	Payload json.RawMessage `json:"payload"`
}

func voiceErr(c *gateway.Conn, code, msg string) {
	c.Send("voice_error", map[string]any{"code": code, "message": msg})
}

// handleVoiceOp serves the voice_state and voice_signal gateway ops.
func (s *Server) handleVoiceOp(ctx context.Context, c *gateway.Conn, op string, data []byte) {
	me := c.User()
	switch op {
	case gateway.OpVoiceState:
		var req voiceStateReq
		if err := json.Unmarshal(data, &req); err != nil {
			voiceErr(c, "bad_request", "Malformed voice state.")
			return
		}
		if req.ChannelID == nil {
			// a hang-up only counts from the connection in the call, so a
			// second device or a displaced tab cannot end it for the other
			if st, ok := s.Voice.LeaveConn(me.ID, c.ID()); ok {
				s.broadcastVoiceLeave(ctx, st)
			}
			return
		}
		ch, err := s.Store.ChannelByID(ctx, *req.ChannelID)
		if err != nil {
			voiceErr(c, "not_found", "That channel does not exist.")
			return
		}
		p, ok, code, msg := s.canJoinVoice(ctx, me, ch)
		if !ok {
			voiceErr(c, code, msg)
			return
		}
		wasEmpty := s.Voice.Count(ch.ID) == 0
		resumed := req.Resume || s.Voice.RecentlyActive(ch.ID)
		cur, had := s.Voice.Get(me.ID)
		inSame := had && cur.ChannelID == ch.ID
		// server mutes belong to one server: they follow a move inside it,
		// but nobody could lift them in a DM call or in another server
		keep := inSame
		if had && !inSame && ch.ServerID != nil {
			if prev, err := s.Store.ChannelByID(ctx, cur.ChannelID); err == nil && prev.ServerID != nil && *prev.ServerID == *ch.ServerID {
				keep = true
			}
		}
		old := s.Voice.Join(voice.State{UserID: me.ID, ChannelID: ch.ID, SessionID: c.SessionID(), ConnID: c.ID(), SelfMute: req.SelfMute, SelfDeaf: req.SelfDeaf, Video: req.Video, Streaming: req.Streaming, Suppress: !p.Has(perms.Speak)}, keep)
		if old != nil && old.ChannelID != ch.ID {
			s.broadcastVoiceLeave(ctx, *old)
		} else if old != nil && old.ConnID != c.ID() {
			// the call moved to this connection (another device or tab picked
			// it up): the one that held it hears that it is no longer in it
			s.closeSFUSession(old.SFUSession)
			s.emitConn(me.ID, old.ConnID, "voice_state", leavePayload(*old))
		}
		st, _ := s.Voice.Get(me.ID)
		s.sfuSyncLive(st)
		audience := s.voiceAudience(ctx, ch)
		s.Bcast.EmitUsers(audience, "voice_state", statePayload(st))
		if s.isDM(ch) && !inSame && !wasEmpty {
			// answering: this user's other devices stop ringing
			s.Bcast.EmitUsers([]ids.ID{me.ID}, "call_end", map[string]any{"channel_id": ch.ID, "user_id": me.ID, "reason": "answered"})
		}
		if s.isDM(ch) && wasEmpty && !inSame {
			// joining an empty DM starts a call: ring the others, except
			// anyone who blocked the caller
			others := []ids.ID{}
			for _, id := range ch.Recipients {
				if id == me.ID {
					continue
				}
				if _, blockedMe, err := s.Store.Blocked(ctx, me.ID, id); err != nil || blockedMe {
					continue
				}
				others = append(others, id)
			}
			s.Bcast.EmitUsers(others, "call_ring", map[string]any{"channel_id": ch.ID, "from": me.ID})
			// a rejoin after a reconnect or a restart is the same call
			if !resumed {
				m := &store.Message{ChannelID: ch.ID, AuthorID: me.ID, Type: "system_call", Mentions: []ids.ID{}}
				if err := s.Store.InsertMessage(ctx, m); err == nil {
					m.MentionRoles = []ids.ID{}
					s.Bcast.EmitChannel(ch.ID, "message_create", m)
				}
			}
		}
	case gateway.OpVoiceSignal:
		if len(data) > maxSignalBytes {
			voiceErr(c, "too_large", "Signal payload is too large.")
			return
		}
		var req voiceSignalReq
		if err := json.Unmarshal(data, &req); err != nil {
			voiceErr(c, "bad_request", "Malformed signal.")
			return
		}
		mine, ok := s.Voice.Get(me.ID)
		if !ok {
			voiceErr(c, "not_in_voice", "Join a voice channel first.")
			return
		}
		if mine.ConnID != c.ID() {
			// a device that no longer holds the call; its leave is on the way
			return
		}
		target, ok := s.Voice.Get(req.To)
		if !ok || target.ChannelID != mine.ChannelID {
			voiceErr(c, "peer_gone", "That user is not in your voice channel.")
			return
		}
		// only the target's device in the call may answer; another device of
		// the same person would negotiate a second connection under one id
		s.emitConn(req.To, target.ConnID, "voice_signal", map[string]any{"from": me.ID, "channel_id": mine.ChannelID, "payload": req.Payload})
	}
}

// canJoinVoice checks channel type, membership, blocks, Connect, timeouts and
// the user limit, and returns the caller's permissions in the channel.
func (s *Server) canJoinVoice(ctx context.Context, me *store.User, ch *store.Channel) (perms.Perm, bool, string, string) {
	if ch.Type == "subchat" {
		return 0, false, "no_call", "A subchat has no call of its own. Use the conversation it belongs to."
	}
	if cur, ok := s.Voice.Get(me.ID); s.Meter != nil && !(ok && cur.ChannelID == ch.ID) && !s.Meter.CallsAllowed(ctx) {
		// toggles inside a running call still pass; new calls wait for next month
		return 0, false, "calls_paused", "Calls are paused until next month to keep them free."
	}
	if s.isDM(ch) {
		member := false
		for _, id := range ch.Recipients {
			if id == me.ID {
				member = true
			}
		}
		if !member {
			return 0, false, "not_found", "That channel does not exist."
		}
		cur, ok := s.Voice.Get(me.ID)
		if ch.Type == "dm" && !(ok && cur.ChannelID == ch.ID) {
			// a block in either direction stops new calls, like it stops
			// messaging; mute toggles inside a call already running still pass
			for _, other := range ch.Recipients {
				if other == me.ID {
					continue
				}
				if ab, ba, err := s.Store.Blocked(ctx, me.ID, other); err != nil || ab || ba {
					return 0, false, "blocked", "You cannot call this user."
				}
			}
		}
		return perms.All, true, "", ""
	}
	if ch.Type != "voice" {
		return 0, false, "not_voice", "That is not a voice channel."
	}
	p, _, err := s.Store.ChannelPerms(ctx, ch.ID, me.ID)
	if err != nil || p == 0 {
		return 0, false, "not_found", "That channel does not exist."
	}
	if !p.Has(perms.Connect) {
		return p, false, "missing_permission", "You cannot connect to that channel."
	}
	if cur, ok := s.Voice.Get(me.ID); ok && cur.ChannelID == ch.ID {
		return p, true, "", ""
	}
	if ch.UserLimit > 0 && s.Voice.Count(ch.ID) >= ch.UserLimit && !p.Has(perms.MoveMembers) {
		return p, false, "channel_full", "That voice channel is full."
	}
	return p, true, "", ""
}

func (s *Server) handleVoiceICE(w http.ResponseWriter, r *http.Request) {
	servers := []map[string]any{}
	if len(s.Cfg.StunURLs) > 0 {
		servers = append(servers, map[string]any{"urls": s.Cfg.StunURLs})
	}
	if len(s.Cfg.TurnURLs) > 0 {
		entry := map[string]any{"urls": s.Cfg.TurnURLs}
		if s.Cfg.TurnUsername != "" {
			entry["username"] = s.Cfg.TurnUsername
			entry["credential"] = s.Cfg.TurnCredential
		}
		servers = append(servers, entry)
	}
	if relay := s.cloudflareTURN(r); relay != nil {
		servers = append(servers, relay...)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"ice_servers": servers, "sfu": s.Realtime != nil})
}

// turnTTL is how long a minted relay credential lasts, and turnReuse how long
// this server hands the same one back before asking for another.
const (
	turnTTL   = 4 * time.Hour
	turnReuse = 3 * time.Hour
)

var turnCache = struct {
	sync.Mutex
	m map[ids.ID]struct {
		at      time.Time
		servers []map[string]any
	}
}{m: map[ids.ID]struct {
	at      time.Time
	servers []map[string]any
}{}}

var turnClient = &http.Client{Timeout: 6 * time.Second}

// cloudflareTURN mints a short-lived relay credential for this user, for the
// networks where two people cannot reach each other directly. The long-term
// key never leaves this server. Returns nil when TURN is not configured or
// the request fails: a call without a relay is better than no call at all.
func (s *Server) cloudflareTURN(r *http.Request) []map[string]any {
	if s.Cfg.TurnKeyID == "" || s.Cfg.TurnAPIToken == "" {
		return nil
	}
	me := auth.UserFrom(r.Context())
	if me == nil {
		return nil
	}
	turnCache.Lock()
	if hit, ok := turnCache.m[me.ID]; ok && time.Since(hit.at) < turnReuse {
		servers := hit.servers
		turnCache.Unlock()
		return servers
	}
	turnCache.Unlock()

	body, _ := json.Marshal(map[string]any{"ttl": int(turnTTL.Seconds()), "customIdentifier": me.ID.String()})
	url := "https://rtc.live.cloudflare.com/v1/turn/keys/" + urlpkg.PathEscape(s.Cfg.TurnKeyID) + "/credentials/generate-ice-servers"
	req, err := http.NewRequestWithContext(r.Context(), "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+s.Cfg.TurnAPIToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := turnClient.Do(req)
	if err != nil {
		s.Log.Warn("turn credentials unavailable", "err", err)
		return nil
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		s.Log.Warn("turn credentials refused", "status", res.StatusCode)
		return nil
	}
	var parsed struct {
		ICEServers json.RawMessage `json:"iceServers"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	// the shape is either one entry or a list, depending on the endpoint
	var list []map[string]any
	if err := json.Unmarshal(parsed.ICEServers, &list); err != nil {
		var one map[string]any
		if json.Unmarshal(parsed.ICEServers, &one) != nil {
			return nil
		}
		list = []map[string]any{one}
	}
	turnCache.Lock()
	turnCache.m[me.ID] = struct {
		at      time.Time
		servers []map[string]any
	}{time.Now(), list}
	turnCache.Unlock()
	return list
}

func (s *Server) handleVoiceParticipants(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	out := []voiceStatePayload{}
	for _, st := range s.Voice.Participants(ch.ID) {
		out = append(out, statePayload(st))
	}
	WriteJSON(w, http.StatusOK, out)
}

// handleCallDecline tells the callers that this recipient will not pick up.
func (s *Server) handleCallDecline(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	if !s.isDM(ch) {
		WriteError(w, E(http.StatusBadRequest, "not_dm", "Only DM calls can be declined."))
		return
	}
	s.Bcast.EmitUsers(ch.Recipients, "call_end", map[string]any{"channel_id": ch.ID, "user_id": me.ID, "reason": "declined"})
	w.WriteHeader(http.StatusNoContent)
}

// handleVoiceModerate server-mutes, deafens, moves or disconnects a member.
func (s *Server) handleVoiceModerate(w http.ResponseWriter, r *http.Request) {
	srv, me, actorPerms := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	uid, err := ids.Parse(r.PathValue("uid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	st, ok := s.Voice.Get(uid)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "not_in_voice", "That member is not in a voice channel."))
		return
	}
	cur, err := s.Store.ChannelByID(r.Context(), st.ChannelID)
	if err != nil || cur.ServerID == nil || *cur.ServerID != srv.ID {
		WriteError(w, E(http.StatusBadRequest, "not_in_voice", "That member is not in a voice channel of this server."))
		return
	}
	var raw map[string]json.RawMessage
	if err := ReadJSON(w, r, &raw, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if !s.canActOn(r.Context(), srv, me.ID, uid) {
		WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You cannot moderate this member."))
		return
	}
	changes := map[string]any{}
	var mute, deaf *bool
	if v, ok := raw["mute"]; ok {
		if !actorPerms.Has(perms.MuteMembers) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Mute Members."))
			return
		}
		var b bool
		if json.Unmarshal(v, &b) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "mute must be true or false."))
			return
		}
		mute = &b
		changes["mute"] = b
	}
	if v, ok := raw["deaf"]; ok {
		if !actorPerms.Has(perms.DeafenMembers) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Deafen Members."))
			return
		}
		var b bool
		if json.Unmarshal(v, &b) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "deaf must be true or false."))
			return
		}
		deaf = &b
		changes["deaf"] = b
	}
	// Validate the whole request before changing anything, so a refused move
	// cannot leave a mute applied with no audit entry.
	var dest *store.Channel
	var destPerms perms.Perm
	disconnect := false
	if v, ok := raw["channel_id"]; ok {
		if !actorPerms.Has(perms.MoveMembers) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Move Members."))
			return
		}
		if string(v) == "null" {
			disconnect = true
			changes["channel_id"] = nil
		} else {
			var target ids.ID
			if json.Unmarshal(v, &target) != nil {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "channel_id is malformed."))
				return
			}
			dest, err = s.Store.ChannelByID(r.Context(), target)
			if err != nil || dest.ServerID == nil || *dest.ServerID != srv.ID || dest.Type != "voice" {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "The destination must be a voice channel of this server."))
				return
			}
			if destPerms, _, err = s.Store.ChannelPerms(r.Context(), dest.ID, uid); err != nil || !destPerms.Has(perms.Connect) {
				WriteError(w, E(http.StatusBadRequest, "cannot_connect", "That member cannot connect to the destination."))
				return
			}
			changes["channel_id"] = dest.ID
		}
	}
	if mute != nil || deaf != nil {
		updated, _ := s.Voice.Update(uid, func(x *voice.State) {
			if mute != nil {
				x.ServerMute = *mute
			}
			if deaf != nil {
				x.ServerDeaf = *deaf
			}
		})
		s.Bcast.EmitUsers(s.voiceAudience(r.Context(), cur), "voice_state", statePayload(updated))
	}
	if disconnect {
		if left, ok := s.Voice.Leave(uid); ok {
			s.broadcastVoiceLeave(r.Context(), left)
		}
	} else if dest != nil && dest.ID != cur.ID {
		if latest, ok := s.Voice.Get(uid); ok && latest.ChannelID == cur.ID {
			old := s.Voice.Join(voice.State{UserID: uid, ChannelID: dest.ID, SessionID: latest.SessionID, ConnID: latest.ConnID, SelfMute: latest.SelfMute, SelfDeaf: latest.SelfDeaf, Video: latest.Video, Streaming: latest.Streaming, JoinedAt: latest.JoinedAt, Suppress: !destPerms.Has(perms.Speak)}, true)
			if old != nil {
				// what they pulled in the old channel stops; their client makes a new session
				s.closeSFUSession(old.SFUSession)
				// The moved member must not hear this leave: their client takes
				// a leave of its own channel as a disconnect and drops the call.
				// The join below moves them instead.
				s.Bcast.EmitUsers(withoutID(s.voiceAudience(r.Context(), cur), uid), "voice_state", leavePayload(*old))
			}
			moved, _ := s.Voice.Get(uid)
			s.Bcast.EmitUsers(append(withoutID(s.voiceAudience(r.Context(), dest), uid), uid), "voice_state", statePayload(moved))
		}
	}
	s.audit(r, srv.ID, me.ID, "member_voice", "user", &uid, changes, "")
	final, ok := s.Voice.Get(uid)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	WriteJSON(w, http.StatusOK, statePayload(final))
}

func withoutID(list []ids.ID, id ids.ID) []ids.ID {
	out := make([]ids.ID, 0, len(list))
	for _, x := range list {
		if x != id {
			out = append(out, x)
		}
	}
	return out
}

// voiceChannelDeleted kicks everyone out of a channel that no longer exists.
// A DM's recipients are on the channel itself, so this also works after the
// conversation was deleted.
func (s *Server) voiceChannelDeleted(ctx context.Context, ch *store.Channel) {
	if s.Voice == nil {
		return
	}
	audience := s.voiceAudience(ctx, ch)
	cleared := s.Voice.ClearChannel(ch.ID)
	for _, st := range cleared {
		s.closeSFUSession(st.SFUSession)
		s.Bcast.EmitUsers(audience, "voice_state", leavePayload(st))
	}
	if len(cleared) > 0 && s.isDM(ch) {
		s.Bcast.EmitUsers(audience, "call_end", map[string]any{"channel_id": ch.ID, "reason": "ended"})
	}
}

// voiceServerDeleted kicks everyone out of the voice channels of a deleted
// server. The channels and members are read before the deletion.
func (s *Server) voiceServerDeleted(chans []*store.Channel, members []ids.ID) {
	if s.Voice == nil {
		return
	}
	for _, ch := range chans {
		if ch.Type != "voice" {
			continue
		}
		for _, st := range s.Voice.ClearChannel(ch.ID) {
			s.closeSFUSession(st.SFUSession)
			s.Bcast.EmitUsers(members, "voice_state", leavePayload(st))
		}
	}
}

// dropVoice ends a user's call when it is in a channel they are losing access
// to (a kick, ban, timeout or leaving a group). Run it while the user can still
// see the channel so they hear the leave with everyone else.
func (s *Server) dropVoice(ctx context.Context, uid ids.ID, losing func(*store.Channel) bool) {
	if s.Voice == nil {
		return
	}
	st, ok := s.Voice.Get(uid)
	if !ok {
		return
	}
	ch, err := s.Store.ChannelByID(ctx, st.ChannelID)
	if err != nil || !losing(ch) {
		return
	}
	if left, ok := s.Voice.LeaveConn(uid, st.ConnID); ok {
		s.broadcastVoiceLeave(ctx, left)
	}
}
