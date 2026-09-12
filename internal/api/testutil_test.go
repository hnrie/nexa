package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	d, err := db.Open(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	cfg, _ := config.Load(func(k string) string {
		switch k {
		case "DATA_DIR":
			return dir
		case "PUBLIC_URL":
			return "http://localhost"
		}
		return ""
	})
	st := store.New(d)
	srv := NewServer(cfg, st, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	m, err := media.New(filepath.Join(dir, "media"), st)
	if err != nil {
		t.Fatal(err)
	}
	srv.Media = m
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() { ts.Close(); d.Close() })
	return srv, ts
}

// do performs a JSON request and decodes the body into a generic map.
func do(t *testing.T, ts *httptest.Server, method, path, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		var v any
		if err := json.Unmarshal(raw, &v); err == nil {
			if m, ok := v.(map[string]any); ok {
				out = m
			} else {
				out["_list"] = v
			}
		} else {
			out["_raw"] = string(raw)
		}
	}
	return res, out
}

func errCode(m map[string]any) string {
	if e, ok := m["error"].(map[string]any); ok {
		c, _ := e["code"].(string)
		return c
	}
	return ""
}
