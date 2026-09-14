package api

import (
	"errors"
	"net/http"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const maxSubchatName = 48

func (s *Server) subchatRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/channels/{id}/subchats", s.authed(s.handleSubchatList))
	mux.Handle("POST /api/v1/channels/{id}/subchats", s.authed(s.handleSubchatCreate))
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
	sub, err := s.Store.CreateSubchat(r.Context(), ch, me.ID, name)
	if errors.Is(err, store.ErrTooMany) {
		WriteError(w, E(http.StatusBadRequest, "too_many_subchats", "This conversation already has the most subchats it can hold."))
		return
	}
	if err != nil {
		WriteError(w, err)
		return
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
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.Name == nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "There is nothing to change."))
		return
	}
	name, ok := CleanText(*req.Name, maxSubchatName)
	if !ok || name == "" {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "Give the subchat a name of 1 to 48 characters."))
		return
	}
	if err := s.Store.UpdateChannel(r.Context(), ch.ID, store.ChannelPatch{Name: &name}); err != nil {
		WriteError(w, err)
		return
	}
	fresh, err := s.Store.ChannelByID(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(fresh.Recipients, "channel_update", fresh)
	WriteJSON(w, http.StatusOK, fresh)
}
