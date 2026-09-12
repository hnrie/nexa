// Package api serves the REST API and wires the middleware stack.
package api

import (
	"log/slog"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/store"
)

// Broadcaster is how handlers push realtime events; the gateway implements it.
type Broadcaster interface {
	UserUpdated(u *store.User)
	EmitUsers(userIDs []ids.ID, event string, data any)
	EmitChannel(channelID ids.ID, event string, data any)
	KeysMaybeNeeded(convID ids.ID)
}

// NoopBroadcaster drops everything (tests, or before the gateway is wired).
type NoopBroadcaster struct{}

func (NoopBroadcaster) UserUpdated(*store.User)         {}
func (NoopBroadcaster) EmitUsers([]ids.ID, string, any) {}
func (NoopBroadcaster) EmitChannel(ids.ID, string, any) {}
func (NoopBroadcaster) KeysMaybeNeeded(ids.ID)          {}

// Server holds the dependencies of every handler.
type Server struct {
	Cfg     config.Config
	Store   *store.Store
	Log     *slog.Logger
	Bcast   Broadcaster
	Auth    *auth.Authenticator
	Version string
	Extra   []func(mux *http.ServeMux) // routes registered by other packages (gateway, media, static)

	limGeneric *ratelimit.Limiter
	limAuthIP  *ratelimit.Limiter
	limAuthUsr *ratelimit.Limiter
	limReg     *ratelimit.Limiter
}

// NewServer builds a Server with rate limiters and the authenticator.
func NewServer(cfg config.Config, st *store.Store, log *slog.Logger, bc Broadcaster) *Server {
	if bc == nil {
		bc = NoopBroadcaster{}
	}
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		Cfg: cfg, Store: st, Log: log, Bcast: bc, Version: "dev",
		Auth:       &auth.Authenticator{Store: st, TTL: cfg.SessionTTL},
		limGeneric: ratelimit.New(ratelimit.Every(60, time.Minute), 60, 10*time.Minute),
		limAuthIP:  ratelimit.New(ratelimit.Every(5, time.Minute), 5, 10*time.Minute),
		limAuthUsr: ratelimit.New(ratelimit.Every(5, time.Minute), 5, 10*time.Minute),
		limReg:     ratelimit.New(ratelimit.Every(3, time.Hour), 3, 2*time.Hour),
	}
}

// Handler returns the fully assembled HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.Version})
	})
	s.routes(mux)
	for _, extra := range s.Extra {
		extra(mux)
	}
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, E(http.StatusNotFound, "not_found", "No such API route."))
	})
	return Chain(mux, RequestID, Recover, SecurityHeaders, Logging(s.Log))
}

// routes registers the versioned API. Domain files add their groups here.
func (s *Server) routes(mux *http.ServeMux) {
	for _, reg := range s.routeGroups() {
		reg(mux)
	}
}

// authed wraps h with the bearer-token middleware and the generic per-user limiter.
func (s *Server) authed(h http.HandlerFunc) http.Handler {
	return s.Auth.Middleware(RateLimit(s.limGeneric, func(r *http.Request) string {
		if u := auth.UserFrom(r.Context()); u != nil {
			return "u:" + u.ID.String()
		}
		return "ip:" + auth.ClientIP(r)
	})(h))
}

// ipLimited wraps a public handler with a per-IP limiter.
func ipLimited(l *ratelimit.Limiter, h http.HandlerFunc) http.Handler {
	return RateLimit(l, func(r *http.Request) string { return auth.ClientIP(r) })(h)
}
