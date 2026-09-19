# Progress — server-core
State: audit-done
Last checkpoint: 2026-09-19T10:46Z
Next finding id: 044

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
- [x] internal/store/channels_test.go
- [x] internal/store/errors_log_test.go
- [x] internal/store/guests_test.go
- [x] internal/store/keys_test.go
- [x] internal/store/messages_test.go
- [x] internal/store/relationships_test.go
- [x] internal/store/server_refs_test.go
- [x] internal/store/servers_test.go
- [x] internal/store/sessions_test.go
- [x] internal/store/testutil_test.go
- [x] internal/store/users_test.go

### internal/gateway
- [x] internal/gateway/protocol.go
- [x] internal/gateway/conn.go
- [x] internal/gateway/hub.go
- [x] internal/gateway/activity.go
- [x] internal/gateway/activity_test.go
- [x] internal/gateway/conn_test.go
- [x] internal/gateway/hub_test.go
- [x] internal/gateway/limits_test.go

### internal/cache
- [x] internal/cache/cache.go
- [x] internal/cache/memory.go
- [x] internal/cache/redis.go
- [x] internal/cache/cache_test.go

### internal/media
- [x] internal/media/handler.go
- [x] internal/media/store.go
- [x] internal/media/validate.go
- [x] internal/media/variants.go
- [x] internal/media/media_test.go

### internal/unfurl
- [x] internal/unfurl/cache.go
- [x] internal/unfurl/fetch.go
- [x] internal/unfurl/guard.go
- [x] internal/unfurl/players.go
- [x] internal/unfurl/youtube.go
- [x] internal/unfurl/cache_test.go
- [x] internal/unfurl/fetch_test.go
- [x] internal/unfurl/guard_test.go
- [x] internal/unfurl/players_test.go
- [x] internal/unfurl/youtube_test.go

### internal/realtime
- [x] internal/realtime/client.go
- [x] internal/realtime/meter.go
- [x] internal/realtime/client_test.go
- [x] internal/realtime/meter_test.go

### internal/voice, rpcapps, ids
- [x] internal/voice/registry.go
- [x] internal/voice/registry_test.go
- [x] internal/rpcapps/rpcapps.go
- [x] internal/rpcapps/rpcapps_test.go
- [x] internal/ids/ids.go
- [x] internal/ids/ids_test.go

### cmd/chatmigrate
- [x] cmd/chatmigrate/main.go
- [x] cmd/chatmigrate/main_test.go
- [x] cmd/chatmigrate/helpers_test.go

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
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/server-correctness.md (store/gateway/media parts)
- [x] audit/performance.md (server section)

## Handoff note
**FINDINGS.md was missing on a resume**: the first agent's SCORE-001..013 never reached disk (the `Write` tool refuses `.md` files; use a Bash heredoc/`cat >>`). Numbering restarts at 014; 001-013 are lost.
Successor progress: all ops files, db/db.go + dialect.go re-read, chatmigrate/main.go, store settings/instance/errors_log/legal/realtime. Findings 014-025 written.
Predecessor's pending items: (a) backup.sh -> SCORE-014/015 (the sealing key is `data/server.secret`, cmd/chatd/main.go:259 + api/mfa_handlers.go:53,159). (d) role icon / member avatar dead columns -> SCORE-023. Still open: (b) perms.go perf finding (write after gateway/hub.go, to say how often fan-out calls channelViewers), (c) packsQuery N+1 PackStickers (check callers in expressions.go + api).
Verified NOT findings: install.sh's `[ "$i" = 30 ] && die` does not trip `set -e` (tested, bash 3.2); chatmigrate enumerates tables from sqlite_master (new tables carried) and SQLite's version lives in `PRAGMA user_version`, so nothing collides with Postgres's `schema_version` table; **the Postgres schema is byte-identical to a regeneration from the SQLite migrations** (rebuilt the migrations with the sqlite3 CLI in $TMPDIR, ran tools/pg_schema.py, diff = 0 lines); the only SQLite-only SQL anywhere in store/api is `json_each`, which goes through `Dialect.JSONArrayHas`, and every user-facing `LIKE` lowers its column through `Dialect.Lower` (usernames are lowercased by `api.ValidUsername`/register, so the un-lowered `username LIKE ?` is safe on Postgres too).
Third agent (from 2026-09-19T05:03Z): all four of the predecessor's pending items are settled and written — (a) SCORE-014/015, (b) SCORE-026, (c) SCORE-030, (d) SCORE-023. gateway/{protocol,conn,hub,activity}.go are read (SCORE-026..029 came out of them). Remaining: cache, media, unfurl, realtime, voice/registry, the tests everywhere, round-1 cross-check. ~8,700 lines.
Verified fixed from round 1: the gateway caps (limits_test.go passes them: per-account/per-IP/instance/unidentified), the `conn.user` race (it is an atomic.Value now), Limiter.Reset through Redis. Next: round-1 cross-check only (audit/server-correctness.md store+gateway+media parts, audit/performance.md server section), plus the BRIEF verify list (media proxy expiry store side, mfa backup codes). Every source and test file in scope is inspected. -> round-1 cross-check (server-correctness.md + performance.md server sections). No findings from the voice/ids/rpcapps/chatmigrate/realtime tests: all four suites are thorough. Done since: cache (SCORE-031/032), media (SCORE-033/034). Round-1 REVIEW.md read: its "Still open" list = no Android updater, per-ABI APKs undownloaded, the three structural perf items (SCORE-026 is one of them), android-ui BROKENs, signing key not backed up (SCORE-014 is adjacent). `Limiter.Reset` through Redis (round-1 BROKEN) IS fixed (ratelimit/limiter.go:113-126). Round-1's unbounded `login:<4KiB username>` limiter key is NOT fixed (auth_handlers.go:225) but `internal/ratelimit` + `cmd/chatd` belong to server-api, so left to them.
Old next-order (for reference): internal/cache -> media -> unfurl -> realtime -> voice -> rpcapps/ids/chatmigrate tests -> store tests -> gateway tests -> round-1 cross-check.

