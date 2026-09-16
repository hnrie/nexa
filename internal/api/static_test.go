package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticServing(t *testing.T) {
	srv, ts := newTestServer(t)
	dist := t.TempDir()
	os.MkdirAll(filepath.Join(dist, "assets"), 0o755)
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>nexa</title>"), 0o644)
	os.WriteFile(filepath.Join(dist, "assets", "app-abc123.js"), []byte("console.log(1)"), 0o644)
	os.WriteFile(filepath.Join(dist, "manifest.webmanifest"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(dist, "sw.js"), []byte("self.x=1"), 0o644)
	srv.Cfg.WebDist = dist
	ts2 := newHTTPTestServer(t, srv)
	get := func(p string) (*http.Response, string) {
		res, err := http.Get(ts2.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res, string(b)
	}
	res, body := get("/")
	if res.StatusCode != 200 || !strings.Contains(body, "nexa") || res.Header.Get("Cache-Control") != "no-cache, must-revalidate" || res.Header.Get("CDN-Cache-Control") != "no-store" || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("index: %d %q %v", res.StatusCode, body, res.Header)
	}
	if res, body = get("/channels/@me/123"); res.StatusCode != 200 || !strings.Contains(body, "nexa") {
		t.Errorf("spa fallback: %d", res.StatusCode)
	}
	res, body = get("/assets/app-abc123.js")
	if res.StatusCode != 200 || body != "console.log(1)" || res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/javascript") {
		t.Errorf("asset: %d %q %v", res.StatusCode, body, res.Header)
	}
	// a file from a build that has been replaced must 404, never fall back to
	// the page: a cache would then keep that page at the script's address
	for _, missing := range []string{"/assets/gone-deadbeef.js", "/twemoji/9999.svg", "/download-sw.js", "/__download/0123456789abcdef0123456789abcdef"} {
		res, body = get(missing)
		if res.StatusCode != 404 || strings.Contains(body, "nexa") || res.Header.Get("Cache-Control") != "no-store" {
			t.Errorf("missing %s: %d %q %v", missing, res.StatusCode, body, res.Header.Get("Cache-Control"))
		}
	}
	if res, _ = get("/manifest.webmanifest"); res.Header.Get("Content-Type") != "application/manifest+json" {
		t.Errorf("manifest type: %s", res.Header.Get("Content-Type"))
	}
	if res, _ = get("/sw.js"); res.Header.Get("Service-Worker-Allowed") != "/" {
		t.Error("service worker header")
	}
	if res, body = get("/../../etc/passwd"); res.StatusCode != 200 || !strings.Contains(body, "nexa") {
		t.Errorf("traversal must fall back to index: %d", res.StatusCode)
	}
	if res, body = get("/api/v1/nope"); res.StatusCode != 404 || !strings.Contains(body, "not_found") {
		t.Errorf("api 404 stays json: %d %s", res.StatusCode, body)
	}
	if res, _ = get("/media/avatar/1"); res.StatusCode != 404 {
		t.Error("media 404")
	}
	_ = ts
	// missing dist → 503 with explanation
	srv.Cfg.WebDist = filepath.Join(dist, "missing")
	ts3 := newHTTPTestServer(t, srv)
	res2, err := http.Get(ts3.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res2.Body)
	res2.Body.Close()
	if res2.StatusCode != 503 || !strings.Contains(string(b), "not been built") {
		t.Errorf("missing dist: %d %s", res2.StatusCode, b)
	}
}

func TestGuestCallLinkPreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>nexa</title></head><body></body></html>"), 0o644)
	srv.Cfg.WebDist = dist
	ts := newHTTPTestServer(t, srv)
	res, err := http.Get(ts.URL + "/call/AbCdEf123456")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	body := string(b)
	// an invitation to a call, and nothing about whose
	if res.StatusCode != 200 || !strings.Contains(body, `<meta property="og:title" content="Join a voice call">`) || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("guest link page: %d %q", res.StatusCode, body)
	}
}
