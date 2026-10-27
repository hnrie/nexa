package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Embedding is limited to the standalone demo, never a live account page.
func TestDemoFramePolicy(t *testing.T) {
	dist := t.TempDir()
	for _, name := range []string{"demo.html", "index.html"} {
		if err := os.WriteFile(filepath.Join(dist, name), []byte("<!doctype html><title>Nexa</title>"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct{ path, ancestor string }{{"/demo.html", "'self'"}, {"/index.html", "'none'"}} {
		req := httptest.NewRequest(http.MethodGet, check.path, nil)
		recorder := httptest.NewRecorder()
		file := filepath.Join(dist, strings.TrimPrefix(check.path, "/"))
		serveStaticFile(recorder, req, file, check.path, time.Now())
		policy := recorder.Header().Get("Content-Security-Policy")
		if !strings.Contains(policy, "frame-ancestors "+check.ancestor) {
			t.Errorf("%s: %s", check.path, policy)
		}
	}
}

func TestStaticServing(t *testing.T) {
	srv, ts := newTestServer(t)
	dist := t.TempDir()
	os.MkdirAll(filepath.Join(dist, "assets"), 0o755)
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>Nexa</title>"), 0o644)
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
	if res.StatusCode != 200 || !strings.Contains(body, "Nexa") || res.Header.Get("Cache-Control") != "no-cache, must-revalidate" || res.Header.Get("CDN-Cache-Control") != "no-store" || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("index: %d %q %v", res.StatusCode, body, res.Header)
	}
	if res, body = get("/channels/@me/123"); res.StatusCode != 200 || !strings.Contains(body, "Nexa") {
		t.Errorf("spa fallback: %d", res.StatusCode)
	}
	res, body = get("/assets/app-abc123.js")
	if res.StatusCode != 200 || body != "console.log(1)" || res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/javascript") {
		t.Errorf("asset: %d %q %v", res.StatusCode, body, res.Header)
	}
	// a file from a build that has been replaced must 404, never fall back to
	// the page: a cache would then keep that page at the script's address
	for _, missing := range []string{"/models/whisper-tiny/missing.json", "/assets/gone-deadbeef.js", "/twemoji/9999.svg", "/download-sw.js", "/__download/0123456789abcdef0123456789abcdef"} {
		res, body = get(missing)
		if res.StatusCode != 404 || strings.Contains(body, "Nexa") || res.Header.Get("Cache-Control") != "no-store" {
			t.Errorf("missing %s: %d %q %v", missing, res.StatusCode, body, res.Header.Get("Cache-Control"))
		}
	}
	if res, _ = get("/manifest.webmanifest"); res.Header.Get("Content-Type") != "application/manifest+json" {
		t.Errorf("manifest type: %s", res.Header.Get("Content-Type"))
	}
	if res, _ = get("/sw.js"); res.Header.Get("Service-Worker-Allowed") != "/" {
		t.Error("service worker header")
	}
	if res, body = get("/../../etc/passwd"); res.StatusCode != 200 || !strings.Contains(body, "Nexa") {
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

// cspDirectives splits a content security policy into its directives' sources.
func cspDirectives(csp string) map[string][]string {
	out := map[string][]string{}
	for _, d := range strings.Split(csp, ";") {
		f := strings.Fields(d)
		if len(f) > 0 {
			out[f[0]] = f[1:]
		}
	}
	return out
}

func cspHas(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// A person's themes may load web fonts and stylesheets over https, and
// plugins run from blob: modules; nothing else about scripts loosens.
func TestContentSecurityPolicy(t *testing.T) {
	d := cspDirectives(CSP)
	for _, want := range []struct{ dir, src string }{
		{"script-src", "'self'"},
		{"script-src", "blob:"},
		{"style-src", "https:"},
		{"style-src", "'unsafe-inline'"},
		{"font-src", "https:"},
		{"font-src", "data:"},
		{"connect-src", "https:"},
		{"object-src", "'none'"},
		{"frame-ancestors", "'none'"},
		{"base-uri", "'self'"},
	} {
		if !cspHas(d[want.dir], want.src) {
			t.Errorf("%s lacks %s: %q", want.dir, want.src, d[want.dir])
		}
	}
	// scripts still never come from the network or from strings
	for _, never := range []string{"https:", "http:", "'unsafe-eval'", "'unsafe-inline'", "*", "data:"} {
		if cspHas(d["script-src"], never) {
			t.Errorf("script-src allows %s: %q", never, d["script-src"])
		}
	}
	// every page the static handler writes carries this policy
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>Nexa</title>"), 0o644)
	srv.Cfg.WebDist = dist
	ts := newHTTPTestServer(t, srv)
	res, err := http.Get(ts.URL + "/channels/@me")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.Header.Get("Content-Security-Policy") != CSP {
		t.Errorf("app page policy: %q", res.Header.Get("Content-Security-Policy"))
	}
}

func TestFrontPagePreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>Nexa</title></head><body></body></html>"), 0o644)
	srv.Cfg.WebDist = dist
	srv.Cfg.PublicURL = "https://chat.example.org"
	ts := newHTTPTestServer(t, srv)
	get := func(path string) (int, string) {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	// the front page unfurls with a title and a picture at a whole address
	code, body := get("/")
	if code != 200 || !strings.Contains(body, `<meta property="og:image" content="https://chat.example.org/home/app.png">`) || !strings.Contains(body, `summary_large_image`) {
		t.Errorf("front page: %d %q", code, body)
	}
	// its own background from the first frame, which the page takes away once drawn
	if !strings.Contains(body, `<style id="front-paint">`) {
		t.Errorf("front page without its first paint: %q", body)
	}
	// and its words keep to the house style: no dashes standing in for commas
	if strings.Contains(body, "—") {
		t.Errorf("front page preview has an em dash: %q", body)
	}
	// and only the front page: the app's other pages keep the shared head
	if _, body = get("/channels/@me"); strings.Contains(body, "og:image") {
		t.Errorf("an app page took the front page's preview: %q", body)
	}
}

func TestGuestCallLinkPreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>Nexa</title></head><body></body></html>"), 0o644)
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
	if res.StatusCode != 200 || !strings.Contains(body, `<meta property="og:title" content="Join a Voice Call">`) || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("guest link page: %d %q", res.StatusCode, body)
	}
}

// A note's share link unfurls as what it is, and the app's page loads behind
// it; nothing about the note, which the server cannot read anyway.
func TestNoteLinkPreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><title>Nexa</title></head><body><div id=\"root\"></div></body></html>"), 0o644)
	srv.Cfg.WebDist = dist
	ts := newHTTPTestServer(t, srv)
	res, err := http.Get(ts.URL + "/note/dG9rZW4tb2YtYS1zaGFyZWQtbm90ZQ")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	body := string(b)
	if res.StatusCode != 200 || !strings.Contains(body, `<meta property="og:title" content="A Shared Note">`) || !strings.Contains(body, `<div id="root">`) || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("note link page: %d %q", res.StatusCode, body)
	}
	if strings.Contains(body, "\u2014") || strings.Contains(body, "—") {
		t.Errorf("note link preview has an em dash: %q", body)
	}
}

