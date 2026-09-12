package auth

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"evilion.xyz/chat/internal/store"
)

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxSession
)

// touchInterval bounds how often last_seen_at is written.
const touchInterval = 5 * time.Minute

// Authenticator resolves bearer tokens to users.
type Authenticator struct {
	Store *store.Store
	TTL   time.Duration
}

// Resolve returns the user and session for a bearer token, or nil when the
// token is missing, unknown, expired, or the account cannot log in.
func (a *Authenticator) Resolve(ctx context.Context, token string) (*store.User, *store.Session) {
	if token == "" || len(token) > 256 {
		return nil, nil
	}
	se, err := a.Store.SessionByTokenHash(ctx, HashToken(token))
	if err != nil {
		return nil, nil
	}
	now := time.Now().UnixMilli()
	if a.TTL > 0 && se.LastSeenAt+a.TTL.Milliseconds() < now {
		_ = a.Store.DeleteSession(ctx, se.ID)
		return nil, nil
	}
	u, err := a.Store.UserByID(ctx, se.UserID)
	if err != nil || u.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
		return nil, nil
	}
	if now-se.LastSeenAt > touchInterval.Milliseconds() {
		_ = a.Store.TouchSession(ctx, se.ID, now)
		se.LastSeenAt = now
	}
	return u, se
}

// Middleware rejects requests without a valid bearer token.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := BearerToken(r)
		u, se := a.Resolve(r.Context(), token)
		if u == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "unauthorized", "message": "You need to log in."}})
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
