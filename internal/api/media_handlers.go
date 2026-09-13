package api

import (
	"net/http"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
)

func (s *Server) mediaRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /media/{kind}/{id}", s.handleMediaPublic)
	mux.Handle("PUT /api/v1/users/@me/avatar", s.authed(s.handleAvatarPut("avatar")))
	mux.Handle("DELETE /api/v1/users/@me/avatar", s.authed(s.handleAvatarDelete("avatar")))
	mux.Handle("PUT /api/v1/users/@me/banner", s.authed(s.handleAvatarPut("banner")))
	mux.Handle("DELETE /api/v1/users/@me/banner", s.authed(s.handleAvatarDelete("banner")))
}

// limitsFor returns the upload bounds for a public image kind.
func (s *Server) limitsFor(kind string) media.Limits {
	switch kind {
	case "banner":
		return media.Limits{MaxBytes: s.Cfg.MaxAvatarBytes, MaxW: 8192, MaxH: 4096}
	case "emoji":
		return media.Limits{MaxBytes: s.Cfg.MaxEmojiBytes, MaxW: 512, MaxH: 512}
	case "sticker":
		return media.Limits{MaxBytes: s.Cfg.MaxStickerBytes, MaxW: 1024, MaxH: 1024}
	default: // avatar, icon
		return media.Limits{MaxBytes: s.Cfg.MaxAvatarBytes, MaxW: 4096, MaxH: 4096}
	}
}

func (s *Server) handleMediaPublic(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	raw := r.PathValue("id")
	if i := strings.IndexByte(raw, '.'); i > 0 {
		raw = raw[:i]
	}
	id, err := ids.Parse(raw)
	if err != nil || s.Media == nil || !media.PublicKinds[kind] {
		http.NotFound(w, r)
		return
	}
	// ?size= asks for a copy no larger than that, so a 32-pixel avatar is not a 4096-pixel one
	if !s.Media.ServePublicSized(w, r, kind, id, media.VariantSize(r.URL.Query().Get("size"))) {
		http.NotFound(w, r)
	}
}

// handleAvatarPut stores an uploaded image as the user's avatar or banner.
func (s *Server) handleAvatarPut(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.UserFrom(r.Context())
		lim := s.limitsFor(kind)
		r.Body = http.MaxBytesReader(w, r.Body, lim.MaxBytes+1)
		b, err := s.Media.PutPublic(r.Context(), kind, r.Body, lim, u.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		bid := b.ID
		if err := s.Store.SwapImage(r.Context(), "users", kind+"_id", u.ID, &bid); err != nil {
			WriteError(w, err)
			return
		}
		updated, err := s.Store.UserByID(r.Context(), u.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.UserUpdated(updated)
		WriteJSON(w, http.StatusOK, map[string]any{kind + "_id": b.ID, "user": s.meView(r.Context(), updated)})
	}
}

func (s *Server) handleAvatarDelete(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.UserFrom(r.Context())
		// the old image is read and released in one write, so a double tap releases it once
		if err := s.Store.SwapImage(r.Context(), "users", kind+"_id", u.ID, nil); err != nil {
			WriteError(w, err)
			return
		}
		if updated, err := s.Store.UserByID(r.Context(), u.ID); err == nil {
			s.Bcast.UserUpdated(updated)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
