package api

import (
	"context"
	"encoding/json"
	"net/http"

	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
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
}

func statePayload(st voice.State) voiceStatePayload {
	ch := st.ChannelID
	return voiceStatePayload{UserID: st.UserID, ChannelID: &ch, SessionID: st.SessionID, SelfMute: st.SelfMute, SelfDeaf: st.SelfDeaf, Video: st.Video, Streaming: st.Streaming, ServerMute: st.ServerMute, ServerDeaf: st.ServerDeaf, JoinedAt: st.JoinedAt}
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
}

// WireVoice installs the voice registry, the gateway voice ops and cleanup hooks.
// Call it after WireServers so the ready payload gains voice states last.
func (s *Server) WireVoice(hub *gateway.Hub) {
	if s.Voice == nil {
		s.Voice = voice.New()
	}
	if hub == nil {
		return
	}
	hub.VoiceOp = s.handleVoiceOp
	hub.OnConnClose = func(ctx context.Context, uid, session ids.ID) {
		if st, ok := s.Voice.LeaveSession(uid, session); ok {
			s.broadcastVoiceLeave(ctx, st)
		}
	}
	hub.OnDisconnect = func(ctx context.Context, uid ids.ID) {
		if st, ok := s.Voice.Leave(uid); ok {
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

type voiceStateReq struct {
	ChannelID *ids.ID `json:"channel_id"`
	SelfMute  bool    `json:"self_mute"`
	SelfDeaf  bool    `json:"self_deaf"`
	Video     bool    `json:"video"`
	Streaming bool    `json:"streaming"`
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
			if st, ok := s.Voice.Leave(me.ID); ok {
				s.broadcastVoiceLeave(ctx, st)
			}
			return
		}
		ch, err := s.Store.ChannelByID(ctx, *req.ChannelID)
		if err != nil {
			voiceErr(c, "not_found", "That channel does not exist.")
			return
		}
		if ok, code, msg := s.canJoinVoice(ctx, me, ch); !ok {
			voiceErr(c, code, msg)
			return
		}
		wasEmpty := s.Voice.Count(ch.ID) == 0
		cur, inSame := s.Voice.Get(me.ID)
		inSame = inSame && cur.ChannelID == ch.ID
		old := s.Voice.Join(voice.State{UserID: me.ID, ChannelID: ch.ID, SessionID: c.SessionID(), SelfMute: req.SelfMute, SelfDeaf: req.SelfDeaf, Video: req.Video, Streaming: req.Streaming})
		if old != nil && old.ChannelID != ch.ID {
			s.broadcastVoiceLeave(ctx, *old)
		}
		st, _ := s.Voice.Get(me.ID)
		audience := s.voiceAudience(ctx, ch)
		s.Bcast.EmitUsers(audience, "voice_state", statePayload(st))
		if s.isDM(ch) && wasEmpty && !inSame {
			// joining an empty DM starts a call: ring the others
			others := []ids.ID{}
			for _, id := range ch.Recipients {
				if id != me.ID {
					others = append(others, id)
				}
			}
			s.Bcast.EmitUsers(others, "call_ring", map[string]any{"channel_id": ch.ID, "from": me.ID})
			m := &store.Message{ChannelID: ch.ID, AuthorID: me.ID, Type: "system_call", Mentions: []ids.ID{}}
			if err := s.Store.InsertMessage(ctx, m); err == nil {
				m.MentionRoles = []ids.ID{}
				s.Bcast.EmitChannel(ch.ID, "message_create", m)
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
		target, ok := s.Voice.Get(req.To)
		if !ok || target.ChannelID != mine.ChannelID {
			voiceErr(c, "peer_gone", "That user is not in your voice channel.")
			return
		}
		s.Bcast.EmitUsers([]ids.ID{req.To}, "voice_signal", map[string]any{"from": me.ID, "channel_id": mine.ChannelID, "payload": req.Payload})
	}
}

// canJoinVoice checks channel type, membership, Connect, timeouts and the user limit.
func (s *Server) canJoinVoice(ctx context.Context, me *store.User, ch *store.Channel) (bool, string, string) {
	if ch.Type == "subchat" {
		return false, "no_call", "A subchat has no call of its own. Use the conversation it belongs to."
	}
	if s.isDM(ch) {
		for _, id := range ch.Recipients {
			if id == me.ID {
				return true, "", ""
			}
		}
		return false, "not_found", "That channel does not exist."
	}
	if ch.Type != "voice" {
		return false, "not_voice", "That is not a voice channel."
	}
	p, _, err := s.Store.ChannelPerms(ctx, ch.ID, me.ID)
	if err != nil || p == 0 {
		return false, "not_found", "That channel does not exist."
	}
	if !p.Has(perms.Connect) {
		return false, "missing_permission", "You cannot connect to that channel."
	}
	if cur, ok := s.Voice.Get(me.ID); ok && cur.ChannelID == ch.ID {
		return true, "", ""
	}
	if ch.UserLimit > 0 && s.Voice.Count(ch.ID) >= ch.UserLimit && !p.Has(perms.MoveMembers) {
		return false, "channel_full", "That voice channel is full."
	}
	return true, "", ""
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
	WriteJSON(w, http.StatusOK, map[string]any{"ice_servers": servers})
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
	if v, ok := raw["channel_id"]; ok {
		if !actorPerms.Has(perms.MoveMembers) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Move Members."))
			return
		}
		if string(v) == "null" {
			if left, ok := s.Voice.Leave(uid); ok {
				s.broadcastVoiceLeave(r.Context(), left)
			}
			changes["channel_id"] = nil
		} else {
			var target ids.ID
			if json.Unmarshal(v, &target) != nil {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "channel_id is malformed."))
				return
			}
			dest, err := s.Store.ChannelByID(r.Context(), target)
			if err != nil || dest.ServerID == nil || *dest.ServerID != srv.ID || dest.Type != "voice" {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "The destination must be a voice channel of this server."))
				return
			}
			if p, _, err := s.Store.ChannelPerms(r.Context(), dest.ID, uid); err != nil || !p.Has(perms.Connect) {
				WriteError(w, E(http.StatusBadRequest, "cannot_connect", "That member cannot connect to the destination."))
				return
			}
			if dest.ID != cur.ID {
				old := s.Voice.Join(voice.State{UserID: uid, ChannelID: dest.ID, SessionID: st.SessionID, SelfMute: st.SelfMute, SelfDeaf: st.SelfDeaf, Video: st.Video, Streaming: st.Streaming, JoinedAt: st.JoinedAt})
				if old != nil {
					s.broadcastVoiceLeave(r.Context(), *old)
				}
				moved, _ := s.Voice.Get(uid)
				s.Bcast.EmitUsers(s.voiceAudience(r.Context(), dest), "voice_state", statePayload(moved))
			}
			changes["channel_id"] = dest.ID
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

// voiceChannelDeleted kicks everyone out of a channel that no longer exists.
func (s *Server) voiceChannelDeleted(ctx context.Context, ch *store.Channel) {
	if s.Voice == nil {
		return
	}
	audience := s.voiceAudience(ctx, ch)
	for _, st := range s.Voice.ClearChannel(ch.ID) {
		s.Bcast.EmitUsers(audience, "voice_state", leavePayload(st))
	}
}
