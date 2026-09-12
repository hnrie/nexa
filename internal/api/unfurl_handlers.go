package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/unfurl"
)

func (s *Server) unfurlRoutes(mux *http.ServeMux) {
	if s.limUnfurl == nil {
		s.limUnfurl = ratelimit.New(ratelimit.Every(30, time.Minute), 30, 10*time.Minute)
	}
	mux.Handle("GET /api/v1/unfurl", s.authed(s.handleUnfurl))
}

// handleUnfurl fetches a link preview on behalf of the sender. Anything that
// cannot be embedded (including blocked addresses) is a 204 so the client
// simply shows no preview.
func (s *Server) handleUnfurl(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	if ok, retry := s.limUnfurl.Allow("unfurl:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" || len(raw) > 2048 {
		WriteError(w, E(http.StatusBadRequest, "bad_url", "url is required and must be under 2048 characters."))
		return
	}
	if s.Unfurl == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	res, err := s.Unfurl.Lookup(r.Context(), raw)
	if err != nil {
		if errors.Is(err, unfurl.ErrUnsupported) || errors.Is(err, unfurl.ErrBlocked) || errors.Is(err, unfurl.ErrTooLarge) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		WriteError(w, E(http.StatusBadGateway, "fetch_failed", "That link could not be fetched."))
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	WriteJSON(w, http.StatusOK, res)
}
