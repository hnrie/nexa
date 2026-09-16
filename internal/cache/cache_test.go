package cache

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

// Both backends have to behave the same way, or moving to Redis would change
// how the app works rather than just where its state lives.
func each(t *testing.T, fn func(t *testing.T, c Cache, tick func(time.Duration))) {
	t.Run("memory", func(t *testing.T) {
		m := NewMemory()
		now := time.Now()
		m.now = func() time.Time { return now }
		fn(t, m, func(d time.Duration) { now = now.Add(d) })
	})
	t.Run("redis", func(t *testing.T) {
		mr := miniredis.RunT(t)
		// presence reads the server's clock, so the test has to move that one
		// as well as the TTLs
		now := time.Now()
		mr.SetTime(now)
		c, err := NewRedis("redis://" + mr.Addr())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		fn(t, c, func(d time.Duration) {
			now = now.Add(d)
			mr.SetTime(now)
			mr.FastForward(d)
		})
	})
}

func TestPresenceCountsEveryProcess(t *testing.T) {
	each(t, func(t *testing.T, c Cache, tick func(time.Duration)) {
		ctx := context.Background()
		on, err := c.IsOnline(ctx, "u1")
		if err != nil || on {
			t.Fatalf("nobody should be online yet: %v %v", on, err)
		}
		if err := c.Online(ctx, "u1", "node-a", time.Minute); err != nil {
			t.Fatal(err)
		}
		if err := c.Online(ctx, "u1", "node-b", time.Minute); err != nil {
			t.Fatal(err)
		}
		// one process letting go does not take them offline
		if err := c.Offline(ctx, "u1", "node-a"); err != nil {
			t.Fatal(err)
		}
		if on, _ := c.IsOnline(ctx, "u1"); !on {
			t.Error("still connected to node-b")
		}
		if err := c.Offline(ctx, "u1", "node-b"); err != nil {
			t.Fatal(err)
		}
		if on, _ := c.IsOnline(ctx, "u1"); on {
			t.Error("the last process let go")
		}
	})
}

// A process that dies stops counting on its own: nothing has to notice it went.
func TestPresenceExpiresWithoutASweeper(t *testing.T) {
	each(t, func(t *testing.T, c Cache, tick func(time.Duration)) {
		ctx := context.Background()
		if err := c.Online(ctx, "u1", "gone", 30*time.Second); err != nil {
			t.Fatal(err)
		}
		if on, _ := c.IsOnline(ctx, "u1"); !on {
			t.Fatal("should be online")
		}
		tick(31 * time.Second)
		if on, _ := c.IsOnline(ctx, "u1"); on {
			t.Error("a mark nobody refreshed should have run out")
		}
	})
}

func TestOnlineAmongAnswersForEveryone(t *testing.T) {
	each(t, func(t *testing.T, c Cache, tick func(time.Duration)) {
		ctx := context.Background()
		_ = c.Online(ctx, "a", "n", time.Minute)
		_ = c.Online(ctx, "c", "n", time.Minute)
		got, err := c.OnlineAmong(ctx, []string{"a", "b", "c"})
		if err != nil {
			t.Fatal(err)
		}
		if !got["a"] || got["b"] || !got["c"] {
			t.Errorf("got %v", got)
		}
	})
}

func TestRateLimitIsShared(t *testing.T) {
	each(t, func(t *testing.T, c Cache, tick func(time.Duration)) {
		ctx := context.Background()
		for i := 0; i < 3; i++ {
			ok, _, err := c.Allow(ctx, "k", 3, time.Minute)
			if err != nil || !ok {
				t.Fatalf("attempt %d should be allowed: %v %v", i, ok, err)
			}
		}
		ok, wait, err := c.Allow(ctx, "k", 3, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Error("the fourth should be refused")
		}
		if wait <= 0 {
			t.Errorf("a refusal should say how long to wait, got %v", wait)
		}
		// a different key has its own allowance
		if ok, _, _ := c.Allow(ctx, "other", 3, time.Minute); !ok {
			t.Error("another key should not be affected")
		}
		tick(61 * time.Second)
		if ok, _, _ := c.Allow(ctx, "k", 3, time.Minute); !ok {
			t.Error("the window should have moved on")
		}
	})
}

func TestEventsReachEverySubscriber(t *testing.T) {
	each(t, func(t *testing.T, c Cache, tick func(time.Duration)) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		var mu sync.Mutex
		var got [][]byte
		done := make(chan struct{}, 2)
		for i := 0; i < 2; i++ {
			if err := c.Subscribe(ctx, "room", func(p []byte) {
				mu.Lock()
				got = append(got, p)
				mu.Unlock()
				done <- struct{}{}
			}); err != nil {
				t.Fatal(err)
			}
		}
		if err := c.Publish(ctx, "room", []byte("hello")); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 2; i++ {
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("an event did not reach every subscriber")
			}
		}
		mu.Lock()
		defer mu.Unlock()
		for _, p := range got {
			if string(p) != "hello" {
				t.Errorf("payload came across as %q", p)
			}
		}
	})
}

func TestOpenPicksTheBackend(t *testing.T) {
	c, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c.(*Memory); !ok {
		t.Errorf("no URL should keep it in this process, got %T", c)
	}
	c.Close()
	mr := miniredis.RunT(t)
	c, err = Open("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c.(*Redis); !ok {
		t.Errorf("a URL should use Redis, got %T", c)
	}
	c.Close()
	// a URL that cannot be reached is an error, never a quiet fallback
	if _, err := Open("redis://127.0.0.1:1"); err == nil {
		t.Error("an unreachable Redis should be refused")
	}
}
