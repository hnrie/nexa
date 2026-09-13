package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

func (s *Server) adminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/instance", s.handleInstanceInfo)
	mux.Handle("GET /api/v1/admin/stats", s.admin(s.handleAdminStats))
	mux.Handle("GET /api/v1/admin/users", s.admin(s.handleAdminUsers))
	mux.Handle("PATCH /api/v1/admin/users/{id}", s.admin(s.handleAdminUserPatch))
	mux.Handle("DELETE /api/v1/admin/users/{id}", s.admin(s.handleAdminUserDelete))
	mux.Handle("GET /api/v1/admin/settings", s.admin(s.handleAdminSettings))
	mux.Handle("PATCH /api/v1/admin/settings", s.admin(s.handleAdminSettingsPatch))
}

// admin gates a handler behind the admin flag.
func (s *Server) admin(h http.HandlerFunc) http.Handler {
	return s.authed(func(w http.ResponseWriter, r *http.Request) {
		if auth.UserFrom(r.Context()).Flags&store.FlagAdmin == 0 {
			WriteError(w, E(http.StatusForbidden, "admin_only", "Only instance admins can do that."))
			return
		}
		h(w, r)
	})
}

// handleInstanceInfo is public: the register page needs to know the policy.
// captchaInfo is what a browser needs to show the captcha: the provider and
// its public site key, never the secret. Nil when captchas are off.
func (s *Server) captchaInfo() map[string]string {
	if !s.captchaEnabled() {
		return nil
	}
	return map[string]string{"provider": "turnstile", "site_key": s.Cfg.TurnstileSiteKey}
}

