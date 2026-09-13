package api

import (
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
	if err := s.Store.SetUserFlags(r.Context(), id, flags); err != nil {
		WriteError(w, err)
		return
	}
	if req.Disabled != nil && *req.Disabled {
		// a disabled account loses every session immediately
		_ = s.Store.DeleteUserSessions(r.Context(), id, 0)
		s.Bcast.EmitUsers([]ids.ID{id}, "session_expired", map[string]any{"reason": "disabled"})
	}
	WriteJSON(w, http.StatusOK, store.AdminUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Flags: flags, CreatedAt: u.CreatedAt, Admin: flags&store.FlagAdmin != 0, Disabled: flags&store.FlagDisabled != 0})
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
