package rpcapps

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

const appID = "383226320970055681"

func fakeDiscord(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("GET /applications/{id}/rpc", func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Header.Get("User-Agent") == "" {
			t.Error("no User-Agent sent")
		}
		if r.PathValue("id") != appID {
			http.Error(w, `{"message":"Unknown Application","code":10002}`, http.StatusNotFound)
			return
		}
		time.Sleep(20 * time.Millisecond) // long enough for concurrent lookups to overlap
		_, _ = w.Write([]byte(`{"id":"` + appID + `","name":"Visual Studio Code","icon":"db3133f34f68553148f3a65c1f4633aa"}`))
	})
	mux.HandleFunc("GET /oauth2/applications/{id}/assets", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"id":"1359298290058789037","type":1,"name":"c"},{"id":"1359298108856729682","type":1,"name":"Angular"}]`))
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, &hits
}

func newCache(ts *httptest.Server) *Cache {
	c := New()
	c.Base = ts.URL
	c.CDN = "https://cdn.test"
	return c
}

func TestLookupNamesTheApplicationAndItsArt(t *testing.T) {
	ts, hits := fakeDiscord(t)
	c := newCache(ts)
	app, err := c.Lookup(context.Background(), appID)
	if err != nil {
		t.Fatal(err)
	}
	if app.Name != "Visual Studio Code" || app.IconURL != "https://cdn.test/app-icons/"+appID+"/db3133f34f68553148f3a65c1f4633aa.png?size=128" {
		t.Errorf("app: %+v", app)
	}
	if got := app.AssetURL("c"); got != "https://cdn.test/app-assets/"+appID+"/1359298290058789037.png" {
		t.Errorf("asset by name: %q", got)
	}
	if got := app.AssetURL("angular"); got != "https://cdn.test/app-assets/"+appID+"/1359298108856729682.png" {
		t.Errorf("asset names are matched without case: %q", got)
	}
	if got := app.AssetURL("1359298290058789037"); got != "https://cdn.test/app-assets/"+appID+"/1359298290058789037.png" {
		t.Errorf("asset by id: %q", got)
	}
	if got := app.AssetURL("nope"); got != "" {
		t.Errorf("unknown asset: %q", got)
	}
	if _, err := c.Lookup(context.Background(), appID); err != nil || hits.Load() != 1 {
		t.Errorf("second lookup should come from the cache: %v, %d fetches", err, hits.Load())
	}
}

func TestUnknownAndMalformedApplications(t *testing.T) {
	ts, hits := fakeDiscord(t)
	c := newCache(ts)
	if _, err := c.Lookup(context.Background(), "111111111111111111"); !errors.Is(err, ErrUnknown) {
		t.Errorf("unknown app: %v", err)
	}
	if _, err := c.Lookup(context.Background(), "111111111111111111"); !errors.Is(err, ErrUnknown) || hits.Load() != 1 {
		t.Errorf("an unknown app is remembered too: %v, %d fetches", err, hits.Load())
	}
	for _, bad := range []string{"", "abc", "12", "../../users/@me", "1234567890123456789012"} {
		if _, err := c.Lookup(context.Background(), bad); !errors.Is(err, ErrUnknown) {
			t.Errorf("%q: %v", bad, err)
		}
	}
	if hits.Load() != 1 {
		t.Errorf("malformed ids must not reach Discord: %d fetches", hits.Load())
	}
}

func TestConcurrentLookupsShareOneFetch(t *testing.T) {
	ts, hits := fakeDiscord(t)
	c := newCache(ts)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.Lookup(context.Background(), appID); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if hits.Load() != 1 {
		t.Errorf("%d fetches for one app", hits.Load())
	}
}

func TestEntriesExpire(t *testing.T) {
	ts, hits := fakeDiscord(t)
	c := newCache(ts)
	now := time.Now()
	c.now = func() time.Time { return now }
	if _, err := c.Lookup(context.Background(), appID); err != nil {
		t.Fatal(err)
	}
	now = now.Add(c.TTL + time.Minute)
	if _, err := c.Lookup(context.Background(), appID); err != nil || hits.Load() != 2 {
		t.Errorf("an expired entry is fetched again: %v, %d fetches", err, hits.Load())
	}
}

func TestDiscordAskingToSlowDownPausesEveryLookup(t *testing.T) {
	var hits atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Retry-After", "30")
		http.Error(w, `{"message":"You are being rate limited.","retry_after":30,"global":false}`, http.StatusTooManyRequests)
	}))
	t.Cleanup(ts.Close)
	c := newCache(ts)
	now := time.Now()
	c.now = func() time.Time { return now }
	if _, err := c.Lookup(context.Background(), appID); !errors.Is(err, ErrBusy) {
		t.Fatalf("a 429: %v", err)
	}
	if _, err := c.Lookup(context.Background(), "111111111111111111"); !errors.Is(err, ErrBusy) || hits.Load() != 1 {
		t.Errorf("no lookup may reach Discord while it asks to wait: %v, %d requests", err, hits.Load())
	}
	now = now.Add(31 * time.Second)
	if _, err := c.Lookup(context.Background(), appID); !errors.Is(err, ErrBusy) || hits.Load() != 2 {
		t.Errorf("after the wait, and since busy is not remembered, Discord is asked again: %v, %d requests", err, hits.Load())
	}
}

func TestLookupsOfNewApplicationsArePaced(t *testing.T) {
	ts, hits := fakeDiscord(t)
	c := newCache(ts)
	c.Pace = rate.NewLimiter(rate.Every(time.Hour), 2) // one application's two requests
	if _, err := c.Lookup(context.Background(), appID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Lookup(context.Background(), "111111111111111111"); !errors.Is(err, ErrBusy) || hits.Load() != 1 {
		t.Errorf("past the pace a lookup is put off without asking: %v, %d requests", err, hits.Load())
	}
	if _, err := c.Lookup(context.Background(), appID); err != nil {
		t.Errorf("a known application still comes from the cache: %v", err)
	}
}
