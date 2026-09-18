package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"evilion.xyz/chat/internal/config"
)

func TestHiddenPath(t *testing.T) {
	for _, c := range []struct {
		path string
		want bool
	}{
		{"/.DS_Store", true},
		{"/assets/.DS_Store", true},
		{"/.vite/manifest.json", true},
		{"/.env", true},
		{"/.well-known/assetlinks.json", false},
		{"/assets/main-abc.js", false},
		{"/", false},
		{"/channels/@me", false},
	} {
		if got := hiddenPath(c.path); got != c.want {
			t.Errorf("hiddenPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

// A build directory picks up a .DS_Store whether anyone means it to or not;
// serving it hands out the names of everything beside it.
func TestStaticHandlerRefusesDotfiles(t *testing.T) {
	dist := t.TempDir()
	for name, body := range map[string]string{
		"index.html":       "<html></html>",
		".DS_Store":        "finder junk",
		"assets/main-a.js": "console.log(1)",
		"assets/.DS_Store": "more junk",
	} {
		full := filepath.Join(dist, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{Cfg: config.Config{WebDist: dist}}
	h := s.staticHandler()

	for _, c := range []struct {
		path string
		code int
	}{
		{"/.DS_Store", http.StatusNotFound},
		{"/assets/.DS_Store", http.StatusNotFound},
		{"/assets/main-a.js", http.StatusOK},
		{"/", http.StatusOK},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, c.path, nil))
		if w.Code != c.code {
			t.Errorf("GET %s = %d, want %d", c.path, w.Code, c.code)
		}
		if c.code == http.StatusNotFound && w.Body.String() == "finder junk" {
			t.Errorf("GET %s served the file anyway", c.path)
		}
	}
}
