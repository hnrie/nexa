# Server correctness

## Summary

An audit of `internal/store`, `internal/api`, `internal/gateway`, `internal/perms`
and `cmd/chatd` for bugs and robustness, reading the code rather than the docs.

The codebase is careful in the places the author clearly thought hard about — the
resumable-upload spool (`internal/media/store.go:204`), the voice registry's
copy-on-read locking (`internal/voice/registry.go`), idempotent message sends by
nonce, the `goLive` pre-registration buffer. Most of what follows is on the edges
of those: the error paths beside the happy path, and the places where a rule that
holds on SQLite does not hold on Postgres.

Three themes dominate:

1. **`x, _ :=` followed by a use of `x`.** This appears ~20 times across
   `internal/api`. Two shapes: a swallowed error becomes a `nil` pointer that is
   dereferenced (a panic caught by `Recover`, after the write already landed), or
   it becomes a `nil` value that is *broadcast* — `"server_update": null`,
   `"member_update": null` — which the web client's dispatch throws on and
   silently swallows (`web/src/gateway/session.ts:47`). One instance
   (`internal/api/channel_handlers.go:349`) reads a swallowed error as "the group
   is empty" and deletes the conversation and every message in it.

2. **Single-writer assumptions that Postgres does not honour.** `db.Open` gives
   SQLite one writer connection; `db.OpenPostgres` gives sixteen
   (`internal/db/db.go:60,77`). Several check-then-insert sequences are correct
   only under the former and are documented as if that were a property of the
   design. There is already a test that would fail on Postgres today
   (`internal/store/channels_test.go:87`) — it just never runs there, because
   `CHAT_TEST_POSTGRES` is not set by `make test-go`.

3. **Fan-out work proportional to server size, on the request path.** A single
   permission change calls `snapshotVisibility` twice, and each call runs
   `ViewableServerChannels` (5+ queries) per member
   (`internal/api/server_handlers.go:136`). Every presence change resolves the
   full member list of every server the user is in
   (`internal/api/server_glue.go:167`). These are correct, just quadratic.

Counts: **2 DATA-LOSS, 8 BROKEN, 2 RACE, 26 BAD, 24 POLISH.**

---

## Findings

### [DATA-LOSS] A swallowed error deletes a group DM and every message in it
- **Where**: `internal/api/channel_handlers.go:349-355`
- **What**:
  ```go
  remaining, _ := s.Store.Participants(r.Context(), ch.ID)
  if len(remaining) == 0 {
      _ = s.deleteConversation(r.Context(), ch)
      ...
  }
  ```
  `store.Participants` returns `(nil, err)` on any query error
  (`internal/store/channels.go:289-304`). The handler cannot tell "nobody is left"
  from "the query failed", and takes both to mean the first.
- **How it fails**: `DELETE /api/v1/channels/{id}/recipients/{uid}` on a group DM.
  `RemoveParticipant` succeeds. The follow-up `SELECT user_id FROM dm_participants`
  fails — a `SQLITE_BUSY` past the 5 s `busy_timeout`, a scan error, a dropped
  Postgres connection. `remaining` is `nil`, so `deleteConversation` runs:
  `DeleteChannel` drops the channel row, and the `ON DELETE CASCADE` on
  `messages.channel_id` (`internal/db/migrations-postgres/0011_init.sql:86`) takes
  every message, attachment, pin and read state with it. The other members are
  never even told — the `channel_delete` on line 352 is sent only to `uid`. They
  discover it on their next reconnect, when `ready` no longer lists the group.
  The error from `deleteConversation` is discarded too, so the response is 204.
- **Fix**: `remaining, err := ...; if err != nil { WriteError(w, err); return }`.
  The same shape exists at `internal/api/group_handlers.go:187` but reads from a
  pre-loaded `ch.Recipients` snapshot instead, which has its own problem (below).

### [DATA-LOSS] Purging a banned user's messages is not atomic and loses the delete events
- **Where**: `internal/store/messages.go:511-537`, called from `internal/api/server_handlers.go:1524-1528`
- **What**: `DeleteMessagesByUserSince` reads the ids to delete from the *read*
  pool, then calls `s.DeleteMessage(ctx, id)` in a loop — **one transaction per
  message**, each doing its own `fixLastMessageTx`. On any error mid-loop it
  returns `(nil, err)`.
- **How it fails**: `PUT /api/v1/servers/{id}/bans/{uid}` with
  `{"delete_message_days": 7}` for a user with 800 recent messages. Message 400's
  delete fails (context cancelled because the admin's browser gave up on the slow
  request, a busy timeout, anything). 399 messages are already gone from the
  database. The function returns `nil, err`; the handler's
  `if deleted, err := ...; err == nil` skips the whole block, so **no
  `message_delete_bulk` is emitted for any of them**. Every connected client keeps
  showing 399 messages that no longer exist, and will keep showing them until a
  reconnect rebuilds the channel. A retry of the ban re-reads the remaining 401
  and starts over. On SQLite, 800 sequential write transactions also monopolise
  the single writer connection for the duration, stalling every other write on the
  instance.
- **Fix**: do the whole purge in one `s.Tx`, collecting ids as they are deleted,
  and return the partial list alongside the error so the caller can still emit
  what went. Cap the batch and page.

### [BROKEN] A newly created DM is sent to clients with `key_conv_id: "0"`
- **Where**: `internal/store/channels.go:64-98` (specifically the return at 96-97)
- **What**: `CreateDM` builds `c := &Channel{Type: "dm"}`, inserts it, then returns
  `c` directly with only `ID`, `CreatedAt` and `Recipients` filled.
  `Channel.KeyConvID` is never set, so it marshals as `"0"`. Every sibling does set
  it: `CreateGroupDM` re-reads through `ChannelByID` (line 121), `CreateSubchat`
  sets it explicitly (line 255), `ChannelByID` sets it in `scanChannel` (line 43).
- **How it fails**: `POST /api/v1/users/@me/channels` with one recipient, first
  time. The 201 body and the `channel_create` fanned out to both participants
  carry `"key_conv_id": "0"`. The web client already has a hand-written workaround
  for exactly this — `web/src/components/composer/send.ts:31`:
  `if (ch?.key_conv_id && ch.key_conv_id !== "0") return ch.key_conv_id;` — so the
  bug is being papered over on the client rather than fixed here. Anything that
  trusts the field without the `!== "0"` guard (the Android client's
  `Channel.key_conv_id`, a future client, `GuestCallPage.tsx:64`) picks the wrong
  conversation to encrypt for.
- **Fix**: `c.KeyConvID = c.ID` before returning, or return `s.ChannelByID(ctx, c.ID)`
  as `CreateGroupDM` does.

### [BROKEN] Snowflake ids have no node id, so two chatd processes collide
- **Where**: `internal/ids/ids.go:19-56`
- **What**: the package comment says "10 bits of node id (always 0 for this
  single-process server)", and `New()` never sets those bits: the returned id is
  `(ms-Epoch)<<22 | seq` with a process-local `seq`.
  `internal/db/db.go:28-33` documents Postgres as the answer for "several chatd
  processes writing at once".
- **How it fails**: two chatd processes behind one Postgres. Both issue their
  first id of a millisecond as `(ms-Epoch)<<22 | 0`. Identical value. Whichever
  `INSERT INTO messages` lands second gets a primary-key violation — and note that
  the `ON CONFLICT(channel_id, author_id, nonce) ... DO NOTHING` at
  `internal/store/messages.go:116` does **not** absorb a PK conflict, so it
  surfaces as a raw driver error → `WriteError` → 500. Under load the collision
  rate is roughly (writes per ms)² / 4096 per process pair. The same applies to
  users, channels, roles, uploads and blobs. This is not theoretical: it is the
  documented deployment shape.
- **Fix**: take the node id from config/env (`CHATD_NODE_ID`, 0–1023) and OR it in
  at `ids.go:55`. Refuse to start when two processes are configured with the same
  one.

### [BROKEN] Two processes migrating a fresh Postgres database race
- **Where**: `internal/db/db.go:133-175` (`current, err := d.Version(ctx)` at 152)
- **What**: `Migrate` reads the current version once, then applies every newer
  file, each in its own transaction. There is no advisory lock and no
  `SELECT ... FOR UPDATE`.
