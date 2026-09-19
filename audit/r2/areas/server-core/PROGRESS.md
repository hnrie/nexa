# Progress — server-core
State: auditing
Last checkpoint: 2026-09-18T13:05Z
Next finding id: 014

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
- [ ] internal/store/settings.go
- [ ] internal/store/instance.go
- [ ] internal/store/legal.go
- [ ] internal/store/errors_log.go
- [ ] internal/store/realtime.go
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
- [ ] internal/gateway/protocol.go
- [ ] internal/gateway/conn.go
- [ ] internal/gateway/hub.go
- [ ] internal/gateway/activity.go
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
- [ ] internal/rpcapps/rpcapps.go
- [ ] internal/rpcapps/rpcapps_test.go
- [x] internal/ids/ids.go
- [ ] internal/ids/ids_test.go

### cmd/chatmigrate
- [x] cmd/chatmigrate/main.go
- [ ] cmd/chatmigrate/main_test.go
- [ ] cmd/chatmigrate/helpers_test.go

### ops
- [ ] deploy/install.sh
- [ ] deploy/route-dns.sh
- [ ] deploy/xyz.evilion.chat.plist.in
- [ ] deploy/README.md
- [x] backup.sh
- [x] run.sh
- [ ] Makefile
- [ ] chatd.env.example
- [ ] README.md
- [x] tools/gen_pg_schema.sh
- [x] tools/pg_schema.py

### round 1 cross-check
- [ ] audit/REVIEW.md (Done / Not doing / Still open)
- [ ] audit/server-correctness.md (store/gateway/media parts)
- [ ] audit/performance.md (server section)

## Handoff note
46 files done, SCORE-001..013 written. Store is read except settings/instance/legal/errors_log/realtime and the remaining tests.
Pending to write once verified: (a) backup.sh — tar failure swallowed (`|| true`) yet "written" printed; misses chatd.env (check whether the server secret in it seals user_mfa.totp_secret — if so a restore without it locks out every 2FA user), release.jks, update-key.pem, data/desktop, data/android; no pruning; (b) a structural perf finding on perms.go: ChannelPerms = 9 queries, channelViewers = 6 + 2/1000 members and O(members) perms.Compute — write it after reading gateway/hub.go to say how often fan-out calls it; (c) packsQuery N+1 PackStickers — check callers; (d) role icon / member avatar columns look unreachable from the API (dead schema) — confirm with a grep for RolePatch{/MemberPatch{ before deciding whether to report.
Verified and NOT findings: pin handler checks message channel; detachUser hands owned servers on and removes memberships/groups before DeleteAccount; both deadlock scans (pool use inside Tx; query while cursor open) are clean.
