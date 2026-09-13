package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// turnstileStandIn answers siteverify the way Cloudflare does: tokens named
// "good-<action>" pass for that action, anything else fails.
func turnstileStandIn(t *testing.T, secret string) func() {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		out := map[string]any{"success": false, "error-codes": []string{"invalid-input-response"}}
		if r.PostForm.Get("secret") == secret && strings.HasPrefix(r.PostForm.Get("response"), "good-") {
			out = map[string]any{"success": true, "action": strings.TrimPrefix(r.PostForm.Get("response"), "good-"), "hostname": "chat.example"}
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	prev := captchaVerifyURL
	captchaVerifyURL = srv.URL
	return func() {
		captchaVerifyURL = prev
		srv.Close()
	}
}

func withCaptcha(t *testing.T, ts *httptest.Server, method, path, token, captcha string, body any) (*http.Response, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if captcha != "" {
		req.Header.Set(CaptchaHeader, captcha)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func TestCaptchaGuardsAbusableActions(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice") // before captchas are on
	srv.Cfg.TurnstileSiteKey = "site-key"
	srv.Cfg.TurnstileSecretKey = "secret-key"
	defer turnstileStandIn(t, "secret-key")()

	// the public instance info says how to show it, and never gives the secret away
	res, info := do(t, ts, "GET", "/api/v1/instance", "", nil)
	captcha, _ := info["captcha"].(map[string]any)
	if res.StatusCode != 200 || captcha["provider"] != "turnstile" || captcha["site_key"] != "site-key" {
		t.Fatalf("instance: %v", info["captcha"])
	}
	if raw, _ := json.Marshal(info); bytes.Contains(raw, []byte("secret-key")) {
		t.Fatal("the secret key must never reach a browser")
	}

	// no token, a bad one, or one made for something else: refused
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/register", "", "", registerBody("bob")); res.StatusCode != 403 || errCode(body) != "captcha_required" {
		t.Errorf("register without a token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/register", "", "forged", registerBody("bob")); res.StatusCode != 403 || errCode(body) != "captcha_failed" {
		t.Errorf("register with a bad token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/register", "", "good-login", registerBody("bob")); res.StatusCode != 403 || errCode(body) != "captcha_failed" {
		t.Errorf("a token made for another action: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/register", "", "good-register", registerBody("bob")); res.StatusCode != 201 {
		t.Fatalf("register with a good token: %d %v", res.StatusCode, body)
	}

	// the other guarded actions
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/login", "", "", map[string]any{"username": "alice", "auth_key": b64(key32)}); res.StatusCode != 403 || errCode(body) != "captcha_required" {
		t.Errorf("login without a token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/login", "", "good-login", map[string]any{"username": "alice", "auth_key": b64(key32)}); res.StatusCode != 200 {
		t.Errorf("login with a good token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, "", map[string]any{"username": "bob"}); res.StatusCode != 403 || errCode(body) != "captcha_required" {
		t.Errorf("friend request without a token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, "good-friend_request", map[string]any{"username": "bob"}); res.StatusCode >= 300 {
		t.Errorf("friend request with a good token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/servers", tokA, "", map[string]any{"name": "Spam"}); res.StatusCode != 403 || errCode(body) != "captcha_required" {
		t.Errorf("server create without a token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/servers", tokA, "good-create_server", map[string]any{"name": "Fine"}); res.StatusCode != 201 {
		t.Errorf("server create with a good token: %d %v", res.StatusCode, body)
	}
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/invites/nope", tokA, "", nil); res.StatusCode != 403 || errCode(body) != "captcha_required" {
		t.Errorf("invite join without a token: %d %v", res.StatusCode, body)
	}

	// ordinary requests never ask
	if res, _ := do(t, ts, "GET", "/api/v1/users/@me", tokA, nil); res.StatusCode != 200 {
		t.Errorf("unguarded request: %d", res.StatusCode)
	}
}

func TestCaptchaUnreachableIsNotAPass(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.TurnstileSiteKey = "site-key"
	srv.Cfg.TurnstileSecretKey = "secret-key"
	prev := captchaVerifyURL
	captchaVerifyURL = "http://127.0.0.1:1/unreachable"
	defer func() { captchaVerifyURL = prev }()
	if res, body := withCaptcha(t, ts, "POST", "/api/v1/auth/register", "", "good-register", registerBody("bob")); res.StatusCode != 503 || errCode(body) != "captcha_unavailable" {
		t.Errorf("unreachable verifier: %d %v", res.StatusCode, body)
	}
}
