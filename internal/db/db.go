// Package db opens the SQLite database with the pragmas chatd relies on and
// applies the embedded, forward-only migrations.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB holds a single-connection writer pool and a multi-connection reader pool.
// SQLite allows exactly one writer at a time; funnelling all writes through one
// connection turns "database is locked" errors into ordinary queueing.
type DB struct {
	W *sql.DB
	R *sql.DB
}

// Open creates the parent directory if needed and opens the database.
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=synchronous(NORMAL)&_pragma=temp_store(MEMORY)"
	w, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	r, err := sql.Open("sqlite", dsn)
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(8)
	r.SetMaxIdleConns(8)
	if err := w.Ping(); err != nil {
		w.Close()
		r.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	return &DB{W: w, R: r}, nil
}

// Tx runs fn inside a write transaction, rolling back on error or panic.
func (d *DB) Tx(ctx context.Context, fn func(tx *sql.Tx) error) (err error) {
	tx, err := d.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Migrate applies every migration newer than PRAGMA user_version, each in its
// own transaction together with the version bump.
func (d *DB) Migrate(ctx context.Context) error {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var current int
	if err := d.W.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return err
	}
	for _, name := range names {
		numStr, _, _ := strings.Cut(name, "_")
		n, err := strconv.Atoi(numStr)
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", name)
		}
		if n <= current {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		err = d.Tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, string(body)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			_, err := tx.ExecContext(ctx, "PRAGMA user_version = "+strconv.Itoa(n))
			return err
		})
		if err != nil {
			return err
		}
		current = n
	}
	return nil
}

// Close checkpoints the WAL and closes both pools.
func (d *DB) Close() error {
	_, _ = d.W.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	rerr := d.R.Close()
	werr := d.W.Close()
	if werr != nil {
		return werr
	}
	return rerr
}
