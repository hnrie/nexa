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

// Limiter holds one token bucket per key.
type Limiter struct {
	mu      sync.Mutex
	r       rate.Limit
	burst   int
	ttl     time.Duration
	entries map[string]*entry
	now     func() time.Time
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
