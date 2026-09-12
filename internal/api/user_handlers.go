package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const (
	maxAboutMe  = 100000
	maxPronouns = 40
	maxStatus   = 128
	maxSettings = 1 << 20
)

func (s *Server) userRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/users/@me", s.authed(s.handleMe))
	mux.Handle("PATCH /api/v1/users/@me", s.authed(s.handleMePatch))
	mux.Handle("POST /api/v1/users/@me/delete", s.authed(s.handleMeDelete))
	mux.Handle("GET /api/v1/users/@me/settings", s.authed(s.handleSettingsGet))
	mux.Handle("PUT /api/v1/users/@me/settings", s.authed(s.handleSettingsPut))
	mux.Handle("GET /api/v1/users/@me/keys", s.authed(s.handleMyKeys))
	mux.Handle("GET /api/v1/users/search", s.authed(s.handleUserSearch))
	mux.Handle("GET /api/v1/users/{id}", s.authed(s.handleUserGet))
	mux.Handle("GET /api/v1/users/{id}/profile", s.authed(s.handleUserProfile))
	mux.Handle("GET /api/v1/users/{id}/public-key", s.authed(s.handlePublicKey))
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, meView(auth.UserFrom(r.Context())))
}

// parseUserID resolves "@me" or a snowflake from the path.
func parseUserID(r *http.Request) (ids.ID, bool) {
	raw := r.PathValue("id")
	if raw == "@me" {
		return auth.UserFrom(r.Context()).ID, true
	}
	id, err := ids.Parse(raw)
	return id, err == nil
}

func (s *Server) handleMePatch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var raw map[string]json.RawMessage
	if err := ReadJSON(w, r, &raw, 512<<10); err != nil {
		WriteError(w, err)
		return
	}
	var p store.ProfilePatch
	bad := func(code, msg string) { WriteError(w, E(http.StatusBadRequest, code, msg)) }
	getString := func(key string) (string, bool, bool) { // value, present, isNull
		v, ok := raw[key]
		if !ok {
			return "", false, false
		}
		if string(v) == "null" {
			return "", true, true
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return "", true, true
		}
		return s, true, false
	}
	if v, present, null := getString("username"); present {
		v = strings.ToLower(strings.TrimSpace(v))
		if null || !ValidUsername(v) {
			bad("invalid_username", "Usernames are 2–32 characters of a-z, 0-9, _ and . (no leading, trailing or double dots).")
			return
		}
		p.Username = &v
	}
	if v, present, null := getString("display_name"); present {
		clean, ok := CleanDisplayName(v)
		if null || !ok {
			bad("invalid_display_name", "Display names are 1–32 characters.")
			return
		}
		p.DisplayName = &clean
	}
	if v, present, null := getString("about_me"); present {
		if null {
			v = ""
		}
		clean, ok := CleanText(v, maxAboutMe)
		if !ok {
			bad("invalid_about_me", "About me is too long.")
			return
		}
		p.AboutMe = &clean
	}
	if v, present, null := getString("pronouns"); present {
		if null {
			v = ""
		}
		clean, ok := CleanText(strings.ReplaceAll(v, "\n", " "), maxPronouns)
		if !ok {
			bad("invalid_pronouns", "Pronouns are at most 40 characters.")
			return
		}
		p.Pronouns = &clean
	}
	if v, present, null := getString("status_text"); present {
		if null {
			v = ""
		}
		clean, ok := CleanText(strings.ReplaceAll(v, "\n", " "), maxStatus)
		if !ok {
			bad("invalid_status", "Status text is at most 128 characters.")
			return
		}
		p.StatusText = &clean
	}
	if v, present, null := getString("status_emoji"); present {
		if null {
			v = ""
		}
		clean, ok := CleanText(v, 64)
		if !ok || strings.ContainsAny(clean, " \n") {
			bad("invalid_status", "Status emoji is malformed.")
			return
		}
		p.StatusEmoji = &clean
	}
	if v, ok := raw["status_expires_at"]; ok {
		if string(v) == "null" {
			var nilP *int64
			p.StatusExpiresAt = &nilP
		} else {
			var n int64
			if err := json.Unmarshal(v, &n); err != nil || n < 0 {
				bad("invalid_status", "status_expires_at must be a timestamp or null.")
				return
			}
			np := &n
			p.StatusExpiresAt = &np
		}
	}
	if v, ok := raw["accent_color"]; ok {
		if string(v) == "null" {
			var nilP *int
			p.AccentColor = &nilP
		} else {
			var n int
			if err := json.Unmarshal(v, &n); err != nil || n < 0 || n > 0xFFFFFF {
				bad("invalid_color", "accent_color must be 0–16777215 or null.")
				return
			}
			np := &n
			p.AccentColor = &np
		}
	}
	if v, ok := raw["accent_color_2"]; ok {
		if string(v) == "null" {
			var nilP *int
			p.AccentColor2 = &nilP
		} else {
			var n int
			if err := json.Unmarshal(v, &n); err != nil || n < 0 || n > 0xFFFFFF {
				bad("invalid_color", "accent_color_2 must be 0–16777215 or null.")
				return
			}
			np := &n
			p.AccentColor2 = &np
		}
	}
	if v, present, null := getString("presence_pref"); present {
		if null || !OneOf(v, "online", "idle", "dnd", "invisible") {
			bad("invalid_presence", "presence_pref must be online, idle, dnd or invisible.")
			return
		}
		p.PresencePref = &v
	}
	if v, present, null := getString("dm_privacy"); present {
		if null || !OneOf(v, "everyone", "friends", "nobody") {
			bad("invalid_dm_privacy", "dm_privacy must be everyone, friends or nobody.")
			return
		}
		p.DMPrivacy = &v
	}
	if err := s.Store.UpdateProfile(r.Context(), u.ID, p); err != nil {
		WriteError(w, err)
		return
	}
	updated, err := s.Store.UserByID(r.Context(), u.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.UserUpdated(updated)
	WriteJSON(w, http.StatusOK, meView(updated))
}

