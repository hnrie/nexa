package cache

import (
	"context"
	"sync"
	"time"
)

// Memory keeps everything in this process. It is the whole answer while chatd
// runs on one machine, and the fallback when no Redis is configured.
type Memory struct {
	mu      sync.Mutex
	marks   map[string]map[string]time.Time // user -> node -> expiry
	windows map[string]*window
	// allows counts Allow calls, so the expired windows are swept every so
	// often: the keys are callers' strings — addresses, usernames — and
	// without a sweep each one would stay in memory for good
	allows int
	subs   map[string]map[int]func([]byte)
	nextID int
	now    func() time.Time
}

// window is one key's count in its current window, as Redis keeps it: a
// counter that starts with the first request and expires with the window.
type window struct {
	count int
	until time.Time
}

// sweepEvery is how many Allow calls pass between sweeps of expired windows.
const sweepEvery = 1024

func NewMemory() *Memory {
	return &Memory{
		marks:   map[string]map[string]time.Time{},
		windows: map[string]*window{},
		subs:    map[string]map[int]func([]byte){},
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

// Allow counts n requests per window for key, the way the Redis backend does:
// a fixed window that opens with the first request and gives everything back
// when it expires. A limit of zero or less allows nothing.
func (m *Memory) Allow(_ context.Context, key string, n int, per time.Duration) (bool, time.Duration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	if m.allows++; m.allows%sweepEvery == 0 {
		for k, w := range m.windows {
			if !now.Before(w.until) {
				delete(m.windows, k)
			}
		}
	}
	w := m.windows[key]
	if w == nil || !now.Before(w.until) {
		w = &window{until: now.Add(per)}
		m.windows[key] = w
	}
	w.count++
	if w.count > n {
		return false, w.until.Sub(now), nil
	}
	return true, 0, nil
}

// ResetRate forgets a key's count.
func (m *Memory) ResetRate(_ context.Context, key string) error {
	m.mu.Lock()
	delete(m.windows, key)
	m.mu.Unlock()
	return nil
}

func (m *Memory) Publish(_ context.Context, channel string, payload []byte) error {
	m.mu.Lock()
	fns := make([]func([]byte), 0, len(m.subs[channel]))
	for _, fn := range m.subs[channel] {
		fns = append(fns, fn)
	}
	m.mu.Unlock()
	for _, fn := range fns {
		fn(payload)
	}
	return nil
}

// Subscribe delivers what is published on channel until ctx ends, and then
// forgets the subscription entirely.
func (m *Memory) Subscribe(ctx context.Context, channel string, fn func([]byte)) error {
	m.mu.Lock()
	m.nextID++
	id := m.nextID
	if m.subs[channel] == nil {
		m.subs[channel] = map[int]func([]byte){}
	}
	m.subs[channel][id] = fn
	m.mu.Unlock()
	go func() {
		<-ctx.Done()
		m.mu.Lock()
		delete(m.subs[channel], id)
		if len(m.subs[channel]) == 0 {
			delete(m.subs, channel)
		}
		m.mu.Unlock()
	}()
	return nil
}

func (m *Memory) Close() error { return nil }
