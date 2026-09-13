package api

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/unfurl"
)

// proxyResolver maps the one test hostname to a public address so the SSRF
// guard lets it through; the transport still dials the local test server.
type proxyResolver struct{ ips []net.IPAddr }

func (r proxyResolver) LookupIPAddr(_ context.Context, _ string) ([]net.IPAddr, error) {
	return r.ips, nil
}

func TestMediaProxy(t *testing.T) {
	srv, ts := newTestServer(t)
	// an upstream that serves one image and one script
	hits := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		switch r.URL.Path {
		case "/pic.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes(8, 8))
		case "/evil.svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = io.WriteString(w, "<svg onload=alert(1)>")
		default:
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<html>")
		}
	}))
	defer upstream.Close()
	tr := &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	}}
	t.Cleanup(tr.CloseIdleConnections)
	srv.Unfurl = &unfurl.Service{Fetcher: &unfurl.Fetcher{Timeout: 5 * time.Second, Transport: tr, Resolver: proxyResolver{[]net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}}}}
	const host = "http://images.test"

	signed := srv.ProxyURL(host + "/pic.png")
	if !strings.HasPrefix(signed, "/media/proxy/") {
		t.Fatalf("proxy url: %s", signed)
	}
	if got := srv.ProxyURL("/media/emoji/12"); got != "/media/emoji/12" {
		t.Errorf("relative urls pass through: %s", got)
	}
	res, err := http.Get(ts.URL + signed)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || len(body) == 0 {
		t.Fatalf("fetch: %d %s %d bytes", res.StatusCode, res.Header.Get("Content-Type"), len(body))
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" || res.Header.Get("Cache-Control") == "" {
		t.Errorf("hardening headers: %v", res.Header)
	}
	// a forged signature is refused, so this is not an open proxy
	parts := strings.SplitN(strings.TrimPrefix(signed, "/media/proxy/"), "/", 2)
	forged := ts.URL + "/media/proxy/AAAAAAAAAAAAAAAAAAAAAA/" + parts[1]
	if r2, err := http.Get(forged); err != nil || r2.StatusCode != 403 {
		t.Errorf("forged signature: %v %v", err, r2 != nil && r2.StatusCode == 403)
	}
	// SVG never passes through
	r3, err := http.Get(ts.URL + srv.ProxyURL(host+"/evil.svg"))
	if err != nil || r3.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("svg blocked: %v %d", err, r3.StatusCode)
	}
	// and neither does HTML
	r4, _ := http.Get(ts.URL + srv.ProxyURL(host+"/page"))
	if r4.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("html blocked: %d", r4.StatusCode)
	}
	// unfurl results come back already rewritten
	if u := srv.ProxyURL("https://example.com/a.png"); !strings.HasPrefix(u, "/media/proxy/") || strings.Contains(u, "example.com/a.png") {
		t.Errorf("unfurl image rewrite: %s", u)
	}
}

func TestNarrowRange(t *testing.T) {
	const max = 100
	for in, want := range map[string]string{
		"bytes=0-":      "bytes=0-99",
		"bytes=500-":    "bytes=500-599",
		"bytes=0-49":    "bytes=0-49",
		"bytes=10-1000": "bytes=10-109",
		"bytes=-500":    "bytes=-500",
		"bytes=0-1,5-6": "bytes=0-1,5-6",
		"bytes=abc-":    "bytes=abc-",
		"bytes=50-10":   "bytes=50-10",
		"items=0-":      "items=0-",
		" bytes=0- ":    "bytes=0-99",
	} {
		if got := narrowRange(in, max); got != want {
			t.Errorf("narrowRange(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMediaProxyPlaysLongVideoInPieces(t *testing.T) {
	srv, ts := newTestServer(t)
	const total = int64(maxProxyBytes) * 3
	var asked []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Header.Get("Range"))
		var start, end int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			// no range, or an open one: the whole file, which is too big to pass
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
		w.Header().Set("Content-Length", "4")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("mp4!"))
	}))
	defer upstream.Close()
	tr := &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	}}
	t.Cleanup(tr.CloseIdleConnections)
	srv.Unfurl = &unfurl.Service{Fetcher: &unfurl.Fetcher{Timeout: 5 * time.Second, Transport: tr, Resolver: proxyResolver{[]net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}}}}

	req, _ := http.NewRequest("GET", ts.URL+srv.ProxyURL("http://videos.test/long.mp4"), nil)
	req.Header.Set("Range", "bytes=0-")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	want := fmt.Sprintf("bytes=0-%d", maxProxyBytes-1)
	if res.StatusCode != http.StatusPartialContent || len(asked) != 1 || asked[0] != want {
		t.Fatalf("a player opening a long video gets its first part: %d, upstream asked %v", res.StatusCode, asked)
	}
	if cr := res.Header.Get("Content-Range"); cr != fmt.Sprintf("bytes 0-%d/%d", maxProxyBytes-1, total) {
		t.Errorf("Content-Range tells the player how long it is: %q", cr)
	}
	// without a range it is still too big to send whole
	res2, err := http.Get(ts.URL + srv.ProxyURL("http://videos.test/long.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("the whole file at once: %d", res2.StatusCode)
	}
}
