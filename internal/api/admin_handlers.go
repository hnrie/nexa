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
		"name":                "Nexa",
		"version":             s.Version,
		"registration":        mode,
		"needs_key":           mode == "invite" && key != "",
		"max_upload_bytes":    s.Cfg.MaxUploadBytes,
		"gif_search":          s.gifEnabled(),
		"public_url":          s.Cfg.PublicURL,
		"turn_configured":     len(s.Cfg.TurnURLs) > 0 || s.Cfg.TurnKeyID != "",
		"max_sticker_bytes":   s.Cfg.MaxStickerBytes,
		"upload_chunk_bytes":  MaxChunkBytes,
		"upload_single_bytes": SingleUploadBytes,
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
	var calls any
	if s.Meter != nil {
		ctx := r.Context()
		calls = map[string]any{"month": s.Meter.Month(), "used_bytes": s.Meter.Used(ctx), "limit_bytes": s.Meter.Limit(), "video_paused": !s.Meter.VideoAllowed(ctx), "calls_paused": !s.Meter.CallsAllowed(ctx)}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"users": st.Users, "servers": st.Servers, "messages": st.Messages, "blobs": st.Blobs, "blob_bytes": st.BlobBytes, "online": online, "version": s.Version, "realtime": calls})
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
		Disabled *bool  `json:"disabled"`
		Admin    *bool  `json:"admin"`
		Reason   string `json:"reason"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if id == me.ID && ((req.Disabled != nil && *req.Disabled) || (req.Admin != nil && !*req.Admin)) {
		WriteError(w, E(http.StatusBadRequest, "self", "You cannot disable or demote yourself."))
		return
	}
	if isSystem(u) {
		WriteError(w, blockError(blockSystem))
		return
	}
	// Nobody can take the owner's access away: without this, any admin could
	// demote the owner and then act on them like anyone else.
	if owner, err := s.Store.InstanceOwnerID(r.Context()); err == nil && owner == id && id != me.ID {
		WriteError(w, E(http.StatusForbidden, "owner_protected", "The instance owner's access cannot be changed."))
		return
	}
	reason, ok := CleanText(req.Reason, maxModReason)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "reason_too_long", "Reasons are at most 1000 characters."))
		return
	}
	// Only the bits this request names are touched, so a second admin changing
	// a different bit at the same moment does not have their change undone.
	var set, clear int64
	if req.Disabled != nil {
		if *req.Disabled {
			set |= store.FlagDisabled
		} else {
			clear |= store.FlagDisabled
		}
	}
	if req.Admin != nil {
		if *req.Admin {
			set |= store.FlagAdmin
		} else {
			clear |= store.FlagAdmin
		}
	}
	// instance admins see every private channel of the servers they are in,
	// so gaining or losing that changes their view (and who holds the keys)
	isAdmin := func(f int64) bool { return f&store.FlagAdmin != 0 && f&(store.FlagDisabled|store.FlagDeleted) == 0 }
	var servers []*store.Server
	var before []visibility
	if isAdmin(u.Flags) != isAdmin((u.Flags|set)&^clear) {
		// The snapshots come first: taken after the write they would show the
		// new view as though it had always been there, and a failed one would
		// make every channel look newly visible to every member.
		if servers, err = s.Store.ServersForUser(r.Context(), id); err != nil {
			WriteError(w, err)
			return
		}
		for _, srv := range servers {
			vis, err := s.snapshotVisibility(r.Context(), srv.ID)
			if err != nil {
				WriteError(w, err)
				return
			}
			before = append(before, vis)
		}
	}
	flags, err := s.Store.ChangeUserFlags(r.Context(), id, set, clear)
	if err != nil {
		WriteError(w, err)
		return
	}
	// what actually changed goes in the log, one line per change
	for _, ch := range []struct {
		bit     int64
		on, off string
	}{{store.FlagAdmin, store.LogAdminGrant, store.LogAdminRevoke}, {store.FlagDisabled, store.LogAccountDisable, store.LogAccountEnable}} {
		was, now := u.Flags&ch.bit != 0, flags&ch.bit != 0
		if was == now {
			continue
		}
		action := ch.off
		if now {
			action = ch.on
		}
		entry := &store.ModLogEntry{Action: action, ModeratorID: me.ID, ModeratorUsername: me.Username, TargetID: &u.ID, TargetUsername: u.Username, Reason: reason}
		if err := s.Store.AppendModLog(r.Context(), entry); err != nil {
			s.Log.Warn("moderation: log access change", "user", id.String(), "err", err)
			continue
		}
		s.emitLog(r.Context(), entry)
	}
	for i, srv := range servers {
		s.syncVisibility(r.Context(), srv.ID, before[i], nil)
	}
	if req.Disabled != nil && *req.Disabled {
		// a disabled account loses every session immediately
		if err := s.Store.DeleteUserSessions(r.Context(), id, 0); err != nil {
			// the account is already disabled — the middleware re-checks the
			// flag per request — but the rows should have gone with it
			s.Log.Warn("disable: session sweep", "user", id.String(), "err", err)
		}
		s.Bcast.EmitUsers([]ids.ID{id}, "session_expired", map[string]any{"reason": "disabled"})
		s.Bcast.CloseUserSessions(id, 0)
	}
	WriteJSON(w, http.StatusOK, store.AdminUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Flags: flags, CreatedAt: u.CreatedAt, Admin: flags&store.FlagAdmin != 0, Disabled: flags&store.FlagDisabled != 0})
}

// handleAdminUserDelete deletes an account the way the moderation panel's
// Delete does, without the case: everything it made goes with it, everywhere,
// including the servers and group chats it owns. Its one-to-one conversations
// stay, for the people on the other side of them.
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
	if isSystem(u) {
		WriteError(w, blockError(blockSystem))
		return
	}
	if u.Flags&store.FlagAdmin != 0 {
		WriteError(w, E(http.StatusBadRequest, "is_admin", "Take away their admin access before deleting their account."))
		return
	}
	counts, err := s.Store.PurgePreview(ctx, id)
	if err != nil {
		WriteError(w, err)
		return
	}
	entry := &store.ModLogEntry{Action: store.ActionDelete, ModeratorID: me.ID, ModeratorUsername: me.Username, TargetID: &u.ID, TargetUsername: u.Username,
		Details: mustJSON(map[string]any{"counts": counts})}
	if err := s.Store.AppendModLog(ctx, entry); err != nil {
		WriteError(w, err)
		return
	}
	s.emitLog(ctx, entry)
	// Signing in stops now, and any tab still open for them signs out, so
	// nothing new is added while the rest goes.
	if _, err := s.Store.ChangeUserFlags(ctx, id, store.FlagDisabled|store.FlagDeleted, 0); err != nil {
		WriteError(w, err)
		return
	}
	if err := s.Store.DeleteUserSessions(ctx, id, 0); err != nil {
		s.Log.Warn("admin: delete sessions", "user", id.String(), "err", err)
	}
	s.Bcast.EmitUsers([]ids.ID{id}, "session_expired", map[string]any{"reason": "deleted"})
	s.Bcast.CloseUserSessions(id, 0)
	pctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purgeTimeout)
	defer cancel()
	if err := s.purgeAccount(r.WithContext(pctx), id, purgeOptions{}); err != nil {
		s.Log.Error("admin: delete account", "user", id.String(), "err", err)
		WriteError(w, E(http.StatusInternalServerError, "delete_incomplete", "The account is closed, but not everything is gone yet. The rest goes by itself shortly."))
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
	// Every field is checked before any of them is written. Validating and
	// writing one at a time meant a request rejected for its second field had
	// already applied its first: an admin who read "registration_key is too
	// long" and concluded nothing had changed had in fact closed registration.
	var pending [][2]string
	if v, ok := raw["registration"]; ok {
		var mode string
		if json.Unmarshal(v, &mode) != nil || !OneOf(mode, "open", "invite", "closed", "") {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "registration must be open, invite or closed."))
			return
		}
		pending = append(pending, [2]string{"registration", mode})
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
		pending = append(pending, [2]string{"registration_key", key})
	}
	if err := s.Store.SetInstanceSettings(r.Context(), pending); err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, s.adminSettingsView(r))
}
