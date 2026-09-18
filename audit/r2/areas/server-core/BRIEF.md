# Brief — server-core (finding prefix `SCORE`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

```
internal/store/        all 34 files (models, servers, channels, messages, keys, users,
                       sessions, relationships, expressions, guests, invites, legal,
                       locks, mfa, perms, readstates, realtime, settings, uploads,
                       blobs, instance, errors_log, store.go, the tests)
internal/db/           db.go dialect.go + migrations/*.sql + migrations-postgres/*.sql
internal/gateway/      activity.go conn.go hub.go protocol.go (+ tests)
internal/realtime/     client.go meter.go (+ tests)
internal/cache/        cache.go memory.go redis.go
internal/media/        handler.go store.go validate.go variants.go
internal/unfurl/       cache.go fetch.go guard.go players.go youtube.go
internal/voice/        registry.go        (structure and races; call semantics are `voice`'s)
internal/rpcapps/      rpcapps.go
internal/ids/          ids.go
cmd/chatmigrate/       main.go (+ tests)
deploy/                install.sh route-dns.sh xyz.evilion.chat.plist.in README.md
backup.sh  run.sh  Makefile  chatd.env.example  README.md (accuracy of what it claims)
tools/gen_pg_schema.sh  tools/pg_schema.py
```

Out of scope: `internal/api` (handlers — `server-api`), the clients.

## What this area is

