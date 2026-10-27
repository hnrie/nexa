package realtime

import (
	"context"
	"strconv"
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

	m.Start("s1", "0", Source("p1", KindAudio), AudioBps)
	m.Start("s1", "1", Source("p1", KindVideo), CameraBps)
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
	m.Start("s", "0", Source("p", KindScreen), 8_000_000) // 1 MB a second
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
	if RateFor(KindAudio, 0) != AudioBps || RateFor(KindScreenAudio, 0) != StreamAudioBps || RateFor(KindVideo, 0) != CameraBps {
		t.Error("audio and camera rates")
	}
	if RateFor(KindScreen, 0) != maxScreenBps || RateFor(KindScreen, 100) != maxScreenBps || RateFor(KindScreen, 50_000_000) != maxScreenBps || RateFor(KindScreen, 8_000_000) != maxScreenBps {
		t.Error("screen rates must not trust the client declaration")
	}
	if !ValidKind("screen_audio") || ValidKind("data") || !IsVideo(KindScreen) || IsVideo(KindScreenAudio) {
		t.Error("kinds")
	}
}

func TestMeterSkipsTracksThatSendNothing(t *testing.T) {
	ctx := context.Background()
	m, _, now := newTestMeter(1000, time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	camera := Source("pub", KindVideo)
	m.SetSourceLive(camera, false)
	m.Start("sub", "3", camera, CameraBps)
	*now = now.Add(time.Minute)
	if got := m.Used(ctx); got != 0 {
		t.Fatalf("a camera that is off costs nothing: %d", got)
	}
	m.SetSourceLive(camera, true)
	*now = now.Add(8 * time.Second)
	if got, want := m.Used(ctx), int64(1_500_000); got != want {
		t.Fatalf("on again, it is charged: %d, want %d", got, want)
	}
	m.SetSourceLive(camera, false)
	*now = now.Add(time.Hour)
	if got, want := m.Used(ctx), int64(1_500_000); got != want {
		t.Fatalf("off again, the charge stops: %d, want %d", got, want)
	}
	m.StopSession("pub")
	if len(m.off) != 0 {
		t.Errorf("the publisher leaving forgets its tracks: %v", m.off)
	}
}

// Pulling one track over and over is charged as one pull, and a track stops
// being charged when the session publishing it ends, whoever was pulling it.
func TestMeterChargesATrackOncePerSession(t *testing.T) {
	ctx := context.Background()
	m, _, now := newTestMeter(1000, time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	src := Source("pub", KindAudio)
	for i := 0; i < 50; i++ {
		m.Start("watcher", strconv.Itoa(i), src, AudioBps)
	}
	*now = now.Add(10 * time.Second)
	if got, want := m.Used(ctx), int64(80_000); got != want {
		t.Fatalf("fifty pulls of one track: %d, want %d", got, want)
	}
	m.StopSession("pub")
	before := m.Used(ctx)
	*now = now.Add(time.Hour)
	if got := m.Used(ctx); got != before {
		t.Errorf("a track whose publisher left is still charged: %d then %d", before, got)
	}
}

func TestConfirmedSourceClosureStopsAllItsPulls(t *testing.T) {
	ctx := context.Background()
	m, _, now := newTestMeter(1000, time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	source := Source("publisher", KindAudio)
	m.Start("a", "0", source, AudioBps)
	m.Start("b", "1", source, AudioBps)
	if mid, exists := m.ActiveMid("a", source); !exists || mid != "0" {
		t.Fatal("subscription not reusable")
	}
	*now = now.Add(time.Second)
	m.StopSource(source)
	used := m.Used(ctx)
	*now = now.Add(time.Minute)
	if m.Used(ctx) != used {
		t.Fatal("confirmed closed publication kept charging")
	}
	if _, exists := m.ActiveMid("a", source); exists {
		t.Fatal("closed subscription reused")
	}
}
