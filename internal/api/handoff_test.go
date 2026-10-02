package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// at is a request from a page at origin.
func at(t *testing.T, ts *httptest.Server, method, path, origin, token string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func movedServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	srv, ts := newTestServer(t)
	srv.Cfg.PublicURL = "https://nexa.example"
	srv.Cfg.AltURLs = []string{"https://other.example"}
	srv.Cfg.MovedFrom = []string{"https://old.example"}
	return srv, ts
}

func TestHandoffMovesASignInOnce(t *testing.T) {
	_, ts := movedServer(t)
	tok, _ := register(t, ts, "alice")
	sealed := strings.Repeat("QUJD", 40) + "=="

	// only a page at the old address leaves one, and only signed in
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs", "https://nexa.example", tok, map[string]any{"sealed": sealed}); code != http.StatusForbidden {
		t.Errorf("left from the new address: %d", code)
	}
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs", "https://evil.example", tok, map[string]any{"sealed": sealed}); code != http.StatusForbidden {
		t.Errorf("left from a stranger's page: %d", code)
	}
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs", "https://old.example", "", map[string]any{"sealed": sealed}); code != http.StatusUnauthorized {
		t.Errorf("left signed out: %d", code)
	}
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs", "https://old.example", tok, map[string]any{"sealed": "<not base64>"}); code != http.StatusBadRequest {
		t.Errorf("left something that is not sealed: %d", code)
	}
	code, out := at(t, ts, "POST", "/api/v1/handoffs", "https://old.example", tok, map[string]any{"sealed": sealed})
	id, _ := out["id"].(string)
	if code != http.StatusCreated || len(id) < 20 {
		t.Fatalf("leaving: %d %v", code, out)
	}

	// taking: from a page at Nexa's own address, opened from the old one
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs/take", "https://old.example", "", map[string]any{"id": id, "from": "https://old.example/"}); code != http.StatusForbidden {
		t.Errorf("taken at the old address: %d", code)
	}
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs/take", "https://nexa.example", "", map[string]any{"id": id, "from": "https://evil.example/page"}); code != http.StatusForbidden {
		t.Errorf("taken by a page opened from somewhere else: %d", code)
	}
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs/take", "https://nexa.example", "", map[string]any{"id": id, "from": ""}); code != http.StatusForbidden {
		t.Errorf("taken by a page opened from nowhere: %d", code)
	}
	// ...and neither refusal used it up
	code, out = at(t, ts, "POST", "/api/v1/handoffs/take", "https://other.example", "", map[string]any{"id": id, "from": "https://old.example/channels/@me"})
	if code != http.StatusOK || out["sealed"] != sealed {
		t.Fatalf("taking: %d %v", code, out)
	}
	// once
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs/take", "https://nexa.example", "", map[string]any{"id": id, "from": "https://old.example/"}); code != http.StatusNotFound {
		t.Errorf("taken twice: %d", code)
	}
}

func TestHandoffWaitsAMinute(t *testing.T) {
	srv, ts := movedServer(t)
	tok, _ := register(t, ts, "alice")
	_, out := at(t, ts, "POST", "/api/v1/handoffs", "https://old.example", tok, map[string]any{"sealed": "QUJD"})
	id := out["id"].(string)
	srv.handoffs.mu.Lock()
	c := srv.handoffs.kept[id]
	c.expires = time.Now().Add(-time.Second)
	srv.handoffs.kept[id] = c
	srv.handoffs.mu.Unlock()
	if code, _ := at(t, ts, "POST", "/api/v1/handoffs/take", "https://nexa.example", "", map[string]any{"id": id, "from": "https://old.example/"}); code != http.StatusNotFound {
		t.Errorf("taken after its minute: %d", code)
	}
	// and an old one goes when the next is left
	_, _ = at(t, ts, "POST", "/api/v1/handoffs", "https://old.example", tok, map[string]any{"sealed": "QUJD"})
	srv.handoffs.mu.Lock()
	_, still := srv.handoffs.kept[id]
	srv.handoffs.mu.Unlock()
	if still {
		t.Error("an expired copy was kept")
	}
}

// Pages at an old address say where Nexa is now; pages anywhere else do not.
func TestMovedAddressPagesSayWhereNexaIs(t *testing.T) {
	srv, ts := movedServer(t)
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>Nexa</title></head><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv.Cfg.WebDist = dist
	ts.Config.Handler = srv.Handler()
	get := func(host, path string) string {
		t.Helper()
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		req.Host = host
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b)
	}
	const marker = `<meta name="nexa-moved-to" content="https://nexa.example">`
	for _, p := range []string{"/", "/channels/@me", "/index.html", "/call/abc", "/note/xyz"} {
		if body := get("old.example", p); !strings.Contains(body, marker) {
			t.Errorf("%s at the old address: no way on in %q", p, body)
		}
		for _, host := range []string{"nexa.example", "other.example"} {
			if body := get(host, p); strings.Contains(body, "nexa-moved-to") {
				t.Errorf("%s at %s says Nexa moved", p, host)
			}
		}
	}
	// the front page names Nexa's own address as the page's real one, wherever it is opened
	if body := get("other.example", "/"); !strings.Contains(body, `<link rel="canonical" href="https://nexa.example/">`) {
		t.Errorf("no canonical address on the front page: %q", body)
	}
}

func TestEveryAddressIsNexasOwn(t *testing.T) {
	srv, _ := movedServer(t)
	for _, h := range []string{"nexa.example", "OTHER.example", "old.example"} {
		if !srv.captchaSite(h) {
			t.Errorf("a captcha solved on %s was refused", h)
		}
	}
	if srv.captchaSite("evil.example") {
		t.Error("a captcha solved on someone else's page was taken")
	}
	for _, link := range []string{"https://nexa.example/invite/abc", "https://other.example/invite/abc", "https://old.example/invite/abc"} {
		if code := srv.inviteCodeOf(link); code != "abc" {
			t.Errorf("%s is not read as an invite: %q", link, code)
		}
	}
	if code := srv.inviteCodeOf("https://evil.example/invite/abc"); code != "" {
		t.Errorf("someone else's link read as an invite: %q", code)
	}
	// an Origin over the other scheme is not Nexa's
	if _, kind := srv.originAddress("http://nexa.example"); kind != notOurs {
		t.Error("http:// taken for https://")
	}
	req := httptest.NewRequest("GET", "https://other.example/yt/x", nil)
	if got := srv.ytOrigin(req); got != "https://other.example" {
		t.Errorf("the player at the other address is told it is at %q", got)
	}
	req = httptest.NewRequest("GET", "https://evil.example/yt/x", nil)
	if got := srv.ytOrigin(req); got != "https://nexa.example" {
		t.Errorf("a request for someone else's host is told it is at %q", got)
	}
}
