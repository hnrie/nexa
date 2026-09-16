// Package db opens the database chatd runs on — SQLite by default, Postgres
// when one is configured — with the settings each needs, and applies the
// embedded, forward-only migrations.
package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

//go:embed migrations-postgres/*.sql
var pgMigrations embed.FS

// DB holds a writer pool and a reader pool.
//
// SQLite allows exactly one writer at a time; funnelling all writes through one
// connection turns "database is locked" errors into ordinary queueing. Postgres
// has no such limit, so its writer pool is as wide as its readers, and the split
// stays only because it lets a replica serve the reads later.
type DB struct {
	W *Conn
	R *Conn
	// Dialect says which database is behind the pools, for the handful of
	// queries that cannot be written the same way for both.
	Dialect Dialect
}

// Open opens SQLite at path, creating the parent directory if needed.
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
	return &DB{W: newConn(w, SQLite), R: newConn(r, SQLite), Dialect: SQLite}, nil
}

// OpenPostgres opens a Postgres database from a URL
// (postgres://user:pass@host:5432/chat?sslmode=require).
func OpenPostgres(url string) (*DB, error) {
	w, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(16)
	w.SetMaxIdleConns(8)
	r, err := sql.Open("pgx", url)
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(16)
	r.SetMaxIdleConns(8)
	if err := w.Ping(); err != nil {
		w.Close()
		r.Close()
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	return &DB{W: newConn(w, Postgres), R: newConn(r, Postgres), Dialect: Postgres}, nil
}

// OpenURL picks the engine from the address: a postgres:// URL, or a file path.
func OpenURL(addr string) (*DB, error) {
	if strings.HasPrefix(addr, "postgres://") || strings.HasPrefix(addr, "postgresql://") {
		return OpenPostgres(addr)
	}
	return Open(addr)
}

// Tx runs fn inside a write transaction, rolling back on error or panic. The
// transaction it hands over rebinds placeholders exactly as the pools do, so a
// query written once works inside a transaction as well as outside one.
func (d *DB) Tx(ctx context.Context, fn func(tx *Tx) error) (err error) {
	raw, err := d.W.sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = raw.Rollback()
			panic(p)
		}
		if err != nil {
			_ = raw.Rollback()
		}
	}()
	if err = fn(&Tx{tx: raw, dialect: d.Dialect}); err != nil {
		return err
	}
	return raw.Commit()
}

// Version is the schema version the database is at.
func (d *DB) Version(ctx context.Context) (int, error) {
	if d.Dialect == Postgres {
		if _, err := d.W.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
			return 0, err
		}
		var v sql.NullInt64
		if err := d.W.QueryRowContext(ctx, `SELECT max(version) FROM schema_version`).Scan(&v); err != nil {
			return 0, err
		}
		return int(v.Int64), nil
	}
	var current int
	err := d.W.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current)
	return current, err
}

// Migrate applies every migration newer than the schema version, each in its
// own transaction together with the version bump.
func (d *DB) Migrate(ctx context.Context) error {
	dir, set := "migrations", migrations
	if d.Dialect == Postgres {
		dir, set = "migrations-postgres", pgMigrations
	}
	entries, err := fs.ReadDir(set, dir)
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
	current, err := d.Version(ctx)
	if err != nil {
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
		body, err := set.ReadFile(dir + "/" + name)
		if err != nil {
			return err
		}
		err = d.Tx(ctx, func(tx *Tx) error {
			if _, err := tx.ExecContext(ctx, string(body)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			if d.Dialect == Postgres {
				_, err := tx.ExecContext(ctx, `INSERT INTO schema_version (version) VALUES ($1)`, n)
				return err
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

// Close checkpoints SQLite's WAL and closes both pools.
func (d *DB) Close() error {
	if d.Dialect == SQLite {
		_, _ = d.W.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	}
	rerr := d.R.Close()
	werr := d.W.Close()
	if werr != nil {
		return werr
	}
	return rerr
}

// ErrNoMigrations is returned when a Postgres database has no schema yet and
// none is embedded, which only happens in a broken build.
var ErrNoMigrations = errors.New("no migrations for this dialect")
