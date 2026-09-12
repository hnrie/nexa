package api

import (
	"testing"

	"evilion.xyz/chat/internal/unfurl"
)

func TestUnfurlRoute(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Unfurl = unfurl.NewService()
	tok, _ := register(t, ts, "alice")
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=http://127.0.0.1/secret", "", nil); res.StatusCode != 401 {
		t.Error("auth required")
	}
	if res, body := do(t, ts, "GET", "/api/v1/unfurl", tok, nil); res.StatusCode != 400 || errCode(body) != "bad_url" {
		t.Errorf("missing url: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=http://127.0.0.1/secret", tok, nil); res.StatusCode != 204 {
		t.Errorf("blocked address should be an empty 204, got %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/unfurl?url=ftp://example.com/x", tok, nil); res.StatusCode != 204 {
		t.Errorf("unsupported scheme should be 204, got %d", res.StatusCode)
	}
}
