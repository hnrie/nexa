package api

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ratelimit"
)

// A step-up limit is a free allowance that a captcha extends. Past the free
// bucket a request asks for a captcha (the apps solve it and send it again,
// as for any guarded action), and a solved one buys a batch of requests, so
// someone busy building a server, or many people opening an invite behind
// one address, keep going after a second's check while a script pays for
// every batch. The solves themselves are limited, so there is still a
// ceiling. With captchas off it is the plain free limit.
type stepUp struct {
	action string
	free   *ratelimit.Limiter // what needs no captcha
	solves *ratelimit.Limiter // captchas that count, per key
	batch  int                // requests one captcha buys, the one it came with included
	last   time.Duration      // how long a batch keeps

	mu   sync.Mutex
	left map[string]permit
}

type permit struct {
	n     int
	until time.Time
}

func newStepUp(action string, free, solves *ratelimit.Limiter, batch int, last time.Duration) *stepUp {
	return &stepUp{action: action, free: free, solves: solves, batch: batch, last: last, left: map[string]permit{}}
}

// take spends one request of a batch bought earlier.
func (u *stepUp) take(key string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	p, ok := u.left[key]
	if !ok || p.n <= 0 || time.Now().After(p.until) {
		delete(u.left, key)
		return false
	}
	p.n--
	u.left[key] = p
	return true
}

// grant gives key a fresh batch, less the request that bought it.
func (u *stepUp) grant(key string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	now := time.Now()
	if len(u.left) > 10000 {
		for k, p := range u.left {
			if now.After(p.until) {
				delete(u.left, k)
			}
		}
	}
	u.left[key] = permit{n: u.batch - 1, until: now.Add(u.last)}
}

func (s *Server) stepUpLimited(u *stepUp, keyFn func(*http.Request) string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := keyFn(r)
		ok, retry := u.free.Allow(key)
		if ok || u.take(key) {
			h.ServeHTTP(w, r)
			return
		}
		refuse := func(retry time.Duration) {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(retry.Seconds()+0.999))))
			WriteError(w, ErrRateLimited)
		}
		if !s.captchaEnabled() {
			refuse(retry)
			return
		}
		if !s.requireCaptcha(w, r, u.action) {
			return
		}
		if ok, solveRetry := u.solves.Allow(key); !ok {
			refuse(min(retry, solveRetry))
			return
		}
		u.grant(key)
		h.ServeHTTP(w, r)
	})
}

// stepUpUser is userLimited with a step-up limit, counted per account.
func (s *Server) stepUpUser(u *stepUp, h http.HandlerFunc) http.Handler {
	return s.authed(s.stepUpLimited(u, func(r *http.Request) string {
		if me := auth.UserFrom(r.Context()); me != nil {
			return me.ID.String()
		}
		return auth.RateKey(r)
	}, h).ServeHTTP)
}

// stepUpIP is ipLimited with a step-up limit, counted per address.
func (s *Server) stepUpIP(u *stepUp, h http.HandlerFunc) http.Handler {
	return s.stepUpLimited(u, auth.RateKey, h)
}
