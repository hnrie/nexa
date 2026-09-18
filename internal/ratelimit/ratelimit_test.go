package ratelimit

import (
	"context"
	"errors"
	"testing"
	"time"
)

// With a shared counter the allowance is one for every process, not one each.
func TestSharedAllowanceIsCountedOnce(t *testing.T) {
	shared := &fakeShared{n: map[string]int{}}
	a := New(Every(3, time.Minute), 3, time.Hour)
	b := New(Every(3, time.Minute), 3, time.Hour)
	a.Share(shared)
	b.Share(shared)
	// three between the two of them, not three each
	for i := 0; i < 3; i++ {
		l := a
		if i%2 == 1 {
			l = b
		}
		if ok, _ := l.Allow("ip"); !ok {
			t.Fatalf("attempt %d should be allowed", i)
		}
	}
	if ok, wait := a.Allow("ip"); ok || wait <= 0 {
		t.Errorf("the fourth should be refused with a wait, got ok=%v wait=%v", ok, wait)
	}
}

// A shared counter that cannot be reached must not let everything through.
func TestFallsBackToItsOwnBucket(t *testing.T) {
	l := New(Every(2, time.Minute), 2, time.Hour)
	l.Share(&fakeShared{fail: true})
	if ok, _ := l.Allow("ip"); !ok {
		t.Fatal("first should be allowed")
	}
	if ok, _ := l.Allow("ip"); !ok {
		t.Fatal("second should be allowed")
	}
	if ok, _ := l.Allow("ip"); ok {
		t.Error("the third should be refused by this process's own bucket")
	}
}

type fakeShared struct {
	n    map[string]int
	fail bool
}

func (f *fakeShared) Allow(_ context.Context, key string, n int, window time.Duration) (bool, time.Duration, error) {
	if f.fail {
		return false, 0, errors.New("unreachable")
	}
	f.n[key]++
	if f.n[key] > n {
		return false, window, nil
	}
	return true, 0, nil
}

func (f *fakeShared) ResetRate(_ context.Context, key string) error {
	if f.fail {
		return errors.New("unreachable")
	}
	delete(f.n, key)
	return nil
}

// Reset has to mean the same thing whether or not the allowance is shared.
// Clearing only this process's map left someone who mistyped their password
// four times and then got it right throttled for the rest of the window.
func TestResetClearsTheSharedCounter(t *testing.T) {
	shared := &fakeShared{n: map[string]int{}}
	l := New(Every(3, time.Minute), 3, time.Hour)
	l.Share(shared)
	for i := 0; i < 3; i++ {
		if ok, _ := l.Allow("login:alice"); !ok {
			t.Fatalf("attempt %d should be allowed", i)
		}
	}
	if ok, _ := l.Allow("login:alice"); ok {
		t.Fatal("the fourth should be refused")
	}
	l.Reset("login:alice")
	if ok, _ := l.Allow("login:alice"); !ok {
		t.Error("after a successful sign-in the next attempt must be allowed again")
	}
}
