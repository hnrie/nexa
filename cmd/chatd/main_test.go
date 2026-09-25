package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

func TestLoadOrCreateSecret(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.secret")
	first, err := loadOrCreateSecret(path, nil)
	if err != nil || len(first) != 32 {
		t.Fatalf("create: %v %d", err, len(first))
	}
	again, err := loadOrCreateSecret(path, nil)
	if err != nil || !bytes.Equal(first, again) {
		t.Fatalf("reload changed the secret: %v", err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file left behind: %v", err)
	}

	// a truncated secret is kept for the operator to restore, not replaced
	if err := os.WriteFile(path, first[:10], 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreateSecret(path, nil); err == nil {
		t.Error("a short secret should stop startup")
	}
	if b, _ := os.ReadFile(path); !bytes.Equal(b, first[:10]) {
		t.Error("a short secret was overwritten")
	}

	// neither is one that exists but cannot be read
	unreadable := filepath.Join(dir, "dir.secret")
	if err := os.Mkdir(unreadable, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreateSecret(unreadable, nil); err == nil {
		t.Error("an unreadable secret should stop startup")
	}
}

// A database restored without its secret must not come up with a new one: the
// accounts with two-factor sign-in on could never sign in again. With nothing
// sealed yet, a missing secret is simply a first start.
func TestLoadOrCreateSecretRefusesARestoreWithoutIt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.secret")
	if _, err := loadOrCreateSecret(path, func() (int, error) { return 2, nil }); err == nil || !strings.Contains(err.Error(), "backup") {
		t.Fatalf("want a refusal that points at the backup, got %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("no secret should have been written: %v", err)
	}
	if _, err := loadOrCreateSecret(path, func() (int, error) { return 0, errors.New("disk on fire") }); err == nil {
		t.Fatal("a database that cannot answer should stop startup too")
	}
	if b, err := loadOrCreateSecret(path, func() (int, error) { return 0, nil }); err != nil || len(b) != 32 {
		t.Fatalf("first start: %v", err)
	}
	// once it exists it is read, whatever depends on it
	if _, err := loadOrCreateSecret(path, func() (int, error) { return 5, nil }); err != nil {
		t.Fatalf("an existing secret must load: %v", err)
	}

	// and what is counted is the accounts with a second factor on
	d, err := db.Open(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	u := &store.User{Username: "a", DisplayName: "a", AuthHash: "h", KDFSalt: []byte{1}, KDFParams: `{}`, PublicKey: make([]byte, 32), EncPrivateKey: []byte{1}}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if n, err := st.CountTwoFactorAccounts(ctx); err != nil || n != 0 {
		t.Fatalf("count before: %d %v", n, err)
	}
	if err := st.EnableTOTP(ctx, u.ID, []byte("sealed"), 1); err != nil {
		t.Fatal(err)
	}
	if n, err := st.CountTwoFactorAccounts(ctx); err != nil || n != 1 {
		t.Fatalf("count after: %d %v", n, err)
	}
}

// Several chatd processes are not one instance; a configuration that asks for
// a second one is told so at startup.
func TestProcessWarning(t *testing.T) {
	if w := processWarning(config.Config{}); w != "" {
		t.Errorf("one process, nothing to say: %q", w)
	}
	if w := processWarning(config.Config{RedisURL: "redis://x"}); w != "" {
		t.Errorf("Redis alone only shares rate limits, which is fine: %q", w)
	}
	for _, c := range []config.Config{{NodeID: 3}, {NodeID: 3, RedisURL: "redis://x"}} {
		if w := processWarning(c); !strings.Contains(w, "one process") {
			t.Errorf("%+v: want the one-process warning, got %q", c, w)
		}
	}
}

func TestSweepTemp(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	u := &store.User{Username: "a", DisplayName: "a", AuthHash: "h", KDFSalt: []byte{1}, KDFParams: `{}`, PublicKey: make([]byte, 32), EncPrivateKey: []byte{1}}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	up, err := st.CreateUpload(ctx, u.ID, 10)
	if err != nil {
		t.Fatal(err)
	}

	media := filepath.Join(dir, "media")
	now := time.Now()
	old := now.Add(-48 * time.Hour)
	file := func(rel string, mtime time.Time) string {
		p := filepath.Join(media, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, mtime, mtime); err != nil {
			t.Fatal(err)
		}
		return p
	}
	gone := []string{
		file("tmp/upload-old", old),
		file("tmp/resume-"+ids.New().String(), old), // its upload row is gone
		file("variants/ab/.variant-old", old),
	}
	kept := []string{
		file("tmp/upload-fresh", now),               // a request still writing it
		file("tmp/resume-"+up.ID.String(), old),     // its upload can still be finished
		file("tmp/resume-"+ids.New().String(), now), // too recent to judge
		file("variants/ab/.variant-fresh", now),     // being encoded
		file("variants/ab/0123-64.jpg", old),        // a finished variant
		file("tmp/other", old),                      // not ours to remove
	}
	if n := sweepTemp(ctx, st, media, now); n != len(gone) {
		t.Errorf("removed %d, want %d", n, len(gone))
	}
	for _, p := range gone {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s should be removed", p)
		}
	}
	for _, p := range kept {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should be kept: %v", p, err)
		}
	}
}
