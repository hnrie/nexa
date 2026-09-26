package db

import (
	"context"
	"path/filepath"
	"testing"
)

// Accounts on the old default, where anyone could message them, move to
// friends and server members with migration 0018. A stricter choice stays.
func TestMigrationMovesTheOldDMDefault(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	// user 4 takes the column's default, which is still 'everyone'
	_, err = d.W.Exec(`
	INSERT INTO users(id,username,display_name,auth_hash,kdf_salt,kdf_params,public_key,enc_private_key,dm_privacy,created_at,updated_at) VALUES
	  (1,'a','A','h',x'00','{}',x'00',x'00','everyone',0,0),
	  (2,'b','B','h',x'00','{}',x'00',x'00','friends',0,0),
	  (3,'c','C','h',x'00','{}',x'00',x'00','nobody',0,0);
	INSERT INTO users(id,username,display_name,auth_hash,kdf_salt,kdf_params,public_key,enc_private_key,created_at,updated_at) VALUES
	  (4,'d','D','h',x'00','{}',x'00',x'00',0,0);
	-- back to how version 17 looked: undo what later migrations add
	DROP TABLE webhooks;
	ALTER TABLE messages DROP COLUMN webhook_id;
	ALTER TABLE messages DROP COLUMN plain;
	ALTER TABLE polls DROP COLUMN ended_at;
	PRAGMA user_version = 17;`)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int]string{1: "friends_servers", 2: "friends", 3: "nobody", 4: "friends_servers"} {
		var got string
		if err := d.R.QueryRow(`SELECT dm_privacy FROM users WHERE id = ?`, id).Scan(&got); err != nil || got != want {
			t.Errorf("user %d: dm_privacy %q %v, want %q", id, got, err, want)
		}
	}
}
