#!/bin/sh
# Prints the whole Postgres schema the SQLite migrations add up to, for
# checking a new Postgres migration against: compare its output before and
# after the SQLite migration, and write the difference as
# internal/db/migrations-postgres/NNNN_<name>.sql with the same number.
#
# It used to replace the Postgres baseline outright. A database already at the
# baseline's version never runs a replacement again, and one at an older
# version would run a whole schema over tables it already has, so the baseline
# (0013_init.sql) now stays as it is and later versions go beside it.
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
python3 tools/pg_schema.py "$tmp/sqlite.sql"
echo "-- the SQLite schema is at version $version" >&2