- **How it fails**: two chatd processes start together against an empty Postgres.
  Both `Version()` return 0 (each creating `schema_version` with
  `CREATE TABLE IF NOT EXISTS`). Both read `0011_init.sql` and both run it. One
  commits; the other fails with `relation "blobs" already exists`, `Migrate`
  returns the error and `cmd/chatd/main.go:72-75` calls `os.Exit(1)`. Under a
  process supervisor the loser restarts, finds version 11 and comes up — so the
  symptom is one crash-loop cycle per deploy, not a permanent outage. But if the
  two processes interleave *different* migrations later (0012 and 0013 added
  together), the second can commit a version bump for a migration whose statements
  the first already ran, leaving `schema_version` ahead of the actual schema.
- **Fix**: `SELECT pg_advisory_lock(<constant>)` around the whole loop for the
  Postgres dialect (SQLite is already serialised by the single writer).

### [BROKEN] Check-then-insert guards hold on SQLite and not on Postgres
- **Where**: `internal/store/channels.go:71-88` (`CreateDM`),
  `internal/store/channels.go:222-250` (`CreateSubchat`, `MaxSubchats`),
  `internal/store/messages.go:394-409` (`AddReaction`, `MaxReactionEmoji`),
  `internal/api/auth_handlers.go:161-168` (first-user-is-admin)
- **What**: each reads inside `s.Tx` and then writes based on what it read. The
  comment at `channels.go:69-71` states the safety argument outright: *"writes go
  through one connection, so two people tapping Message at once cannot both miss
  the pair"*. That is true of `db.Open` (`SetMaxOpenConns(1)`, `db.go:60`) and
  false of `db.OpenPostgres` (`SetMaxOpenConns(16)`, `db.go:77`). `DB.Tx` uses
  `BeginTx(ctx, nil)` — default isolation, READ COMMITTED on Postgres — so two
  transactions read the same "no DM exists" and both insert. There is no unique
  index on the participant pair to catch it.
- **How it fails** (traced for `CreateDM`): A and B tap Message on each other at
  the same moment against a Postgres-backed instance. Both transactions run the
  `SELECT c.id FROM channels c JOIN dm_participants p1 ... p2 ...` and get
  `ErrNoRows`. Both insert a channel and two `dm_participants` rows. Two DM
  channels now exist for one pair; `DMChannelsForUser` returns both; messages land
  in whichever one that client happened to open, and neither side sees the other's.
  `TestConcurrentCreateDMMakesOneConversation`
  (`internal/store/channels_test.go:87`) asserts exactly this and would fail —
  it just never runs against Postgres.
  Same shape: >50 subchats per conversation, >20 distinct reaction emoji per
  message, and two people registering simultaneously on an empty instance both
  getting `store.FlagAdmin`.
- **Fix**: add `CREATE UNIQUE INDEX dm_pair ON ...` (or a canonical pair column)
  and handle `db.IsUniqueViolation` by re-reading; for the counted limits, use
  `BEGIN IMMEDIATE`/`SELECT ... FOR UPDATE` on a row that both transactions must
  take, or accept the overshoot explicitly.

### [BROKEN] A backwards clock can freeze every id generation in the process
- **Where**: `internal/ids/ids.go:40-53`
- **What**:
  ```go
  if ms < lastMs { ms = lastMs }
  if ms == lastMs {
      seq = (seq + 1) & seqMask
      if seq == 0 { for ms <= lastMs { ms = now() } }   // spin
  }
  ```
  The spin runs while holding the package-global `mu`.
- **How it fails**: the wall clock jumps backwards (NTP step after a VM suspend,
  a manual `date`, a leap-second smear gone wrong) by more than a millisecond, and
  4096 ids are issued in that stalled millisecond — which one busy request burst
  can do. `lastMs` is pinned at the pre-jump value; `now()` keeps returning
  something smaller; the loop spins at 100 % CPU **holding `mu`**. Every other
  `ids.New()` — every message, every session, every upload, every gateway
  connection — blocks on that mutex until the wall clock catches up, which for a
  one-hour backwards jump is one hour. The process is up, answering health checks,
  and unable to create anything.
- **Theoretical rather than traced**: I have not reproduced it; it needs both a
  backwards jump and sequence exhaustion in the same millisecond.
- **Fix**: use a monotonic base (`time.Since(start)` added to a captured wall
  clock) rather than `time.Now().UnixMilli()`, or bound the spin and fall back to
  incrementing `lastMs`.

### [BROKEN] Creating a locked subchat half-applies when the lock write fails
- **Where**: `internal/api/subchat_handlers.go:204-225`
- **What**: `CreateSubchat` commits its own transaction; `SetLock` is a separate
  transaction afterwards. On `SetLock` failure the handler returns 500 having
  already created the channel, and never emits `channel_create`.
- **How it fails**: `POST /api/v1/channels/{id}/subchats` with a password.
  The subchat is created. `SetLock` fails. The caller sees a 500 and assumes
  nothing happened. In fact an **unlocked** subchat with the requested name now
  exists inside the conversation — every participant will see it (and can read it)
  on their next `ready`, and it counts against `MaxSubchats`. Retrying creates a
  second one.
- **Fix**: pass the lock into `CreateSubchat` so both writes share one transaction,
  or delete the subchat on `SetLock` failure before returning.

### [BROKEN] `Limiter.Reset` does nothing when limiters are shared through Redis
- **Where**: `internal/ratelimit/limiter.go:105-109`, callers at
  `internal/api/auth_handlers.go:247` and `:256`
- **What**: `Allow` consults `l.shared` (Redis) first and only falls back to the
  local bucket. `Reset` deletes from `l.entries` — the local map — and never tells
  the shared counter.
- **How it fails**: an instance with `REDIS_URL` set
  (`cmd/chatd/main.go:99-101`). `limAuthUsr` is 5 attempts per 5 minutes keyed by
  `"login:"+username`. A user mistypes their password four times, then gets it
  right. `handleLogin` calls `s.limAuthUsr.Reset("login:"+username)` — a no-op
  against Redis. They sign out and back in a minute later: the shared counter
  still holds 5 uses, and a **correct** password gets a 429 with a `Retry-After`
  of up to five minutes. The behaviour differs between the single-process and
  multi-process deployments, which is the opposite of what `ShareLimiters` is for.
- **Fix**: give `Shared` a `Reset(ctx, key)` method and call it.

### [RACE] `conn.user` is written from a timer goroutine and read from three others
- **Where**: write at `internal/gateway/conn.go:465`; reads at
  `internal/gateway/conn.go:506,518,533`, `internal/gateway/hub.go:135,137`,
  `internal/gateway/activity.go:432,439`, `internal/gateway/conn.go:76`
- **What**: `applyPresence` ends with `c.user = u`. It is called from two places:
  `queuePresence` on the read-loop goroutine (fine), and `flushPresence`
  (`conn.go:397-412`) from a `time.AfterFunc` callback on the runtime timer
  goroutine. Nothing guards `c.user`.
- **How it fails**: a client sends two `presence` ops inside `presenceEvery`
  (2 s) — the composer's status picker does exactly this, and
  `TestPresenceChangesCoalesce` sends eight in a row. The second is deferred to a
  timer. While that timer is pending the client sends a `typing` op; `handle`
  reads `c.user.ID` at `conn.go:533` on the read-loop goroutine. The timer fires
  and writes `c.user` on the timer goroutine. Unsynchronised write and read of the
  same word from two goroutines — a data race by the Go memory model, and on a
  32-bit build a genuinely torn pointer. Independently, `hub.sweepSessions`
  (`hub.go:131-147`) reads `c.user.ID` for every open connection every 60 s, which
  races with any presence flush anywhere on the instance. `make test-go` already
  runs `-race`; the existing tests simply never have a reader active while the
  timer fires.
- **Fix**: guard `c.user` with a mutex (or store it in an `atomic.Pointer[store.User]`)
  and have `User()`, `handle`, `sweepSessions` and `activitiesChanged` read
  through it.

### [RACE] `goLive` fills the send channel while holding `pendMu`; one off and the hub deadlocks
- **Where**: `internal/gateway/conn.go:162-178`, with `enqueue` at `:137-158` and
  `Hub.EmitUsers` at `internal/gateway/hub.go:263-280`
- **What**: `goLive` holds `c.pendMu` for its whole body and pushes `1 + len(pending)`
  frames into `c.send` — **before `writeLoop` has been started**
  (`conn.go:261` runs before `conn.go:267`), so nothing is draining. It is safe
  only because `enqueue` refuses to append past `cap(c.send)-1 == 255`, making the
  total exactly `256 == cap(c.send)`. The comment says as much.
