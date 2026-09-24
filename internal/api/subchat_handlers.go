package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const maxSubchatName = 48

func (s *Server) subchatRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/channels/{id}/subchats", s.authed(s.handleSubchatList))
	mux.Handle("POST /api/v1/channels/{id}/subchats", s.authed(s.handleSubchatCreate))
	mux.Handle("GET /api/v1/channels/{id}/lock", s.authed(s.handleLockParams))
	mux.Handle("POST /api/v1/channels/{id}/unlock", s.userLimited(s.limAuthUsr, s.handleUnlock))
}

// lockRequest is a password as the client stretched it: the same shape as an
// account's, so the server never sees the password itself.
type lockRequest struct {
	AuthKey []byte          `json:"password_key"`
	Salt    []byte          `json:"password_salt"`
	Params  json.RawMessage `json:"password_params"`
	// Remove takes the password off instead of setting one.
	Remove bool `json:"password_remove"`
}

// lockFrom reads the password material out of a request, or reports why not.
// A nil lock with a nil error means the request asked for no change.
func lockFrom(req lockRequest) (*store.ChannelLock, error) {
	if req.Remove {
		return &store.ChannelLock{}, nil
	}
	if len(req.AuthKey) == 0 && len(req.Salt) == 0 && len(req.Params) == 0 {
		return nil, nil
	}
	if len(req.AuthKey) != 32 || len(req.Salt) < 16 || len(req.Salt) > 64 || !validKDF(req.Params) {
		return nil, E(http.StatusBadRequest, "invalid_password", "That password could not be prepared. Try again.")
	}
	hash, err := auth.HashAuthKey(req.AuthKey)
	if err != nil {
		return nil, err
	}
	return &store.ChannelLock{Salt: req.Salt, Params: string(req.Params), Hash: hash}, nil
}

// handleLockParams hands out what a client needs to stretch the password the
// same way this channel's was stretched. It says nothing about the password.
func (s *Server) handleLockParams(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channelIgnoringLock(w, r)
	if ch == nil {
		return
	}
	l, err := s.Store.LockOf(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if !l.Locked() {
		WriteJSON(w, http.StatusOK, map[string]any{"locked": false, "unlocked": true})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"locked": true, "unlocked": s.unlocked(r, ch), "salt": l.Salt, "params": json.RawMessage(l.Params)})
}

