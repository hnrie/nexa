// Package ratelimit provides keyed token-bucket limiters.
package ratelimit

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type entry struct {
	lim  *rate.Limiter
	last time.Time
}

// Shared is a limiter every chatd process counts against together. Without one
// each process has its own allowance, so two of them let twice as much through.
type Shared interface {
	Allow(ctx context.Context, key string, n int, window time.Duration) (bool, time.Duration, error)
}

// Limiter holds one token bucket per key.
//
// With a Shared set it asks that instead, so several processes share one
// allowance. A shared counter that cannot be reached falls back to this
// process's own bucket rather than letting everything through.
type Limiter struct {
	mu      sync.Mutex
	r       rate.Limit
	burst   int
	ttl     time.Duration
	entries map[string]*entry
	now     func() time.Time

	shared Shared
	// window and n describe the same allowance to the shared counter.
	window time.Duration
	n      int
}

// Share makes this limiter count against s, in windows of the same length its
// own bucket refills over.
func (l *Limiter) Share(s Shared) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.shared = s
	l.n = l.burst
	if l.r > 0 {
		l.window = time.Duration(float64(l.burst) / float64(l.r) * float64(time.Second))
	}
	if l.window <= 0 {
		l.window = time.Minute
	}
}

// New creates a limiter allowing r events per second with the given burst;
// idle keys are forgotten after ttl.
func New(r rate.Limit, burst int, ttl time.Duration) *Limiter {
	return &Limiter{r: r, burst: burst, ttl: ttl, entries: map[string]*entry{}, now: time.Now}
}

// Every is a convenience for "n events per interval".
func Every(n int, interval time.Duration) rate.Limit {
	return rate.Every(interval / time.Duration(n))
}

// Allow reports whether key may proceed now; when it may not, retryAfter says
// how long until it could.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	shared, n, window := l.shared, l.n, l.window
	l.mu.Unlock()
	if shared != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		ok, wait, err := shared.Allow(ctx, key, n, window)
		cancel()
		if err == nil {
			return ok, wait
		}
		// the shared counter is unreachable; this process's own is better than none
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e, ok := l.entries[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(l.r, l.burst)}
		l.entries[key] = e
	}
	e.last = now
	if e.lim.AllowN(now, 1) {
		return true, 0
	}
	res := e.lim.ReserveN(now, 1)
	delay := res.DelayFrom(now)
	res.CancelAt(now)
	if delay <= 0 {
		delay = time.Second
	}
	return false, delay
}

// Reset forgets a key (used after a successful login to clear failures).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

// Start runs the idle-key sweeper until ctx is done.
func (l *Limiter) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(l.ttl)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				l.sweep()
			}
		}
	}()
}

func (l *Limiter) sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := l.now().Add(-l.ttl)
	for k, e := range l.entries {
		if e.last.Before(cutoff) {
			delete(l.entries, k)
		}
	}
}

// Len returns the number of tracked keys (for tests).
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}