The persistence and fan-out half of `chatd`. `internal/store` is the data
layer over `database/sql` with a SQLite dialect (live) and a Postgres dialect
(tested, not live), with SQL migrations kept in both dialects by hand
(`tools/gen_pg_schema.sh` regenerates the Postgres init from SQLite's).
`internal/gateway` holds every client's WebSocket, builds the `ready`
payload, fans events out to the members who may see them, tracks presence,
typing and Rich Presence activities, and enforces connection caps.
`internal/realtime` is the Cloudflare Realtime SFU client and the usage
meter that keeps calls under the free allowance. `internal/cache` abstracts
in-process vs. Redis for presence, rate limits and cross-process events.
`internal/media` stores content-addressed blobs and makes image variants;
`internal/unfurl` fetches link previews behind an SSRF guard. `chatmigrate`
copies a stopped SQLite database to Postgres and verifies hashes.

## Checklist

Data integrity:
- Every multi-statement mutation: is it in one transaction, and does the
  transaction include the reads it depends on? Check-then-act races between
  requests (two joins, two role edits, two key rotations, a kick during a
  grant). Row locking / `SELECT … FOR UPDATE` on Postgres vs. SQLite's single
  writer — are the semantics equivalent?
- Deletion cascades: server, channel, category, group, account, sticker pack,
  emoji, upload, guest link. What is left orphaned (rows, blobs on disk,
  grants, read states, pins, reactions, invites, audit entries)? Is anything
  deleted that should be kept (audit log, legal retention)?
- A failed read that looks like an empty result (round 1's group-participants
  data loss). Find every place an error is swallowed into a zero value.
- Migrations: idempotent? Ordered? Is `0011` in both dialects equivalent?
  Does a migration run inside a transaction on SQLite (DDL in SQLite is
  transactional; check `db.go`)? What happens if chatd starts on a database
  from a newer version? Foreign keys on (`PRAGMA foreign_keys`) and honoured
  by the schema? Indexes for every query that filters or sorts (read the
  queries, then the schema).
- SQLite specifics: WAL, busy timeout, single writer serialization, `_txlock`,
  journal checkpointing, the database growing without `VACUUM`; the backup
  script (`backup.sh`) — does it use the online backup API or copy live
  files? Restore path documented and tested?
- Postgres parity: every query through the dialect; placeholder rewriting;
  `RETURNING`; upserts; boolean/blob/time types; `chatmigrate` covering every
  table (compare with the schema — a new table nobody added to it is a
  silent data loss on migration).

Gateway:
- Audience of every event: who receives `message_create` in a private
  channel, `presence` for a blocked user, `typing` in a DM with someone who
  blocked you, member/role/channel updates after a permission change
  (visibility diffing), voice states across servers, activity updates
  (Rich Presence) to whom? A wrong audience here is a privacy leak — P0.
- `ready` payload: what does it contain and cost (round 1 said 30–100
  queries); could a client with many servers make it enormous; does it leak
  data the client cannot decrypt anyway?
- Connection lifecycle: heartbeat and timeout, resume semantics (the 20 s
  voice resume grace), what happens to a session revoked while connected,
  caps (32 per account, 256 per address, 4096 total, connect rate limiter —
  verify), backpressure on slow clients (a full send queue: drop, close, or
  block the hub?), goroutine and map growth (presence entries for users who
  never come back, typing timers, activities).
- Protocol: unknown ops, malformed frames, oversized frames, op flooding
  from a client, the guest ready and what a guest can send.
- Redis mode: does every path that fans out also publish to Redis, and does
  the subscriber ignore its own messages correctly; rate limits shared;
  presence expiry across processes; what happens when Redis drops.

Media and unfurl:
- Blob validation (`validate.go`): sniffing, decompression bombs (a tiny
  PNG that decodes to gigabytes), animated formats, SVG (scripts), EXIF
  stripping, dimensions caps, the variants pipeline's memory use per request
  and concurrency cap, disk-full behaviour (`api/disk.go` is theirs; the
  store's write path is yours).
- Content addressing: dedup across users — does it leak that someone else
  already uploaded a file? Reference counting and GC of unreferenced blobs.
- Unfurl guard: private and link-local ranges, IPv6, redirects that land
  inside, DNS rebinding (resolve once, dial that address), size and time
  caps, content types accepted, the YouTube and player special cases, the
  cache (poisoning, expiry, unbounded growth).

Realtime meter:
- Accounting correctness (per pull, audio vs. camera vs. screen), the 90 %
  video pause and 99 % stop, month rollover, persistence across restarts
  (`0009_realtime_usage.sql`), what happens at exactly the boundary, and
  whether a client can make the meter under-count.

Ops:
- `deploy/install.sh` idempotency and safety, the plist (working directory,
  env file, log paths, `KeepAlive`, resource limits), log rotation (does
  `logs/chatd.log` grow forever?), `run.sh`, the Makefile's guards (`make
  server` keeps `bin/chatd.prev`; `make web` sets `DEPLOY=1`), `backup.sh`
  (what it misses: the Android signing key, `chatd.env`, `data/desktop`,
  `data/android` — say what a restore from it would lack), README and
  deploy README accuracy against the code (the README still says calls are
  peer-to-peer and "no media server" — check every such claim).

Performance (from reading; profile only if cheap):
- Permission computation per request with no caching (round 1's structural
  item) — measure the query count for a message send in a server with
  overwrites; propose the cache and its invalidation.
- N+1 patterns in `ready`, member lists, message pages with reactions,
  search.

## Compare with

The handlers that call the store (`internal/api/*`) to see how each function
is used; the clients' expectations of event ordering
(`web/src/gateway/dispatch.ts`, `android/.../net/Gateway.kt`,
`android/.../data/AppState.kt`).

## Round 1

`audit/REVIEW.md`, then the store/gateway/media parts of
`audit/server-correctness.md` and `audit/performance.md`'s server section.
Verify: the gateway caps, the group-participants fix, the media proxy expiry
(`server-api` checks the handler; you check the store side), the TOTP backup
codes in `store/mfa.go`.

## Facts you would otherwise rediscover

- `chatmigrate` was dry-run on a copy of the live database: 1,743 rows, 37
  tables, all hashes matching (2026-09-16). New tables since then?
- Redis for tests is `miniredis`; Postgres for tests is
  `fergusstrange/embedded-postgres` (precompiled; never `brew install`).
- The live `logs/chatd.log` has pre-existing "sfu close session … context
  deadline exceeded" warnings; do not chase them as new.
- Every id carries `NODE_ID` (0–1023) for multi-process deployments.

## Reading order

`db/db.go`, `db/dialect.go`, the migrations in order → `store/store.go`,
`models.go` → `users.go`, `sessions.go`, `keys.go` → `servers.go`,
`channels.go`, `perms.go`, `invites.go` → `messages.go`, `readstates.go`,
`uploads.go`, `blobs.go` → `relationships.go`, `expressions.go`, `guests.go`,
`locks.go`, `mfa.go`, `settings.go`, `instance.go`, `legal.go`,
`errors_log.go`, `realtime.go` → `gateway/protocol.go`, `conn.go`, `hub.go`,
`activity.go` → `cache/*` → `media/*` → `unfurl/*` → `realtime/*` →
`voice/registry.go`, `rpcapps`, `ids` → `cmd/chatmigrate` → `deploy/`,
`backup.sh`, `Makefile`, READMEs → the tests.
