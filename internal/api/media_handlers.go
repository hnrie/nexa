package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

func (s *Server) mediaRoutes(mux *http.ServeMux) {
	// Deliberately not metered per address. One page of a large member list is
	// hundreds of these, and behind a NAT a whole building shares one bucket,
	// so a limiter here would refuse ordinary page loads long before it
	// refused anything else. What it would have protected — the rescale of an
	// image at a size nobody has asked for yet — is already bounded by
	// media.variantWork, which decodes two at a time whatever arrives.
	mux.HandleFunc("GET /media/{kind}/{id}", s.handleMediaPublic)
	// Replacing a picture leaves the old one on disk for a day, so pictures
	// are metered like any other upload.
	mux.Handle("PUT /api/v1/users/@me/avatar", s.userLimited(s.limUpload, s.handleAvatarPut("avatar")))
	mux.Handle("DELETE /api/v1/users/@me/avatar", s.authed(s.handleAvatarDelete("avatar")))
	mux.Handle("PUT /api/v1/users/@me/banner", s.userLimited(s.limUpload, s.handleAvatarPut("banner")))
	mux.Handle("DELETE /api/v1/users/@me/banner", s.authed(s.handleAvatarDelete("banner")))
}

// releaseBlob gives back the reference an upload took when whatever was meant
// to point at it did not happen.
//
// It deliberately does not use the request's context. The failure being
// compensated for is often the request being cancelled — the person closed the
// tab — and releasing on that same context fails too, silently, leaving bytes
// on disk with a reference count of one that nothing points at. The GC only
// collects blobs at zero, so those are there forever, and uploading the same
// image again finds the orphan by hash and raises it to two.
func (s *Server) releaseBlob(ctx context.Context, id ids.ID) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.Store.AddBlobRef(ctx, id, -1); err != nil && !errors.Is(err, store.ErrNotFound) {
		s.Log.Warn("release blob", "blob", id.String(), "err", err)
	}
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
			// nothing points at the image now, so its reference goes back and
			// the collector can take it; every other upload path does this
			s.releaseBlob(r.Context(), b.ID)
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
