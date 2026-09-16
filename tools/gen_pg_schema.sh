#!/bin/sh
# Regenerates the Postgres schema from the SQLite migrations, so the two cannot
# drift. Run it after adding a SQLite migration, then commit both.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/dump.go" <<'GO'
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"evilion.xyz/chat/internal/db"
)

func main() {
	dir, err := os.MkdirTemp("", "schema")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)
	d, err := db.Open(filepath.Join(dir, "chat.db"))
	if err != nil {
		panic(err)
	}
	if err := d.Migrate(context.Background()); err != nil {
		panic(err)
	}
	rows, err := d.R.QueryContext(context.Background(),
		`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
		 ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			panic(err)
		}
		fmt.Printf("%s;\n", s)
	}
	v, _ := d.Version(context.Background())
	fmt.Fprintf(os.Stderr, "%d\n", v)
}
GO
mkdir -p cmd/_schemadump
cp "$tmp/dump.go" cmd/_schemadump/main.go
version=$(go run ./cmd/_schemadump > "$tmp/sqlite.sql" 2>&1 >/dev/null; go run ./cmd/_schemadump 2>&1 >"$tmp/sqlite.sql")
rm -rf cmd/_schemadump
out=$(printf "internal/db/migrations-postgres/%04d_init.sql" "$version")
rm -f internal/db/migrations-postgres/*_init.sql
python3 tools/pg_schema.py "$tmp/sqlite.sql" > "$out"
echo "wrote $out"
