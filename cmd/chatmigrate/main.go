// Command chatmigrate copies a chatd SQLite database into Postgres.
//
// It reads every table in dependency order and writes it in batches inside one
// transaction, so either the whole database lands or none of it does. Nothing
// is interpreted on the way: ids, times, blobs and JSON columns are carried
// across exactly as they are, which is what makes the copy checkable — the row
// counts on both sides have to match, and the tool says so before it finishes.
//
//	chatmigrate --from data/chat.db --to 'postgres://user:pass@host/chat?sslmode=require'
//	chatmigrate --from data/chat.db --to '…' --wipe     # replace whatever is there
//
// Stop chatd first. A copy taken while it is running would miss whatever was
// written after the read began.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"evilion.xyz/chat/internal/db"
)

// appendOnly names the tables whose triggers refuse updates and deletes (see
// the mod_log migration). Rows go into them like any other; only a wipe has to
// empty them another way.
var appendOnly = map[string]bool{"mod_log": true}

// tableOrder lists every table in the source, ordered so that a table is
// always copied after whatever it points at. It is read from the database
// rather than written down here, so a table added later is carried across
// without anyone remembering to add it.
func tableOrder(ctx context.Context, src *db.DB) ([]string, error) {
	rows, err := src.R.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	deps := map[string][]string{}
	known := map[string]bool{}
	for _, n := range names {
		known[n] = true
	}
	for _, n := range names {
		r, err := src.R.QueryContext(ctx, `SELECT "table" FROM pragma_foreign_key_list(?)`, n)
		if err != nil {
			return nil, err
		}
		for r.Next() {
			var target string
			if err := r.Scan(&target); err != nil {
				r.Close()
				return nil, err
			}
			// a table pointing at itself is fine: the rows go in one batch
			if target != n && known[target] {
				deps[n] = append(deps[n], target)
			}
		}
		r.Close()
	}

	var out []string
	done := map[string]bool{}
	var visit func(string, map[string]bool)
	visit = func(n string, stack map[string]bool) {
		if done[n] || stack[n] {
			return
		}
		stack[n] = true
		for _, d := range deps[n] {
			visit(d, stack)
		}
		delete(stack, n)
		done[n] = true
		out = append(out, n)
	}
	for _, n := range names {
		visit(n, map[string]bool{})
	}
	return out, nil
}

