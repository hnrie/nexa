// Package config loads chatd's configuration from the environment (optionally
// pre-populated from a KEY=VALUE file) with validated defaults.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the complete runtime configuration of chatd.
type Config struct {
	Listen          string
	PublicURL       string
	DataDir         string
	WebDist         string
	MaxUploadBytes  int64
	MaxAvatarBytes  int64
	MaxEmojiBytes   int64
	MaxStickerBytes int64
	Registration    string // open | invite | closed
	RegistrationKey string // when Registration == "invite": a shared key accepted at register time
	AdminUsername   string
	TurnURLs        []string
	TurnUsername    string
	TurnCredential  string
	TenorAPIKey     string
	LogLevel        string
	SessionTTL      time.Duration
}

// Load builds a Config from getenv, applying defaults and validating values.
func Load(getenv func(string) string) (Config, error) {
	c := Config{
		Listen:          "127.0.0.1:8090",
		PublicURL:       "https://chat.evilion.xyz",
		DataDir:         "./data",
		WebDist:         "./web/dist",
		MaxUploadBytes:  104857600,
		MaxAvatarBytes:  10 << 20,
		MaxEmojiBytes:   2 << 20,
		MaxStickerBytes: 5 << 20,
		Registration:    "open",
		LogLevel:        "info",
		SessionTTL:      90 * 24 * time.Hour,
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
	str("REGISTRATION", &c.Registration)
	str("REGISTRATION_KEY", &c.RegistrationKey)
	str("ADMIN_USERNAME", &c.AdminUsername)
	str("TURN_USERNAME", &c.TurnUsername)
	str("TURN_CREDENTIAL", &c.TurnCredential)
	str("TENOR_API_KEY", &c.TenorAPIKey)
	str("LOG_LEVEL", &c.LogLevel)

	ints := []struct {
		k   string
		dst *int64
	}{
		{"MAX_UPLOAD_BYTES", &c.MaxUploadBytes},
		{"MAX_AVATAR_BYTES", &c.MaxAvatarBytes},
		{"MAX_EMOJI_BYTES", &c.MaxEmojiBytes},
		{"MAX_STICKER_BYTES", &c.MaxStickerBytes},
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
		if err != nil || n <= 0 {
			return c, fmt.Errorf("SESSION_TTL_DAYS: expected a positive integer, got %q", v)
		}
		c.SessionTTL = time.Duration(n) * 24 * time.Hour
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
