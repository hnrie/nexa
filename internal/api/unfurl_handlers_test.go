package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"evilion.xyz/chat/internal/unfurl"
)

func TestUnfurlRoute(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Unfurl = unfurl.NewService()
	tok, _ := register(t, ts, "alice")
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=http://127.0.0.1/secret", "", nil); res.StatusCode != 401 {
		t.Error("auth required")
	}
	if res, body := do(t, ts, "GET", "/api/v1/unfurl", tok, nil); res.StatusCode != 400 || errCode(body) != "bad_url" {
		t.Errorf("missing url: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=http://127.0.0.1/secret", tok, nil); res.StatusCode != 204 {
		t.Errorf("blocked address should be an empty 204, got %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=ftp://example.com/x", tok, nil); res.StatusCode != 204 {
		t.Errorf("unsupported scheme should be 204, got %d", res.StatusCode)
	}
}

// A note's share link is never fetched for a preview: the app draws its own
// card, with the key only the link's holders have.
func TestUnfurlLeavesNoteLinksAlone(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.PublicURL = "https://chat.example.org"
	var fetched atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetched.Add(1)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><meta property="og:title" content="A Shared Note"></head></html>`))
	}))
	defer upstream.Close()
	// every host is this one test server, so nothing here reaches the internet
	tr := &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	}}
	t.Cleanup(tr.CloseIdleConnections)
	srv.Unfurl = &unfurl.Service{Fetcher: &unfurl.Fetcher{Timeout: 5 * time.Second, Transport: tr, Resolver: proxyResolver{[]net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}}}}
	tok, _ := register(t, ts, "alice")
	for _, link := range []string{"https://chat.example.org/note/dG9rZW4tb2YtYS1zaGFyZWQtbm90ZQ", "https://CHAT.example.org/note/dG9rZW4tb2YtYS1zaGFyZWQtbm90ZQ/"} {
		if res, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape(link), tok, nil); res.StatusCode != http.StatusNoContent {
			t.Errorf("%s got a preview: %d %v", link, res.StatusCode, body)
		}
	}
	if fetched.Load() != 0 {
		t.Errorf("a note link was fetched %d times", fetched.Load())
	}
	// the same page elsewhere is somebody else's site, and previewed as one
	if res, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape("http://elsewhere.example.net/note/dG9rZW4tb2YtYS1zaGFyZWQtbm90ZQ"), tok, nil); res.StatusCode != http.StatusOK || fetched.Load() != 1 {
		t.Errorf("another site's page: %d %v", res.StatusCode, body)
	}
}
