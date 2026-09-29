package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/ratelimit"
)

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer (hijack, flush).
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// RequestID ensures every request carries an X-Request-Id.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" || len(id) > 64 {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r)
	})
}

// Logging writes one structured line per request.
func Logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r)
			if sw.status == 0 {
				sw.status = http.StatusOK
			}
			lvl := slog.LevelDebug
			if sw.status >= 500 {
				lvl = slog.LevelError
			}
			log.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", sw.status, "bytes", sw.bytes, "ms", time.Since(start).Milliseconds(), "req", w.Header().Get("X-Request-Id"))
		})
	}
}

// Recover turns panics into 500s.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				if p == http.ErrAbortHandler {
					panic(p)
				}
				slog.Error("panic", "err", fmt.Sprint(p), "path", r.URL.Path, "stack", string(debug.Stack()))
				WriteError(w, E(http.StatusInternalServerError, "internal", "Something went wrong on the server."))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders sets the headers every response should carry.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()")
		// Browsers only honour this over HTTPS, which is how Nexa is
		// reached; it stops a first visit being quietly downgraded.
		h.Set("Strict-Transport-Security", "max-age=31536000")
		// A page this one opens cannot reach back into it.
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		// API answers carry accounts, keys and sessions: nothing in between
		// keeps a copy. A handler that means to be cached says so itself.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimit rejects requests over the limit for keyFn(r).
func RateLimit(l *ratelimit.Limiter, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, retry := l.Allow(keyFn(r))
			if !ok {
				secs := int(retry.Seconds() + 0.999)
				if secs < 1 {
					secs = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(secs))
				WriteError(w, ErrRateLimited)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Chain applies middlewares in the given order (first is outermost).
func Chain(h http.Handler, mws ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}