- **How it fails**: the lock chain is `Hub.EmitUsers` holds `h.mu.RLock()` →
  `c.enqueue` takes `c.pendMu` → blocked. `h.mu` is an `RWMutex`, so a blocked
  reader blocks any waiting writer, and `register`/`unregister`/`h.mu.Lock()`
  queue behind it, which in turn blocks every subsequent `RLock`. If `goLive` ever
  blocks on `c.send <-`, **every emitter and every new connection on the entire
  instance deadlocks permanently.** Today the arithmetic holds; the invariant is
  protected by nothing but the constant `sendBuffer = 256` (`hub.go:72`) and the
  `-1` at `conn.go:142`. Changing `sendBuffer`, adding a second pre-live frame, or
  enqueueing anything between `goLive` and `go c.writeLoop()` turns a
  slow-consumer edge case into a process-wide hang.
  This is a fragile invariant, not a bug I traced firing.
- **Fix**: start `writeLoop` before `goLive`, and have `goLive` publish `pending`
  under the lock but send outside it (or use the same non-blocking
  `select`/`default` that `enqueue` uses).

### [BAD] `role, _ = s.Store.RoleByID(...)` then `&role.ID` — nil dereference in a handler
- **Where**: `internal/api/server_handlers.go:993-997`
- **What**:
  ```go
  _ = s.Store.UpdateRole(r.Context(), role.ID, store.RolePatch{Hoist: ..., Mentionable: ...})
  role, _ = s.Store.RoleByID(r.Context(), role.ID)
  s.audit(r, srv.ID, me.ID, "role_create", "role", &role.ID, ...)
  ```
- **How it fails**: `POST /api/v1/servers/{id}/roles` with `{"hoist": true}`. The
  role is created and the hoist applied. The re-read fails (any transient read
  error) → `role` is `nil` → `&role.ID` panics. `Recover`
  (`internal/api/middleware.go:75`) turns it into a 500, but the role already
  exists and the client, having seen a 500, has no id for it and no
  `role_create` event (line 1007 is never reached). The role appears out of
  nowhere on the next reload.
- **Fix**: check the error and fall back to the `role` already in hand.

### [BAD] `u, _ = s.Store.UserByID(...)` then `keyBundle(u)` — nil dereference after a successful recovery
- **Where**: `internal/api/auth_handlers.go:406-410`
- **What**: `u, _ = s.Store.UserByID(r.Context(), u.ID)` followed by
  `keyBundle(u)`, which reads `u.PublicKey`.
- **How it fails**: `POST /api/v1/auth/recover/finish`. The password is replaced,
  every session is deleted, MFA is disabled and a new session is created — all
  committed. The re-read fails; `u` is nil; `keyBundle` panics. The user gets a
  500 on the one request that was supposed to hand them their new token, and
  their old sessions are already gone. They must run recovery again from the top
  (which still works, the new password is live).
- **Fix**: keep the old `u` on error; the only field that changed is the auth hash,
  which `keyBundle` does not read.

### [BAD] `updated, _ := s.Store.ChannelByID(...)` then `updated.Recipients` / `systemMessage(updated, …)`
- **Where**: `internal/api/channel_handlers.go:258-259`, `:276-277`, `:309-312`, `:365-368`
- **What**: four call sites discard the error from `ChannelByID` and then
  dereference the result.
- **How it fails**: `POST /api/v1/channels/{id}/recipients/{uid}`
  (line 309). `AddParticipant` commits — the user is in the group. The re-read
  fails → `updated` is nil → line 310 broadcasts `"channel_create": null` to the
  new member (harmless-ish) and line 312 calls
  `s.systemMessage(r, updated, ...)`, which reads `ch.ID` on a nil pointer
  (`channel_handlers.go:37`) and panics. 500 to the caller, membership already
  changed, no `channel_update` to anyone else, no key-rotation flag. Lines 258 and
  276 are the same after an icon change; line 365 the same after a removal.
- **Fix**: handle the error; the membership change is already durable, so log and
  fall back to re-emitting from `ch` rather than panicking.

### [BAD] Discarded errors broadcast `null` as a `server_update` / `member_update` / `role_update`
- **Where**: `internal/api/server_handlers.go:349`, `:374`, `:392`, `:495`, `:722`,
  `:1090`, `:1364`, `:1419`
- **What**: eight sites do `updated, _ := s.Store.XByID(...)` and pass `updated`
  straight to `emitServer` / `EmitChannel` / `WriteJSON`.
- **How it fails**: `PATCH /api/v1/servers/{id}` (line 349). The patch commits; the
  re-read fails; `updated` is a typed nil, which marshals to `null`. Every member
  receives `{"t":"server_update","d":null}`. The web dispatch does
  `upsertServer(d)` (`web/src/gateway/dispatch.ts:195`) which reads `d.id` → throws
  inside the dispatch promise → swallowed by the `.catch(() => undefined)` at
  `web/src/gateway/session.ts:47`. The event is lost silently and every client's
  copy of the server is stale until a reconnect. The HTTP caller gets
  `200 null`. Same for role (`:1090`), member (`:1364`, `:1419`) and channel
  (`:722`) updates.
- **Fix**: check the error and emit the in-memory object you already have.

### [BAD] `voice.Update` failure broadcasts a phantom participant with id "0"
- **Where**: `internal/api/voice_glue.go:659-668`
- **What**:
  ```go
  updated, _ := s.Voice.Update(uid, func(x *voice.State) { ... })
  s.Bcast.EmitUsers(s.voiceAudience(r.Context(), cur), "voice_state", statePayload(updated))
  ```
  `Registry.Update` returns `(State{}, false)` when the user is not in a call
  (`internal/voice/registry.go:254-263`), and `ok` is discarded.
- **How it fails**: a moderator sends
  `PATCH /api/v1/servers/{id}/members/{uid}/voice` with `{"mute": true}`.
  `s.Voice.Get(uid)` at line 580 succeeds. `ReadJSON` at line 591 reads the body —
  a round trip during which the target hangs up. `Update` now returns the zero
  `State`. `statePayload` on it produces
  `{"user_id":"0","channel_id":"0","session_id":"0","joined_at":0,"user":{"id":"0","display_name":""}}`
  and sends it to everyone who can see the channel. The web's voice store adds a
  participant with id `"0"` to channel `"0"`; nothing ever removes it, because no
  leave for id 0 will arrive. Lines 307 and 688 have the same shape.
- **Fix**: `updated, ok := ...; if !ok { ... }` and skip the broadcast.

### [BAD] `removeMember` silently skips private-channel key rotation on a read error
- **Where**: `internal/api/server_handlers.go:422`
- **What**: `visible, _ := s.Store.ViewableServerChannels(ctx, srv.ID, uid)`.
  `visible` is then the only thing deciding which private channels get
  `needs_rotation` set (lines 437-441).
- **How it fails**: a kick or ban where that query errors → `visible` is nil → the
  loop adds nothing → only the server root is flagged. Every private channel the
  kicked user could read keeps its current epoch, and the people still in it go on
  encrypting under a key the removed user holds. No error is reported anywhere;
  the kick returns 204. This is a correctness bug with a security consequence.
- **Fix**: propagate the error and refuse the removal, or fall back to flagging
  every own-key channel of the server.

### [BAD] Permission changes do O(members × channels) sequential queries on the request path
- **Where**: `internal/api/server_handlers.go:136-158` (`snapshotVisibility`) and
  `:163-214` (`syncVisibility`); called from `:580`, `:850`, `:899`, `:1084`,
  `:1108`, `:1346`, `:1409`
- **What**: `snapshotVisibility` calls `ViewableServerChannels` once per member.
  Each of those runs `ServerByID` + `Member` (2 queries) + `Roles` +
  `ServerChannels` + `OverwritesForServer` — five-plus round trips, all of which
  return the *same* server-wide data every time. It is then run a second time in
  `syncVisibility`.
- **How it fails**: an admin changes one channel overwrite on a 2 000-member
  server. That is ~20 000 sequential queries against the read pool before the
  request returns, plus `ServerChannels` again, plus one `EmitUsers` call per
  (user, changed channel) pair at lines 182/186/192 — each taking `h.mu.RLock()`
  and allocating a frame. The request takes tens of seconds; the browser times
  out; the admin retries, doubling the load. On SQLite the read pool is 8
  connections, so eight concurrent permission edits saturate it and every other
  read on the instance queues.
- **Fix**: load roles, channels and overwrites **once**, then compute
  `perms.Compute` per member in memory (all the inputs are already in hand);
  batch the fan-out into one `EmitUsers` per (channel, user-set).

