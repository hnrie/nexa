package main

import (
	"context"
	"path/filepath"
	"testing"

	"evilion.xyz/chat/internal/db"
)

func schemaDB(t *testing.T) *db.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "chat.db")
	d, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	srcPaths[d] = path
	t.Cleanup(func() { d.Close() })
	if err := d.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return d
}

// The order is worked out from the schema, so every table comes after whatever
// it points at. Getting this wrong would fail the copy halfway through.
func TestCopyOrderRespectsForeignKeys(t *testing.T) {
	d := schemaDB(t)
	ctx := context.Background()
	order, err := tableOrder(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	at := map[string]int{}
	for i, n := range order {
		at[n] = i
	}
	var count int
	if err := d.R.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if len(order) != count {
		t.Fatalf("the order has %d tables, the schema has %d", len(order), count)
	}
	for _, table := range order {
		rows, err := d.R.QueryContext(ctx, `SELECT "table" FROM pragma_foreign_key_list(?)`, table)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var target string
			if err := rows.Scan(&target); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			if target == table {
				continue
			}
			if to, ok := at[target]; ok && to > at[table] {
				t.Errorf("%s is copied before %s, which it points at", table, target)
			}
		}
		rows.Close()
	}
}

// The whole point is that nothing is left behind, so the copy has to carry
// every row of every table across and say so.
func TestCopiesEveryRow(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a Postgres")
	}
	url := testPostgres(t)
	src := schemaDB(t)
	ctx := context.Background()
	// something in a few tables, including blobs users point at
	if _, err := src.W.ExecContext(ctx, `INSERT INTO blobs (id, sha256, size, mime, kind, created_at) VALUES (1,'a',1,'image/png','avatar',1), (2,'b',2,'image/png','icon',2)`); err != nil {
		t.Fatal(err)
	}
	if _, err := src.W.ExecContext(ctx, `INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_params, public_key, enc_private_key, avatar_id, created_at, updated_at)
		VALUES (10,'a','A','h',x'0102','{}',x'03',x'04',1,1,1), (11,'b','B','h',x'0506','{}',x'07',x'08',NULL,2,2)`); err != nil {
		t.Fatal(err)
	}
	if err := run(srcPath(t, src), url, true, 2); err != nil {
		t.Fatal(err)
	}
	dst, err := db.OpenPostgres(url)
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	var users int
	if err := dst.R.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 2 {
		t.Errorf("users copied: %d", users)
	}
	// the bytes have to survive exactly, or keys stop unwrapping
	var salt []byte
	if err := dst.R.QueryRowContext(ctx, `SELECT kdf_salt FROM users WHERE id = 10`).Scan(&salt); err != nil {
		t.Fatal(err)
	}
	if len(salt) != 2 || salt[0] != 1 || salt[1] != 2 {
		t.Errorf("kdf_salt came across as %v", salt)
	}
	var avatar *int64
	if err := dst.R.QueryRowContext(ctx, `SELECT avatar_id FROM users WHERE id = 11`).Scan(&avatar); err != nil {
		t.Fatal(err)
	}
	if avatar != nil {
		t.Errorf("a NULL came across as %v", *avatar)
	}
}

// The bytes that matter are held until a batch is sent, and a []byte scanned
// into an `any` points at memory the driver reuses. Without a copy the second
// row of a batch would carry the first row's key.
func TestKeysSurviveBatching(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a Postgres")
	}
	url := testPostgres(t)
	src := schemaDB(t)
	ctx := context.Background()
	for i := 1; i <= 6; i++ {
		// each user's key material is different, and long enough to notice
		key := make([]byte, 32)
		for j := range key {
			key[j] = byte(i)
		}
		if _, err := src.W.ExecContext(ctx, `INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_params, public_key, enc_private_key, created_at, updated_at)
			VALUES (?,?,?,?,?,'{}',?,?,?,?)`, i, string(rune('a'+i-1)), "U", "h", key, key, key, i, i); err != nil {
			t.Fatal(err)
		}
	}
	// a batch smaller than the number of rows, so the buffer is reused
	if err := run(srcPath(t, src), url, true, 2); err != nil {
		t.Fatal(err)
	}
	dst, err := db.OpenPostgres(url)
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	for i := 1; i <= 6; i++ {
		var got []byte
		if err := dst.R.QueryRowContext(ctx, `SELECT enc_private_key FROM users WHERE id = ?`, i).Scan(&got); err != nil {
			t.Fatal(err)
		}
		for _, b := range got {
			if b != byte(i) {
				t.Fatalf("user %d's key came across as %x", i, got)
			}
		}
		if len(got) != 32 {
			t.Fatalf("user %d's key is %d bytes", i, len(got))
		}
	}
}
