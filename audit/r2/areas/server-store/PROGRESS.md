# Progress — server-store
State: auditing
Last checkpoint: 2026-09-19T10:52Z
Next finding id: 001

## Inspected
- [x] internal/store/store.go
- [x] internal/store/models.go
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
- [ ] internal/store/users.go
- [ ] internal/store/sessions.go
- [ ] internal/store/mfa.go
- [ ] internal/store/keys.go
- [ ] internal/store/servers.go
- [ ] internal/store/channels.go
- [ ] internal/store/perms.go
- [ ] internal/store/invites.go
- [ ] internal/store/messages.go
- [ ] internal/store/readstates.go
- [ ] internal/store/uploads.go
- [ ] internal/store/blobs.go
- [ ] internal/store/relationships.go
- [ ] internal/store/expressions.go
- [ ] internal/store/guests.go
- [ ] internal/store/locks.go
- [ ] internal/store/settings.go
- [ ] internal/store/instance.go
- [ ] internal/store/legal.go
- [ ] internal/store/errors_log.go
- [ ] internal/store/realtime.go
- [ ] internal/db/db_test.go (skim)
- [ ] internal/db/dialect_test.go (skim)
- [ ] internal/db/pg_test.go (skim)
- [ ] internal/db/subchat_migration_test.go (skim)
- [ ] internal/store/testutil_test.go (skim)
- [ ] internal/store/channels_test.go (skim)
- [ ] internal/store/errors_log_test.go (skim)
- [ ] internal/store/guests_test.go (skim)
- [ ] internal/store/keys_test.go (skim)
- [ ] internal/store/messages_test.go (skim)
- [ ] internal/store/relationships_test.go (skim)
- [ ] internal/store/server_refs_test.go (skim)
- [ ] internal/store/servers_test.go (skim)
- [ ] internal/store/sessions_test.go (skim)
- [ ] internal/store/users_test.go (skim)

## Handoff note
2026-09-19T10:52Z. Read store.go, models.go, db.go, dialect.go, all 11 SQLite
migrations and the Postgres init. No finding written yet; conclusions so far
(to verify against the callers before writing):
- db.go: no `_txlock=immediate`; fine only because W has MaxOpenConns(1) —
  check no code writes through the R pool and no Tx reads via s.db.R
  (read-your-writes). Migrate on Postgres: lock on a dedicated conn, migrations
  on pool conns — OK. No periodic WAL checkpoint (only on Close).
- dialect.go: rebind ignores `--` comments / "identifiers"; Conn.cache is an
  unbounded sync.Map keyed by query text (only a problem if a query embeds
  values — check dynamic builders).
- Schema: key_epochs/key_grants/key_flags have no FK to channels/servers ->
  every channel/server delete must clean them by hand (0007 shows the code
  does it for subchats; verify DeleteChannel/DeleteServer/DeleteDM). invites.
  channel_id has no FK (group-DM invites orphan when the group is deleted).
  Missing FK-child indexes: read_states(channel_id), pins(message_id),
  sticker_installs(pack_id), users/servers/roles/channels(avatar|banner|icon)
  -> blob deletes scan those tables (check blobs.go GC batch size).
  servers.owner_id / messages.author_id FK with no ON DELETE: hard user delete
  must fail -> check users.go delete path is soft.
- Public(): Flags & FlagAdmin only; status_expires_at not enforced in Public().
Next: tools/gen_pg_schema.sh (hand-edit check), users.go, sessions.go, mfa.go.
