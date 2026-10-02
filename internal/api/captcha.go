package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
)

// Captchas guard the actions a bot would abuse: creating accounts, guessing
// passwords, recovering accounts, friend request spam, joining servers en
// masse and creating them. They use Cloudflare Turnstile, which is free and
// usually never shows a person anything; it only asks for a click when it is
// unsure. Nothing asks for one until both keys are configured.

// CaptchaHeader carries the Turnstile token for the one request it was made for.
const CaptchaHeader = "X-Captcha-Token"

var captchaClient = &http.Client{Timeout: 8 * time.Second}

// captchaVerifyURL is where tokens are checked; tests point it at a stand-in.
var captchaVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

func (s *Server) captchaEnabled() bool {
	return s.Cfg.TurnstileSiteKey != "" && s.Cfg.TurnstileSecretKey != ""
}

// requireCaptcha checks the token sent with a request, made for `action`. It
// writes the error itself and reports whether the request may go on.
func (s *Server) requireCaptcha(w http.ResponseWriter, r *http.Request, action string) bool {
	if !s.captchaEnabled() {
		return true
	}
	token := strings.TrimSpace(r.Header.Get(CaptchaHeader))
	if token == "" || len(token) > 2048 {
		WriteError(w, E(http.StatusForbidden, "captcha_required", "Please complete the captcha."))
		return false
	}
	unavailable := func() bool {
		WriteError(w, E(http.StatusServiceUnavailable, "captcha_unavailable", "The captcha could not be checked just now. Try again in a moment."))
		return false
	}
	form := url.Values{"secret": {s.Cfg.TurnstileSecretKey}, "response": {token}, "remoteip": {auth.ClientIP(r)}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, captchaVerifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return unavailable()
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := captchaClient.Do(req)
	if err != nil {
		return unavailable()
	}
	defer res.Body.Close()
	var out struct {
		Success  bool   `json:"success"`
		Action   string `json:"action"`
		Hostname string `json:"hostname"`
		Metadata struct {
			// Cloudflare's test secret keys pass every token, for no action on
			// example.com, and say so here. A real secret never answers this.
			Testing bool `json:"result_with_testing_key"`
		} `json:"metadata"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out) != nil {
		return unavailable()
	}
	// A token counts only for the action it was solved for, and only when it
	// was solved on this site: one made for a friend request, or on a page
	// someone else put the widget on, does not sign anybody in.
	if !out.Success || (!out.Metadata.Testing && (out.Action != action || !s.captchaSite(out.Hostname))) {
		WriteError(w, E(http.StatusForbidden, "captcha_failed", "The captcha check failed. Please try again."))
		return false
	}
	return true
}

// captchaSite reports whether Cloudflare saw the captcha solved on one of
// this Nexa's own hostnames (PUBLIC_URL, ALT_URLS and MOVED_FROM).
func (s *Server) captchaSite(hostname string) bool {
	for _, h := range s.ourHostnames() {
		if strings.EqualFold(hostname, h) {
			return true
		}
	}
	return false
}