### [BAD] `handleRolePositions` re-reads the full member list once per role
- **Where**: `internal/api/server_handlers.go:1160-1162`
- **What**: `for _, ro := range roles { s.emitServer(r.Context(), srv.ID, "role_update", ro) }`
  and `emitServer` (`:110-116`) starts with `s.Store.MemberIDs(ctx, serverID)`.
- **How it fails**: dragging roles in a server with 250 roles (the cap,
  `maxServerRoles`) and 2 000 members issues 250 `SELECT user_id FROM
  server_members WHERE server_id = ?` queries returning 2 000 rows each — half a
  million rows read to send 250 events.
- **Fix**: read `MemberIDs` once above the loop.

### [BAD] Every presence change resolves the full membership of every server the user is in
- **Where**: `internal/api/server_glue.go:167-181`, reached from
  `internal/gateway/hub.go:383-387` (`interestedIn`)
- **What**: `hub.Interested` loops the user's servers calling `MemberIDs` on each
  and concatenates the results. `interestedIn` also runs `Friends` and
  `DMChannelsForUser`. `broadcastPresence` calls it, and `broadcastPresence` runs
  on connect, on disconnect, on every accepted `presence` op, on every profile
  PATCH, on every activity update, and on every server join.
- **How it fails**: a user in 15 servers of 3 000 members each. One status flip
  builds a 45 000-element slice, then `EmitUsers` walks it building a 45 000-entry
  dedupe map under `h.mu.RLock()` — twice (once for others, once for self,
  `hub.go:489-490`). With `activityEvery` at 4 s the desktop app's Rich Presence
  can drive this continuously. All of it under a read lock that blocks
  `register`/`unregister`.
- **Fix**: cache the co-member set per user with a short TTL and invalidate on
  join/leave, or push presence per-server rather than per-user.

### [BAD] `SubchatsFor` runs a nested query while its own result set is open
- **Where**: `internal/store/channels.go:260-279`
- **What**:
  ```go
  rows, err := s.db.R.QueryContext(...)
  defer rows.Close()
  for rows.Next() {
      ...
      if c.Recipients, err = s.Participants(ctx, c.ID); err != nil { ... }   // second query, same pool
  }
  ```
  `s.db.R` is capped at 8 connections on SQLite (`internal/db/db.go:64`).
- **How it fails**: eight concurrent `GET /api/v1/channels/{id}/subchats` (or the
  `deleteConversation` path at `internal/api/group_handlers.go:111`). Each holds
  one reader connection for its open cursor and asks for a second for
  `Participants`. All 8 connections are held by cursors; all 8 goroutines wait for
  a free connection. `database/sql` waits on the request context, which for an
  HTTP handler has no deadline — so the deadlock persists until each client gives
  up and cancels. Every other read on the instance queues behind them. `Members`
  (`servers.go:379`) and `DMChannelsForUser` (`channels.go:188`) deliberately
  close their rows first; this one does not.
- **Fix**: drain into a slice, `rows.Close()`, then hydrate — and better, fetch all
  participants for all subchats in one `IN (...)` query as `DMChannelsForUser` does.

### [BAD] Two people uploading the same avatar at the same moment get a 500
- **Where**: `internal/store/blobs.go:42-45` (`InsertBlob`), used by
  `internal/media/store.go:134-149` (`PutPublic`)
- **What**: `PutPublic` does `BlobBySHA` → not found → `commit` → `InsertBlob`.
  `InsertBlob` has no `ON CONFLICT`, and the schema has
  `CREATE UNIQUE INDEX blobs_sha_kind ON blobs(sha256, kind)`
  (`internal/db/migrations-postgres/0011_init.sql:410`).
- **How it fails**: two users set the same image as their avatar within the same
  few hundred milliseconds. Both `BlobBySHA` lookups miss. Both `commit` (idempotent
  — `commit` no-ops when the destination exists). The second `InsertBlob` violates
  the unique index; the error is not classified, so `WriteError` falls through to
  the `default` branch at `internal/api/errors.go:54` and returns 500 "Something
  went wrong on the server". The user sees a failed avatar upload for no visible
  reason; retrying succeeds, because by then `BlobBySHA` finds the row.
- **Fix**: on `db.IsUniqueViolation`, re-run `BlobBySHA` and take the existing
  reference, as the found-branch already does.

### [BAD] A failed `FinishUpload` strands a completed upload forever
- **Where**: `internal/api/upload_handlers.go:208-221`
- **What**: `FinishSpool` renames the spool file into the blob directory and
  inserts the blob row (`internal/media/store.go:255-280`). `FinishUpload` — the
  DB write recording `blob_id` on the upload row — is a separate statement
  afterwards.
- **How it fails**: a 4 GB file finishes uploading. `FinishSpool` succeeds: the
  bytes are committed, the blob row exists with `ref_count = 0`. `FinishUpload`
  fails. The handler returns 500. The client retries
  `POST /api/v1/uploads/{id}/finish`: `up.BlobID` is still nil, so the handler
  calls `FinishSpool` again — but `os.Stat(spoolPath)` now fails, because the file
  was renamed away, so it returns `ErrNotFound` → 404. Every retry 404s. The
  blob is GC'd 24 hours later (`cmd/chatd/main.go:160`) and the user must upload
  all 4 GB again. `handleUploadStatus` meanwhile reports `received == size`,
  so the client has no signal to restart from scratch either.
- **Fix**: have `FinishSpool` return the blob it created and make the finish
  handler idempotent by looking the blob up by name when the spool is gone; or
  write `blob_id` in the same transaction as `InsertBlob`.

### [BAD] Banning is three independent writes with no rollback
- **Where**: `internal/api/server_handlers.go:1509-1529`
- **What**: `Ban` → `removeMember` → `DeleteMessagesByUserSince`, each independent.
- **How it fails**: `removeMember` fails after `Ban` committed (e.g. the
  `dropVoice` → `ChannelByID` inside it errors, or `RemoveMember` hits a busy
  timeout). The handler returns 500. The user is now **banned but still a member**:
  `IsMember` is true, they keep receiving every event, they can still post, and
  `addMember`'s ban check only bites on a *re*-join. The moderator sees a failure
  and has no way to tell what landed. Retrying the ban re-runs `Ban`
  (idempotent, `ON CONFLICT DO UPDATE`) and then `removeMember` again, which is
  the recovery — but nothing says so.
- **Fix**: at minimum, retry `removeMember` or roll the ban back on failure; ideally
  ban+remove in one transaction with the events emitted after commit.

### [BAD] Deleting an account is a long non-transactional sequence that can stop halfway
- **Where**: `internal/api/admin_handlers.go:206-250` (`detachUser`), called from
  `internal/api/user_handlers.go:215-222`
- **What**: `detachUser` loops every server (transferring ownership or deleting
  the server, then `removeMember`) and every group DM (`removeFromGroup`), each a
  separate write, returning on the first error. `handleMeDelete` then calls
  `DeleteAccount`.
- **How it fails**: `POST /api/v1/users/@me/delete` for a user in 10 servers.
  Server 4's `removeMember` fails. The user has already been removed from servers
  1–3 (with `member_remove` and `key_rotation_needed` broadcast, and their keys
  rotated) and is still in 4–10. `DeleteAccount` never runs, so the account is
  intact and the password still works. The user retries; the already-processed
  servers are skipped (`ServersForUser` no longer lists them) so it converges —
  but in the window the user has been half-ejected from their servers with no
  indication, and if `s.Store.DeleteServer` at line 217 ran for a server whose
  successor lookup said "nobody left", that deletion is not undone.
- **Fix**: make the whole thing resumable and idempotent by design (it nearly is),
  and record progress so a partial run is visible; or do the membership removals
  in one transaction and emit afterwards.

### [BAD] The public invite-preview route has no rate limit and does unbounded work
- **Where**: route at `internal/api/server_handlers.go:60`, handler body at
  `:1644-1653`
- **What**: `mux.HandleFunc("GET /api/v1/invites/{code}", s.handleInvitePreview)`
  — registered raw. Every other public route goes through `ipLimited(...)`
  (`auth_handlers.go:64-68`, `guest_handlers.go:54-55`). The handler then does
  `MemberCount`, `MemberIDs` (every member id), and calls `hub.Online(id)` in a
  loop — each taking `h.mu.RLock()`.
- **How it fails**: anyone who knows an invite code for a 50 000-member server can
  loop `GET /api/v1/invites/{code}` with no limit. Each request reads 50 000 rows
  and takes `h.mu.RLock()` 50 000 times, blocking gateway `register`/`unregister`
  (which need the write lock) for the duration. A handful of concurrent requests
  stalls every new WebSocket connection on the instance.
