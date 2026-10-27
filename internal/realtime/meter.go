package realtime

import (
	"context"
	"sync"
	"time"
)

// Kinds of track a call device publishes.
const (
	KindAudio       = "audio"
	KindVideo       = "video"
	KindScreen      = "screen"
	KindScreenAudio = "screen_audio"
)

// ValidKind reports whether k is one of the four kinds.
func ValidKind(k string) bool {
	return k == KindAudio || k == KindVideo || k == KindScreen || k == KindScreenAudio
}

// IsVideo reports whether a kind is paused when the allowance runs low.
func IsVideo(k string) bool { return k == KindVideo || k == KindScreen }

// The rates a pulled track is charged at, in bits per second. They are what
// each kind can carry at most (the camera sender is capped to match), so the
// estimate errs high rather than letting a bill through.
const (
	AudioBps = 64_000
	// StreamAudioBps is a screen share's sound: stereo for music and games,
	// asked for at 128 kbps (web voice/opus.ts STREAM_AUDIO_BITRATE).
	StreamAudioBps   = 128_000
	CameraBps        = 1_500_000
	DefaultScreenBps = 5_000_000
	minScreenBps     = 1_000_000
	// Pro shares up to 20 Mbit/s (api/billing.go)
	maxScreenBps = 20_000_000
)

// ClampScreenBps bounds a screen share's declared bitrate.
func ClampScreenBps(bps int64) int64 {
	if bps <= 0 {
		return DefaultScreenBps
	}
	return min(maxScreenBps, max(minScreenBps, bps))
}

// RateFor returns the bits per second a pulled track of kind is charged at.
func RateFor(kind string, screenBps int64) int64 {
	switch kind {
	case KindVideo:
		return CameraBps
	case KindScreen:
		// An untrusted sender can understate its configured bitrate.
		return maxScreenBps
	case KindScreenAudio:
		return StreamAudioBps
	default:
		return AudioBps
	}
}

// UsageStore keeps the monthly totals.
type UsageStore interface {
	AddRealtimeUsage(ctx context.Context, month string, bytes int64) (int64, error)
	RealtimeUsage(ctx context.Context, month string) (int64, error)
}

type pull struct {
	// source is the published track pulled: its SFU session and kind
	source string
	bps    int64
	since  time.Time
}

// Source names a published track for the meter.
func Source(session, kind string) string { return session + ":" + kind }

// Meter estimates the month's SFU egress from the tracks devices pull. Video
// pauses at 90 % of the allowance and new calls stop at 99 %.
type Meter struct {
	mu    sync.Mutex
	st    UsageStore
	now   func() time.Time
	limit int64
	pulls map[string]map[string]pull
	// off holds the sources sending nothing just now (a camera turned off, a
	// share ended); pulls of them are not charged meanwhile
	off map[string]bool
	// month and used are the stored total the counts below add to
	month     string
	used      int64
	loaded    bool
	unflushed int64
}

// NewMeter meters against a monthly allowance in gigabytes.
func NewMeter(st UsageStore, monthlyGB int64) *Meter {
	return &Meter{st: st, now: time.Now, limit: monthlyGB * 1_000_000_000, pulls: map[string]map[string]pull{}, off: map[string]bool{}}
}

func monthOf(t time.Time) string { return t.UTC().Format("2006-01") }

func bytesFor(bps int64, d time.Duration) int64 {
	if d <= 0 {
		return 0
	}
	return bps * d.Milliseconds() / 8000
}

// charge is what a pull has used since it was last counted.
func (m *Meter) charge(p pull, now time.Time) int64 {
	if m.off[p.source] {
		return 0
	}
	return bytesFor(p.bps, now.Sub(p.since))
}

// Start begins charging a pulled track of source.
func (m *Meter) Start(session, mid, source string, bps int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	byMid := m.pulls[session]
	if byMid == nil {
		byMid = map[string]pull{}
		m.pulls[session] = byMid
	}
	if old, ok := byMid[mid]; ok {
		m.unflushed += m.charge(old, now)
	}
	// One session watching one track twice sees it once: a second pull of
	// the same source replaces the first rather than being charged beside it,
	// so asking for a track over and over cannot run the allowance down.
	for other, p := range byMid {
		if other != mid && p.source == source {
			m.unflushed += m.charge(p, now)
			delete(byMid, other)
		}
	}
	byMid[mid] = pull{source: source, bps: bps, since: now}
}

// ActiveMid reuses an existing provider subscription. Allocating a duplicate
// while merely deduplicating its meter entry would leave real egress uncharged.
func (m *Meter) ActiveMid(session, source string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for mid, p := range m.pulls[session] {
		if p.source == source {
			return mid, true
		}
	}
	return "", false
}