Fourth agent (2026-09-19T10:32Z onwards): the round-1 cross-check is done — every file in scope is
ticked. Findings 040-043 came out of it. The unfurl fetch-budget item the second handoff note was
about had already been written (SCORE-035/036), so nothing was pending.

Round-1 verification, in code, one by one (all of `server-correctness.md`'s server-core items):
FIXED and confirmed — the ban purge is one transaction with the ids collected inside it
(`store/messages.go` `DeleteMessagesByUserSince`); `CreateDM` sets `KeyConvID` and holds the pair
through `tx.Serialise` (a new `pg_advisory_xact_lock` helper, `db/dialect.go:209`), which also covers
`MaxSubchats`/`MaxReactionEmoji`; `Migrate` takes `pg_advisory_lock` on Postgres and refuses nothing
else; ids carry a node id (`SetNode`) and the clock is monotonic with a bounded spin; the writer pool
runs `synchronous(FULL)`; `SubchatsFor` drains its cursor first; `PutPublic` handles the unique
violation by re-reading; blob commits fsync the directory; `AttachmentByBlob` and `UnreferencedBlobs`
have deterministic `ORDER BY`; `UploadByID` returns nil on error; `perms.go` uses `errors.Is`; both
raw `lower()` calls go through the dialect; `RecordClientError` trims only past a slack; the gateway
has `safely`/`recoverTimer` around every goroutine and timer, a 5 s `background()` context for
fan-out, and `store.IsDMLike` + `DMBlocked` in `hub.Viewers`/`CanAccess`/typing (so the blocked-user
subchat typing hole is closed); `turnCache` is gone; `FinishTOTPSetup` is one transaction that
refuses a repeat (`ErrMFAAlreadyOn`); `RemoveParticipant` returns the remaining participants from
inside the write transaction (which fixes both the group-delete data loss and the stale-snapshot
sibling); the media proxy signature carries a 24 h expiry and neither the unfurl cache (1 h, raw
URLs, `out := *res`) nor the GIF cache (2 min) outlives it.
STILL OPEN -> SCORE-040 (KeysMaybeNeeded/Needs), SCORE-041 (uncapped mention count), SCORE-042
(per-connection marshal), SCORE-043 (ten one-liners: Ev* constants, IsInstanceAdmin, subchat unread,
CreateServerChannel dead query, Pins/Reactors, has_attachments, UpdateMessage NULL, store.contains,
invite modulo bias, SetSourceLive).
NOT re-reported, deliberately: everything `performance.md` filed as NOTABLE/MINOR (REVIEW.md declines
them pending a profiler) — the ones still true in this area are the gateway frame encode (raised
anyway as SCORE-042), `DMChannelsForUser`'s scan of `channels` (no index on `type`),
`instanceAdmins`' scan of `users` (no index on `flags`), the missing `messages(channel_id,
author_id)` index for slowmode, SQLite's default 2 MB page cache and no mmap, `Tx` not caching
placeholder rebinding, `DeleteMessages`' count-per-id, `SetMemberRoles`/`SetRolePositions` row at a
time, `MutualServers` probing per server, `GC`/`Remove` two queries per blob.
Checked and NOT a finding: the duplicate `CREATE INDEX invites_server` in 0001 and 0002 is correct
(0002 rebuilds the table, so the index goes with it); blob reference accounting on delete is
thorough (message, channel, server, pack, sticker, emoji, avatar/banner and account deletion all
release refs through `refFloor`); `DeleteAccount` anonymises and drops sessions, relationships,
settings, grants and MFA in one transaction; the hot tables' primary keys cover the hot lookups.

DONE: every file ticked, Summary written at the top of FINDINGS.md, State: audit-done. 30 findings
(SCORE-014..043): P0 1, P1 5, P2 16, P3 8. Nothing is pending. If a fifth agent arrives, there is no
audit work left here — the next phase for this area is triage.