func main() {
	from := flag.String("from", "data/chat.db", "the SQLite database to copy from")
	to := flag.String("to", "", "the Postgres URL to copy into")
	wipe := flag.Bool("wipe", false, "empty the Postgres tables first")
	batch := flag.Int("batch", 500, "rows per insert")
	flag.Parse()
	if *to == "" {
		fmt.Fprintln(os.Stderr, "--to is required: a postgres:// URL")
		os.Exit(2)
	}
	if err := run(*from, *to, *wipe, *batch); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run(from, to string, wipe bool, batch int) error {
	ctx := context.Background()
	src, err := db.Open(from)
	if err != nil {
		return fmt.Errorf("open %s: %w", from, err)
	}
	defer src.Close()
	dst, err := db.OpenPostgres(to)
	if err != nil {
		return fmt.Errorf("open postgres: %w", err)
	}
	defer dst.Close()

	fmt.Println("applying the schema…")
	if err := dst.Migrate(ctx); err != nil {
		return err
	}

	tables, err := tableOrder(ctx, src)
	if err != nil {
		return err
	}

	started := time.Now()
	total := 0
	err = dst.Tx(ctx, func(tx *db.Tx) error {
		if wipe {
			// in reverse, so nothing is pointed at while it is emptied
			for i := len(tables) - 1; i >= 0; i-- {
				empty := `DELETE FROM ` + tables[i]
				if appendOnly[tables[i]] {
					// its triggers refuse row deletes; replacing the whole
					// database is the one time emptying it is meant
					empty = `TRUNCATE ` + tables[i]
				}
				if _, err := tx.ExecContext(ctx, empty); err != nil {
					return fmt.Errorf("empty %s: %w", tables[i], err)
				}
			}
		}
		for _, t := range tables {
			n, err := copyTable(ctx, src, tx, t, batch)
			if err != nil {
				return fmt.Errorf("%s: %w", t, err)
			}
			total += n
			fmt.Printf("  %-20s %8d rows\n", t, n)
		}
		return nil
	})
	if err != nil {
		return err
	}

	fmt.Printf("copied %d rows in %s; checking…\n", total, time.Since(started).Round(time.Millisecond))
	if err := sameBytes(ctx, src, dst); err != nil {
		return err
	}
	for _, t := range tables {
		var a, b int64
		if err := src.R.QueryRowContext(ctx, `SELECT count(*) FROM `+t).Scan(&a); err != nil {
			return err
		}
		if err := dst.R.QueryRowContext(ctx, `SELECT count(*) FROM `+t).Scan(&b); err != nil {
			return err
		}
		if a != b {
			return fmt.Errorf("%s: %d rows in SQLite, %d in Postgres", t, a, b)
		}
	}
	fmt.Println("every table matches and every key came across unchanged.")
	fmt.Println("Point DATABASE_URL at Postgres and start chatd; the SQLite file is untouched.")
	return nil
}

// keyColumns are the values that have to survive exactly: a key or a session
// token that came across wrong would lock somebody out, and a row count would
// not notice. Each is read from both databases in the same order and hashed.
var keyColumns = []struct{ table, order, cols string }{
	{"users", "id", "kdf_salt, public_key, enc_private_key, enc_private_key_recovery, auth_hash"},
	{"key_epochs", "conv_id, epoch", "created_by, created_at"},
	{"key_grants", "conv_id, epoch, user_id", "wrapped_key"},
	{"messages", "id", "ciphertext, key_conv_id, key_epoch"},
	{"user_settings", "user_id", "blob, version"},
	{"blobs", "id", "sha256, size, mime, kind"},
	{"sessions", "id", "token_hash"},
	{"attachments", "id", "blob_id, size"},
}

// sameBytes checks that the values that matter are identical on both sides.
func sameBytes(ctx context.Context, src, dst *db.DB) error {
	for _, c := range keyColumns {
		a, err := digest(ctx, src, c.table, c.order, c.cols)
		if err != nil {
			return err
		}
		b, err := digest(ctx, dst, c.table, c.order, c.cols)
		if err != nil {
			return err
		}
		if !bytes.Equal(a, b) {
			return fmt.Errorf("%s came across changed (sqlite %x, postgres %x)", c.table, a[:8], b[:8])
		}
	}
	return nil
}

func digest(ctx context.Context, d *db.DB, table, order, cols string) ([]byte, error) {
	rows, err := d.R.QueryContext(ctx, `SELECT `+cols+` FROM `+table+` ORDER BY `+order)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", table, err)
	}
	defer rows.Close()
	names, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	for rows.Next() {
		cells := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range cells {
			ptrs[i] = &cells[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		for _, v := range cells {
			switch t := v.(type) {
			case []byte:
				h.Write(t)
			case string:
				h.Write([]byte(t))
			case nil:
				h.Write([]byte{0})
			default:
				fmt.Fprintf(h, "%v", t)
			}
			h.Write([]byte{0xff})
		}
	}
	return h.Sum(nil), rows.Err()
}

// copyTable reads one table out of SQLite and writes it into Postgres in
// batches, column for column.
func copyTable(ctx context.Context, src *db.DB, tx *db.Tx, table string, batch int) (int, error) {
	rows, err := src.R.QueryContext(ctx, `SELECT * FROM `+table)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return 0, err
	}
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = `"` + c + `"`
	}
	insertHead := `INSERT INTO ` + table + ` (` + strings.Join(quoted, ",") + `) VALUES `

	var (
		pending []any
		values  []string
		n       int
	)
	flush := func() error {
		if len(values) == 0 {
			return nil
		}
		_, err := tx.ExecContext(ctx, insertHead+strings.Join(values, ","), pending...)
		pending, values = pending[:0], values[:0]
		return err
	}
	for rows.Next() {
		cells := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range cells {
			ptrs[i] = &cells[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return n, err
		}
		marks := make([]string, len(cols))
		for i := range cols {
			marks[i] = "?"
			// A []byte scanned into an `any` may point at memory the driver
			// reuses on the next row. These are held until the batch is sent,
			// so every one is copied: without this a key or a salt would be
			// written as whatever happened to be in the buffer later, and
			// nothing would say so.
			if b, ok := cells[i].([]byte); ok {
				cp := make([]byte, len(b))
				copy(cp, b)
				pending = append(pending, cp)
			} else {
				pending = append(pending, cells[i])
			}
		}
		values = append(values, "("+strings.Join(marks, ",")+")")
		n++
		if len(values) >= batch {
			if err := flush(); err != nil {
				return n, err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return n, err
	}
	return n, flush()
}
