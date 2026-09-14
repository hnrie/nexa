// Package config loads chatd's configuration from the environment (optionally
// pre-populated from a KEY=VALUE file) with validated defaults.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config is the complete runtime configuration of chatd.
type Config struct {
	Listen    string
	PublicURL string
	DataDir   string
	WebDist   string
	// DesktopDir holds published desktop app installers and update manifests,
	// served at /desktop/. It defaults to "desktop" inside DataDir.
	DesktopDir      string
	MaxUploadBytes  int64
	MaxAvatarBytes  int64
	MaxEmojiBytes   int64
	MaxStickerBytes int64
	Registration    string // open | invite | closed
	RegistrationKey string // when Registration == "invite": a shared key accepted at register time
	AdminUsername   string
	// StunURLs are the STUN servers handed to clients. "none" in STUN_URLS
	// turns them off, which is what a LAN-only instance wants.
	StunURLs       []string
	TurnURLs       []string
	TurnUsername   string
	TurnCredential string
	// TurnKeyID and TurnAPIToken turn on Cloudflare Realtime TURN, where this
	// server mints a short-lived credential for each person who joins a call.
	// The relay is billed by the gigabyte and is only used when two people
	// cannot reach each other directly.
	TurnKeyID    string
	TurnAPIToken string
	// KlipyAPIKey enables GIF search. Without it the picker still offers
	// whatever has been favourited.
	KlipyAPIKey string
	// TurnstileSiteKey and TurnstileSecretKey turn on Cloudflare Turnstile
	// captchas for the actions bots abuse. Both are free to get; without them
	// nothing asks for a captcha.
	TurnstileSiteKey   string
	TurnstileSecretKey string
	// RealtimeAppID and RealtimeAppSecret send every call through Cloudflare
	// Realtime SFU, so nobody in a call learns another person's address.
	// Without them calls go peer to peer.
	RealtimeAppID     string
	RealtimeAppSecret string
	// RealtimeMonthlyGB is the SFU's free allowance per month. Video pauses
	// near it and calls stop just short of it, so nothing is ever billed.
	RealtimeMonthlyGB int64
	LogLevel          string
	SessionTTL        time.Duration
}

// Load builds a Config from getenv, applying defaults and validating values.
func Load(getenv func(string) string) (Config, error) {
	c := Config{
		Listen:            "127.0.0.1:8090",
		PublicURL:         "https://chat.evilion.xyz",
		DataDir:           "./data",
		WebDist:           "./web/dist",
		MaxUploadBytes:    104857600,
		MaxAvatarBytes:    10 << 20,
		MaxEmojiBytes:     2 << 20,
		MaxStickerBytes:   5 << 20,
		Registration:      "open",
		RealtimeMonthlyGB: 1000,
		LogLevel:          "info",
		SessionTTL:        90 * 24 * time.Hour,
	}
	str := func(k string, dst *string) {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			*dst = v
		}
	}
	str("LISTEN", &c.Listen)
	str("PUBLIC_URL", &c.PublicURL)
	str("DATA_DIR", &c.DataDir)
	str("WEB_DIST", &c.WebDist)
	str("DESKTOP_DIR", &c.DesktopDir)
	if c.DesktopDir == "" {
		c.DesktopDir = filepath.Join(c.DataDir, "desktop")
	}
	str("REGISTRATION", &c.Registration)
	str("REGISTRATION_KEY", &c.RegistrationKey)
	str("ADMIN_USERNAME", &c.AdminUsername)
	str("TURN_USERNAME", &c.TurnUsername)
	str("TURN_CREDENTIAL", &c.TurnCredential)
	str("TURN_KEY_ID", &c.TurnKeyID)
	str("TURN_API_TOKEN", &c.TurnAPIToken)
	str("KLIPY_API_KEY", &c.KlipyAPIKey)
	str("TURNSTILE_SITE_KEY", &c.TurnstileSiteKey)
	str("TURNSTILE_SECRET_KEY", &c.TurnstileSecretKey)
	str("REALTIME_APP_ID", &c.RealtimeAppID)
	str("REALTIME_APP_SECRET", &c.RealtimeAppSecret)
	str("LOG_LEVEL", &c.LogLevel)
	// Usernames are stored lowercase, so a name written with capitals would
	// otherwise never match the account it means.
	c.AdminUsername = strings.ToLower(c.AdminUsername)

	ints := []struct {
		k   string
		dst *int64
	}{
		{"MAX_UPLOAD_BYTES", &c.MaxUploadBytes},
		{"MAX_AVATAR_BYTES", &c.MaxAvatarBytes},
		{"MAX_EMOJI_BYTES", &c.MaxEmojiBytes},
		{"MAX_STICKER_BYTES", &c.MaxStickerBytes},
		{"REALTIME_MONTHLY_GB", &c.RealtimeMonthlyGB},
	}
	for _, kv := range ints {
		v := strings.TrimSpace(getenv(kv.k))
		if v == "" {
			continue
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return c, fmt.Errorf("%s: expected a positive integer, got %q", kv.k, v)
		}
		*kv.dst = n
	}
	if v := strings.TrimSpace(getenv("SESSION_TTL_DAYS")); v != "" {
		n, err := strconv.Atoi(v)
		// A hundred years is "forever"; much larger overflows the duration and
		// turns into a TTL that signs everyone out.
		if err != nil || n <= 0 || n > 36500 {
			return c, fmt.Errorf("SESSION_TTL_DAYS: expected 1..36500, got %q", v)
		}
		c.SessionTTL = time.Duration(n) * 24 * time.Hour
	}
	c.StunURLs = []string{"stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"}
	if v := strings.TrimSpace(getenv("STUN_URLS")); v != "" {
		c.StunURLs = nil
		if !strings.EqualFold(v, "none") {
			for _, u := range strings.Split(v, ",") {
				if u = strings.TrimSpace(u); u != "" {
					c.StunURLs = append(c.StunURLs, u)
				}
			}
		}
	}
	if v := getenv("TURN_URLS"); v != "" {
		for _, u := range strings.Split(v, ",") {
			if u = strings.TrimSpace(u); u != "" {
				c.TurnURLs = append(c.TurnURLs, u)
			}
		}
	}
	switch c.Registration {
	case "open", "invite", "closed":
	default:
		return c, fmt.Errorf("REGISTRATION: expected open|invite|closed, got %q", c.Registration)
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return c, fmt.Errorf("LOG_LEVEL: expected debug|info|warn|error, got %q", c.LogLevel)
	}
	// With one key and not the other captchas would be silently off.
	if (c.TurnstileSiteKey == "") != (c.TurnstileSecretKey == "") {
		return c, fmt.Errorf("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY: set both to turn captchas on, or neither")
	}
	// With one and not the other calls would quietly go peer to peer.
	if (c.RealtimeAppID == "") != (c.RealtimeAppSecret == "") {
		return c, fmt.Errorf("REALTIME_APP_ID and REALTIME_APP_SECRET: set both to send calls through Cloudflare Realtime, or neither")
	}
	c.PublicURL = strings.TrimRight(c.PublicURL, "/")
	if !strings.HasPrefix(c.PublicURL, "http://") && !strings.HasPrefix(c.PublicURL, "https://") {
		return c, fmt.Errorf("PUBLIC_URL: must start with http:// or https://, got %q", c.PublicURL)
	}
	return c, nil
}

// LoadEnvFile parses KEY=VALUE lines. Blank lines and # comments are skipped,
// a leading "export " is ignored, and single or double quotes around a value
// are removed.
func LoadEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	m := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
			v = v[1 : len(v)-1]
		}
		m[k] = v
	}
	return m, sc.Err()
}
