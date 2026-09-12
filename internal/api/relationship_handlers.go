package api

import (
	"net/http"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

func (s *Server) relationshipRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/users/@me/relationships", s.authed(s.handleRelationships))
	mux.Handle("POST /api/v1/users/@me/relationships", s.authed(s.handleFriendRequest))
	mux.Handle("PUT /api/v1/users/@me/relationships/{id}", s.authed(s.handleFriendAccept))
	mux.Handle("DELETE /api/v1/users/@me/relationships/{id}", s.authed(s.handleRelationshipDelete))
	mux.Handle("PATCH /api/v1/users/@me/relationships/{id}", s.authed(s.handleRelationshipNickname))
	mux.Handle("PUT /api/v1/users/@me/blocks/{id}", s.authed(s.handleBlock))
	mux.Handle("DELETE /api/v1/users/@me/blocks/{id}", s.authed(s.handleUnblock))
	s.Profile.MutualFriends = func(r *http.Request, me, other ids.ID) ([]ids.ID, error) {
		return s.Store.MutualFriends(r.Context(), me, other)
	}
}

type relationshipView = store.RelationshipView

func (s *Server) handleRelationships(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	rels, err := s.Store.Relationships(r.Context(), me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	targets := make([]ids.ID, 0, len(rels))
	for _, rel := range rels {
		targets = append(targets, rel.TargetID)
	}
	users, err := s.Store.UsersByIDs(r.Context(), targets)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := make([]relationshipView, 0, len(rels))
	for _, rel := range rels {
		if u := users[rel.TargetID]; u != nil {
			out = append(out, relationshipView{User: u.Public(), Type: rel.Type, Nickname: rel.Nickname, CreatedAt: rel.CreatedAt})
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

// emitRelationship tells both sides about their current relationship rows.
func (s *Server) emitRelationship(r *http.Request, a, b *store.User) {
	for _, pair := range [][2]*store.User{{a, b}, {b, a}} {
		rel, err := s.Store.Relationship(r.Context(), pair[0].ID, pair[1].ID)
		if err != nil {
			s.Bcast.EmitUsers([]ids.ID{pair[0].ID}, "relationship_remove", map[string]any{"user_id": pair[1].ID})
			continue
		}
		s.Bcast.EmitUsers([]ids.ID{pair[0].ID}, "relationship_add", relationshipView{User: pair[1].Public(), Type: rel.Type, Nickname: rel.Nickname, CreatedAt: rel.CreatedAt})
	}
}

func (s *Server) handleFriendRequest(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		Username string `json:"username"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	ctx := r.Context()
	target, err := s.Store.UserByUsername(ctx, strings.ToLower(strings.TrimSpace(req.Username)))
	if err != nil || target.Flags&store.FlagDeleted != 0 {
		WriteError(w, E(http.StatusNotFound, "user_not_found", "No user with that username."))
		return
	}
	if target.ID == me.ID {
		WriteError(w, E(http.StatusBadRequest, "self", "You cannot add yourself."))
		return
	}
	ab, ba, err := s.Store.Blocked(ctx, me.ID, target.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if ab || ba {
		WriteError(w, E(http.StatusForbidden, "blocked", "You cannot send a request to this user."))
		return
	}
	existing, err := s.Store.Relationship(ctx, me.ID, target.ID)
	if err == nil {
		switch existing.Type {
		case "friend":
			WriteError(w, E(http.StatusBadRequest, "already_friends", "You are already friends."))
			return
		case "outgoing":
			WriteError(w, E(http.StatusBadRequest, "already_sent", "You already sent a request."))
			return
		case "incoming":
			if err := s.Store.SetRelationshipPair(ctx, me.ID, target.ID, "friend", "friend"); err != nil {
				WriteError(w, err)
				return
			}
			s.emitRelationship(r, me, target)
			WriteJSON(w, http.StatusOK, map[string]any{"type": "friend", "user": target.Public()})
			return
		}
	}
	if err := s.Store.SetRelationshipPair(ctx, me.ID, target.ID, "outgoing", "incoming"); err != nil {
		WriteError(w, err)
		return
	}
	s.emitRelationship(r, me, target)
	WriteJSON(w, http.StatusOK, map[string]any{"type": "outgoing", "user": target.Public()})
}

func (s *Server) handleFriendAccept(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	rel, err := s.Store.Relationship(r.Context(), me.ID, id)
	if err != nil || rel.Type != "incoming" {
		WriteError(w, E(http.StatusNotFound, "no_request", "There is no pending request from that user."))
		return
	}
	target, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.SetRelationshipPair(r.Context(), me.ID, id, "friend", "friend"); err != nil {
		WriteError(w, err)
		return
	}
	s.emitRelationship(r, me, target)
	// Becoming friends opens the conversation straight away, so neither of you
	// has to go looking for a way to start it.
	resp := map[string]any{"type": "friend", "user": target.Public()}
	if ch, created, err := s.Store.CreateDM(r.Context(), me.ID, target.ID); err == nil {
		if created {
			s.Bcast.EmitUsers(ch.Recipients, "channel_create", ch)
		} else if unhidden, err := s.Store.UnhideDM(r.Context(), ch.ID); err == nil && len(unhidden) > 0 {
			s.Bcast.EmitUsers(unhidden, "channel_create", ch)
		}
		resp["channel"] = ch
	}
	WriteJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRelationshipDelete(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	rel, err := s.Store.Relationship(r.Context(), me.ID, id)
	if err != nil || rel.Type == "blocked" {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteRelationshipPair(r.Context(), me.ID, id); err != nil {
		WriteError(w, err)
		return
	}
	if target, err := s.Store.UserByID(r.Context(), id); err == nil {
		s.emitRelationship(r, me, target)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil || id == me.ID {
		WriteError(w, ErrNotFound)
		return
	}
	target, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteRelationship(r.Context(), id, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	if err := s.Store.SetRelationship(r.Context(), me.ID, id, "blocked"); err != nil {
		WriteError(w, err)
		return
	}
	s.emitRelationship(r, me, target)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnblock(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	rel, err := s.Store.Relationship(r.Context(), me.ID, id)
	if err != nil || rel.Type != "blocked" {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.DeleteRelationship(r.Context(), me.ID, id); err != nil {
		WriteError(w, err)
		return
	}
	if target, err := s.Store.UserByID(r.Context(), id); err == nil {
		s.emitRelationship(r, me, target)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRelationshipNickname sets a private nickname for a friend.
func (s *Server) handleRelationshipNickname(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	other, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	var req struct {
		Nickname string `json:"nickname"`
	}
	if err := ReadJSON(w, r, &req, 2<<10); err != nil {
		WriteError(w, err)
		return
	}
	nick, ok := CleanText(strings.Join(strings.Fields(req.Nickname), " "), 32)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "invalid_nickname", "Nicknames are at most 32 characters."))
		return
	}
	if err := s.Store.SetRelationshipNickname(r.Context(), me.ID, other, nick); err != nil {
		WriteError(w, err)
		return
	}
	rel, err := s.Store.Relationship(r.Context(), me.ID, other)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	u, err := s.Store.UserByID(r.Context(), other)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	view := store.RelationshipView{User: u.Public(), Type: rel.Type, Nickname: rel.Nickname, CreatedAt: rel.CreatedAt}
	s.Bcast.EmitUsers([]ids.ID{me.ID}, "relationship_add", view)
	WriteJSON(w, http.StatusOK, view)
}
