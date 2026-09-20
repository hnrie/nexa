package api

import (
	"os"
	"testing"
)

// TestTelegramImportLive imports a real public set through the real Bot API.
// It only runs with TELEGRAM_LIVE_TOKEN set, so normal test runs (and CI)
// never touch the network.
func TestTelegramImportLive(t *testing.T) {
	token := os.Getenv("TELEGRAM_LIVE_TOKEN")
	if token == "" {
		t.Skip("set TELEGRAM_LIVE_TOKEN to run against the real Bot API")
	}
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	srv.Cfg.TelegramBotToken = token
	res, body := do(t, ts, "POST", "/api/v1/stickers/packs/import/telegram", tokA, map[string]any{"url": "https://t.me/addstickers/dennicat"})
	if res.StatusCode != 201 {
		t.Fatalf("import: %d %v", res.StatusCode, body)
	}
	total := body["total"].(float64)
	t.Logf("dennicat: imported=%v skipped=%v failed=%v total=%v", body["imported"], body["skipped"], body["failed"], total)
	if total < 100 || body["imported"] != total || body["failed"] != float64(0) || body["skipped"] != float64(0) {
		t.Fatalf("counts: %v", body)
	}
	pack := body["pack"].(map[string]any)
	if len(pack["stickers"].([]any)) != int(total) {
		t.Fatalf("pack stickers: %d", len(pack["stickers"].([]any)))
	}
}
