package api

import (
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const (
	// only the one-shot create call is capped, and only to keep the request small;
	// a group grows without limit through invites and adds
	maxGroupCreate = 50
	maxChannelName = 100
)

func (s *Server) channelRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/users/@me/channels", s.authed(s.handleDMCreate))
	mux.Handle("GET /api/v1/users/@me/channels", s.authed(s.handleDMList))
	mux.Handle("GET /api/v1/channels/{id}", s.authed(s.handleChannelGet))
	mux.Handle("PATCH /api/v1/channels/{id}", s.authed(s.handleChannelPatch))
	mux.Handle("PUT /api/v1/channels/{id}/icon", s.authed(s.handleChannelIcon))
	mux.Handle("DELETE /api/v1/channels/{id}/icon", s.authed(s.handleChannelIconDelete))
	mux.Handle("POST /api/v1/channels/{id}/recipients/{uid}", s.authed(s.handleRecipientAdd))
	mux.Handle("DELETE /api/v1/channels/{id}/recipients/{uid}", s.authed(s.handleRecipientRemove))
	mux.Handle("POST /api/v1/channels/{id}/typing", s.authed(s.handleTyping))
	mux.Handle("POST /api/v1/channels/{id}/attachments", s.authed(s.handleAttachmentUpload))
	mux.Handle("GET /media/attachments/{id}", s.authed(s.handleAttachmentDownload))
	mux.Handle("GET /api/v1/channels/{id}/pins", s.authed(s.handlePins))
	mux.Handle("PUT /api/v1/channels/{id}/pins/{mid}", s.authed(s.handlePin))
	mux.Handle("DELETE /api/v1/channels/{id}/pins/{mid}", s.authed(s.handleUnpin))
}

// systemMessage inserts and broadcasts a system message in a channel.
func (s *Server) systemMessage(r *http.Request, ch *store.Channel, actor ids.ID, typ string, about []ids.ID, replyTo *ids.ID) {
	m := &store.Message{ChannelID: ch.ID, AuthorID: actor, Type: typ, Mentions: about, ReplyToID: replyTo}
	if m.Mentions == nil {
		m.Mentions = []ids.ID{}
	}
	if err := s.Store.InsertMessage(r.Context(), m); err != nil {
		s.Log.Warn("system message", "err", err)
		return
	}
	m.MentionRoles = []ids.ID{}
	s.Bcast.EmitChannel(ch.ID, "message_create", m)
}

