package db

import "testing"

func TestRebindNumbersPlaceholders(t *testing.T) {
	cases := []struct{ in, want string }{
		{"SELECT 1", "SELECT 1"},
		{"SELECT * FROM t WHERE a = ?", "SELECT * FROM t WHERE a = $1"},
		{"INSERT INTO t (a,b,c) VALUES (?,?,?)", "INSERT INTO t (a,b,c) VALUES ($1,$2,$3)"},
		{"UPDATE t SET a = ? WHERE b = ? AND c = ?", "UPDATE t SET a = $1 WHERE b = $2 AND c = $3"},
		// a question mark inside a string is part of the string
		{"SELECT * FROM t WHERE a = 'why?' AND b = ?", "SELECT * FROM t WHERE a = 'why?' AND b = $1"},
		{"SELECT 'it''s a ?' , ?", "SELECT 'it''s a ?' , $1"},
		// comments are not code: an apostrophe in one opens no string, and a
		// question mark in one is no placeholder
		{"SELECT ? -- the account's own ?\nFROM t WHERE a = ?", "SELECT $1 -- the account's own ?\nFROM t WHERE a = $2"},
		{"SELECT ? /* isn't it? */ , ?", "SELECT $1 /* isn't it? */ , $2"},
		{"SELECT ? /*/ still a comment ? */ , ?", "SELECT $1 /*/ still a comment ? */ , $2"},
		// nor is a quoted identifier
		{`SELECT "odd?name" FROM t WHERE a = ?`, `SELECT "odd?name" FROM t WHERE a = $1`},
		// a minus alone is arithmetic
		{"SELECT a - ? FROM t WHERE b = ?", "SELECT a - $1 FROM t WHERE b = $2"},
	}
	for _, c := range cases {
		if got := rebind(Postgres, c.in); got != c.want {
			t.Errorf("rebind(%q) = %q, want %q", c.in, got, c.want)
		}
		if got := rebind(SQLite, c.in); got != c.in {
			t.Errorf("sqlite must be left alone: %q became %q", c.in, got)
		}
	}
}

func TestRebindCountsPastNine(t *testing.T) {
	in := "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
	want := "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"
	if got := rebind(Postgres, in); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestJSONArrayHas(t *testing.T) {
	if got := SQLite.JSONArrayHas("m.mentions"); got != "EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?)" {
		t.Errorf("sqlite: %s", got)
	}
	if got := Postgres.JSONArrayHas("m.mentions"); got == "" || got == SQLite.JSONArrayHas("m.mentions") {
		t.Errorf("postgres needs its own form, got %s", got)
	}
	if got := SQLite.JSONArrayHasExpr("m.mention_roles", "mr.role_id"); got != "EXISTS (SELECT 1 FROM json_each(m.mention_roles) WHERE value = CAST(mr.role_id AS TEXT))" {
		t.Errorf("sqlite expr: %s", got)
	}
}
