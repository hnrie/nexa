# Brief — server-store (finding prefix `SSTORE`) — a supplement to server-core

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Why this area exists

The `server-core` audit is done (`audit/r2/areas/server-core/FINDINGS.md`,
SCORE-014…043), but its first agent's thirteen findings — written while
reading the store — never reached disk. Later agents re-derived what they
could from the handoff note and the round-1 cross-check, but nobody has
re-read the store files themselves with fresh eyes. You do that.

## Scope

```
internal/store/   every non-test .go file: blobs channels errors_log expressions guests instance
                  invites keys legal locks messages mfa models perms readstates realtime
                  relationships servers sessions settings store uploads users
internal/store/   the *_test.go files (skim, to know what is covered)
internal/db/      db.go dialect.go migrations/*.sql migrations-postgres/*.sql
```

Read `audit/r2/areas/server-core/FINDINGS.md` first (the Summary and the
titles at least) so you do not re-report SCORE-014…043; if you find more
evidence for one of them, add an "Addendum" line under your own findings
naming it rather than a duplicate.

## Checklist (from the server-core brief's "Data integrity" section)

- Every multi-statement mutation: one transaction? Includes the reads it
  depends on? Check-then-act races between requests (two joins, two role
  edits, two rotations, a kick during a grant). Row locking on Postgres vs
  SQLite's single writer — equivalent semantics? (`tx.Serialise` exists for
  some paths; which paths lack it?)
- Deletion cascades: server, channel, category, group, account, pack,
  emoji, upload, guest link — what is orphaned (rows, blobs, grants, read
  states, pins, reactions, invites, audit rows) or wrongly deleted?
- Error swallowed into a zero value (round 1's group-participants data loss
  pattern) — find every `_ =`/ignored error and every `if err != nil { return nil }`.
- Migrations: idempotent, ordered, transactional; both dialects equivalent
  (the Postgres init is generated — is anything hand-edited?); foreign keys
  on and honoured; an index for every filter/sort in the queries you read.
- SQLite specifics: busy timeout, `_txlock`, checkpointing, growth.
- Postgres parity: placeholders, `RETURNING`, upserts, types, `chatmigrate`
  covering every table.
- Query correctness: pagination cursors (ties, direction), `LIMIT` without
  `ORDER BY`, `LIKE` escaping (`%`/`_` in user input), JSON handling,
  time zones, integer overflow in counters, id ordering assumptions.
- Every `Public()`/view struct: what leaks (emails? flags? private fields?).

## Reading order

`store.go`, `models.go`, `db/db.go`, `db/dialect.go`, the migrations in
order → `users.go`, `sessions.go`, `mfa.go` → `keys.go` → `servers.go`,
`channels.go`, `perms.go`, `invites.go` → `messages.go`, `readstates.go`,
`uploads.go`, `blobs.go` → `relationships.go`, `expressions.go`,
`guests.go`, `locks.go`, `settings.go`, `instance.go`, `legal.go`,
`errors_log.go`, `realtime.go` → the tests.
