package main

// Builds a fresh SQLite database from the migrations and prints its schema, so
// the Postgres one can be generated from exactly what SQLite ends up with.

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
		`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var t, n, s string
		if err := rows.Scan(&t, &n, &s); err != nil {
			panic(err)
		}
		fmt.Printf("%s;\n", s)
	}
	v, _ := d.Version(context.Background())
	fmt.Fprintf(os.Stderr, "version=%d\n", v)
}
