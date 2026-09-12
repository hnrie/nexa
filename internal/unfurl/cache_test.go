package unfurl

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCachePutGet(t *testing.T) {
	c := NewCache(4, time.Hour)
	want := &Result{URL: "https://example.test/a", Type: "link", Title: "A"}
	c.Put(want.URL, want, nil)

	got, err, ok := c.Get(want.URL)
	if !ok {
		t.Fatal("Get: miss, want hit")
	}
	if err != nil {
		t.Fatalf("Get err = %v, want nil", err)
	}
	if got == nil || got.Title != "A" || got.URL != want.URL {
		t.Fatalf("Get res = %+v, want %+v", got, want)
	}
	if _, _, ok := c.Get("https://example.test/missing"); ok {
		t.Error("Get(missing) = hit, want miss")
	}
	if c.Len() != 1 {
		t.Errorf("Len = %d, want 1", c.Len())
	}
}

func TestCacheTTL(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	now := base
	c := NewCache(4, time.Minute)
	c.now = func() time.Time { return now }

	c.Put("k", &Result{URL: "k"}, nil)
	now = base.Add(59 * time.Second)
	if _, _, ok := c.Get("k"); !ok {
		t.Fatal("Get before TTL: miss, want hit")
	}
	now = base.Add(time.Minute)
	if _, _, ok := c.Get("k"); ok {
		t.Fatal("Get at TTL: hit, want miss")
	}
	if c.Len() != 0 {
		t.Errorf("Len after expiry = %d, want 0", c.Len())
	}
}

func TestCacheZeroTTLNeverExpires(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	now := base
	c := NewCache(4, 0)
	c.now = func() time.Time { return now }
	c.Put("k", &Result{URL: "k"}, nil)
	now = base.Add(100 * time.Hour)
	if _, _, ok := c.Get("k"); !ok {
		t.Fatal("Get with zero TTL: miss, want hit")
	}
}

func TestCacheLRUEviction(t *testing.T) {
	c := NewCache(2, time.Hour)
	c.Put("a", &Result{URL: "a"}, nil)
	c.Put("b", &Result{URL: "b"}, nil)
	if _, _, ok := c.Get("a"); !ok { // "a" becomes most recently used
		t.Fatal("Get(a): miss")
	}
	c.Put("c", &Result{URL: "c"}, nil)

	if c.Len() != 2 {
		t.Fatalf("Len = %d, want 2", c.Len())
	}
	if _, _, ok := c.Get("b"); ok {
		t.Error("b still cached, want evicted as least recently used")
	}
	for _, k := range []string{"a", "c"} {
		if _, _, ok := c.Get(k); !ok {
			t.Errorf("%s evicted, want cached", k)
		}
	}
}

func TestCacheReplaceExisting(t *testing.T) {
	c := NewCache(2, time.Hour)
	c.Put("a", &Result{URL: "a", Title: "old"}, nil)
	c.Put("a", &Result{URL: "a", Title: "new"}, nil)
	if c.Len() != 1 {
		t.Fatalf("Len = %d, want 1", c.Len())
	}
	got, _, ok := c.Get("a")
	if !ok || got.Title != "new" {
		t.Fatalf("Get = %+v, %v, want title new", got, ok)
	}
}

func TestCacheNegativeCaching(t *testing.T) {
	c := NewCache(8, time.Hour)
	c.Put("u", nil, ErrUnsupported)
	c.Put("b", nil, ErrBlocked)
	c.Put("w", nil, fmt.Errorf("wrapped: %w", ErrUnsupported))
	c.Put("t", nil, errors.New("dial tcp: connection refused"))
	c.Put("l", nil, ErrTooLarge)

	res, err, ok := c.Get("u")
	if !ok || !errors.Is(err, ErrUnsupported) || res != nil {
		t.Errorf("Get(u) = %v, %v, %v; want nil, ErrUnsupported, true", res, err, ok)
	}
	if _, err, ok := c.Get("b"); !ok || !errors.Is(err, ErrBlocked) {
		t.Errorf("Get(b) = %v, %v; want ErrBlocked, true", err, ok)
	}
	if _, err, ok := c.Get("w"); !ok || !errors.Is(err, ErrUnsupported) {
		t.Errorf("Get(w) = %v, %v; want wrapped ErrUnsupported, true", err, ok)
	}
	if _, _, ok := c.Get("t"); ok {
		t.Error("transport error was cached, want not cached")
	}
	if _, _, ok := c.Get("l"); ok {
		t.Error("ErrTooLarge was cached, want not cached")
	}
	if c.Len() != 3 {
		t.Errorf("Len = %d, want 3", c.Len())
	}
}

func TestCacheConcurrent(t *testing.T) {
	c := NewCache(16, time.Hour)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("k%d", i%4)
			for j := 0; j < 50; j++ {
				c.Put(key, &Result{URL: key}, nil)
				c.Get(key)
				c.Len()
			}
		}(i)
	}
	wg.Wait()
	if c.Len() == 0 {
		t.Error("Len = 0 after concurrent writes")
	}
}

func TestNewServiceDefaults(t *testing.T) {
	s := NewService()
	if s.Fetcher == nil || s.Cache == nil {
		t.Fatalf("NewService = %+v, want fetcher and cache", s)
	}
	if s.Fetcher.Timeout != 6*time.Second {
		t.Errorf("Timeout = %v, want 6s", s.Fetcher.Timeout)
	}
	if s.Fetcher.MaxBytes != 2<<20 {
		t.Errorf("MaxBytes = %d, want %d", s.Fetcher.MaxBytes, 2<<20)
	}
	if s.Fetcher.UserAgent == "" {
		t.Error("UserAgent is empty")
	}
	if s.Cache.size != 2000 || s.Cache.ttl != time.Hour {
		t.Errorf("cache = %d entries / %v, want 2000 / 1h", s.Cache.size, s.Cache.ttl)
	}
}

func TestServiceLookupCachesOutcome(t *testing.T) {
	s := &Service{
		Fetcher: &Fetcher{Resolver: fakeResolver{"private.test": {"127.0.0.1"}}},
		Cache:   NewCache(4, time.Hour),
	}
	const u = "http://private.test/x"
	if _, err := s.Lookup(context.Background(), u); !errors.Is(err, ErrBlocked) {
		t.Fatalf("Lookup err = %v, want ErrBlocked", err)
	}
	if s.Cache.Len() != 1 {
		t.Fatalf("cache Len = %d, want 1", s.Cache.Len())
	}
	// Swapping in a resolver that would now succeed proves the second lookup is served
	// from the negative cache.
	s.Fetcher.Resolver = fakeResolver{"private.test": {"8.8.8.8"}}
	if _, err := s.Lookup(context.Background(), u); !errors.Is(err, ErrBlocked) {
		t.Fatalf("second Lookup err = %v, want cached ErrBlocked", err)
	}
}

func TestServiceLookupNilCache(t *testing.T) {
	s := &Service{Fetcher: &Fetcher{Resolver: fakeResolver{"private.test": {"127.0.0.1"}}}}
	if _, err := s.Lookup(context.Background(), "http://private.test/x"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("Lookup err = %v, want ErrBlocked", err)
	}
}
