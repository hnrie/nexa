package api

import (
	"net/http"
	"testing"
)

func TestHealthAnd404(t *testing.T) {
	_, ts := newTestServer(t)
	res, body := do(t, ts, "GET", "/api/health", "", nil)
	if res.StatusCode != 200 || body["ok"] != true {
		t.Errorf("health: %d %v", res.StatusCode, body)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" || res.Header.Get("X-Request-Id") == "" {
		t.Error("security headers / request id missing")
	}
	res, body = do(t, ts, "GET", "/api/v1/nope", "", nil)
	if res.StatusCode != 404 || errCode(body) != "not_found" {
		t.Errorf("404: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me", "", nil)
	if res.StatusCode != 401 || errCode(body) != "unauthorized" {
		t.Errorf("authed route without token: %d %v", res.StatusCode, body)
	}
}

func TestReadJSON(t *testing.T) {
	_, ts := newTestServer(t)
	_ = ts
	req, _ := http.NewRequest("POST", "/x", nil)
	_ = req
}