func (s *Server) handleDMCreate(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		RecipientIDs []ids.ID `json:"recipient_ids"`
		Name         string   `json:"name"`
	}
	if err := ReadJSON(w, r, &req, 8<<10); err != nil {
		WriteError(w, err)
		return
	}
	seen := map[ids.ID]bool{me.ID: true}
	var recipients []ids.ID
	for _, id := range req.RecipientIDs {
		if !seen[id] {
			seen[id] = true
			recipients = append(recipients, id)
		}
	}
	ctx := r.Context()
	switch {
	case len(recipients) == 0:
		WriteError(w, E(http.StatusBadRequest, "no_recipients", "Pick at least one other person."))
		return
	case len(recipients) == 1:
		target, err := s.Store.UserByID(ctx, recipients[0])
		if err != nil || target.Flags&store.FlagDeleted != 0 {
			WriteError(w, ErrNotFound)
			return
		}
		ab, ba, err := s.Store.Blocked(ctx, me.ID, target.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		if ab || ba {
			WriteError(w, E(http.StatusForbidden, "blocked", "You cannot message this user."))
			return
		}
		friends, err := s.Store.AreFriends(ctx, me.ID, target.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		if !friends {
			switch target.DMPrivacy {
			case "nobody":
				WriteError(w, E(http.StatusForbidden, "dm_closed", "This user does not accept direct messages."))
				return
			case "friends":
				WriteError(w, E(http.StatusForbidden, "dm_friends_only", "This user only accepts messages from friends."))
				return
			}
		}
		ch, created, err := s.Store.CreateDM(ctx, me.ID, target.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		if created {
			s.Bcast.EmitUsers(ch.Recipients, "channel_create", ch)
			WriteJSON(w, http.StatusCreated, ch)
			return
		}
		// opening a DM the caller had closed puts it back for good, not just
		// until the next reconnect rebuilds the sidebar without it
		if reopened, err := s.Store.ReopenDM(ctx, ch.ID, me.ID); err == nil && reopened {
			s.Bcast.EmitUsers([]ids.ID{me.ID}, "channel_create", ch)
		}
		WriteJSON(w, http.StatusOK, ch)
	default:
		if len(recipients) > maxGroupCreate {
			WriteError(w, E(http.StatusBadRequest, "too_many", "Start with fewer people and invite the rest."))
			return
		}
		for _, id := range recipients {
			ok, err := s.Store.AreFriends(ctx, me.ID, id)
			if err != nil {
				WriteError(w, err)
				return
			}
			if !ok {
				WriteError(w, E(http.StatusForbidden, "not_friends", "You can only add friends to a group."))
				return
			}
		}
		name, ok := CleanText(req.Name, maxChannelName)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Group names are at most 100 characters."))
			return
		}
		ch, err := s.Store.CreateGroupDM(ctx, me.ID, recipients, name)
		if err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.EmitUsers(ch.Recipients, "channel_create", ch)
		WriteJSON(w, http.StatusCreated, ch)
	}
}

func (s *Server) handleDMList(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.DMChannelsForUser(r.Context(), auth.UserFrom(r.Context()).ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleChannelGet(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	WriteJSON(w, http.StatusOK, ch)
}

func (s *Server) handleChannelPatch(w http.ResponseWriter, r *http.Request) {
	// Each kind checks its own right below: Manage Channels for a server
	// channel (asking for Manage Messages here too locked out channel managers),
	// who may manage a subchat, and ownership for handing a group on.
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	if !s.isDM(ch) {
		if s.ServerChannelPatch == nil {
			WriteError(w, ErrForbidden)
			return
		}
		s.ServerChannelPatch(w, r, ch, me)
		return
	}
	if ch.Type == "subchat" {
		s.handleSubchatPatch(w, r, ch, me)
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "Only group DMs can be edited."))
		return
	}
	var req struct {
		Name    *string `json:"name"`
		OwnerID *ids.ID `json:"owner_id"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	var p store.ChannelPatch
	if req.Name != nil {
		name, ok := CleanText(*req.Name, maxChannelName)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Group names are at most 100 characters."))
			return
		}
		p.Name = &name
	}
	if req.OwnerID != nil {
		if ch.OwnerID == nil || *ch.OwnerID != me.ID {
			WriteError(w, E(http.StatusForbidden, "not_owner", "Only the group owner can transfer ownership."))
			return
		}
		found := false
		for _, id := range ch.Recipients {
			if id == *req.OwnerID {
				found = true
			}
		}
		if !found {
			WriteError(w, E(http.StatusBadRequest, "not_member", "The new owner must be in the group."))
			return
		}
		p.OwnerID = req.OwnerID
	}
	if err := s.Store.UpdateChannel(r.Context(), ch.ID, p); err != nil {
		WriteError(w, err)
		return
	}
	updated, err := s.Store.ChannelByID(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(updated.Recipients, "channel_update", updated)
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleChannelIcon(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedManage)
	if ch == nil {
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "Only group DMs have icons."))
		return
	}
	lim := s.limitsFor("icon")
	r.Body = http.MaxBytesReader(w, r.Body, lim.MaxBytes+1)
	b, err := s.Media.PutPublic(r.Context(), "icon", r.Body, lim, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	bid := b.ID
	ptr := &bid
	if err := s.Store.UpdateChannel(r.Context(), ch.ID, store.ChannelPatch{IconID: &ptr}); err != nil {
		WriteError(w, err)
		return
	}
	if ch.IconID != nil && *ch.IconID != b.ID {
		_ = s.Store.AddBlobRef(r.Context(), *ch.IconID, -1)
	}
	updated, _ := s.Store.ChannelByID(r.Context(), ch.ID)
	s.Bcast.EmitUsers(updated.Recipients, "channel_update", updated)
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleChannelIconDelete(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channel(w, r, NeedManage)
	if ch == nil {
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "Only group DMs have icons."))
		return
	}
	var nilID *ids.ID
	if err := s.Store.UpdateChannel(r.Context(), ch.ID, store.ChannelPatch{IconID: &nilID}); err != nil {
		WriteError(w, err)
		return
	}
	if ch.IconID != nil {
		_ = s.Store.AddBlobRef(r.Context(), *ch.IconID, -1)
	}
	updated, _ := s.Store.ChannelByID(r.Context(), ch.ID)
	s.Bcast.EmitUsers(updated.Recipients, "channel_update", updated)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRecipientAdd(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedManage)
	if ch == nil {
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "Only group DMs can gain members."))
		return
	}
	uid, err := ids.Parse(r.PathValue("uid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ok, err := s.Store.AreFriends(r.Context(), me.ID, uid)
	if err != nil {
		WriteError(w, err)
		return
	}
	if !ok {
		WriteError(w, E(http.StatusForbidden, "not_friends", "You can only add your friends."))
		return
	}
	subs, err := s.Store.AddParticipant(r.Context(), ch.ID, uid, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	updated, _ := s.Store.ChannelByID(r.Context(), ch.ID)
	s.Bcast.EmitUsers([]ids.ID{uid}, "channel_create", updated)
	s.Bcast.EmitUsers(ch.Recipients, "channel_update", updated)
	s.systemMessage(r, updated, me.ID, "system_member_add", []ids.ID{uid}, nil)
	s.Bcast.KeysMaybeNeeded(ch.ID)
	s.subchatsJoined(r.Context(), subs, uid)
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleRecipientRemove(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	if ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_group", "You cannot leave a direct message."))
		return
	}
	uid, err := ids.Parse(r.PathValue("uid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	isOwner := ch.OwnerID != nil && *ch.OwnerID == me.ID
	if uid != me.ID && !isOwner {
		WriteError(w, E(http.StatusForbidden, "not_owner", "Only the group owner can remove others."))
		return
	}
	subs, err := s.Store.RemoveParticipant(r.Context(), ch.ID, uid)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.subchatsLeft(r.Context(), ch.ID, subs, uid)
	remaining, _ := s.Store.Participants(r.Context(), ch.ID)
	if len(remaining) == 0 {
		_ = s.deleteConversation(r.Context(), ch)
		s.Bcast.EmitUsers([]ids.ID{uid}, "channel_delete", map[string]any{"id": ch.ID})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if uid != me.ID {
		// every member can list the group's links, so whoever was just removed
		// has seen them; they stop working rather than letting them back in
		_ = s.Store.RevokeChannelInvites(r.Context(), ch.ID)
	}
	if ch.OwnerID != nil && *ch.OwnerID == uid {
		newOwner := remaining[0]
		_ = s.Store.UpdateChannel(r.Context(), ch.ID, store.ChannelPatch{OwnerID: &newOwner})
	}
	updated, _ := s.Store.ChannelByID(r.Context(), ch.ID)
	s.Bcast.EmitUsers([]ids.ID{uid}, "channel_delete", map[string]any{"id": ch.ID})
	s.Bcast.EmitUsers(remaining, "channel_update", updated)
	s.systemMessage(r, updated, me.ID, "system_member_remove", []ids.ID{uid}, nil)
	tr := true
	_ = s.Store.SetKeyFlags(r.Context(), ch.ID, &tr, nil)
	s.Bcast.EmitUsers(remaining, "key_rotation_needed", map[string]any{"conv_id": ch.ID})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTyping(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedSend)
	if ch == nil {
		return
	}
	s.Bcast.Typing(r.Context(), me.ID, ch.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedAttach)
	if ch == nil {
		return
	}
	if ok, retry := s.limUpload.Allow("up:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	// One request only takes what fits through the proxy in front; anything
	// larger goes through /uploads in pieces.
	limit := s.Cfg.MaxUploadBytes
	if limit > MaxSingleUploadBytes {
		limit = MaxSingleUploadBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1)
	b, err := s.Media.PutEncrypted(r.Context(), r.Body, limit, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"blob_id": b.ID, "size": b.Size, "channel_id": ch.ID})
}

func (s *Server) handleAttachmentDownload(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	b, err := s.Store.BlobByID(r.Context(), id)
	if err != nil || b.Kind != "attachment" {
		http.NotFound(w, r)
		return
	}
	att, err := s.Store.AttachmentByBlob(r.Context(), id)
	if err != nil {
		// not attached yet: only the uploader may fetch it
		if b.OwnerID == nil || *b.OwnerID != me.ID {
			http.NotFound(w, r)
			return
		}
	} else {
		ch, err := s.Store.ChannelByID(r.Context(), att.ChannelID)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ok, err := s.canAccess(r, me, ch, NeedHistory)
		if err != nil || !ok {
			http.NotFound(w, r)
			return
		}
	}
	s.Media.ServeEncrypted(w, r, b)
}

func (s *Server) handlePins(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedHistory)
	if ch == nil {
		return
	}
	list, err := s.Store.Pins(r.Context(), ch.ID, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handlePin(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedPin)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	m, err := s.Store.MessageByID(r.Context(), mid, me.ID)
	if err != nil || m.ChannelID != ch.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.PinMessage(r.Context(), ch.ID, mid, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitChannel(ch.ID, "pin_update", map[string]any{"channel_id": ch.ID, "message_id": mid, "pinned": true})
	s.systemMessage(r, ch, me.ID, "system_pin", []ids.ID{}, &mid)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnpin(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channel(w, r, NeedPin)
	if ch == nil {
		return
	}
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.UnpinMessage(r.Context(), ch.ID, mid); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitChannel(ch.ID, "pin_update", map[string]any{"channel_id": ch.ID, "message_id": mid, "pinned": false})
	w.WriteHeader(http.StatusNoContent)
}
