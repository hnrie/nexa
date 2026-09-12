package api

import (
	"net/http"
	"strconv"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/store"
)

const (
	maxCrashMessage   = 500
	maxCrashStack     = 4000
	maxCrashComponent = 2000
	maxCrashPath      = 200
)

func (s *Server) crashRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/client-errors", s.authed(s.handleCrashReport))
	mux.Handle("GET /api/v1/admin/errors", s.admin(s.handleCrashList))
	mux.Handle("DELETE /api/v1/admin/errors", s.admin(s.handleCrashClear))
}

// clip trims a field to a length the log can hold, without splitting a rune.
func clip(v string, n int) string {
	v = strings.TrimSpace(v)
	if len(v) <= n {
		return v
	}
	cut := v[:n]
	for len(cut) > 0 && !utf8Start(cut[len(cut)-1]) {
		cut = cut[:len(cut)-1]
	}
	return cut
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }

func (s *Server) handleCrashReport(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		Kind      string `json:"kind"`
		Message   string `json:"message"`
		Stack     string `json:"stack"`
		Component string `json:"component"`
		Path      string `json:"path"`
		Version   string `json:"version"`
	}
	if err := ReadJSON(w, r, &req, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	msg := clip(req.Message, maxCrashMessage)
	if msg == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	kind := req.Kind
	switch kind {
	case "render", "promise", "error":
	default:
		kind = "error"
	}
	ua := r.UserAgent()
	if len(ua) > maxUserAgent {
		ua = ua[:maxUserAgent]
	}
	e := &store.ClientError{
		UserID:    &me.ID,
		Kind:      kind,
		Message:   msg,
		Stack:     clip(req.Stack, maxCrashStack),
		Component: clip(req.Component, maxCrashComponent),
		Path:      clip(req.Path, maxCrashPath),
		UserAgent: ua,
		Version:   clip(req.Version, 64),
	}
	if err := s.Store.RecordClientError(r.Context(), e); err != nil {
		WriteError(w, err)
		return
	}
	s.Log.Warn("client crash", "user", me.ID.String(), "kind", kind, "message", msg, "path", e.Path, "version", e.Version)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCrashList(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := s.Store.RecentClientErrors(r.Context(), limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleCrashClear(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.ClearClientErrors(r.Context()); err != nil {
		WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
