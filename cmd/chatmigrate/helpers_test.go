package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"evilion.xyz/chat/internal/db"
)

// srcPath is where a test database lives, so run() can open it by name.
var srcPaths = map[*db.DB]string{}

func srcPath(t *testing.T, d *db.DB) string {
	t.Helper()
	if p, ok := srcPaths[d]; ok {
		return p
	}
	t.Fatal("no path recorded for this database")
	return ""
}

func testPostgres(t *testing.T) string {
	t.Helper()
	if os.Getenv("SKIP_PG_TESTS") != "" {
		t.Skip("SKIP_PG_TESTS is set")
	}
	if url := os.Getenv("CHAT_TEST_POSTGRES"); url != "" {
		return url
	}
	dir := filepath.Join(os.TempDir(), "chatd-pgtest")
	pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Username("chat").Password("chat").Database("chatmigrate").Port(55433).
		RuntimePath(filepath.Join(dir, "runtime-migrate")).
		DataPath(filepath.Join(dir, "data-migrate")).
		BinariesPath(filepath.Join(dir, "bin")).
		StartTimeout(90 * time.Second))
	if err := pg.Start(); err != nil {
		t.Skipf("no Postgres to test against: %v", err)
	}
	t.Cleanup(func() { _ = pg.Stop() })
	return "postgres://chat:chat@127.0.0.1:55433/chatmigrate?sslmode=disable"
}