- **Fix**: wrap it in `ipLimited(s.limGeneric, ...)` and replace the per-id
  `Online` loop with a single `OnlineUsers()` snapshot intersected against the
  member set — or cache the online count per server.

### [BAD] Shutdown closes the database while gateway goroutines are still using it
- **Where**: `cmd/chatd/main.go:144-153`
- **What**:
  ```go
  cancel()
  hub.CloseAll(websocket.StatusGoingAway, "server restarting")
  httpSrv.Shutdown(shutdownCtx)
  database.Close()
  ```
  `http.Server.Shutdown` explicitly *"does not attempt to close nor wait for
  hijacked connections such as WebSockets"* — and `websocket.Accept` hijacks.
- **How it fails**: on every restart with N connected clients, `CloseAll` starts N
  close handshakes. Each `ServeHTTP` then runs its tail
  (`internal/gateway/conn.go:271-288`): `unregister`, `OnConnClose` (voice detach,
  `broadcastVoiceLeave` → `ChannelByID`), `UserByID`, `broadcastPresence` (→
  `Friends`, `DMChannelsForUser`, `MemberIDs`), `OnDisconnect`. `Shutdown` returns
  as soon as the *non-hijacked* requests finish — typically immediately — so
  `database.Close()` runs while those queries are in flight. They fail with
  `sql: database is closed`; the errors are mostly swallowed. On SQLite the
  `PRAGMA wal_checkpoint(TRUNCATE)` in `db.Close` (`internal/db/db.go:180`) also
  fails silently because reader connections are still open, so the WAL is not
  truncated (harmless, it replays on next start, but the intent is defeated).
- **Fix**: track live gateway connections with a `sync.WaitGroup` and wait for it
  (bounded) between `Shutdown` and `database.Close()`.

### [BAD] `turnCache` is a process-global map that is never swept
- **Where**: `internal/api/voice_glue.go:452-461`, written at `:533-538`
- **What**: a package-level `map[ids.ID]struct{at; servers}` holding minted TURN
  credentials. Entries are added on every `GET /api/v1/voice/ice` by an account
  user, read with a `time.Since(hit.at) < turnReuse` freshness check, and
  **never deleted**.
- **How it fails**: every user who has ever fetched ICE config keeps an entry for
  the life of the process — a slice of `map[string]any` with URLs, a username and
  a credential, a few hundred bytes each. An instance with 100 000 users that
  never restarts holds all 100 000 forever, including for users who were deleted.
  It is also package-level rather than per-`Server`, so tests and any second
  `Server` in one process share it.
