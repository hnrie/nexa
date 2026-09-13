// Package api serves the REST API and wires the middleware stack.
package api

import (
	"context"
	"crypto/rand"
	"log/slog"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
	"evilion.xyz/chat/internal/voice"
)

// Broadcaster is how handlers push realtime events; the gateway implements it.
type Broadcaster interface {
	UserUpdated(u *store.User)
	EmitUsers(userIDs []ids.ID, event string, data any)
	EmitChannel(channelID ids.ID, event string, data any)
	KeysMaybeNeeded(convID ids.ID)
	Typing(ctx context.Context, uid, channelID ids.ID)
	// CloseSession and CloseUserSessions disconnect the sockets of sessions
	// that were just deleted; except 0 closes all of a user's.
	CloseSession(sessionID ids.ID)
	CloseUserSessions(uid, except ids.ID)
}

// NoopBroadcaster drops everything (tests, or before the gateway is wired).
type NoopBroadcaster struct{}

func (NoopBroadcaster) UserUpdated(*store.User)                {}
func (NoopBroadcaster) EmitUsers([]ids.ID, string, any)        {}
func (NoopBroadcaster) EmitChannel(ids.ID, string, any)        {}
func (NoopBroadcaster) KeysMaybeNeeded(ids.ID)                 {}
func (NoopBroadcaster) Typing(context.Context, ids.ID, ids.ID) {}
func (NoopBroadcaster) CloseSession(ids.ID)                    {}
func (NoopBroadcaster) CloseUserSessions(ids.ID, ids.ID)       {}

// Server holds the dependencies of every handler.
type Server struct {
	Cfg     config.Config
	Store   *store.Store
	Log     *slog.Logger
	Bcast   Broadcaster
	Auth    *auth.Authenticator
	Version string
	Extra   []func(mux *http.ServeMux) // routes registered by other packages (gateway, media, static)
	Secret  []byte                     // server secret for fake KDF salts (never leaves the box)
	Media   *media.Store
	Profile ProfileExtras
	// InviteCheck reports whether an invite code allows registration (set by the server layer).
	InviteCheck func(ctx context.Context, code string) bool

	limGeneric *ratelimit.Limiter
	limAuthIP  *ratelimit.Limiter
	limAuthUsr *ratelimit.Limiter
	limReg     *ratelimit.Limiter
	limMsg     *ratelimit.Limiter
	limUpload  *ratelimit.Limiter
	limUnfurl  *ratelimit.Limiter

	// Unfurl produces link previews for senders (nil disables the route body).
	Unfurl *unfurl.Service
	// Voice tracks who is in which voice channel (set by WireVoice).
	Voice *voice.Registry

	// ChannelAccess decides server-channel access (Phase 2). DM access is built in.
	ChannelAccess func(ctx context.Context, u *store.User, ch *store.Channel, need string) (bool, error)
	// ConvForChannel maps a server channel to the conversation that holds its keys (Phase 2).
	ConvForChannel func(ctx context.Context, ch *store.Channel) (ids.ID, error)
	// ServerChannelPatch handles PATCH for server channels (Phase 2).
	ServerChannelPatch func(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User)
	// CanRotate restricts who may create key epochs for a conversation (Phase 2).
	CanRotate func(ctx context.Context, u *store.User, conv ids.ID) (bool, error)
}

// NewServer builds a Server with rate limiters and the authenticator.
func NewServer(cfg config.Config, st *store.Store, log *slog.Logger, bc Broadcaster) *Server {
	if bc == nil {
		bc = NoopBroadcaster{}
	}
	if log == nil {
		log = slog.Default()
	}
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	return &Server{
		Cfg: cfg, Store: st, Log: log, Bcast: bc, Version: "dev", Secret: secret,
		Auth:       &auth.Authenticator{Store: st, TTL: cfg.SessionTTL},
		limGeneric: ratelimit.New(ratelimit.Every(600, time.Minute), 300, 10*time.Minute),
		limAuthIP:  ratelimit.New(ratelimit.Every(20, time.Minute), 20, 10*time.Minute),
		limAuthUsr: ratelimit.New(ratelimit.Every(5, time.Minute), 5, 10*time.Minute),
		limReg:     ratelimit.New(ratelimit.Every(10, time.Hour), 10, 2*time.Hour),
		limMsg:     ratelimit.New(ratelimit.Every(5, 5*time.Second), 5, 5*time.Minute),
		limUpload:  ratelimit.New(ratelimit.Every(60, time.Minute), 60, time.Hour),
		limUnfurl:  ratelimit.New(ratelimit.Every(30, time.Minute), 30, 10*time.Minute),
	}
}

// StartLimiters runs the rate limiters' idle-key sweepers until ctx is done.
// Without them every IP and every username ever tried stays in memory for the
// life of the process.
func (s *Server) StartLimiters(ctx context.Context) {
	for _, l := range []*ratelimit.Limiter{s.limGeneric, s.limAuthIP, s.limAuthUsr, s.limReg, s.limMsg, s.limUpload, s.limUnfurl} {
		l.Start(ctx)
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
