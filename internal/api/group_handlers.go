package api

import (
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

func (s *Server) groupRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/channels/{id}/invites", s.authed(s.handleGroupInvites))
}

func hasID(list []ids.ID, id ids.ID) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}

// dmChannel loads a DM or group DM the caller belongs to.
func (s *Server) dmChannel(w http.ResponseWriter, r *http.Request) (*store.Channel, *store.User) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	ch, err := s.Store.ChannelByID(r.Context(), id)
	if err != nil || !s.isCallable(ch) || !hasID(ch.Recipients, me.ID) {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	return ch, me
}

// handleGroupInvites lists a group's live invite links.
func (s *Server) handleGroupInvites(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.dmChannel(w, r)
	if ch == nil {
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "Only group DMs have invite links."))
		return
	}
	list, err := s.Store.InvitesForChannel(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

// handleDMDelete closes a DM for the caller, or removes the conversation for
// everyone when purge is asked for. A group is left, unless its owner deletes it.
func (s *Server) handleDMDelete(w http.ResponseWriter, r *http.Request) {
	ch, me := s.dmChannel(w, r)
	if ch == nil {
		return
	}
	purge := r.URL.Query().Get("purge") == "true"
	if ch.Type == "group_dm" {
		if !purge {
			// leaving is the ordinary way out of a group
			s.leaveGroup(w, r, ch, me)
			return
		}
		if ch.OwnerID == nil || *ch.OwnerID != me.ID {
			WriteError(w, E(http.StatusForbidden, "not_owner", "Only the group's owner can delete it."))
			return
		}
		recipients := ch.Recipients
		if err := s.Store.DeleteChannel(r.Context(), ch.ID); err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.EmitUsers(recipients, "channel_delete", map[string]any{"id": ch.ID})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !purge {
		if err := s.Store.HideDM(r.Context(), ch.ID, me.ID, true); err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.EmitUsers([]ids.ID{me.ID}, "channel_delete", map[string]any{"id": ch.ID, "closed": true})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// deleting a one-to-one conversation takes it away from both sides
	recipients := ch.Recipients
	if err := s.Store.DeleteChannel(r.Context(), ch.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(recipients, "channel_delete", map[string]any{"id": ch.ID})
	w.WriteHeader(http.StatusNoContent)
}

// leaveGroup removes the caller from a group DM, handing ownership on if needed.
func (s *Server) leaveGroup(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) {
	ctx := r.Context()
	if err := s.Store.RemoveParticipant(ctx, ch.ID, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	remaining := make([]ids.ID, 0, len(ch.Recipients))
	for _, id := range ch.Recipients {
		if id != me.ID {
			remaining = append(remaining, id)
		}
	}
	if len(remaining) == 0 {
		_ = s.Store.DeleteChannel(ctx, ch.ID)
		s.Bcast.EmitUsers([]ids.ID{me.ID}, "channel_delete", map[string]any{"id": ch.ID})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if ch.OwnerID != nil && *ch.OwnerID == me.ID {
		next := remaining[0]
		_ = s.Store.UpdateChannel(ctx, ch.ID, store.ChannelPatch{OwnerID: &next})
	}
	s.systemMessage(r, ch, me.ID, "system_member_remove", []ids.ID{me.ID}, nil)
	if updated, err := s.Store.ChannelByID(ctx, ch.ID); err == nil {
		s.Bcast.EmitUsers(remaining, "channel_update", updated)
	}
	s.Bcast.EmitUsers([]ids.ID{me.ID}, "channel_delete", map[string]any{"id": ch.ID})
	// whoever is left keeps talking under a fresh key
	tr := true
	_ = s.Store.SetKeyFlags(ctx, ch.ID, &tr, nil)
	s.Bcast.EmitUsers(remaining, "key_rotation_needed", map[string]any{"conv_id": ch.ID})
	w.WriteHeader(http.StatusNoContent)
}

// groupInvitePreview answers the public preview for a group DM invite.
func (s *Server) groupInvitePreview(w http.ResponseWriter, r *http.Request, in *store.Invite) {
	if in.ChannelID == nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	ch, err := s.Store.ChannelByID(r.Context(), *in.ChannelID)
	if err != nil || ch.Type != "group_dm" {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	name := ch.Name
	if name == "" {
		name = "Group chat"
	}
	resp := map[string]any{
		"code":       in.Code,
		"expires_at": in.ExpiresAt,
		"group":      map[string]any{"id": ch.ID, "name": name, "icon_id": ch.IconID, "member_count": len(ch.Recipients)},
	}
	if u, err := s.Store.UserByID(r.Context(), in.InviterID); err == nil {
		resp["inviter"] = u.Public()
	}
	WriteJSON(w, http.StatusOK, resp)
}

// groupInviteJoin adds the caller to the group the invite points at.
func (s *Server) groupInviteJoin(w http.ResponseWriter, r *http.Request, in *store.Invite, me *store.User) {
	ctx := r.Context()
	if in.ChannelID == nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	ch, err := s.Store.ChannelByID(ctx, *in.ChannelID)
	if err != nil || ch.Type != "group_dm" {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	if hasID(ch.Recipients, me.ID) {
		WriteJSON(w, http.StatusOK, map[string]any{"channel": ch})
		return
	}
	if err := s.Store.AddParticipant(ctx, ch.ID, me.ID, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	_ = s.Store.UseInvite(ctx, in.Code)
	updated, err := s.Store.ChannelByID(ctx, ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(updated.Recipients, "channel_create", updated)
	s.systemMessage(r, updated, me.ID, "system_member_add", []ids.ID{me.ID}, nil)
	s.Bcast.KeysMaybeNeeded(updated.ID)
	users := []store.PublicUser{}
	if byID, err := s.Store.UsersByIDs(ctx, updated.Recipients); err == nil {
		for _, id := range updated.Recipients {
			if u := byID[id]; u != nil {
				users = append(users, u.Public())
			}
		}
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"channel": updated, "users": users})
}
