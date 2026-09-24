// Package api serves the REST API and wires the middleware stack.
package api

import (
	"context"
	"crypto/rand"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/realtime"
	"evilion.xyz/chat/internal/rpcapps"
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
	// PresenceChanged re-sends a user's presence to whoever should now see it.
	PresenceChanged(uid ids.ID)
	Typing(ctx context.Context, uid, channelID ids.ID)
	// CloseSession and CloseUserSessions disconnect the sockets of sessions
	// that were just deleted; except 0 closes all of a user's.
	CloseSession(sessionID ids.ID)
	CloseUserSessions(uid, except ids.ID)
	// DisconnectUser closes a user's sockets with a close code of its own,
	// once the frames already queued for them (the reason why) are out.
	DisconnectUser(uid ids.ID, code int, reason string)
}

// NoopBroadcaster drops everything (tests, or before the gateway is wired).
type NoopBroadcaster struct{}

func (NoopBroadcaster) UserUpdated(*store.User)                {}
func (NoopBroadcaster) EmitUsers([]ids.ID, string, any)        {}
func (NoopBroadcaster) EmitChannel(ids.ID, string, any)        {}
func (NoopBroadcaster) KeysMaybeNeeded(ids.ID)                 {}
func (NoopBroadcaster) PresenceChanged(ids.ID)                 {}
func (NoopBroadcaster) Typing(context.Context, ids.ID, ids.ID) {}
func (NoopBroadcaster) CloseSession(ids.ID)                    {}
func (NoopBroadcaster) CloseUserSessions(ids.ID, ids.ID)       {}
func (NoopBroadcaster) DisconnectUser(ids.ID, int, string)     {}

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
	limProxy   *ratelimit.Limiter
	limRefresh *ratelimit.Limiter
	limVoice   *ratelimit.Limiter
	limGuest   *ratelimit.Limiter
	limRotate  *ratelimit.Limiter

	// Unfurl produces link previews for senders (nil disables the route body).
	Unfurl *unfurl.Service
	// Apps looks up Discord Rich Presence applications for activities.
	Apps *rpcapps.Cache
	// activityHub resolves activity previews the way the gateway shows them.
	activityHub *gateway.Hub
	// Voice tracks who is in which voice channel (set by WireVoice).
	Voice *voice.Registry
	// hub is the gateway, for whether a guest is still connected (set by WireVoice).
	hub *gateway.Hub
	// guestAway notes when each guest was first seen with no connection.
	guestAway guestAwayTimes
	// Realtime sends calls through Cloudflare Realtime SFU when configured, and
	// Meter keeps them inside its free allowance (both nil otherwise).
	Realtime *realtime.Client
	Meter    *realtime.Meter
	// turnCreds holds each account's minted relay credential until it is old
	// enough to be worth minting another.
	turnMu    sync.Mutex
	turnCreds map[ids.ID]turnCred
	// serverCounts holds the member and online counts the public invite pages
	// show, so replaying a shared code cannot drive the work behind them.
	countsMu     sync.Mutex
	serverCounts map[ids.ID]serverCounts

	// system holds the Nexa account once it has been looked up or made.
	system systemAccount

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
		// The media proxy fetches from somewhere else on the caller's behalf,
		// so an unmetered one is both a way to exhaust this instance's
		// bandwidth and a way to aim this instance at someone else's.
		limProxy: ratelimit.New(ratelimit.Every(120, time.Minute), 60, 10*time.Minute),
		// re-signing old media links, per account: a conversation scrolled
		// back through asks once per screenful, up to a hundred links a time
		limRefresh: ratelimit.New(ratelimit.Every(60, time.Minute), 30, 10*time.Minute),
		// a call renegotiates for every camera, share and person joining
		limVoice: ratelimit.New(ratelimit.Every(240, time.Minute), 120, 10*time.Minute),
		// joining a call as a guest, per address: a household or a meeting room, not a crowd of bots
		limGuest: ratelimit.New(ratelimit.Every(30, time.Hour), 10, 2*time.Hour),
		// New key epochs, per conversation. Every one of them costs every
		// online key-holder a re-wrap for every entitled member, so the rate
		// is held to well above real membership churn and far below what one
		// account posting in a loop would manage.
		limRotate: ratelimit.New(ratelimit.Every(60, time.Hour), 30, 2*time.Hour),
	}
}

// limiters is every rate limiter this server keeps.
func (s *Server) limiters() []*ratelimit.Limiter {
	return []*ratelimit.Limiter{s.limGeneric, s.limAuthIP, s.limAuthUsr, s.limReg, s.limMsg, s.limUpload, s.limUnfurl, s.limProxy, s.limRefresh, s.limVoice, s.limGuest, s.limRotate}
}

// StartLimiters runs the rate limiters' idle-key sweepers until ctx is done.
// Without them every IP and every username ever tried stays in memory for the
// life of the process.
func (s *Server) StartLimiters(ctx context.Context) {
	for _, l := range s.limiters() {
		l.Start(ctx)
	}
}

// ShareLimiters makes every rate limit count across chatd processes rather
// than once per process, which is what an instance behind more than one of
// them needs: otherwise two processes let twice as much through.
func (s *Server) ShareLimiters(shared ratelimit.Shared) {
	for _, l := range s.limiters() {
		l.Share(shared)
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

// authed wraps h with the bearer-token middleware, the generic per-user
// limiter, and the account's mute or ban (see moderation_gate.go).
func (s *Server) authed(h http.HandlerFunc) http.Handler {
	return s.Auth.Middleware(RateLimit(s.limGeneric, func(r *http.Request) string {
		if u := auth.UserFrom(r.Context()); u != nil {
			return "u:" + u.ID.String()
		}
		return "ip:" + auth.ClientIP(r)
	})(s.restricted(h)))
}

// callAuthed is authed for the routes a call runs on, which guests use too.
func (s *Server) callAuthed(h http.HandlerFunc) http.Handler {
	return s.Auth.CallMiddleware(RateLimit(s.limGeneric, func(r *http.Request) string {
		if u := auth.UserFrom(r.Context()); u != nil {
			return "u:" + u.ID.String()
		}
		return "ip:" + auth.ClientIP(r)
	})(s.restricted(h)))
}

// guestAuthed lets in guests only.
func (s *Server) guestAuthed(h http.HandlerFunc) http.Handler {
	return s.Auth.GuestMiddleware(RateLimit(s.limGeneric, func(r *http.Request) string {
		return "u:" + auth.UserFrom(r.Context()).ID.String()
	})(h))
}

// ipLimited wraps a public handler with a per-IP limiter.
func ipLimited(l *ratelimit.Limiter, h http.HandlerFunc) http.Handler {
	return RateLimit(l, func(r *http.Request) string { return auth.ClientIP(r) })(h)
}

// userLimited counts against the signed-in account, for routes where guessing
// is the risk rather than volume: typing a subchat's password, say.
func (s *Server) userLimited(l *ratelimit.Limiter, h http.HandlerFunc) http.Handler {
	return s.authed(RateLimit(l, func(r *http.Request) string {
		if u := auth.UserFrom(r.Context()); u != nil {
			return u.ID.String()
		}
		return auth.ClientIP(r)
	})(h).ServeHTTP)
}
