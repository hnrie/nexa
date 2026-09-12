package db

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

var allTables = []string{"blobs", "users", "sessions", "user_settings", "relationships", "servers", "server_members", "roles", "member_roles", "channels", "channel_overwrites", "dm_participants", "messages", "attachments", "reactions", "pins", "read_states", "invites", "bans", "audit_log", "emojis", "sticker_packs", "stickers", "sticker_installs", "key_epochs", "key_grants", "key_flags", "polls", "poll_votes", "instance_settings"}

func TestOpenMigrateIdempotent(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "chat.db")
	d, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(ctx); err != nil {
		t.Fatal("second migrate:", err)
	}
	var v int
	if err := d.R.QueryRow("PRAGMA user_version").Scan(&v); err != nil || v < 1 {
		t.Errorf("user_version = %d (%v)", v, err)
	}
	var mode string
	d.R.QueryRow("PRAGMA journal_mode").Scan(&mode)
	if mode != "wal" {
		t.Errorf("journal_mode = %s", mode)
	}
	var fk int
	d.W.QueryRow("PRAGMA foreign_keys").Scan(&fk)
	if fk != 1 {
		t.Error("foreign keys off on writer")
	}
	d.R.QueryRow("PRAGMA foreign_keys").Scan(&fk)
	if fk != 1 {
		t.Error("foreign keys off on reader")
	}
	for _, tbl := range allTables {
		var n int
		if err := d.R.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", tbl).Scan(&n); err != nil || n != 1 {
			t.Errorf("table %s missing", tbl)
		}
	}
}

func TestTxRollbackAndForeignKeys(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	err = d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec("INSERT INTO blobs(id,sha256,size,mime,kind,encrypted,ref_count,created_at) VALUES(1,'a',1,'x','avatar',0,1,0)"); err != nil {
			return err
		}
		return errors.New("boom")
	})
	if err == nil || err.Error() != "boom" {
		t.Fatalf("expected boom, got %v", err)
	}
	var n int
	d.R.QueryRow("SELECT count(*) FROM blobs").Scan(&n)
	if n != 0 {
		t.Error("rollback failed")
	}
	// A session for a user that does not exist must be refused by the FK.
	_, err = d.W.Exec("INSERT INTO sessions(id,user_id,token_hash,created_at,last_seen_at) VALUES(1,999,'h',0,0)")
	if err == nil {
		t.Error("foreign key constraint not enforced")
	}
	// Multi-statement exec works (migrations depend on it) and cascades delete.
	_, err = d.W.Exec(`INSERT INTO users(id,username,display_name,auth_hash,kdf_salt,kdf_params,public_key,enc_private_key,created_at,updated_at) VALUES(5,'u','U','h',x'00','{}',x'00',x'00',0,0);
	INSERT INTO sessions(id,user_id,token_hash,created_at,last_seen_at) VALUES(2,5,'h2',0,0);`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.W.Exec("DELETE FROM users WHERE id=5"); err != nil {
		t.Fatal(err)
	}
	d.R.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 0 {
		t.Error("cascade delete of sessions failed")
	}
}
