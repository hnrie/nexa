package api

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// Moving browsers from an address Nexa moved away from (MOVED_FROM) to its
// own (PUBLIC_URL) without signing anyone out.
//
// A browser keeps a sign-in per address, so a page at the old one cannot just
// give it to the new: the two never see each other's storage. The page at the
// old address seals what it holds (the session, and the account's keys or the
// passcode-locked copy of them) with a key it makes up, leaves the sealed copy
// here, and moves on to the new address with that key and the copy's name in
// the part of the link after the #, which never reaches any server. The page
// at the new address takes the copy, once, and opens it (web/src/lib/move.ts).
//
// So this server only ever holds the sealed copy and never its key, and lets
// go of it the moment it is taken or a minute after it was left. A copy can
// only be left by a page at a moved address, and only be taken by a page at
// one of Nexa's own that was opened from a moved one: a link someone is sent
// cannot sign them in to somebody else's account.
//
// The copies live in this process's memory. chatd runs as one process (see
// config.RedisURL), and a copy lost to a restart only means signing in again.

const (
	handoffTTL = time.Minute
	// a session, a key pair or a lock record, and the device's own
	// preferences: well under this
	handoffMaxSealed = 512 << 10
	handoffMaxKept   = 2000
)

var handoffSealed = regexp.MustCompile(`^[A-Za-z0-9+/_-]+=*$`)

type handoffStore struct {
	mu   sync.Mutex
	kept map[string]handoffCopy
}

type handoffCopy struct {
	sealed  string
	expires time.Time
}

func (s *Server) handoffRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/handoffs", s.authed(s.handleHandoffLeave))
	mux.Handle("POST /api/v1/handoffs/take", ipLimited(s.limAuthIP, s.handleHandoffTake))
}

// handleHandoffLeave keeps a sealed copy of a sign-in for a minute, from a page
// at an address Nexa moved from, and answers with the name to take it by.
func (s *Server) handleHandoffLeave(w http.ResponseWriter, r *http.Request) {
	if _, kind := s.originAddress(r.Header.Get("Origin")); kind != ourMoved {
		WriteError(w, E(http.StatusForbidden, "handoff_origin", "Only a page at an old address can move its sign-in."))
		return
	}
	var req struct {
		Sealed string `json:"sealed"`
	}
	if err := ReadJSON(w, r, &req, handoffMaxSealed+1024); err != nil {
		WriteError(w, err)
		return
	}
	if req.Sealed == "" || len(req.Sealed) > handoffMaxSealed || !handoffSealed.MatchString(req.Sealed) {
		WriteError(w, E(http.StatusBadRequest, "bad_handoff", "That is not a sealed sign-in."))
		return
	}
	raw := make([]byte, 18)
	_, _ = rand.Read(raw)
	id := base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now()
	h := &s.handoffs
	h.mu.Lock()
	if h.kept == nil {
		h.kept = map[string]handoffCopy{}
	}
	for k, c := range h.kept {
		if now.After(c.expires) {
			delete(h.kept, k)
		}
	}
	if len(h.kept) >= handoffMaxKept {
		h.mu.Unlock()
		w.Header().Set("Retry-After", "30")
		WriteError(w, E(http.StatusServiceUnavailable, "handoff_busy", "Too many people are moving at once. Try again in a moment."))
		return
	}
	h.kept[id] = handoffCopy{sealed: req.Sealed, expires: now.Add(handoffTTL)}
	h.mu.Unlock()
	WriteJSON(w, http.StatusCreated, map[string]any{"id": id, "expires_in": int(handoffTTL.Seconds())})
}

// handleHandoffTake gives a sealed sign-in back, once, to a page at one of
// Nexa's own addresses that was opened from a moved one.
func (s *Server) handleHandoffTake(w http.ResponseWriter, r *http.Request) {
	if _, kind := s.originAddress(r.Header.Get("Origin")); kind != ourPublic && kind != ourAlt {
		WriteError(w, E(http.StatusForbidden, "handoff_origin", "Only a page at Nexa's own address can take a sign-in."))
		return
	}
	var req struct {
		ID string `json:"id"`
		// the page the browser came from (document.referrer), which a link
		// sent from anywhere else does not have
		From string `json:"from"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if _, kind := s.originAddress(req.From); kind != ourMoved {
		WriteError(w, E(http.StatusForbidden, "handoff_from", "A sign-in can only be moved straight from the old address."))
		return
	}
	h := &s.handoffs
	h.mu.Lock()
	c, ok := h.kept[req.ID]
	delete(h.kept, req.ID)
	h.mu.Unlock()
	if !ok || time.Now().After(c.expires) {
		WriteError(w, E(http.StatusNotFound, "handoff_gone", "That sign-in has already been taken, or waited too long."))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	WriteJSON(w, http.StatusOK, map[string]any{"sealed": c.sealed})
}