func (s *Server) handleInstanceInfo(w http.ResponseWriter, r *http.Request) {
	mode, key := s.registrationPolicy(r.Context())
	WriteJSON(w, http.StatusOK, map[string]any{
		"name":                "Evilion Chat",
		"version":             s.Version,
		"registration":        mode,
		"needs_key":           mode == "invite" && key != "",
		"max_upload_bytes":    s.Cfg.MaxUploadBytes,
		"gif_search":          s.gifEnabled(),
		"public_url":          s.Cfg.PublicURL,
		"turn_configured":     len(s.Cfg.TurnURLs) > 0 || s.Cfg.TurnKeyID != "",
		"max_sticker_bytes":   s.Cfg.MaxStickerBytes,
		"upload_chunk_bytes":  MaxChunkBytes,
		"upload_single_bytes": MaxSingleUploadBytes,
		"captcha":             s.captchaInfo(),
	})
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	st, err := s.Store.Stats(r.Context())
	if err != nil {
		WriteError(w, err)
		return
	}
	online := 0
	if h, ok := s.Bcast.(interface{ OnlineUsers() []ids.ID }); ok {
		online = len(h.OnlineUsers())
	}
	WriteJSON(w, http.StatusOK, map[string]any{"users": st.Users, "servers": st.Servers, "messages": st.Messages, "blobs": st.Blobs, "blob_bytes": st.BlobBytes, "online": online, "version": s.Version})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	before, _ := ids.Parse(r.URL.Query().Get("before"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := s.Store.AdminUsers(r.Context(), r.URL.Query().Get("q"), before, limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleAdminUserPatch(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	var req struct {
		Disabled *bool `json:"disabled"`
		Admin    *bool `json:"admin"`
	}
	if err := ReadJSON(w, r, &req, 1<<10); err != nil {
		WriteError(w, err)
		return
	}
	if id == me.ID && ((req.Disabled != nil && *req.Disabled) || (req.Admin != nil && !*req.Admin)) {
		WriteError(w, E(http.StatusBadRequest, "self", "You cannot disable or demote yourself."))
		return
	}
	flags := u.Flags
	if req.Disabled != nil {
		if *req.Disabled {
			flags |= store.FlagDisabled
		} else {
			flags &^= store.FlagDisabled
		}
	}
	if req.Admin != nil {
		if *req.Admin {
			flags |= store.FlagAdmin
		} else {
			flags &^= store.FlagAdmin
		}
	}
	// instance admins see every private channel of the servers they are in,
	// so gaining or losing that changes their view (and who holds the keys)
	isAdmin := func(f int64) bool { return f&store.FlagAdmin != 0 && f&(store.FlagDisabled|store.FlagDeleted) == 0 }
	var servers []*store.Server
	var before []visibility
	if isAdmin(u.Flags) != isAdmin(flags) {
		servers, _ = s.Store.ServersForUser(r.Context(), id)
		for _, srv := range servers {
			vis, _ := s.snapshotVisibility(r.Context(), srv.ID)
			before = append(before, vis)
		}
	}
	if err := s.Store.SetUserFlags(r.Context(), id, flags); err != nil {
		WriteError(w, err)
		return
	}
	for i, srv := range servers {
		s.syncVisibility(r.Context(), srv.ID, before[i], nil)
	}
	if req.Disabled != nil && *req.Disabled {
		// a disabled account loses every session immediately
		_ = s.Store.DeleteUserSessions(r.Context(), id, 0)
		s.Bcast.EmitUsers([]ids.ID{id}, "session_expired", map[string]any{"reason": "disabled"})
		s.Bcast.CloseUserSessions(id, 0)
	}
	WriteJSON(w, http.StatusOK, store.AdminUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Flags: flags, CreatedAt: u.CreatedAt, Admin: flags&store.FlagAdmin != 0, Disabled: flags&store.FlagDisabled != 0})
}

// handleAdminUserDelete deletes someone's account as they could themselves:
// their name and profile go, and what they wrote stays under Deleted User.
// They are taken out of every server and group first, and a server they own
// passes to another member rather than being left without an owner.
func (s *Server) handleAdminUserDelete(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	ctx := r.Context()
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	u, err := s.Store.UserByID(ctx, id)
	if err != nil || u.Flags&store.FlagDeleted != 0 {
		WriteError(w, ErrNotFound)
		return
	}
	if id == me.ID {
		WriteError(w, E(http.StatusBadRequest, "self", "Delete your own account from your settings instead."))
		return
	}
	if u.Flags&store.FlagAdmin != 0 {
		WriteError(w, E(http.StatusBadRequest, "is_admin", "Take away their admin access before deleting their account."))
		return
	}
	if err := s.detachUser(r, id, me.ID); err != nil {
		WriteError(w, err)
		return
	}
	if err := s.Store.DeleteAccount(ctx, id); err != nil {
		WriteError(w, err)
		return
	}
	// any tab still open for them signs out now
	s.Bcast.EmitUsers([]ids.ID{id}, "session_expired", map[string]any{"reason": "deleted"})
	s.Bcast.CloseUserSessions(id, 0)
	if deleted, err := s.Store.UserByID(ctx, id); err == nil {
		s.Bcast.UserUpdated(deleted)
	}
	w.WriteHeader(http.StatusNoContent)
}

// detachUser takes an account that is being deleted out of every server and
// group; actor is whoever asked (an admin, or the user themselves). A server
// it owns passes to another member (see successor) or, when nobody else is
// in it, is deleted.
func (s *Server) detachUser(r *http.Request, id, actor ids.ID) error {
	ctx := r.Context()
	servers, err := s.Store.ServersForUser(ctx, id)
	if err != nil {
		return err
	}
	for _, srv := range servers {
		if srv.OwnerID == id {
			next, ok := s.successor(ctx, srv, id, actor)
			if !ok {
				// nobody else is in it: there is nothing left to keep
				if err := s.Store.DeleteServer(ctx, srv.ID); err != nil {
					return err
				}
				s.Bcast.EmitUsers([]ids.ID{id}, "server_delete", map[string]any{"id": srv.ID})
				continue
			}
			if err := s.Store.UpdateServer(ctx, srv.ID, store.ServerPatch{OwnerID: &next}); err != nil {
				return err
			}
			s.audit(r, srv.ID, actor, "server_transfer", "user", &next, nil, "the owner's account was deleted")
			if updated, err := s.Store.ServerByID(ctx, srv.ID); err == nil {
				s.emitServer(ctx, srv.ID, "server_update", updated)
				srv = updated
			}
		}
		if err := s.removeMember(r, srv, id, "member_remove", map[string]any{"reason": "account_deleted"}); err != nil {
			return err
		}
	}
	groups, err := s.Store.GroupDMsForUser(ctx, id)
	if err != nil {
		return err
	}
	for _, gid := range groups {
		ch, err := s.Store.ChannelByID(ctx, gid)
		if err != nil {
			continue
		}
		if err := s.removeFromGroup(r, ch, id); err != nil {
			return err
		}
	}
	return nil
}

// successor picks who takes a server over from an owner who is going: the
// admin doing it if they are a member, otherwise whoever ranks highest.
func (s *Server) successor(ctx context.Context, srv *store.Server, leaving, admin ids.ID) (ids.ID, bool) {
	members, err := s.Store.MemberIDs(ctx, srv.ID)
	if err != nil {
		return 0, false
	}
	var best ids.ID
	bestRank, found := 0, false
	for _, m := range members {
		if m == leaving {
			continue
		}
		if m == admin {
			return m, true
		}
		if rank, _ := s.actorHighest(ctx, srv, m); !found || rank > bestRank {
			best, bestRank, found = m, rank, true
		}
	}
	return best, found
}

func (s *Server) adminSettingsView(r *http.Request) map[string]any {
	mode, key := s.registrationPolicy(r.Context())
	overrides, _ := s.Store.InstanceSettings(r.Context())
	return map[string]any{
		"registration":         mode,
		"registration_key_set": key != "",
		"config_registration":  s.Cfg.Registration,
		"overrides":            overrides,
		"max_upload_bytes":     s.Cfg.MaxUploadBytes,
		"max_emoji_bytes":      s.Cfg.MaxEmojiBytes,
		"max_sticker_bytes":    s.Cfg.MaxStickerBytes,
		"max_avatar_bytes":     s.Cfg.MaxAvatarBytes,
		"gif_search":           s.gifEnabled(),
		"turn":                 len(s.Cfg.TurnURLs) > 0,
	}
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, s.adminSettingsView(r))
}

func (s *Server) handleAdminSettingsPatch(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if err := ReadJSON(w, r, &raw, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if v, ok := raw["registration"]; ok {
		var mode string
		if json.Unmarshal(v, &mode) != nil || !OneOf(mode, "open", "invite", "closed", "") {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "registration must be open, invite or closed."))
			return
		}
		if err := s.Store.SetInstanceSetting(r.Context(), "registration", mode); err != nil {
			WriteError(w, err)
			return
		}
	}
	if v, ok := raw["registration_key"]; ok {
		var key string
		if string(v) != "null" && json.Unmarshal(v, &key) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "registration_key must be a string."))
			return
		}
		key = strings.TrimSpace(key)
		if len(key) > 128 {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "registration_key is too long."))
			return
		}
		if err := s.Store.SetInstanceSetting(r.Context(), "registration_key", key); err != nil {
			WriteError(w, err)
			return
		}
	}
	WriteJSON(w, http.StatusOK, s.adminSettingsView(r))
}
