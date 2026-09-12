package api

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
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
