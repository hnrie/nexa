package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopReleasesAreServed(t *testing.T) {
	srv, ts := newTestServer(t)
	dir := t.TempDir()
	srv.Cfg.DesktopDir = dir

	// nothing published yet
	if res, body := do(t, ts, "GET", "/api/v1/desktop/latest", "", nil); res.StatusCode != 404 || errCode(body) != "no_release" {
		t.Fatalf("before publishing: %d %v", res.StatusCode, body)
	}

	manifest := `{"version":"1.2.3","released_at":1800000000000,"files":[{"os":"windows","arch":"x64","kind":"installer","name":"nexa-Setup-1.2.3-x64.exe","size":11,"sha256":"ab"},{"os":"mac","arch":"arm64","kind":"installer","name":"nexa-1.2.3-arm64.dmg","size":5,"sha256":"cd"}],"junk":"dropped"}`
	for name, body := range map[string]string{
		"manifest.json":            manifest,
		"latest.yml":               "version: 1.2.3\n",
		"signed-latest.yml.sig":    "public-signature-fixture",
		"nexa-Setup-1.2.3-x64.exe": "hello world",
		"nexa-1.2.3-arm64.dmg":     "12345",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	res, body := do(t, ts, "GET", "/api/v1/desktop/latest", "", nil)
	if res.StatusCode != 200 || body["version"] != "1.2.3" || len(body["files"].([]any)) != 2 || body["junk"] != nil {
		t.Fatalf("latest: %d %v", res.StatusCode, body)
	}
	if f := body["files"].([]any)[0].(map[string]any); f["os"] != "windows" || f["name"] != "nexa-Setup-1.2.3-x64.exe" || f["size"] != float64(11) {
		t.Errorf("file entry: %v", f)
	}

	get := func(path, rng string) (*http.Response, string) {
		t.Helper()
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return r, string(b)
	}
	r, b := get("/desktop/nexa-Setup-1.2.3-x64.exe", "")
	if r.StatusCode != 200 || b != "hello world" || !strings.Contains(r.Header.Get("Cache-Control"), "immutable") || !strings.Contains(r.Header.Get("Content-Disposition"), "attachment") {
		t.Errorf("installer: %d %q %v", r.StatusCode, b, r.Header)
	}
	// resumable, as updaters and browsers expect
	if r, b := get("/desktop/nexa-Setup-1.2.3-x64.exe", "bytes=6-"); r.StatusCode != 206 || b != "world" {
		t.Errorf("range: %d %q", r.StatusCode, b)
	}
	if r, _ := get("/desktop/latest.yml", ""); r.StatusCode != 200 || r.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("update manifest must not be cached: %d %v", r.StatusCode, r.Header)
	}
	if r, _ := get("/desktop/signed-latest.yml.sig", ""); r.StatusCode != 200 || r.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("rotating signature must not be cached: %d %v", r.StatusCode, r.Header)
	}
	for _, bad := range []string{"/desktop/missing.exe", "/desktop/..%2Fchat.db", "/desktop/.hidden", "/desktop/"} {
		if r, _ := get(bad, ""); r.StatusCode != 404 {
			t.Errorf("%s: %d", bad, r.StatusCode)
		}
	}
}

func TestActivityPreviewResolvesWithoutShowingAnyone(t *testing.T) {
	_, ts := newTestServer(t)
	tok, _ := register(t, ts, "alice")
	res, body := do(t, ts, "POST", "/api/v1/activities/preview", tok, map[string]any{"activities": []any{
		map[string]any{"name": "Some Game", "type": 0, "details": "Menu", "timestamps": map[string]any{"start": 1799999990}},
		map[string]any{"details": "nameless and unknown"},
	}})
	list, _ := body["_list"].([]any)
	if res.StatusCode != 200 || len(list) != 1 {
		t.Fatalf("preview: %d %v", res.StatusCode, body)
	}
	if a := list[0].(map[string]any); a["name"] != "Some Game" || a["details"] != "Menu" {
		t.Errorf("preview activity: %v", a)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/activities/preview", "", map[string]any{"activities": []any{}}); res.StatusCode != 401 {
		t.Errorf("signed out: %d", res.StatusCode)
	}
}
