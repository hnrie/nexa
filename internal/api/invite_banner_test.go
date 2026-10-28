package api

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/unfurl"
)

// An invite to a server with a banner unfurls with the banner, both in the
// app's own invite card and in the page other sites read preview tags from.
func TestInviteBannerPreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>Nexa</title></head><body></body></html>"), 0o644)
	srv.Cfg.WebDist = dist
	srv.Cfg.PublicURL = "https://chat.example.org"
	ts := newHTTPTestServer(t, srv)
	tok, _ := register(t, ts, "alice")
	view := createServer(t, ts, tok, "Bannered")
	sid := view["id"].(string)
	code := inviteFor(t, ts, tok, channelNamed(view, "general")["id"].(string))
	page := func() string {
		res, err := http.Get(ts.URL + "/invite/" + code)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b)
	}
	unfurl := func() map[string]any {
		_, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape("https://chat.example.org/invite/"+code), tok, nil)
		return body
	}

	// no banner: the small card, and nothing made up
	if body := page(); !strings.Contains(body, `<meta name="twitter:card" content="summary">`) || strings.Contains(body, "/media/banner/") {
		t.Errorf("without a banner: %q", body)
	}
	if body := unfurl(); body["type"] != "invite" || body["banner"] != nil {
		t.Errorf("unfurl without a banner: %v", body)
	}

	res, raw := rawPut(t, ts.URL+"/api/v1/servers/"+sid+"/banner", tok, "image/png", pngBytes(64, 32))
	if res.StatusCode != 200 {
		t.Fatalf("banner upload: %d %s", res.StatusCode, raw)
	}
	body := page()
	if !strings.Contains(body, `<meta property="og:image" content="https://chat.example.org/media/banner/`) || !strings.Contains(body, `?size=1024">`) || !strings.Contains(body, `<meta name="twitter:card" content="summary_large_image">`) {
		t.Errorf("with a banner: %q", body)
	}
	if b, _ := unfurl()["banner"].(string); !strings.HasPrefix(b, "https://chat.example.org/media/banner/") {
		t.Errorf("unfurl banner: %q", b)
	}
	// A whole-community NSFW setting replaces public link metadata with a
	// generic warning; confirming an invite never changes crawler metadata.
	if res, out := do(t, ts, "PATCH", "/api/v1/servers/"+sid, tok, map[string]any{"nsfw": true}); res.StatusCode != 200 {
		t.Fatalf("mark NSFW: %d %v", res.StatusCode, out)
	}
	if body := page(); strings.Contains(body, "Bannered") || strings.Contains(body, "/media/banner/") || !strings.Contains(body, "Age-Restricted Server") {
		t.Fatalf("NSFW page metadata leaked: %q", body)
	}
	if body := unfurl(); body["title"] != "Age-Restricted Server" || body["image"] != nil || body["banner"] != nil {
		t.Fatalf("NSFW unfurl leaked: %v", body)
	}

}

// A short link that lands on one of our invites unfurls as the invite, not as
// a copy of the invite page's preview tags.
func TestUnfurlShortLinkToInvite(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.PublicURL = "http://chat.example.org"
	tok, _ := register(t, ts, "alice")
	view := createServer(t, ts, tok, "Short Links")
	code := inviteFor(t, ts, tok, channelNamed(view, "general")["id"].(string))
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/s/abc" {
			http.Redirect(w, r, "http://chat.example.org/invite/"+code, http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, `<html><head><title>Join Short Links</title></head><body></body></html>`)
	}))
	defer upstream.Close()
	// every host is this one test server, as if the short link's site and ours were both out on the internet
	tr := &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	}}
	t.Cleanup(tr.CloseIdleConnections)
	srv.Unfurl = &unfurl.Service{Fetcher: &unfurl.Fetcher{Timeout: 5 * time.Second, Transport: tr, Resolver: proxyResolver{[]net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}}}}

	res, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape("http://sho.rt/s/abc"), tok, nil)
	if res.StatusCode != http.StatusOK || body["type"] != "invite" || body["invite_code"] != code || body["title"] != "Short Links" {
		t.Fatalf("short link: %d %v", res.StatusCode, body)
	}
	// and an ordinary page stays an ordinary card
	if _, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape("http://sho.rt/elsewhere"), tok, nil); body["type"] == "invite" {
		t.Errorf("a page that is not an invite became one: %v", body)
	}
}
