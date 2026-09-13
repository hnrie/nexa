package realtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

type memUsage struct {
	mu     sync.Mutex
	months map[string]int64
}

func (u *memUsage) AddRealtimeUsage(_ context.Context, month string, b int64) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.months[month] += b
	return u.months[month], nil
}

func (u *memUsage) RealtimeUsage(_ context.Context, month string) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.months[month], nil
}

func newTestMeter(gb int64, start time.Time) (*Meter, *memUsage, *time.Time) {
	st := &memUsage{months: map[string]int64{}}
	m := NewMeter(st, gb)
	now := start
	m.now = func() time.Time { return now }
	return m, st, &now
}

func TestMeterChargesPulledTracks(t *testing.T) {
	ctx := context.Background()
	m, st, now := newTestMeter(1000, time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))

	m.Start("s1", "0", AudioBps)
	m.Start("s1", "1", CameraBps)
	*now = now.Add(10 * time.Second)
	// 10 s of audio (80 KB) and camera (1.875 MB)
	if got, want := m.Used(ctx), int64(80_000+1_875_000); got != want {
		t.Fatalf("running pulls: %d, want %d", got, want)
	}
	m.Stop("s1", "1")
	*now = now.Add(10 * time.Second)
	if err := m.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	if got, want := st.months["2026-09"], int64(160_000+1_875_000); got != want {
		t.Fatalf("flushed: %d, want %d", got, want)
	}
	// flushing again adds only what ran since
	*now = now.Add(5 * time.Second)
	_ = m.Flush(ctx)
	if got, want := st.months["2026-09"], int64(200_000+1_875_000); got != want {
		t.Fatalf("second flush: %d, want %d", got, want)
	}
	m.StopSession("s1")
	*now = now.Add(time.Hour)
	_ = m.Flush(ctx)
	if got := st.months["2026-09"]; got != 200_000+1_875_000 {
		t.Errorf("nothing charged after the session stopped: %d", got)
	}
}

func TestMeterMonthsAndThresholds(t *testing.T) {
	ctx := context.Background()
	m, st, now := newTestMeter(1, time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC))
	st.months["2026-09"] = 899_000_000 // just under 90 % of 1 GB
	if !m.VideoAllowed(ctx) || !m.CallsAllowed(ctx) {
		t.Fatal("under 90 %: everything allowed")
	}
	m.Start("s", "0", 8_000_000) // 1 MB a second
	*now = now.Add(2 * time.Second)
	if m.VideoAllowed(ctx) {
		t.Error("at 90 % video pauses")
	}
	if !m.CallsAllowed(ctx) {
		t.Error("calls go on until 99 %")
	}
	*now = now.Add(95 * time.Second)
	if m.CallsAllowed(ctx) {
		t.Error("at 99 % calls stop")
	}
	m.StopSession("s")
	_ = m.Flush(ctx)
	// a new month starts from what it has stored
	*now = time.Date(2026, 10, 1, 0, 5, 0, 0, time.UTC)
	if got := m.Used(ctx); got != 0 {
		t.Errorf("October starts at zero: %d", got)
	}
	if !m.VideoAllowed(ctx) {
		t.Error("video is back in a new month")
	}
}

func TestRates(t *testing.T) {
	if RateFor(KindAudio, 0) != AudioBps || RateFor(KindScreenAudio, 0) != AudioBps || RateFor(KindVideo, 0) != CameraBps {
		t.Error("audio and camera rates")
	}
	if RateFor(KindScreen, 0) != DefaultScreenBps || RateFor(KindScreen, 100) != minScreenBps || RateFor(KindScreen, 50_000_000) != maxScreenBps || RateFor(KindScreen, 8_000_000) != 8_000_000 {
		t.Error("screen rates are the declared bitrate, bounded")
	}
	if !ValidKind("screen_audio") || ValidKind("data") || !IsVideo(KindScreen) || IsVideo(KindScreenAudio) {
		t.Error("kinds")
	}
}