func (s *Server) handleMeDelete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var req struct {
		AuthKey []byte `json:"auth_key"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	ok, err := auth.VerifyAuthKey(req.AuthKey, u.AuthHash)
	if err != nil || !ok || len(req.AuthKey) != 32 {
		WriteError(w, E(http.StatusUnauthorized, "invalid_credentials", "The password is wrong."))
		return
	}
	if err := s.Store.DeleteAccount(r.Context(), u.ID); err != nil {
		WriteError(w, err)
		return
	}
	if deleted, err := s.Store.UserByID(r.Context(), u.ID); err == nil {
		s.Bcast.UserUpdated(deleted)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	st, err := s.Store.GetSettings(r.Context(), auth.UserFrom(r.Context()).ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if st == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	WriteJSON(w, http.StatusOK, st)
}

func (s *Server) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var req struct {
		Blob    []byte `json:"blob"`
		Version int64  `json:"version"`
	}
	if err := ReadJSON(w, r, &req, maxSettings+4096); err != nil {
		WriteError(w, err)
		return
	}
	if len(req.Blob) == 0 || len(req.Blob) > maxSettings || req.Version < 0 {
		WriteError(w, E(http.StatusBadRequest, "invalid_settings", "Settings blob must be 1 byte to 1 MiB."))
		return
	}
	v, err := s.Store.PutSettings(r.Context(), u.ID, req.Blob, req.Version)
	if err != nil {
		if err == store.ErrConflict {
			WriteError(w, E(http.StatusConflict, "settings_conflict", "Settings were changed on another device; reload them first."))
			return
		}
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers([]ids.ID{u.ID}, "settings_update", map[string]any{"version": v, "session_id": auth.SessionFrom(r.Context()).ID})
	WriteJSON(w, http.StatusOK, map[string]any{"version": v})
}

func (s *Server) handleMyKeys(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, keyBundle(auth.UserFrom(r.Context())))
}

func (s *Server) handleUserSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		WriteJSON(w, http.StatusOK, []store.PublicUser{})
		return
	}
	users, err := s.Store.SearchUsers(r.Context(), q, 10)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := make([]store.PublicUser, 0, len(users))
	for _, u := range users {
		out = append(out, u.Public())
	}
	WriteJSON(w, http.StatusOK, out)
}

func (s *Server) handleUserGet(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUserID(r)
	if !ok {
		WriteError(w, ErrNotFound)
		return
	}
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, u.Public())
}

// ProfileExtras is filled by the relationship layer (mutual friends) and the
// server layer (mutual servers). Nil functions yield empty lists.
type ProfileExtras struct {
	MutualFriends func(r *http.Request, me, other ids.ID) ([]ids.ID, error)
	MutualServers func(r *http.Request, me, other ids.ID) ([]ids.ID, error)
}

func (s *Server) handleUserProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUserID(r)
	if !ok {
		WriteError(w, ErrNotFound)
		return
	}
	me := auth.UserFrom(r.Context())
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, err)
		return
	}
	friends, servers := []ids.ID{}, []ids.ID{}
	if s.Profile.MutualFriends != nil && id != me.ID {
		if friends, err = s.Profile.MutualFriends(r, me.ID, id); err != nil {
			WriteError(w, err)
			return
		}
	}
	if s.Profile.MutualServers != nil && id != me.ID {
		if servers, err = s.Profile.MutualServers(r, me.ID, id); err != nil {
			WriteError(w, err)
			return
		}
	}
	if friends == nil {
		friends = []ids.ID{}
	}
	if servers == nil {
		servers = []ids.ID{}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"user": u.Public(), "mutual_friends": friends, "mutual_servers": servers})
}

func (s *Server) handlePublicKey(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUserID(r)
	if !ok {
		WriteError(w, ErrNotFound)
		return
	}
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"user_id": u.ID, "public_key": u.PublicKey})
}
