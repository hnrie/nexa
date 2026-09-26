package api

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
}