// Workers use the policy on their own response, not the page's. A blanket
// default-src 'none' stops transcription from fetching its model and WASM.
func TestStaticWorkerPolicy(t *testing.T) {
	for _, path := range []string{"/assets/transcribe.worker-abc.js", "/assets/ort-runtime-abc.mjs", "/sw.js"} {
		t.Run(path, func(t *testing.T) {
			dir := t.TempDir()
			file := filepath.Join(dir, filepath.Base(path))
			if err := os.WriteFile(file, []byte("self.ready = true;"), 0600); err != nil {
				t.Fatal(err)
			}
			h := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { serveStaticFile(w, r, file, path, time.Now()) }))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if got := rec.Header().Get("Content-Security-Policy"); got != CSP {
				t.Fatalf("worker policy = %q, want app policy %q", got, CSP)
			}
			if strings.HasPrefix(path, "/assets/transcribe.worker-") {
				if got := rec.Header().Get("Cache-Control"); got != "no-cache, must-revalidate" {
					t.Errorf("transcription worker cache policy = %q", got)
				}
				if got := rec.Header().Get("CDN-Cache-Control"); got != "no-store" {
					t.Errorf("transcription worker CDN cache policy = %q", got)
				}
			} else if path == "/sw.js" {
				if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
					t.Errorf("service worker cache policy = %q", got)
				}
			} else if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
				t.Errorf("runtime asset cache policy = %q", got)
			}
		})
	}
}
