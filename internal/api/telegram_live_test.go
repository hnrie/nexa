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
	res, lines := postImport(t, ts, tokA, "https://t.me/addstickers/dennicat")
	if res.StatusCode != 201 {
		t.Fatalf("import: %d %v", res.StatusCode, lines)
	}
	final := lines[len(lines)-1]
	total := final["total"].(float64)
	t.Logf("dennicat: imported=%v skipped=%v failed=%v total=%v", final["imported"], final["skipped"], final["failed"], total)
	if total < 100 || final["imported"] != total || final["failed"] != float64(0) || final["skipped"] != float64(0) {
		t.Fatalf("counts: %v", final)
	}
	pack := final["pack"].(map[string]any)
	if len(pack["stickers"].([]any)) != int(total) {
		t.Fatalf("pack stickers: %d", len(pack["stickers"].([]any)))
	}
}
