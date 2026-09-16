package db

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

// startPostgres brings up a real Postgres for the test, from the precompiled
// binaries the library downloads once and keeps in the cache. Skipped where
// there is no network to fetch them the first time.
func startPostgres(t *testing.T) string {
	t.Helper()
	if os.Getenv("SKIP_PG_TESTS") != "" {
		t.Skip("SKIP_PG_TESTS is set")
	}
	dir := filepath.Join(os.TempDir(), "chatd-pgtest")
	port := uint32(55432)
	pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Username("chat").Password("chat").Database("chat").
		Port(port).
		RuntimePath(filepath.Join(dir, "runtime")).
		DataPath(filepath.Join(dir, "data-"+t.Name())).
		BinariesPath(filepath.Join(dir, "bin")).
		StartTimeout(90 * time.Second))
	if err := pg.Start(); err != nil {
		t.Skipf("no Postgres to test against: %v", err)
	}
	t.Cleanup(func() { _ = pg.Stop() })
	return "postgres://chat:chat@127.0.0.1:55432/chat?sslmode=disable"
}

// The Postgres schema has to actually apply, with every foreign key resolving
// and every index building — the generator orders the tables itself, and a
// wrong order only shows up here.
func TestPostgresSchemaApplies(t *testing.T) {
	url := startPostgres(t)
	d, err := OpenPostgres(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	// the data directory outlives the test, so start from nothing every time
	if _, err := d.W.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	// and again: migrations are forward-only and must not re-run
	if err := d.Migrate(ctx); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	var n int
	if err := d.R.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 35 {
		t.Errorf("only %d tables made it", n)
	}
	// the placeholders the store writes have to work through the wrapper
	if _, err := d.W.ExecContext(ctx, `INSERT INTO blobs (id, sha256, size, mime, kind, created_at) VALUES (?,?,?,?,?,?)`,
		1, "abc", 10, "image/png", "avatar", 1700000000000); err != nil {
		t.Fatalf("insert through the wrapper: %v", err)
	}
	var mime string
	if err := d.R.QueryRowContext(ctx, `SELECT mime FROM blobs WHERE id = ?`, 1).Scan(&mime); err != nil || mime != "image/png" {
		t.Fatalf("read back: %v %q", err, mime)
	}
}