// StopSource follows a confirmed publication closure, which also stops all its
// subscriptions at the provider.
func (m *Meter) StopSource(source string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for session, byMid := range m.pulls {
		for mid, p := range byMid {
			if p.source == source {
				m.unflushed += m.charge(p, now)
				delete(byMid, mid)
			}
		}
		if len(byMid) == 0 {
			delete(m.pulls, session)
		}
	}
	delete(m.off, source)
}

// Stop ends charging one pulled track.
func (m *Meter) Stop(session, mid string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.pulls[session][mid]; ok {
		m.unflushed += m.charge(p, m.now())
		delete(m.pulls[session], mid)
		if len(m.pulls[session]) == 0 {
			delete(m.pulls, session)
		}
	}
}

// StopSession ends charging everything a session pulls, and forgets what it published.
func (m *Meter) StopSession(session string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for _, p := range m.pulls[session] {
		m.unflushed += m.charge(p, now)
	}
	delete(m.pulls, session)
	ofSession := func(source string) bool {
		return len(source) > len(session) && source[:len(session)+1] == session+":"
	}
	// What others pulled from this session ends with it: a track that no
	// longer exists costs nothing, whether or not their clients have closed
	// it yet.
	for other, byMid := range m.pulls {
		for mid, p := range byMid {
			if ofSession(p.source) {
				m.unflushed += m.charge(p, now)
				delete(byMid, mid)
			}
		}
		if len(byMid) == 0 {
			delete(m.pulls, other)
		}
	}
	for source := range m.off {
		if ofSession(source) {
			delete(m.off, source)
		}
	}
}

// SetSourceLive says whether a published track is sending. Pulls of a track
// that is off (a camera turned off) cost nothing until it is on again.
func (m *Meter) SetSourceLive(source string, live bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.off[source] == live {
		return
	}
	now := m.now()
	for _, byMid := range m.pulls {
		for mid, p := range byMid {
			if p.source != source {
				continue
			}
			m.unflushed += m.charge(p, now)
			p.since = now
			byMid[mid] = p
		}
	}
	if live {
		delete(m.off, source)
	} else {
		m.off[source] = true
	}
}

// ensureMonth loads the stored total when the month is new to the meter.
func (m *Meter) ensureMonth(ctx context.Context, now time.Time) {
	month := monthOf(now)
	if m.loaded && m.month == month {
		return
	}
	used, err := m.st.RealtimeUsage(ctx, month)
	if err != nil {
		return
	}
	m.month, m.used, m.loaded = month, used, true
}

// Flush writes what running and finished pulls have used so far.
func (m *Meter) Flush(ctx context.Context) error {
	m.mu.Lock()
	now := m.now()
	for _, byMid := range m.pulls {
		for mid, p := range byMid {
			m.unflushed += m.charge(p, now)
			p.since = now
			byMid[mid] = p
		}
	}
	add := m.unflushed
	m.unflushed = 0
	month := monthOf(now)
	m.mu.Unlock()
	if add == 0 {
		m.mu.Lock()
		m.ensureMonth(ctx, now)
		m.mu.Unlock()
		return nil
	}
	total, err := m.st.AddRealtimeUsage(ctx, month, add)
	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil {
		m.unflushed += add
		return err
	}
	m.month, m.used, m.loaded = month, total, true
	return nil
}

// Used estimates this month's egress, including what has not been written yet.
func (m *Meter) Used(ctx context.Context) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.ensureMonth(ctx, now)
	total := m.used + m.unflushed
	for _, byMid := range m.pulls {
		for _, p := range byMid {
			total += m.charge(p, now)
		}
	}
	return total
}

// Limit is the monthly allowance in bytes.
func (m *Meter) Limit() int64 { return m.limit }

// Month is the month the estimate is for, as YYYY-MM.
func (m *Meter) Month() string { return monthOf(m.now()) }

// VideoAllowed reports whether camera and screen tracks may still be used.
func (m *Meter) VideoAllowed(ctx context.Context) bool {
	return m.Used(ctx)*100 < m.limit*90
}

// CallsAllowed reports whether calls may still start.
func (m *Meter) CallsAllowed(ctx context.Context) bool {
	return m.Used(ctx)*100 < m.limit*99
}

// Run flushes every interval until ctx ends, and once more on the way out.
func (m *Meter) Run(ctx context.Context, every time.Duration, onErr func(error)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := m.Flush(flushCtx); err != nil && onErr != nil {
				onErr(err)
			}
			cancel()
			return
		case <-t.C:
			if err := m.Flush(ctx); err != nil && onErr != nil {
				onErr(err)
			}
		}
	}
}