- **Fix**: sweep on read (or from `StartLimiters`'s ticker) and make it a field on
  `Server`.

### [BAD] The gateway's fan-out helpers all use `context.Background()`
- **Where**: `internal/gateway/hub.go:364` (`EmitChannel`), `:393` (`UserUpdated`),
  `:402` (`KeysMaybeNeeded`), `internal/gateway/activity.go:432,439`
  (`broadcastUser`)
- **What**: these run database queries with an unbounded context, and are called
  synchronously from HTTP handlers (e.g. `internal/api/message_handlers.go:313-314`
  on every message send).
- **How it fails**: the client cancels a `POST /messages` (navigates away, mobile
  network drops). `r.Context()` is cancelled, so the handler's own queries abort —
  but `EmitChannel` and `KeysMaybeNeeded` have already been entered with
  `context.Background()`. If the database is slow or wedged they block
  indefinitely: `EmitChannel` → `Viewers` → `ChannelViewers` → `allMembers` pages
  1 000 members at a time with no deadline. The goroutine is pinned, holding a
  reader connection, with nothing able to cancel it. Enough of these and the read
  pool (8 on SQLite) is gone.
  `PresenceChanged` (`hub.go:471`) does use a 5 s timeout — so the pattern is
  known, just not applied consistently.
- **Fix**: give them the caller's context, or at minimum a timeout like
  `PresenceChanged` has.

### [BAD] `store.Needs` is O(conversations × members) and is on the key-sync path
- **Where**: `internal/store/keys.go:283-317`, exposed at
  `internal/api/key_handlers.go:35-42`
- **What**: for each conversation the user holds the latest key of, it calls
  `Entitled` → for a server channel that is `channelViewers` → `ServerByID` +
  `Roles` + `Overwrites` + `allMembers` (paged 1 000) + `instanceAdmins`, then
  `UsersLackingGrant` → `HoldersOf`. Nothing is cached across iterations.
- **How it fails**: `GET /api/v1/keys/needs` for a user holding keys for 50
  conversations across servers with 2 000 members: ~50 × (5 queries + 2 pages of
  1 000 rows) plus a full `instanceAdmins` scan of the users table each time. The
  client calls this on connect and after every `keys_needed`. Seconds of database
  time per call, and it is not rate-limited beyond `limGeneric` (600/min).
- **Fix**: memoise `instanceAdmins`, `Roles` and `allMembers` per server across
  the loop.

### [BAD] A wrong JSON type in `PATCH /users/@me` clears the field instead of returning 400
- **Where**: `internal/api/user_handlers.go:56-68`, used at `:86-129`
- **What**: `getString` returns `("", true, true)` — "present and null" — both when
  the value is literal `null` **and** when `json.Unmarshal` into a string fails
  (line 65-67). For `about_me`, `pronouns`, `status_text` and `status_emoji` the
  handler maps "null" to "clear it" (`if null { v = "" }`).
- **How it fails**: `PATCH /api/v1/users/@me` with `{"about_me": 42}` — a client
  bug, a mis-typed integration. The server does not reject it: it silently sets
  About Me to the empty string and returns 200. The user's bio is gone with no
  error anywhere. `username`, `display_name`, `presence_pref` and `dm_privacy` do
  reject it (they treat null as invalid), so the behaviour is inconsistent within
  the same handler.
- **Fix**: distinguish "literal null" from "wrong type" and return
  `invalid_*` for the latter.

### [BAD] `removeFromGroup` decides "is the group empty" from a stale snapshot
- **Where**: `internal/api/group_handlers.go:181-191`
- **What**: `remaining` is computed by filtering `ch.Recipients` — loaded by
  `dmChannel` before the removal — rather than re-reading.
- **How it fails**: the last two members of a group leave at the same time. Both
  requests loaded `ch.Recipients == [A, B]`. A's handler computes
  `remaining == [B]`; B's computes `remaining == [A]`. Neither sees an empty group,
  so `deleteConversation` never runs. An empty group DM row survives with an
  `owner_id` pointing at someone who is not in it, along with all its messages,
  subchats, key epochs and blob references. Nothing ever cleans it up. (The sibling
  handler at `channel_handlers.go:349` re-reads — and has the opposite bug above.)
- **Fix**: re-read participants inside the same write transaction as the removal,
  and delete when the count hits zero there.

### [BAD] `CanRotate` is a permission hook that always returns true
- **Where**: `internal/api/server_glue.go:123-128`
- **What**:
  ```go
  s.CanRotate = func(ctx context.Context, u *store.User, conv ids.ID) (bool, error) {
      if _, err := s.Store.ServerByID(ctx, conv); err == nil {
          return true, nil // any member holding the key may rotate the server root
      }
      return true, nil
  }
  ```
  Both branches return `true`; the lookup is dead code. The field is documented at
  `internal/api/router.go:99` as *"restricts who may create key epochs"*.
- **How it fails**: `POST /api/v1/keys/epochs` at
  `internal/api/key_handlers.go:172-177` is the only caller, and its only real
  guard is `Entitled` membership (lines 157-171). So **any member of a server can
  create a new key epoch for the whole server**, invalidating everyone's cached
  keys and forcing a re-grant round for every member — a one-request denial of
  service against a community, repeatable. Whether that is intended is a design
  question; what is certain is that the hook that exists to answer it does not.
- **Fix**: require `perms.ManageServer` (or holding the current epoch's grant) for
  a server-root rotation, and delete the dead branch.

### [BAD] SQLite runs with `synchronous=NORMAL`, so an acknowledged message can vanish
- **Where**: `internal/db/db.go:47`
- **What**: the DSN sets `_pragma=synchronous(NORMAL)` with `journal_mode(WAL)`.
  In that combination a committed transaction is **not** fsynced; it is durable
  only after the next checkpoint.
- **How it fails**: a user sends a message. `InsertMessage` commits,
  `handleMessageCreate` returns 201 and `EmitChannel("message_create", full)` has
  already delivered it to every other connected client. The machine loses power
  before the checkpoint. On restart SQLite recovers the WAL to its last synced
  point; the message is gone from the server. The recipients' clients still hold
  it in memory and in their own stores, so the conversation silently diverges — and
  since messages are end-to-end encrypted, no server-side reconciliation is
  possible. The sender has a 201 for a message the server does not have.
- **Theoretical rather than traced**: this needs a real power loss, which I did not
  stage. It is the documented behaviour of the pragma.
- **Fix**: either accept it and say so in the deploy notes, or use
  `synchronous(FULL)` for the writer pool (readers do not matter). The write
  volume here is small enough that the fsync cost is likely acceptable.

### [BAD] `handleVoiceOp` reads the registry four times to decide one thing
- **Where**: `internal/api/voice_glue.go:254-258`
- **What**: `MemberCount`, `RecentlyActive`, `Count`, `Get` are four separate
  `RLock`/`RUnlock` cycles on the voice registry, and the decision
  (`wasEmpty`, `resumed`, `inSame`) is made from the four inconsistent snapshots.
  The gateway serialises ops *per connection*, not per user.
- **How it fails**: a user opens the same DM in two tabs and joins the call from
  both within a few milliseconds. Both connections compute `wasEmpty == true` and
  `inSame == false`. Both take the branch at line 316: two `call_ring` events to
  the other party (their phone rings twice) and **two `system_call` messages**
  inserted into the channel (line 332), so the transcript shows the call starting
  twice.
- **Fix**: make the join decision inside one `Registry` method that holds the lock
  and returns "was this the first member".

### [BAD] `voiceAudience` returns nobody when the viewer lookup fails
- **Where**: `internal/api/voice_glue.go:150-163`
- **What**: `out, _ = s.Store.ChannelViewers(ctx, ch.ID)` — error discarded,
  leaving `out` nil.
- **How it fails**: any transient read error while someone joins or leaves a server
  voice channel means `EmitUsers(nil, "voice_state", ...)` — which returns
  immediately (`hub.go:264`). Nobody is told the participant joined or left. The
  participant is in the registry, so a page refresh shows them, but live clients
  show a stale call roster indefinitely (there is no periodic reconcile).
- **Fix**: propagate the error to the caller so it can send `voice_error` instead
  of half-succeeding.

### [BAD] Gateway goroutines have no panic recovery
- **Where**: `internal/gateway/conn.go:267-268` (`go c.writeLoop()`,
  `go c.pingLoop()`), `internal/gateway/activity.go:325` (`go c.resolveLoop()`),
  `internal/gateway/conn.go:205` and `:388`, `internal/gateway/activity.go:435`
  (`time.AfterFunc` callbacks), `internal/api/sfu_handlers.go:418`
- **What**: `Recover` (`internal/api/middleware.go:75`) only wraps the HTTP
  handler chain. Everything the gateway does after the upgrade — the write loop,
  the ping loop, the activity resolver, the presence and activity timers, the SFU
  session closer — runs on bare goroutines. A panic in any of them kills the whole
  process, dropping every other connection with it.
- **How it fails**: no specific panic traced (the slicing in `cleanLine` and
  `applyPresence` is safe because `CleanText` returns `ok == false` only when the
  result is longer than `max`, `internal/textutil/textutil.go:30`). The concern is
  structural: the race at `conn.go:465` combined with a nil `c.user` read would do
  it, as would any future nil in the activity path.
- **Fix**: a small `go safely(func(){...})` wrapper that recovers and logs.

### [BAD] Raw `lower()` in two queries defeats the Unicode folding the dialect layer exists for
- **Where**: `internal/store/instance.go:88`, `internal/store/expressions.go:314`
- **What**: `Dialect.Lower` exists (`internal/db/dialect.go:47-52`) precisely
  because SQLite's built-in `lower()` folds ASCII only, and the store registers a
  `ulower()` that folds the way Go does (`internal/store/users.go:19-29`).
  `SearchUsers` and `Members` use it; `AdminUsers` and `PublicPacks` call raw
  `lower()`.
- **How it fails**: on SQLite, an admin searching `/api/v1/admin/users?q=łukasz`
  never finds the account whose display name is `Łukasz`, while
  `/api/v1/users/search?q=łukasz` does. Same for a public sticker pack named
  `Ñandú`. The two paths disagree, and only on SQLite — on Postgres both work.
- **Fix**: use `s.db.Dialect.Lower(...)` in both places.

### [BAD] `hub.Viewers` and `hub.CanAccess` spell out DM types instead of using `IsDMLike`
- **Where**: `internal/gateway/hub.go:332`, `:347`, `internal/gateway/conn.go:584`
- **What**: `if ch.Type == "dm" || ch.Type == "group_dm"` — `"subchat"` falls
  through to the `ViewerResolver`/`Access`/`SendAccess` hooks, which happen to do
  the right thing via `store.ChannelViewers` and `store.ChannelPerms`.
  `store.IsDMLike` (`internal/store/channels.go:25`) exists for this.
- **How it fails**: two consequences. (1) Every typing indicator and every
  `EmitChannel` on a subchat costs two extra `ChannelByID` round trips, because
  the hook re-loads the channel the caller already has. (2) The DM branch checks
  `DMBlocked` (`hub.go:353`, `conn.go:589`); the hook branch does not — so after A
  blocks B, B can still send typing indicators into a subchat of their 1:1 DM,
  which A's client will display.
- **Fix**: use `store.IsDMLike(ch.Type)` in all three places and let the DM branch
  handle subchats.

### [BAD] `emitServer`, `emitServerWithPerm` and `syncVisibility` drop their errors
- **Where**: `internal/api/server_handlers.go:110-116`, `:120-131`, `:163-171`
- **What**: all three `return` silently when the member/viewer lookup fails.
- **How it fails**: any read error during a server update means the event reaches
  nobody, while the HTTP response says 200. There is no retry and no reconcile —
  clients stay stale until someone reconnects. For `syncVisibility` specifically,
  a failed `snapshotVisibility` (its error is also discarded at every call site,
  e.g. `:580`, `:850`, `:1409`) means `before` is nil, so *every* channel a member
  can currently see looks newly-visible and they get a `channel_create` storm — or,
  with `after` failing, nothing at all.
- **Fix**: log at minimum; better, make the emit failures visible in the response
  or retryable.

### [POLISH] `Dialect.Bump` is dead code that corrupts SQL when a column name is a substring
- **Where**: `internal/db/dialect.go:59-64`
- **What**: `strings.ReplaceAll(expr, column+",", table+"."+column+",")`. Nothing
  in the repo calls it (`grep -rn "Bump("` → only its definition).
- **Why it matters**: if it is ever used with `column = "count"` and an expression
  containing `view_count,`, the replace produces `view_t.count,` — silently
  invalid SQL. And it only qualifies occurrences immediately followed by a comma,
  so `greatest(?, last_seen)` would be left unqualified.
- **Fix**: delete it, or make it take the identifier positions explicitly.

### [POLISH] `retryAfter` contains a no-op expression
- **Where**: `internal/api/auth_handlers.go:271`
- **What**: `return time.Duration(secs).String()[:0] + itoa(secs)` —
  `...String()[:0]` is always `""`. It formats a Duration and throws it away on
  every rate-limited response.
- **Fix**: `return strconv.Itoa(secs)`. The hand-rolled `itoa` at `:274-286` and
  the second one at `internal/db/dialect.go:96-106` can go too.

### [POLISH] `store.contains` reimplements `strings.Contains` in O(n·m)
- **Where**: `internal/store/keys.go:123-132`
- **What**: a hand-written substring search used only by `isFKError`. `strings` is
  already imported by five other files in the same package.
- **Fix**: `strings.Contains`.

### [POLISH] Two thirds of the `Ev*` event constants are unused, and two events are raw strings
- **Where**: `internal/gateway/protocol.go:39-86`
- **What**: `EvMemberAdd`, `EvMemberUpdate`, `EvMemberRemove`, `EvRoleDelete`,
  `EvServerUpdate`, `EvBanAdd`, `EvBanRemove`, `EvEmojiUpdate`, `EvSessionExpired`,
  `EvKeyGrant`, `EvReadState`, `EvPinUpdate`, `EvSettingsUpdate`,
  `EvInviteCreate`, `EvInviteDelete`, `EvChannelPositions`, `EvStickerUpdate` and
  others have **zero** references outside the file that defines them — the handlers
  emit bare string literals instead. Meanwhile two events the clients depend on,
  `"key_rotation_needed"` (`internal/api/channel_handlers.go:371` and three more)
  and `"voice_error"` (`internal/api/voice_glue.go:216`), have no constant at all.
- **Why it matters**: `protocol.go` reads as the protocol's source of truth and is
  not. A typo in a literal (`"mesage_create"`) compiles and ships.
- **Fix**: use the constants everywhere, add the two missing ones, and let the
  compiler catch the rest.

### [POLISH] System messages go out over the gateway with `attachments: null, reactions: null`
- **Where**: `internal/api/channel_handlers.go:36-47`, `internal/api/voice_glue.go:332-336`
- **What**: `systemMessage` broadcasts the freshly-constructed `*store.Message`
  without hydrating it, so `Attachments` and `Reactions` are nil slices and
  marshal as `null`. Every REST path returns `[]` for the same message, because
  `scanMessage` initialises them (`internal/store/messages.go:85-86`).
- **How it fails**: the web client declares them non-optional
  (`web/src/api/types.ts:400-401`) and `Reactions.tsx:59` does
  `msg.reactions.length`. It happens not to crash today only because
  `MessageItem.tsx:139` short-circuits `system_*` types into `<SystemMessage>`
  before reaching `<Reactions>`; `web/src/lib/export.ts:147` does copy the null
  through. Android is safe via `coerceInputValues`.
- **Fix**: set `m.Attachments = []store.Attachment{}` and
  `m.Reactions = []store.ReactionSummary{}` before emitting, or emit through
  `MessageByID` as `handleMessageCreate` does.

### [POLISH] `LIMIT` without a deterministic `ORDER BY`
- **Where**: `internal/store/messages.go:499` (`AttachmentByBlob`,
  `... WHERE blob_id = ? LIMIT 1`), `internal/store/blobs.go:65`
  (`UnreferencedBlobs`, `... LIMIT 500` with no ORDER BY)
- **What**: `AttachmentByBlob` picks an arbitrary attachment row when a blob has
  more than one, and its `ChannelID` is what
  `internal/api/channel_handlers.go:429-438` checks access against.
  `UnreferencedBlobs` picks an arbitrary 500 for the GC sweep.
- **Why it matters**: today one blob can only be attached once —
  `handleMessageCreate:292` refuses a reused blob and `FinishSpool` gives every
  encrypted upload a unique name — so the access check is unambiguous *by accident*.
  If that ever changes, the permission check silently consults the wrong channel.
  The GC one is harmless (each pass deletes what it found, so it makes progress).
- **Fix**: `ORDER BY id LIMIT 1` / `ORDER BY created_at, id LIMIT 500`.

### [POLISH] `Pins` and `Reactors` truncate with no pagination and a non-unique sort key
- **Where**: `internal/store/messages.go:476` and `:424-442`
- **What**: `Pins` is `ORDER BY p.pinned_at DESC LIMIT 500` — millisecond
  timestamps tie, so pins made in the same millisecond come back in an arbitrary
  and possibly varying order, and pin 501 is unreachable. `Reactors` caps at 100
  with no cursor, so a message with 300 reactors only ever shows 100.
- **Fix**: add `, p.message_id DESC` as a tie-break and a `before` cursor.

### [POLISH] `has_attachments` is written, scanned and thrown away
- **Where**: written at `internal/store/messages.go:117`, scanned into `hasAtt` at
  `:66` and never read
- **What**: the column exists and is maintained, `scanMessage` reads it into a
  local and drops it, and `Message` has no field for it. Clients infer it from
  `attachments.length`.
- **Fix**: drop the column from `messageCols` and the schema, or expose it.

### [POLISH] `Recover` writes a JSON error after a partially-written response
- **Where**: `internal/api/middleware.go:77-85`
- **What**: on panic it calls `WriteError(w, ...)`, which sets headers and calls
  `w.WriteHeader(500)`.
- **How it fails**: a panic inside `json.NewEncoder(w).Encode(v)` at
  `internal/api/respond.go:15` — after `WriteHeader(200)` and after some bytes
  have gone out. The recover appends `{"error":...}` to the half-written JSON and
  logs `superfluous response.WriteHeader`. The client gets a body that parses as
  neither. Rare, but the 500 status the caller sees in the log never reached the
  wire.
- **Fix**: track whether anything was written (the `statusWriter` already can) and
  skip the body when it was.

### [POLISH] `err == store.ErrX` instead of `errors.Is` in six places
- **Where**: `internal/store/perms.go:66`, `:127`;
  `internal/api/message_handlers.go:299`, `:547`;
  `internal/api/key_handlers.go:201`; `internal/api/user_handlers.go:259`;
  `internal/api/server_handlers.go:1695`; `internal/api/group_handlers.go:252`, `:262`
- **What**: all correct today because the sentinels are returned unwrapped, and all
  silently wrong the first time someone adds `fmt.Errorf("...: %w", err)` to a
  store method. The same files use `errors.Is` elsewhere.
- **Fix**: `errors.Is` throughout.

### [POLISH] `UploadByID` returns a filled struct alongside an error
- **Where**: `internal/store/uploads.go:38-44`
- **What**: on a non-`ErrNoRows` scan error it still runs `u.BlobID = idPtr(blob)`
  and returns `&u, err`.
- **Fix**: return `nil, err`.

### [POLISH] `UpdateMessage` writes 0 where `InsertMessage` writes NULL
- **Where**: `internal/store/messages.go:278` vs `:117`
- **What**: the insert uses `nullID(m.KeyConvID)` and a nil-checked `epoch`; the
  update passes `int64(keyConv)` and `keyEpoch` directly. An edit with a zero
  conversation would turn `key_conv_id` from NULL into 0, which `idPtr` then reads
  back as a pointer to ID(0) and the client sees `"key_conv_id": "0"`.
- **Why it is only POLISH**: `checkEnvelope`
  (`internal/api/message_handlers.go:144`) rejects a zero `env.Conv` before this is
  reached, so no caller can trigger it today.
- **Fix**: use `nullID`/`nullInt` for symmetry.

### [POLISH] `store.ErrTooMany`, `ErrLimit` and `ErrBanned` are not mapped in `WriteError`
- **Where**: `internal/api/errors.go:36-57`
- **What**: the three sentinels would fall through to the `default` branch and
  become a 500 with "Something went wrong on the server". All three happen to be
  intercepted at their only call sites today
  (`subchat_handlers.go:205`, `message_handlers.go:547`,
  `server_handlers.go:1689`), so nothing is broken — but a new caller of
  `CreateSubchat` or `AddMember` would produce a 500 for a perfectly ordinary
  "limit reached" or "banned".
- **Fix**: map them centrally (400 / 400 / 403).

### [POLISH] Pinning an already-pinned message returns 409 instead of being idempotent
- **Where**: `internal/store/messages.go:445-457`, surfaced at
  `internal/api/channel_handlers.go:471` and `internal/api/errors.go:46`
- **What**: `PinMessage` returns `ErrAlreadyExists` when the `ON CONFLICT DO
  NOTHING` affects no rows, which maps to 409.
- **How it fails**: the `PUT` verb implies idempotency, and a client that retries
  after a timeout (having actually succeeded) gets a 409 it has to special-case.
  `handleUnpin` has the mirror problem: a repeat returns 404.
- **Fix**: return 204 on a repeat for both.

### [POLISH] `s.Meter` nil-guarding is inconsistent
- **Where**: guarded at `internal/api/voice_glue.go:378`, `:467`,
  `internal/api/guest_handlers.go:325`, `internal/api/sfu_handlers.go:430`;
  unguarded at `internal/api/sfu_handlers.go:144`, `:246`, `:288`, `:400`
- **What**: the invariant that `s.Realtime != nil ⟹ s.Meter != nil` holds because
  `WireVoice` creates them together (`voice_glue.go:97-102`) and every SFU handler
  goes through `sfuCaller`, which returns early when `s.Realtime == nil`. But four
  call sites dereference `s.Meter` while four others check it, so the invariant is
  neither enforced nor obviously relied upon.
- **Fix**: pick one — either assert it once in `WireVoice` or nil-check everywhere.

### [POLISH] `Meter.SetSourceLive`'s early-return condition is written backwards
- **Where**: `internal/realtime/meter.go:162`
- **What**: `if !m.off[source] == live { return }` parses as
  `(!m.off[source]) == live` and is correct, but reads as if it meant
  `!(m.off[source] == live)`.
- **Fix**: `if m.off[source] != live { ... }` inverted, or a named local.

### [POLISH] Invite codes are modulo-biased and have no conflict handling
- **Where**: `internal/store/invites.go:15-22`, `internal/store/guests.go:57-64`
- **What**: `inviteAlphabet[int(b[i])%len(inviteAlphabet)]` with a 56-character
  alphabet over 256 byte values — the first 24 characters are ~14 % more likely.
  `CreateInvite` then inserts with no `ON CONFLICT`, so a code collision (56⁸ ≈
  9.6e13, so vanishingly rare) is a raw unique-violation → 500.
- **Fix**: rejection sampling, and retry once on a unique violation.

### [POLISH] The server secret is written without fsyncing its directory
- **Where**: `cmd/chatd/main.go:265-283`
- **What**: the file's contents are `Sync()`ed and it is renamed into place — the
  careful part — but the *directory* entry is never fsynced.
- **How it fails**: first start, secret generated and renamed, machine loses power
  within the writeback window. On reboot the file may not exist. `loadOrCreateSecret`
  generates a **new** one, and every TOTP seed sealed under the old secret becomes
  undecryptable — exactly the outcome the comment at lines 244-246 says it is
  guarding against.
- **Fix**: open the parent directory and `Sync()` it after the rename.
  `internal/media/store.go:283-295` has the same gap for blob commits.

### [POLISH] `groupInviteJoin` sends `channel_create` to members who were already in the group
- **Where**: `internal/api/group_handlers.go:274`
- **What**: `s.Bcast.EmitUsers(updated.Recipients, "channel_create", updated)` — the
  whole recipient list. The sibling path `handleRecipientAdd`
  (`internal/api/channel_handlers.go:310-311`) correctly sends `channel_create` to
  the newcomer and `channel_update` to everyone else.
- **Why it is only POLISH**: the web client's `channel_create` handler upserts, so
  the result is the same. It is a protocol inconsistency, not a visible bug.
- **Fix**: match `handleRecipientAdd`.

### [POLISH] `CreateServerChannel` runs a query that can never match
- **Where**: `internal/store/servers.go:632-639`
- **What**: for a non-category channel it first queries
  `WHERE ... AND type = 'x'` (built by `map[bool]string{true:"category",false:"x"}[...]`),
  gets NULL, then immediately re-queries with the correct predicate.
- **Fix**: pick the query once; drop the `map[bool]string` allocation while you are
  there (it appears five times in `server_handlers.go` too).

### [POLISH] Subchats never report an unread count
- **Where**: `internal/store/readstates.go:79`
- **What**: `CASE WHEN f.type IN ('dm','group_dm') THEN (...) ELSE 0 END` — the
  capped unread count is computed for DMs and groups but not for `subchat`, even
  though subchats are DM-like everywhere else (`store.IsDMLike`) and are listed by
  `DMChannelsForUser`.
- **Why it is only POLISH**: the web's subchat list uses
  `isUnread(rs, ch.last_message_id)` and `rs.mentions` rather than `unread_count`
  (`web/src/components/chat/SubchatPanel.tsx:136,155`), and mention counts *are*
  computed for subchats. So nothing is visibly wrong today.
- **Fix**: use `store.IsDMLike`'s type set in the `CASE`.

### [POLISH] `store.IsInstanceAdmin` turns any error into "not an admin"
- **Where**: `internal/store/perms.go:32-38`
- **What**: `if err := ...Scan(&flags); err != nil { return false }`.
- **How it fails**: during a brief read failure an instance admin silently loses
  every elevated permission (`ServerPerms`, `ChannelPerms`, `actorHighest` all
  consult it) and gets a 403 or a 404 instead of a 500. Misleading rather than
  dangerous — it fails closed.
- **Fix**: return `(bool, error)` and let callers decide.

### [POLISH] `RecordClientError` trims the table on every insert, outside a transaction
- **Where**: `internal/store/errors_log.go:36-41`
- **What**: every crash report runs
  `DELETE FROM client_errors WHERE id NOT IN (SELECT id FROM client_errors ORDER BY id DESC LIMIT 500)`
  — a full scan of the table — as a second, separate statement.
- **How it fails**: a client in a crash loop posts reports as fast as the rate
  limit allows, and each one drives a full scan plus a delete on the single SQLite
  writer. A crash between the two statements leaves the table one over the cap
  (self-healing).
- **Fix**: trim on a timer, or only when `count > cap * 1.1`.

### [POLISH] `sweep()` is nearly unreachable
- **Where**: `internal/gateway/hub.go:100-115`
- **What**: `pingLoop` refreshes `c.beat` on every answered ping
  (`internal/gateway/conn.go:315`), every 12 s, and closes the connection itself
  when a ping fails. So the 60 s heartbeat sweep only ever fires for a peer whose
  TCP stack answers protocol pings while its JavaScript is dead — which is the
  documented intent (`conn.go:24-30`), but means the sweep's cost (walking every
  connection under `RLock` every 5 s) buys very little.
- **Fix**: none needed; noted so nobody "fixes" the ping loop and quietly disables
  the sweep's only real case.

---

## Where a test would have caught it

Existing coverage is genuinely good on the happy paths — `internal/store` has
~20 tests, `internal/gateway` covers ready ordering, heartbeat timeout, revoked
sessions, activity coalescing and op flooding, and `make test-go` already runs
`go vet` and `-race`. The gaps are concentrated in error paths and in the
Postgres dialect.

1. **The Postgres suite exists and is never run.**
   `internal/store/testutil_test.go:21-35` runs the entire store suite against
   Postgres when `CHAT_TEST_POSTGRES` is set — and `make test-go`
   (`Makefile:21-22`) does not set it. `TestConcurrentCreateDMMakesOneConversation`
   (`internal/store/channels_test.go:87`) would **fail today** under Postgres and
   catch the `CreateDM` race. Adding a CI job that starts the embedded Postgres
   (the harness is already there at `internal/db/pg_test.go:16`) and exports the
   variable is the single highest-value change in this list. It would also cover
   the `MaxSubchats` and `MaxReactionEmoji` races.

2. **Error paths in handlers are untested.** Every `x, _ :=` finding above needs
   a store that can be told to fail. A tiny fault-injecting wrapper around
   `*db.Conn` (fail the Nth query) plus table-driven tests would catch
   `channel_handlers.go:349` (the group-deleting one), `server_handlers.go:995`,
   `auth_handlers.go:406`, and the eight `null`-broadcast sites in one pass.
   A cheaper 80 % version: a test that asserts **no gateway event ever carries a
   `null` payload** — run the whole `internal/api` suite with a broadcaster that
   fails on `data == nil`.

3. **The `c.user` race needs a reader while the presence timer fires.**
   `TestPresenceChangesCoalesce` (`internal/gateway/hub_test.go:324`) already
   sends eight presence ops and so schedules the timer. Adding one `typing` op
   (or one call to `hub.sweepSessions`) between the sends and the assertion turns
   it into a `-race` failure.

4. **`goLive`'s buffer arithmetic has no test.** A test that emits exactly
   `sendBuffer` events to a connection between `register` and `goLive` would pin
   the invariant; today changing `sendBuffer` from 256 silently arms a hub-wide
   deadlock.

5. **Upload finish is not tested for a mid-flight failure.**
   `internal/api/upload_handlers_test.go` covers resume and offset conflicts but
   not "FinishSpool succeeded, FinishUpload failed". A test asserting that a
   second `POST /uploads/{id}/finish` returns the same blob in that case would
   catch the stranded-upload bug.

6. **Concurrent identical public uploads.** Two goroutines calling
   `Media.PutPublic` with the same bytes should both get a blob back; today one
   gets a unique-violation 500. One test, `internal/media/media_test.go`.

7. **Ban with message purge is only tested on the happy path.** A test where the
   Nth `DeleteMessage` fails should assert that the events for the ones already
   deleted still go out.

8. **Shutdown ordering.** `cmd/chatd/main_test.go` covers `loadOrCreateSecret` and
   `sweepTemp` but not the shutdown sequence. A test that opens a gateway
   connection, triggers shutdown, and asserts no `sql: database is closed` is
   logged would catch the ordering bug — and would need the `WaitGroup` fix to
   pass.

9. **`ratelimit.Reset` with a shared backend.** `internal/ratelimit/ratelimit_test.go`
   tests the local path; a miniredis-backed test (miniredis is already a
   dependency, `go.mod:7`) asserting that `Reset` clears the shared counter would
   catch the login-lockout bug.

10. **Two clients, one call, two tabs.** `internal/api/voice_handlers_test.go` is
    thorough but single-connection per user. A test joining an empty DM call from
    two connections of the same user and asserting exactly one `call_ring` and one
    `system_call` message would catch `voice_glue.go:254-258`.
