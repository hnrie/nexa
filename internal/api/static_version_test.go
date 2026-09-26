package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// version.json names the build being served, and open pages ask for it to
// learn of a deploy: it must never be kept by a cache, and a build that has
// none must not answer with the app's page in its place.
func TestVersionFile(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>Nexa</title>"), 0o644)
	srv.Cfg.WebDist = dist
	ts := newHTTPTestServer(t, srv)
	get := func() (*http.Response, string) {
		res, err := http.Get(ts.URL + "/version.json")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res, string(b)
	}

	res, body := get()
	if res.StatusCode != 404 || strings.Contains(body, "Nexa") || res.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("missing version.json: %d %q %v", res.StatusCode, body, res.Header)
	}

	os.WriteFile(filepath.Join(dist, "version.json"), []byte(`{"build":"mfz1a2b3"}`+"\n"), 0o644)
	res, body = get()
	if res.StatusCode != 200 || !strings.Contains(body, `"build":"mfz1a2b3"`) {
		t.Fatalf("version.json: %d %q", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("CDN-Cache-Control") != "no-store" || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Errorf("version.json headers: %v", res.Header)
	}
}
