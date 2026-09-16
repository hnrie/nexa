package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

var schemaSeq atomic.Int64

// newStore opens a database for one test. With CHAT_TEST_POSTGRES set to a
// Postgres URL the whole suite runs there instead, each test in a schema of
// its own, which is how the two dialects are kept honest with each other.
func newStore(t *testing.T) *Store {
	t.Helper()
	if url := os.Getenv("CHAT_TEST_POSTGRES"); url != "" {
		return newPostgresStore(t, url)
	}
	d, err := db.Open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return New(d)
}

func newPostgresStore(t *testing.T, url string) *Store {
	t.Helper()
	name := fmt.Sprintf("t%d", schemaSeq.Add(1))
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	admin, err := db.OpenPostgres(url)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := admin.W.ExecContext(ctx, `DROP SCHEMA IF EXISTS `+name+` CASCADE`); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.W.ExecContext(ctx, `CREATE SCHEMA `+name); err != nil {
		t.Fatal(err)
	}
	admin.Close()
	d, err := db.OpenPostgres(url + sep + "search_path=" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return New(d)
}

func ptr[T any](v T) *T { return &v }

func mkUser(t *testing.T, s *Store, username string) *User {
	t.Helper()
	u := &User{Username: username, DisplayName: username, AuthHash: "h", KDFSalt: []byte{1, 2}, KDFParams: `{"m":65536,"t":3,"p":1,"v":1}`, PublicKey: make([]byte, 32), EncPrivateKey: []byte{9}}
	if err := s.CreateUser(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return u
}

var _ = ids.New
