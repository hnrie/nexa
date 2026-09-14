package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	c, err := Load(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != "127.0.0.1:8090" {
		t.Errorf("Listen = %q", c.Listen)
	}
	if c.PublicURL != "https://chat.evilion.xyz" {
		t.Errorf("PublicURL = %q", c.PublicURL)
	}
	if c.MaxUploadBytes != 104857600 {
		t.Errorf("MaxUploadBytes = %d", c.MaxUploadBytes)
	}
	if c.Registration != "open" {
		t.Errorf("Registration = %q", c.Registration)
	}
	if c.SessionTTL != 90*24*time.Hour {
		t.Errorf("SessionTTL = %v", c.SessionTTL)
	}
	if c.RealtimeMonthlyGB != 1000 || c.RealtimeAppID != "" {
		t.Errorf("Realtime defaults: %d %q", c.RealtimeMonthlyGB, c.RealtimeAppID)
	}
	if c.DesktopDir != filepath.Join("data", "desktop") {
		t.Errorf("DesktopDir = %q", c.DesktopDir)
	}
	// the desktop releases follow the data folder unless given a folder of their own
	moved, err := Load(func(k string) string { return map[string]string{"DATA_DIR": "/srv/chat"}[k] })
	if err != nil || moved.DesktopDir != filepath.Join("/srv/chat", "desktop") {
		t.Errorf("DesktopDir with DATA_DIR: %v %q", err, moved.DesktopDir)
	}
	own, err := Load(func(k string) string {
		return map[string]string{"DATA_DIR": "/srv/chat", "DESKTOP_DIR": "/srv/releases"}[k]
	})
	if err != nil || own.DesktopDir != "/srv/releases" {
		t.Errorf("DESKTOP_DIR: %v %q", err, own.DesktopDir)
	}
	both, err := Load(func(k string) string {
		return map[string]string{"REALTIME_APP_ID": "app", "REALTIME_APP_SECRET": "secret", "REALTIME_MONTHLY_GB": "250"}[k]
	})
	if err != nil || both.RealtimeAppID != "app" || both.RealtimeAppSecret != "secret" || both.RealtimeMonthlyGB != 250 {
		t.Errorf("Realtime keys together: %v %+v", err, both)
	}
}

func TestLoadOverridesAndValidation(t *testing.T) {
	env := map[string]string{"LISTEN": "127.0.0.1:9000", "MAX_UPLOAD_BYTES": "10", "REGISTRATION": "invite", "TURN_URLS": "turn:a:3478, turns:b:5349", "PUBLIC_URL": "http://localhost:8090/", "ADMIN_USERNAME": " Boss ", "SESSION_TTL_DAYS": "36500"}
	c, err := Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != "127.0.0.1:9000" || c.MaxUploadBytes != 10 || c.Registration != "invite" {
		t.Errorf("overrides not applied: %+v", c)
	}
	if len(c.TurnURLs) != 2 || c.TurnURLs[1] != "turns:b:5349" {
		t.Errorf("TurnURLs = %v", c.TurnURLs)
	}
	if c.AdminUsername != "boss" {
		t.Errorf("AdminUsername not lowercased: %q", c.AdminUsername)
	}
	if c.SessionTTL != 36500*24*time.Hour {
		t.Errorf("SessionTTL = %v", c.SessionTTL)
	}
	if c.PublicURL != "http://localhost:8090" {
		t.Errorf("PublicURL trailing slash kept: %q", c.PublicURL)
	}
	// half a captcha setup is refused rather than quietly leaving captchas off
	bad := map[string]string{"REGISTRATION": "sometimes", "MAX_UPLOAD_BYTES": "abc", "SESSION_TTL_DAYS": "999999", "PUBLIC_URL": "chat.example", "LOG_LEVEL": "loud", "TURNSTILE_SITE_KEY": "site", "TURNSTILE_SECRET_KEY": "secret", "REALTIME_APP_ID": "app", "REALTIME_APP_SECRET": "secret", "REALTIME_MONTHLY_GB": "0"}
	for k, v := range bad {
		_, err := Load(func(kk string) string {
			if kk == k {
				return v
			}
			return ""
		})
		if err == nil {
			t.Errorf("expected error for %s=%s", k, v)
		}
	}
}

func TestLoadEnvFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "chatd.env")
	if err := os.WriteFile(p, []byte("# comment\nLISTEN=127.0.0.1:1\n\nPUBLIC_URL = \"http://x\"\nexport KLIPY_API_KEY='k'\nnoequals\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := LoadEnvFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if m["LISTEN"] != "127.0.0.1:1" || m["PUBLIC_URL"] != "http://x" || m["KLIPY_API_KEY"] != "k" {
		t.Errorf("parsed %v", m)
	}
	if _, ok := m["noequals"]; ok {
		t.Error("line without = should be skipped")
	}
	if _, err := LoadEnvFile(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Error("missing file should error")
	}
}
