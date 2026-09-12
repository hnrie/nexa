package store

import (
	"context"
	"path/filepath"
	"testing"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

func newStore(t *testing.T) *Store {
	t.Helper()
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
