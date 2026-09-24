package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxSession
	ctxGuest
)

// touchInterval bounds how often last_seen_at is written.
const touchInterval = 5 * time.Minute

// Authenticator resolves bearer tokens to users.
type Authenticator struct {
	Store *store.Store
	TTL   time.Duration
}

// ErrUnavailable is a token that could not be checked: the database failed,
// which says nothing about the token.
var ErrUnavailable = errors.New("auth: the token could not be checked")

// Resolve returns the user and session for a bearer token, or nil when the
// token is missing, unknown, expired, or the account cannot log in — or when
// it could not be checked; Check tells those apart.
func (a *Authenticator) Resolve(ctx context.Context, token string) (*store.User, *store.Session) {
	u, se, _ := a.Check(ctx, token)
	return u, se
}

// Check is Resolve that also says when the token could not be checked at
// all (ErrUnavailable). A client told its session is gone throws away its
// keys and signs out, so a database that is down for a moment must not look
// like every session ending.
func (a *Authenticator) Check(ctx context.Context, token string) (*store.User, *store.Session, error) {
	if token == "" || len(token) > 256 {
		return nil, nil, nil
	}
	se, err := a.Store.SessionByTokenHash(ctx, HashToken(token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, ErrUnavailable
	}
	now := time.Now().UnixMilli()
	if a.TTL > 0 && se.LastSeenAt+a.TTL.Milliseconds() < now {
		_ = a.Store.DeleteSession(ctx, se.ID)
		return nil, nil, nil
	}
	u, err := a.Store.UserByID(ctx, se.UserID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, ErrUnavailable
	}
	if u.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return nil, nil, nil
	}
	if now-se.LastSeenAt > touchInterval.Milliseconds() {
		_ = a.Store.TouchSession(ctx, se.ID, now)
		se.LastSeenAt = now
	}
	return u, se, nil
}

// ResolveGuest returns the stand-in user and session for a guest's bearer
// token, and the guest, or nils when the token is not a guest's or the guest's
// time is up. Resolve never finds a guest: guests have no account, so every
// route that asks for one turns them away unless it asks for guests by name.
func (a *Authenticator) ResolveGuest(ctx context.Context, token string) (*store.User, *store.Session, *store.Guest) {
	if token == "" || len(token) > 256 {
		return nil, nil, nil
	}
	g, err := a.Store.GuestByTokenHash(ctx, HashToken(token))
	if err != nil || g.ExpiresAt <= time.Now().UnixMilli() {
		return nil, nil, nil
	}
	return g.User(), g.Session(), g
}

// GuestAlive reports whether a guest is still let in. A failed lookup other
// than not-found counts as alive, as sessions do.
func (a *Authenticator) GuestAlive(ctx context.Context, id ids.ID) bool {
	g, err := a.Store.GuestByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return false
	}
	return err != nil || g.ExpiresAt > time.Now().UnixMilli()
}

// CallMiddleware lets in accounts and guests alike, for the routes a call
// runs on and nothing else.
func (a *Authenticator) CallMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := BearerToken(r)
		u, se, err := a.Check(r.Context(), token)
		if err != nil {
			unavailable(w)
			return
		}
		if u != nil {
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u, se)))
			return
		}
		if u, se, g := a.ResolveGuest(r.Context(), token); u != nil {
			next.ServeHTTP(w, r.WithContext(WithGuest(r.Context(), u, se, g)))
			return
		}
		unauthorized(w)
	})
}

// GuestMiddleware lets in guests only.
func (a *Authenticator) GuestMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, se, g := a.ResolveGuest(r.Context(), BearerToken(r))
		if u == nil {
			unauthorized(w)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithGuest(r.Context(), u, se, g)))
	})
}

func unavailable(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", "2")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "unavailable", "message": "The server could not check your session just now. Try again in a moment."}})
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "unauthorized", "message": "You need to log in."}})
}

// Middleware rejects requests without a valid bearer token.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := BearerToken(r)
		u, se, err := a.Check(r.Context(), token)
		if err != nil {
			unavailable(w)
			return
		}
		if u == nil {
			unauthorized(w)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u, se)))
	})
}

// BearerToken extracts the token from the Authorization header.
func BearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// WithUser attaches a user and session to ctx.
func WithUser(ctx context.Context, u *store.User, se *store.Session) context.Context {
	ctx = context.WithValue(ctx, ctxUser, u)
	return context.WithValue(ctx, ctxSession, se)
}

// WithGuest attaches a guest, with its stand-in user and session, to ctx.
func WithGuest(ctx context.Context, u *store.User, se *store.Session, g *store.Guest) context.Context {
	return context.WithValue(WithUser(ctx, u, se), ctxGuest, g)
}

// GuestFrom returns the guest making the request, or nil for an account.
func GuestFrom(ctx context.Context) *store.Guest {
	g, _ := ctx.Value(ctxGuest).(*store.Guest)
	return g
}

// UserFrom returns the authenticated user, or nil.
func UserFrom(ctx context.Context) *store.User {
	u, _ := ctx.Value(ctxUser).(*store.User)
	return u
}

// SessionFrom returns the authenticated session, or nil.
func SessionFrom(ctx context.Context) *store.Session {
	s, _ := ctx.Value(ctxSession).(*store.Session)
	return s
}

// ClientIP returns the visitor address. Cloudflare's tunnel connects from
// loopback and sets CF-Connecting-IP; those headers are only trusted then.
// RateKey is the client's address as rate limits count it: an IPv4 address
// as it is, an IPv6 one by its /64. A single home or phone is handed a whole
// /64 and may pick any address in it, so counting whole addresses would give
// each client billions of fresh allowances.
func RateKey(r *http.Request) string {
	ip := ClientIP(r)
	if a, err := netip.ParseAddr(ip); err == nil && a.Is6() && !a.Is4In6() {
		if p, err := a.Prefix(64); err == nil {
			return p.String()
		}
	}
	return ip
}

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
			return v
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			first, _, _ := strings.Cut(v, ",")
			if first = strings.TrimSpace(first); first != "" {
				return first
			}
		}
	}
	return host
}
