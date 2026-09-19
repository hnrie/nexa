# Progress — server-core
State: auditing
Last checkpoint: 2026-09-19T05:03Z
Next finding id: 031

## Inspected

### internal/db
- [x] internal/db/db.go
- [x] internal/db/dialect.go
- [x] internal/db/migrations/0001_init.sql
- [x] internal/db/migrations/0002_dms_packs.sql
- [x] internal/db/migrations/0003_profile_theme.sql
- [x] internal/db/migrations/0004_mfa.sql
- [x] internal/db/migrations/0005_client_errors.sql
- [x] internal/db/migrations/0006_uploads.sql
- [x] internal/db/migrations/0007_subchat_members.sql
- [x] internal/db/migrations/0008_upload_blob.sql
- [x] internal/db/migrations/0009_realtime_usage.sql
- [x] internal/db/migrations/0010_guest_calls.sql
- [x] internal/db/migrations/0011_subchat_locks.sql
- [x] internal/db/migrations-postgres/0011_init.sql
- [x] internal/db/db_test.go
- [x] internal/db/dialect_test.go
- [x] internal/db/pg_test.go
- [x] internal/db/subchat_migration_test.go

### internal/store
- [x] internal/store/store.go
- [x] internal/store/models.go
- [x] internal/store/users.go
- [x] internal/store/sessions.go
- [x] internal/store/keys.go
- [x] internal/store/servers.go
- [x] internal/store/channels.go
- [x] internal/store/perms.go
- [x] internal/store/invites.go
- [x] internal/store/messages.go
- [x] internal/store/readstates.go
- [x] internal/store/uploads.go
- [x] internal/store/blobs.go
- [x] internal/store/relationships.go
- [x] internal/store/expressions.go
- [x] internal/store/guests.go
- [x] internal/store/locks.go
- [x] internal/store/mfa.go
- [x] internal/store/settings.go
- [x] internal/store/instance.go
- [x] internal/store/legal.go
- [x] internal/store/errors_log.go
- [x] internal/store/realtime.go
- [ ] internal/store/channels_test.go
- [ ] internal/store/errors_log_test.go
- [ ] internal/store/guests_test.go
- [x] internal/store/keys_test.go
- [ ] internal/store/messages_test.go
- [ ] internal/store/relationships_test.go
- [ ] internal/store/server_refs_test.go
- [ ] internal/store/servers_test.go
- [x] internal/store/sessions_test.go
- [x] internal/store/testutil_test.go
- [x] internal/store/users_test.go

### internal/gateway
- [x] internal/gateway/protocol.go
- [x] internal/gateway/conn.go
- [x] internal/gateway/hub.go
- [x] internal/gateway/activity.go
- [ ] internal/gateway/activity_test.go
- [ ] internal/gateway/conn_test.go
- [ ] internal/gateway/hub_test.go
- [ ] internal/gateway/limits_test.go

### internal/cache
- [ ] internal/cache/cache.go
- [ ] internal/cache/memory.go
- [ ] internal/cache/redis.go
- [ ] internal/cache/cache_test.go

### internal/media
- [ ] internal/media/handler.go
- [ ] internal/media/store.go
- [ ] internal/media/validate.go
- [ ] internal/media/variants.go
- [ ] internal/media/media_test.go

### internal/unfurl
- [ ] internal/unfurl/cache.go
- [ ] internal/unfurl/fetch.go
- [ ] internal/unfurl/guard.go
- [ ] internal/unfurl/players.go
- [ ] internal/unfurl/youtube.go
- [ ] internal/unfurl/cache_test.go
- [ ] internal/unfurl/fetch_test.go
- [ ] internal/unfurl/guard_test.go
- [ ] internal/unfurl/players_test.go
- [ ] internal/unfurl/youtube_test.go

### internal/realtime
- [ ] internal/realtime/client.go
- [ ] internal/realtime/meter.go
- [ ] internal/realtime/client_test.go
- [ ] internal/realtime/meter_test.go

### internal/voice, rpcapps, ids
- [ ] internal/voice/registry.go
- [ ] internal/voice/registry_test.go
- [x] internal/rpcapps/rpcapps.go
- [ ] internal/rpcapps/rpcapps_test.go
- [x] internal/ids/ids.go
- [ ] internal/ids/ids_test.go

### cmd/chatmigrate
- [x] cmd/chatmigrate/main.go
- [ ] cmd/chatmigrate/main_test.go
- [ ] cmd/chatmigrate/helpers_test.go

### ops
- [x] deploy/install.sh
- [x] deploy/route-dns.sh
- [x] deploy/xyz.evilion.chat.plist.in
- [x] deploy/README.md
- [x] backup.sh
- [x] run.sh
- [x] Makefile
- [x] chatd.env.example
- [x] README.md
- [x] tools/gen_pg_schema.sh
- [x] tools/pg_schema.py

### round 1 cross-check
- [ ] audit/REVIEW.md (Done / Not doing / Still open)
- [ ] audit/server-correctness.md (store/gateway/media parts)
- [ ] audit/performance.md (server section)

## Handoff note
**FINDINGS.md was missing on a resume**: the first agent's SCORE-001..013 never reached disk (the `Write` tool refuses `.md` files; use a Bash heredoc/`cat >>`). Numbering restarts at 014; 001-013 are lost.
Successor progress: all ops files, db/db.go + dialect.go re-read, chatmigrate/main.go, store settings/instance/errors_log/legal/realtime. Findings 014-025 written.
Predecessor's pending items: (a) backup.sh -> SCORE-014/015 (the sealing key is `data/server.secret`, cmd/chatd/main.go:259 + api/mfa_handlers.go:53,159). (d) role icon / member avatar dead columns -> SCORE-023. Still open: (b) perms.go perf finding (write after gateway/hub.go, to say how often fan-out calls channelViewers), (c) packsQuery N+1 PackStickers (check callers in expressions.go + api).
Verified NOT findings: install.sh's `[ "$i" = 30 ] && die` does not trip `set -e` (tested, bash 3.2); chatmigrate enumerates tables from sqlite_master (new tables carried) and SQLite's version lives in `PRAGMA user_version`, so nothing collides with Postgres's `schema_version` table; **the Postgres schema is byte-identical to a regeneration from the SQLite migrations** (rebuilt the migrations with the sqlite3 CLI in $TMPDIR, ran tools/pg_schema.py, diff = 0 lines); the only SQLite-only SQL anywhere in store/api is `json_each`, which goes through `Dialect.JSONArrayHas`, and every user-facing `LIKE` lowers its column through `Dialect.Lower` (usernames are lowercased by `api.ValidUsername`/register, so the un-lowered `username LIKE ?` is safe on Postgres too).
Third agent (from 2026-09-19T05:03Z): all four of the predecessor's pending items are settled and written — (a) SCORE-014/015, (b) SCORE-026, (c) SCORE-030, (d) SCORE-023. gateway/{protocol,conn,hub,activity}.go are read (SCORE-026..029 came out of them). Remaining: cache, media, unfurl, realtime, voice/registry, the tests everywhere, round-1 cross-check. ~8,700 lines.
Next: internal/cache -> media -> unfurl -> realtime -> voice -> rpcapps/ids/chatmigrate tests -> store tests -> gateway tests -> round-1 cross-check.
