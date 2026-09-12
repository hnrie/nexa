package ratelimit

import (
	"testing"
	"time"
)

func TestAllowBurstAndRefill(t *testing.T) {
	l := New(Every(2, time.Second), 3, time.Minute)
	now := time.Unix(1000, 0)
	l.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("burst %d denied", i)
		}
	}
	ok, retry := l.Allow("a")
	if ok || retry <= 0 || retry > time.Second {
		t.Fatalf("4th should be denied with retry in (0,1s], got %v %v", ok, retry)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Error("other key unaffected")
	}
	now = now.Add(600 * time.Millisecond)
	if ok, _ := l.Allow("a"); !ok {
		t.Error("should refill one token after 500ms")
	}
	if ok, _ := l.Allow("a"); ok {
		t.Error("only one token refilled")
	}
	l.Reset("a")
	if ok, _ := l.Allow("a"); !ok {
		t.Error("reset restores burst")
	}
	now = now.Add(2 * time.Minute)
	l.sweep()
	if l.Len() != 0 {
		t.Errorf("sweep should drop idle keys, have %d", l.Len())
	}
}