// handleUnlock records that this session typed the password.
func (s *Server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channelIgnoringLock(w, r)
	if ch == nil {
		return
	}
	var req struct {
		AuthKey []byte `json:"password_key"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	l, err := s.Store.LockOf(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if !l.Locked() {
		WriteJSON(w, http.StatusOK, map[string]any{"unlocked": true})
		return
	}
	if ok, retry := s.limPass.Allow("pw:" + auth.UserFrom(r.Context()).ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	ok, err := auth.VerifyAuthKey(req.AuthKey, l.Hash)
	if err != nil || !ok {
		WriteError(w, E(http.StatusForbidden, "wrong_password", "That is not the password for this subchat."))
		return
	}
	sess := auth.SessionFrom(r.Context())
	if sess == nil {
		WriteError(w, ErrUnauthorized)
		return
	}
	if err := s.Store.MarkUnlocked(r.Context(), ch.ID, sess.ID); err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"unlocked": true})
}

// parentOf loads the DM a subchat belongs to.
func (s *Server) parentOf(r *http.Request, ch *store.Channel) *store.Channel {
	if ch.ParentID == nil {
		return nil
	}
	parent, err := s.Store.ChannelByID(r.Context(), *ch.ParentID)
	if err != nil {
		return nil
	}
	return parent
}

// canManageSubchat decides who may rename or delete one: whoever opened it,
// whoever manages the group it sits in (its owner or an instance admin), or
// either side of a one-to-one DM, where there is no hierarchy to appeal to.
func (s *Server) canManageSubchat(r *http.Request, ch *store.Channel, me *store.User) bool {
	if ch.OwnerID != nil && *ch.OwnerID == me.ID {
		return true
	}
	parent := s.parentOf(r, ch)
	if parent == nil {
		return false
	}
	if parent.Type == "dm" {
		return hasID(parent.Recipients, me.ID)
	}
	return managesGroup(parent, me)
}

// dmForSubchats resolves the channel a subchat list or creation applies to.
func (s *Server) dmForSubchats(w http.ResponseWriter, r *http.Request) (*store.Channel, *store.User) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return nil, nil
	}
	if ch.Type == "subchat" {
		// asking a subchat about its siblings answers about the conversation
		parent := s.parentOf(r, ch)
		if parent == nil || !hasID(parent.Recipients, me.ID) {
			WriteError(w, ErrNotFound)
			return nil, nil
		}
		return parent, me
	}
	if ch.Type != "dm" && ch.Type != "group_dm" {
		WriteError(w, E(http.StatusBadRequest, "not_dm", "Subchats belong to a conversation, not a server channel."))
		return nil, nil
	}
	return ch, me
}

func (s *Server) handleSubchatList(w http.ResponseWriter, r *http.Request) {
	ch, me := s.dmForSubchats(w, r)
	if ch == nil {
		return
	}
	list, err := s.Store.SubchatsFor(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	// only the subchats the caller is in: one they cannot open would still
	// give away its name and who is in it
	mine := make([]*store.Channel, 0, len(list))
	for _, sub := range list {
		if hasID(sub.Recipients, me.ID) {
			mine = append(mine, sub)
		}
	}
	WriteJSON(w, http.StatusOK, mine)
}

func (s *Server) handleSubchatCreate(w http.ResponseWriter, r *http.Request) {
	ch, me := s.dmForSubchats(w, r)
	if ch == nil {
		return
	}
	var req struct {
		Name string `json:"name"`
		lockRequest
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	name, ok := CleanText(req.Name, maxSubchatName)
	if !ok || name == "" {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "Give the subchat a name of 1 to 48 characters."))
		return
	}
	lock, err := lockFrom(req.lockRequest)
	if err != nil {
		WriteError(w, err)
		return
	}
	sub, err := s.Store.CreateSubchat(r.Context(), ch, me.ID, name, lock)
	if errors.Is(err, store.ErrTooMany) {
		WriteError(w, E(http.StatusBadRequest, "too_many_subchats", "This conversation already has the most subchats it can hold."))
		return
	}
	if err != nil {
		WriteError(w, err)
		return
	}
	if sub.Locked {
		// whoever set it does not have to type it straight back
		if sess := auth.SessionFrom(r.Context()); sess != nil {
			if err := s.Store.MarkUnlocked(r.Context(), sub.ID, sess.ID); err != nil {
				s.Log.Warn("subchat create: mark unlocked", "channel", sub.ID.String(), "err", err)
			}
		}
	}
	s.Bcast.EmitUsers(sub.Recipients, "channel_create", sub)
	WriteJSON(w, http.StatusCreated, sub)
}

// handleSubchatDelete removes a subchat and everything in it, for everyone.
func (s *Server) handleSubchatDelete(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) {
	if !s.canManageSubchat(r, ch, me) {
		WriteError(w, E(http.StatusForbidden, "not_allowed", "Only whoever opened this subchat can delete it."))
		return
	}
	// it takes the room away from everyone in it, which a muted account cannot
	if mutedFor(w, r) {
		return
	}
	recipients := append([]ids.ID{}, ch.Recipients...)
	if err := s.Store.DeleteChannel(r.Context(), ch.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(recipients, "channel_delete", map[string]any{"id": ch.ID, "parent_id": ch.ParentID})
	w.WriteHeader(http.StatusNoContent)
}

// handleSubchatPatch renames one.
func (s *Server) handleSubchatPatch(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) {
	if !s.canManageSubchat(r, ch, me) {
		WriteError(w, E(http.StatusForbidden, "not_allowed", "Only whoever opened this subchat can rename it."))
		return
	}
	var req struct {
		Name *string `json:"name"`
		lockRequest
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	lock, err := lockFrom(req.lockRequest)
	if err != nil {
		WriteError(w, err)
		return
	}
	if req.Name == nil && lock == nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "There is nothing to change."))
		return
	}
	if req.Name != nil {
		name, ok := CleanText(*req.Name, maxSubchatName)
		if !ok || name == "" {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Give the subchat a name of 1 to 48 characters."))
			return
		}
		if err := s.Store.UpdateChannel(r.Context(), ch.ID, store.ChannelPatch{Name: &name}); err != nil {
			WriteError(w, err)
			return
		}
	}
	if lock != nil {
		if err := s.Store.SetLock(r.Context(), ch.ID, *lock); err != nil {
			WriteError(w, err)
			return
		}
		// Every session has to type the new password; whoever just set it
		// would otherwise be shut out of the subchat they are looking at.
		if lock.Locked() {
			if sess := auth.SessionFrom(r.Context()); sess != nil {
				_ = s.Store.MarkUnlocked(r.Context(), ch.ID, sess.ID)
			}
		}
	}
	fresh, err := s.Store.ChannelByID(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(fresh.Recipients, "channel_update", fresh)
	WriteJSON(w, http.StatusOK, fresh)
}
