package cache

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Memory keeps everything in this process. It is the whole answer while chatd
// runs on one machine, and the fallback when no Redis is configured.
type Memory struct {
	mu      sync.Mutex
	marks   map[string]map[string]time.Time // user -> node -> expiry
	buckets map[string]*rate.Limiter
	subs    map[string][]func([]byte)
	now     func() time.Time
}

func NewMemory() *Memory {
	return &Memory{
		marks:   map[string]map[string]time.Time{},
		buckets: map[string]*rate.Limiter{},
		subs:    map[string][]func([]byte){},
		now:     time.Now,
	}
}

func (m *Memory) Online(_ context.Context, userID, node string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	set := m.marks[userID]
	if set == nil {
		set = map[string]time.Time{}
		m.marks[userID] = set
	}
	set[node] = m.now().Add(ttl)
	return nil
}

func (m *Memory) Offline(_ context.Context, userID, node string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if set := m.marks[userID]; set != nil {
		delete(set, node)
		if len(set) == 0 {
			delete(m.marks, userID)
		}
	}
	return nil
}

func (m *Memory) IsOnline(_ context.Context, userID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.aliveLocked(userID), nil
}

func (m *Memory) OnlineAmong(_ context.Context, userIDs []string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]bool, len(userIDs))
	for _, id := range userIDs {
		if m.aliveLocked(id) {
			out[id] = true
		}
	}
	return out, nil
}

// aliveLocked drops expired marks as it goes, so nothing has to sweep.
func (m *Memory) aliveLocked(userID string) bool {
	set := m.marks[userID]
	if set == nil {
		return false
	}
	now := m.now()
	for node, until := range set {
		if until.Before(now) {
			delete(set, node)
		}
	}
	if len(set) == 0 {
		delete(m.marks, userID)
		return false
	}
	return true
}

func (m *Memory) Allow(_ context.Context, key string, n int, window time.Duration) (bool, time.Duration, error) {
	m.mu.Lock()
	lim, ok := m.buckets[key]
	if !ok {
		lim = rate.NewLimiter(rate.Every(window/time.Duration(n)), n)
		m.buckets[key] = lim
	}
	m.mu.Unlock()
	now := m.now()
	if lim.AllowN(now, 1) {
		return true, 0, nil
	}
	res := lim.ReserveN(now, 1)
	delay := res.DelayFrom(now)
	res.CancelAt(now)
	if delay <= 0 {
		delay = time.Second
	}
	return false, delay, nil
}

func (m *Memory) Publish(_ context.Context, channel string, payload []byte) error {
	m.mu.Lock()
	fns := append([]func([]byte){}, m.subs[channel]...)
	m.mu.Unlock()
	for _, fn := range fns {
		fn(payload)
	}
	return nil
}

func (m *Memory) Subscribe(ctx context.Context, channel string, fn func([]byte)) error {
	m.mu.Lock()
	m.subs[channel] = append(m.subs[channel], fn)
	at := len(m.subs[channel]) - 1
	m.mu.Unlock()
	go func() {
		<-ctx.Done()
		m.mu.Lock()
		if list := m.subs[channel]; at < len(list) {
			list[at] = func([]byte) {}
		}
		m.mu.Unlock()
	}()
	return nil
}

func (m *Memory) Close() error { return nil }
