# Performance

## Summary

The product's front page claims it is much faster than Discord. Today that claim holds for a small
instance and small servers, and it stops holding in three specific places, all of them structural
rather than incidental.

**On the server**, nothing about permissions is cached. Every event sent to a channel resolves its
audience by loading *every member of the server with their roles* and recomputing permissions for
each of them, plus a full scan of the `users` table to find instance admins. That happens twice per
message sent (once for the fan-out, once for the key-grant check), on every typing indicator, and on
every reaction. A 10 000-member server costs roughly 20 SQL statements, ~10 000 permission
computations and a 50 000-row table scan per typing event. Separately, one API request re-resolves
the same channel permission three or four times, and a role edit in a large server runs
`ViewableServerChannels` once per member — twice.

**On the web**, the message list is not virtualised (`@tanstack/react-virtual` is a dependency and is
never imported). Every mounted row subscribes to ~14 Zustand stores and builds a fresh markdown
render context by iterating every role of every server. Two of the biggest list components subscribe
to the whole `users` map and the whole `presence` map, both of which are cloned wholesale on every
gateway presence event — so one presence packet rebuilds the member list (a collator sort over every
member), rebuilds the row array, and re-creates every message element. The entry bundle is 972 KB raw
/ 290 KB gzip before any route renders, ~17 % of which is the WebRTC/SFU voice engine that nobody
needs until a call starts — and it is downloaded even by a visitor reading the marketing page.

**On Android**, the app parses a 137–230 KB translation catalogue (sometimes two) synchronously on the
main thread in `onCreate` before the first frame; every incoming message re-sorts the entire loaded
history; the chat screen reads `listState.firstVisibleItemIndex` directly in composition (so the whole
screen recomposes on every scrolled item, and a `LaunchedEffect` keyed on it restarts a coroutine per
item); every visible message row opens four `collectAsState` subscriptions of its own; and the server
rail computes unread state by walking every channel in the app and recomputing permissions for each,
per server, per recomposition. There is no baseline profile.

Counts: **26 SEVERE, 42 NOTABLE, 16 MINOR, 6 IDEA** (90 findings).

`SEVERE` here means "a user of this instance can feel it now, or the cost grows without bound and the
constant is already large"; `NOTABLE` means it is invisible at today's size and becomes the limiting
factor as servers or the instance grow. Several server findings sit on that line: at a 20-member
server the member sweep costs four queries and nobody notices, and at 10 000 members it is the whole
budget.

Measured facts used throughout: web first-load = `main-*.js` 547 615 B (170 KB gz) + `react-*.js`
164 932 B (53.9 KB gz) + `crypto-*.js` 44 978 B (18.0 KB gz) + `main-*.css` 147 434 B (37.7 KB gz) +
`/twemoji/available.json` 66 892 B (10.5 KB gz) = **971 851 B raw, 290 138 B gzip**. `go build ./...`
passes; `npm run build` passes in 8.6 s.

---

## Cheapest big wins

1. **Cache the channel-viewer set** (`internal/store/perms.go:155`). A per-(server, channel) cache of
   the viewer list, invalidated on member/role/overwrite change, removes the entire member sweep from
   the message-send, typing and reaction paths. ~80 lines. Turns a ~20-query, 10 000-computation
   operation into a map lookup. This is the single largest server win available.
2. **Lift `useRenderCtx` out of `MessageItem`** (`web/src/lib/markdownCtx.ts:12`). It is called once per
   mounted row and iterates every role of every server; hoist it into one provider in `ChatView`.
   ~20 lines, removes an O(rows × servers × roles) pass on every user-store change.
3. **Parse the Android catalogue off the main thread** (`android/.../i18n/Strings.kt:100`,
   `MainActivity.kt:65`). `Strings.init` + `use(null)` do two full JSON parses of 137–230 KB before
   `setContent`. Move to a background load with English pre-parsed into a resource, or keep the splash
   up while it loads. ~30 lines, ~100–250 ms off every cold start.

Runners-up that are nearly as cheap: memoise `CryptoKey` in `web/src/crypto/aes.ts:28` (≈halves
per-message decrypt cost, 15 lines); add `_pragma=cache_size(-65536)` to the SQLite DSN
(`internal/db/db.go:48`, 1 line); make `AppShell` lazy in `web/src/routes.tsx:5` (1 line, moves ~100 KB
raw out of the entry chunk).

---

## Findings

## Server

### [SEVERE] Every channel event loads the whole server's member list and scans the users table
- **Where**: `internal/store/perms.go:155` (`channelViewers`), reached from `internal/gateway/hub.go:363`
  (`EmitChannel`) via `internal/api/server_glue.go:149`.
- **What**: `channelViewers` does `ServerByID` → `Roles` → `Overwrites` → `allMembers` → `instanceAdmins`,
  then runs `perms.Compute` for every member. `allMembers` (`perms.go:188`) pages `Members()` in
  chunks of 1000, and each page is two queries (a `server_members ⋈ users` join plus
  `member_roles … IN (1000 placeholders)`). `instanceAdmins` (`perms.go:42`) is
  `SELECT id FROM users WHERE flags & ? != 0` — there is no index on `users.flags`, so it is a full
  table scan. Nothing is cached anywhere.
- **Cost**: for a 10 000-member server on a 50 000-user instance: ~20 SQL statements, ~10 000 member
  rows + their role rows materialised, a 50 000-row sequential scan, ~10 000 `toPermMember` slice
  allocations and ~10 000 `perms.Compute` calls — order of 100–200 ms of CPU and one of the eight
  reader connections, **per emitted event**. It runs on every `message_create`
  (`internal/api/message_handlers.go:313`), every `message_update`/`delete`, every `reaction_add`/
  `reaction_remove` (`message_handlers.go:555,571`), every pin change, and every typing indicator
  (`internal/gateway/conn.go:600`). Ten people typing in a big server is enough to saturate the box.
- **Fix**: cache the viewer set per (server, channel) with invalidation on member add/remove, role
  change, member-role change and overwrite change; cache `instanceAdmins` in memory (it changes almost
  never). ~80 lines plus invalidation hooks. Alternative interim fix: push the whole thing into one SQL
  statement so at least it is one round trip.

### [SEVERE] The same work happens a second time per message, via `KeysMaybeNeeded`
- **Where**: `internal/api/message_handlers.go:314` → `internal/gateway/hub.go:401` →
  `internal/store/keys.go:208` (`Entitled`).
- **What**: after emitting, every send calls `KeysMaybeNeeded(conv)`. `Entitled` resolves to
  `MemberIDs(serverID)` for a server-root conversation, or to `channelViewers(...)` again
  (`keys.go:228`) for a channel with its own key. Then `HoldersOf` loads every grant holder, and
  `hub.Online(uid)` is called **per holder** (`hub.go:420`), each taking `h.mu.RLock()`.
- **Cost**: doubles the per-message cost above for private channels; for server-root conversations it
  adds a full `MemberIDs` load plus N lock acquisitions (10 000 RLock/RUnlock pairs for a 10 000-member
  server, per message).
- **Fix**: compute the online set once under a single RLock (`hub.OnlineAmong(ids)`), and share the
  viewer cache from the previous finding. Also skip the whole call when the conversation has no
  `needs_rotation` flag and no new members since the last check. ~40 lines.

### [SEVERE] A role or channel-permission edit is O(members × channels × roles), run twice
- **Where**: `internal/api/server_handlers.go:136` (`snapshotVisibility`), called at lines 580, 850,
  899, 1084, 1108, 1346, and again from `syncVisibility` at line 164.
- **What**: `snapshotVisibility` loops over every member id and calls
  `Store.ViewableServerChannels(serverID, uid)` for each. Each of those (`internal/store/perms.go:244`)
  runs `ServerByID`, `Member` (2 queries), `Roles`, `ServerChannels` (3 queries),
  `OverwritesForServer`, and `IsInstanceAdmin` — ~8 queries — then computes permissions for every
  channel. `syncVisibility` calls it a second time to diff before/after.
- **Cost**: a 10 000-member server with 50 channels: 2 × 10 000 × 8 = **160 000 SQL statements** and
  2 × 10 000 × 50 permission computations for one role edit. On SQLite that is minutes, inside an HTTP
  handler, while holding a reader connection. Then it emits one frame per member
  (`server_handlers.go:180,184,190`), each taking the hub lock separately.
- **Fix**: load roles, channels and overwrites once for the server, load all members with roles once,
  and compute the whole visibility matrix in memory — one pass, ~25 queries total instead of 160 000.
  ~60 lines, entirely local to `snapshotVisibility`.

### [SEVERE] `handleChannelPositions` does the same per-member sweep
- **Where**: `internal/api/server_handlers.go:643-656`.
- **What**: `for _, uid := range members { vis, _ := s.Store.ViewableServerChannels(...) }` then
  `EmitUsers([]ids.ID{uid}, …)` per member.
- **Cost**: 10 000 × ~8 queries for a channel drag-and-drop, plus 10 000 separate hub-lock
  acquisitions and 10 000 separately-encoded frames.
- **Fix**: same hoisting as above, and group members by identical visibility sets so one frame is built
  per distinct set (usually 1–5 sets, not 10 000). ~40 lines.

### [SEVERE] One API request resolves the same channel permission three or four times
- **Where**: `internal/api/access.go:24` (`channel`) → `internal/api/server_glue.go:105`
  (`ChannelAccess`) → `internal/store/perms.go:108` (`ChannelPerms`); called again at
  `internal/api/message_handlers.go:231`, `:253`, `:259`.
- **What**: `ChannelPerms` costs ~9 queries (`ChannelByID` is itself 3: channel row, `LatestEpoch`,
  `Overwrites`; plus `ServerByID`, `Member` ×2, `Roles`, `Overwrites` again, `IsInstanceAdmin`).
  `handleMessageCreate` calls it via `s.channel(…, NeedSend)` and then up to three more times for
  slowmode, `mention_everyone` and `attach`.
- **Cost**: ~36 SQL statements of pure permission checking for one `POST /messages`, before the insert,
  the nonce lookup, the envelope check, the hydrate and the fan-out. Each `IsInstanceAdmin`
  (`perms.go:32`) is its own `SELECT flags FROM users`.
- **Fix**: resolve `ChannelPerms` once in `s.channel` and stash the resulting `perms.Perm` on the
  request context; the later checks become bit tests. ~30 lines. Drops a server-channel message send
  from ~45 statements to ~12.

### [NOTABLE] The gateway JSON-encodes the same frame once per recipient connection
- **Where**: `internal/gateway/conn.go:329` (`writeLoop`), fed by `hub.go:263` (`EmitUsers`).
- **What**: `EmitUsers` builds one `ServerFrame` and enqueues the *struct* to every connection's
  channel; each connection's `writeLoop` then calls `json.Marshal(f)` itself. Deflate compression is
  also on (`conn.go:210`, `CompressionNoContextTakeover`), so each copy is also compressed separately.
- **Cost**: a message in a server with 2 000 online members is marshalled 2 000 times and deflated
  2 000 times. A 1 KB message payload is ~2 µs to marshal plus ~20–40 µs to deflate → roughly
  **40–80 ms of CPU for one message**, scaling linearly with audience. This is the classic gateway
  cost Discord solves by encoding once.
- **Fix**: marshal once in `EmitUsers`/`EmitChannel` and enqueue `[]byte`; keep `ServerFrame` only for
  the per-connection `Send`. Optionally pre-compress once too. ~50 lines, and it is the difference
  between linear-in-audience CPU and constant.

### [NOTABLE] `DMChannelsForUser` full-scans the channels table on every gateway connect
- **Where**: `internal/store/channels.go:172`.
- **What**: `SELECT … FROM channels c WHERE c.type IN ('dm','group_dm','subchat') AND EXISTS (SELECT 1
  FROM dm_participants p WHERE p.channel_id = c.id AND p.user_id = ?)`. There is no index on
  `channels.type`, so this scans every channel row on the instance and runs a correlated subquery for
  each. It is called from `buildReady` (`internal/gateway/conn.go:635`) and from `interestedIn`
  (`hub.go:378`).
- **Cost**: O(all channels on the instance) per connect *and* per presence broadcast. At 200 000
  channels that is a 200 000-row scan every time anyone changes status.
- **Fix**: drive from the indexed side —
  `SELECT … FROM channels c JOIN dm_participants p ON p.channel_id = c.id WHERE p.user_id = ? AND p.hidden = 0 AND c.type IN (…)`
  — `dm_participants_user` makes it O(your DMs). One query rewritten, 2 lines.

### [NOTABLE] Every presence change loads every member of every server you are in
- **Where**: `internal/api/server_glue.go:167-181` (`hub.Interested`), called from
  `internal/gateway/hub.go:373` (`interestedIn`) → `broadcastPresence` (`hub.go:481`).
- **What**: `Interested` runs `ServersForUser` then `MemberIDs(srv.ID)` for **each** server and
  concatenates every id. `interestedIn` additionally runs `Friends` and `DMChannelsForUser`.
  `broadcastPresence` then copies the slice and `EmitUsers` dedupes it into a fresh map.
- **Cost**: a user in five 10 000-member servers produces a 50 000-element `[]ids.ID` and a
  50 000-entry `map[ids.ID]bool` **per presence change** — on connect, on disconnect, on every status
  edit (rate-limited to one per 2 s per connection) and on every activity change (one per 4 s). With
  1 000 such users online that is ~25 000 allocations/second of pure garbage.
- **Fix**: intersect against the online set instead of materialising the full audience: iterate
  `h.conns` (which is bounded by online users) and test membership in a cached per-server member set.
  ~40 lines, and it makes presence cost O(online) rather than O(total membership).

### [SEVERE] `ReadStatesFor` counts unread mentions per channel on every connect
- **Where**: `internal/store/readstates.go:26`, called from `internal/gateway/conn.go:660` with the
  full list of channels the user can see (`ExtraChannels` = `ChannelsForUser`, `server_glue.go:182`).
- **What**: one query with two correlated subqueries per channel. The mention count walks
  `messages_channel` from a floor and evaluates
  `mention_everyone = 1 OR EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?)` for every row
  above it — a JSON parse per message row. The floor is the read marker, or the join time for a
  channel never read.
- **Cost**: a user who joined a busy server and never opened a channel has a floor at join time, so
  this parses the `mentions` JSON of every message since. 100 channels × 10 000 unread = **1 000 000
  JSON parses on connect**, blocking `ready`.
- **Fix**: keep a denormalised `mention_count` on `read_states`, maintained on insert/ack; or cap the
  scan the way the unread count already is (`LIMIT MaxUnreadCount`). The cap is a 3-line change and
  bounds the worst case immediately.

### [NOTABLE] `ChannelsForUser` is called on connect and is O(servers × channels) with per-server queries
- **Where**: `internal/store/perms.go:205`, via `hub.ExtraChannels` (`server_glue.go:182`).
- **What**: for each of the user's servers: `Member` (2 queries), `Roles`, `ServerChannels` (3
  queries), `OverwritesForServer` — then `perms.Compute` per channel, allocating a
  `toPermOverwrites` slice each time.
- **Cost**: 7 queries × N servers on every connect, plus a permission computation per channel. With 50
  servers that is 350 queries before `ready` is built — and `serverView` (below) then repeats most of
  them.
- **Fix**: `serverView` already loads roles, channels and overwrites for each server; have it return the
  viewable set so `ChannelsForUser` is not a second pass. ~30 lines.

### [SEVERE] `ReadyExtras` refetches every online member one row at a time
- **Where**: `internal/api/server_glue.go:208-211`.
- **What**:
  ```go
  if hub.Online(usr.ID) {
      if full, err := s.Store.UserByID(ctx, usr.ID); err == nil {
          p.Presences = append(p.Presences, hub.PresenceOf(ctx, full))
      }
  }
  ```
  `usr` came from `UsersByIDs` two lines earlier — the full row was already loaded and thrown away as a
  `PublicUser`. `hub.Online` takes the hub RLock, and `PresenceOf` takes it twice more.
- **Cost**: one `SELECT … FROM users WHERE id = ?` per online member of every server, on every gateway
  connect. A user in three servers with 200 online members each = 600 extra queries and ~1 800 lock
  acquisitions per connect. Reconnect storms (a deploy, a network blip) multiply this by the number of
  clients.
- **Fix**: have `serverView` return `map[ids.ID]*store.User` instead of `[]store.PublicUser`, and batch
  the online test. ~15 lines.

### [SEVERE] Nothing is compressed by the server
- **Where**: `internal/api/respond.go:11` (`WriteJSON`), `internal/api/static.go:106`
  (`serveStaticFile`). A grep for `gzip`/`Content-Encoding`/`compress/` across `internal/` and `cmd/`
  returns nothing.
- **What**: every API response and every static asset is written uncompressed. `main-*.js` is 547 615 B
  on the wire instead of 169 991 B; the `ready` payload of a user in several servers is tens to
  hundreds of KB of JSON, uncompressed.
- **Cost**: ~3.2× the bytes for JS, ~4× for CSS, ~5–8× for JSON. On the hosted instance Cloudflare's
  tunnel compresses on the way out, so end users are covered there — but the desktop app, any
  self-hoster, any direct origin hit and any content type Cloudflare skips pay the full size.
- **Fix**: wrap the handler in a gzip middleware (or `klauspost/compress/gzhttp`) with a
  ~1 KB minimum and a skip list for `/media/` (already-compressed blobs). ~20 lines.

### [SEVERE] Bulk message purge opens one write transaction per message
- **Where**: `internal/store/messages.go:529-535` (`DeleteMessagesByUserSince`).
- **What**: after collecting the ids, it calls `s.DeleteMessage(ctx, id)` in a loop; each call is its
  own `s.Tx` (`messages.go:303`), which on SQLite is a separate commit and fsync, and each ends with
  `fixLastMessageTx` doing `SELECT max(id) FROM messages WHERE channel_id = ?`.
- **Cost**: banning a spammer with 5 000 messages = 5 000 transactions, 5 000 fsyncs and 5 000
  `max(id)` scans, all on the single SQLite writer connection — every other write on the instance
  queues behind it. Minutes of a frozen server.
- **Fix**: do the whole purge inside one `s.Tx`, and run `fixLastMessageTx` once per affected channel.
  ~20 lines.

### [SEVERE] Every authenticated request costs two queries and no session is ever cached
- **Where**: `internal/auth/middleware.go:33` (`Resolve`), used by `authed`/`callAuthed`/`guestAuthed`
  (`internal/api/router.go:171,180,188`).
- **What**: `SessionByTokenHash` (SHA-256 of the token + an indexed lookup) then `UserByID`, on every
  single request, plus a `TouchSession` write every 5 minutes per session.
- **Cost**: this is the most-executed query pair in the system — 2 reads per request, from a pool of 8
  SQLite readers. At 500 req/s that is 1 000 queries/s spent proving who you are.
- **Fix**: a small LRU keyed by token hash holding `(user, session)` for 10–30 s, invalidated by
  `CloseSession`/`CloseUserSessions` which already exist. ~60 lines, removes ~60 % of all read queries.

### [NOTABLE] Slowmode check has no index to use
- **Where**: `internal/store/messages.go:540` (`LastMessageAt`), called from
  `internal/api/message_handlers.go:232`.
- **What**: `SELECT max(created_at) FROM messages WHERE channel_id = ? AND author_id = ? AND type IN
  ('default','reply')`. The available indexes are `messages_channel(channel_id, id DESC)` and
  `messages_author(author_id)`; neither covers the pair, so SQLite walks one of them end to end.
- **Cost**: O(messages in the channel) or O(messages by that author) per send in a slowmode channel —
  unbounded growth. A channel with 1 M messages makes every send scan 1 M rows.
- **Fix**: `CREATE INDEX messages_channel_author ON messages(channel_id, author_id, id DESC)` and
  select `max(id)` (ids are time-ordered snowflakes) instead of `max(created_at)`. One migration,
  2 lines of Go.

### [NOTABLE] Member search scans the whole membership
- **Where**: `internal/store/servers.go:355-363`.
- **What**: `WHERE m.server_id = ? AND m.user_id > ? AND (u.username LIKE ? OR ulower(u.display_name)
  LIKE ? OR ulower(m.nickname) LIKE ?) ORDER BY m.user_id LIMIT ?`. `ulower` is a **Go callback
  registered as a SQLite scalar function** (`internal/store/users.go:20`), so each evaluated row
  crosses into Go and boxes a `driver.Value`.
- **Cost**: a search with few or no matches walks every member of the server, invoking two Go callbacks
  per row. 50 000 members = 100 000 Go callbacks and 100 000 `driver.Value` allocations per keystroke
  if the client searches as you type.
- **Fix**: store a precomputed folded `search_name` column on `server_members` and `users`, indexed,
  and match against it. One migration plus a write-path change; removes `ulower` from the hot path
  entirely.

### [NOTABLE] User search scans the whole users table
- **Where**: `internal/store/users.go:~312` (`SearchUsers`).
- **What**: `WHERE (username LIKE ? ESCAPE '\' OR ulower(display_name) LIKE ?) AND flags & ? = 0`. The
  `OR` plus the function call on `display_name` means no index is usable for the second branch.
- **Cost**: O(all users) with a Go callback per row, per search request.
- **Fix**: same folded-column approach, or split into two indexed queries and merge. ~30 lines.

### [NOTABLE] `ServePublicSized` loads the blob row twice for every unsized image
- **Where**: `internal/media/variants.go:72` then `:83`/`:86`/`:90`/`:95`, which call
  `m.ServePublic` → `m.Open` → `m.st.BlobByID` (`internal/media/store.go:299`).
- **What**: `ServePublicSized` already fetched the blob with `BlobByID`, then hands off to
  `ServePublic` which fetches it again by id.
- **Cost**: two identical `SELECT … FROM blobs WHERE id = ?` per avatar/emoji/sticker request that
  does not need a variant — which is most of them. An open channel can fire dozens of these.
- **Fix**: add an `openBlob(b *store.Blob)` that takes the already-loaded row. ~10 lines. Better still,
  add a small LRU on blob metadata — the rows are immutable once written, so a 10 000-entry cache
  removes the DB from the image path entirely.

### [NOTABLE] `instanceAdmins` full-scans `users` and there is no index on `flags`
- **Where**: `internal/store/perms.go:42`; no `CREATE INDEX … ON users(flags)` exists in
  `internal/db/migrations/0001_init.sql` or the Postgres equivalent.
- **What**: `SELECT id FROM users WHERE flags & ? != 0 AND flags & ? = 0`. Bitwise predicates are not
  sargable anyway, so even an index would not help — but the query is run from `channelViewers` and
  `MembersWithPerm`, both hot.
- **Cost**: one full `users` scan per call. Called at least twice per message in a server channel.
- **Fix**: cache the admin set in memory with a version counter bumped by the admin handlers. Admins
  change roughly never. ~25 lines.

### [NOTABLE] `sweepSessions` re-validates every connection against the database every minute
- **Where**: `internal/gateway/hub.go:121`, scheduled from `hub.go:93` (every 12th 5-second sweep).
- **What**: for each distinct session it runs `SessionByID` + `UserByID` (`hub.go:152`).
- **Cost**: 2 queries per distinct session per minute. 10 000 connections ≈ 20 000 queries/minute of
  pure background load, spiking every 60 s.
- **Fix**: a single `SELECT id FROM sessions WHERE id IN (…)` plus one `users` query for the survivors —
  2 queries instead of 2N. ~30 lines. (The session cache from the auth finding would also serve this.)

### [NOTABLE] `sweep` and `CloseSession` walk every connection under the hub lock
- **Where**: `internal/gateway/hub.go:100` (`sweep`, every 5 s), `hub.go:169` (`CloseSession`),
  `hub.go:494` (`CloseAll`).
- **What**: nested loops over `h.conns` holding `h.mu.RLock()`. `CloseSession` in particular scans every
  connection of every user to find one session.
- **Cost**: at 50 000 connections, `sweep` walks 50 000 entries every 5 seconds while holding the lock
  that every `EmitUsers` needs. `CloseSession` is O(all connections) for what should be O(1).
- **Fix**: keep a `map[sessionID][]*conn` alongside `conns`, and keep a heap or bucketed wheel of
  heartbeat deadlines instead of a full scan. ~50 lines.

### [NOTABLE] `DeleteMessages` runs a count query per id
- **Where**: `internal/store/messages.go:352-359`.
- **What**: inside the transaction, `SELECT count(*) FROM messages WHERE id = ? AND channel_id = ?` for
  each of up to 100 ids, then a blob-ref update and a delete each.
- **Cost**: ~300 statements for a 100-message bulk delete.
- **Fix**: one `SELECT id FROM messages WHERE channel_id = ? AND id IN (…)` up front, then one
  `DELETE … WHERE id IN (…)` and one blob-ref update. ~25 lines.

### [NOTABLE] `SubchatsFor` queries participants per subchat while the outer cursor is open
- **Where**: `internal/store/channels.go:273`.
- **What**: `s.Participants(ctx, c.ID)` inside the `rows.Next()` loop.
- **Cost**: up to 50 extra queries (`MaxSubchats`) per call, issued while holding an open result set —
  on Postgres each takes a second pooled connection.
- **Fix**: collect the ids, then one `WHERE channel_id IN (…)` query, as `DMChannelsForUser` already
  does at `channels.go:199`. ~20 lines.

### [NOTABLE] `SetMemberRoles` and `SetRolePositions` insert/update one row at a time
- **Where**: `internal/store/servers.go:478`, `internal/store/servers.go:610`,
  `internal/store/channels.go:324` (`AddParticipant` subchat fan-out), `channels.go:350`
  (`RemoveParticipant`).
- **What**: loops of single-row `ExecContext` inside a transaction.
- **Cost**: bounded but linear; reordering 100 roles is 100 statements, adding someone to a group with
  50 subchats is 50 inserts.
- **Fix**: multi-row `VALUES` inserts / a single `CASE` update. ~15 lines each. Low priority.

### [NOTABLE] `MutualServers` probes membership one server at a time
- **Where**: `internal/api/server_glue.go:132-141`.
- **What**: `ServersForUser(me)` then `IsMember(srv.ID, other)` per server.
- **Cost**: N+1 on every profile card open. A user in 50 servers = 51 queries.
- **Fix**: one `SELECT server_id FROM server_members WHERE user_id = ? AND server_id IN (…)`. 5 lines.

### [NOTABLE] SQLite runs with the default 2 MB page cache and no mmap
- **Where**: `internal/db/db.go:48`.
- **What**: the DSN sets `busy_timeout`, `journal_mode(WAL)`, `foreign_keys`, `synchronous(NORMAL)` and
  `temp_store(MEMORY)` — but not `cache_size` or `mmap_size`. `modernc.org/sqlite` defaults to 2000
  pages ≈ 2 MB of page cache per connection.
- **Cost**: with 9 connections that is ~18 MB of cache for a database that will be gigabytes. Every
  index traversal that misses re-reads from the OS page cache through the pure-Go VFS, which is
  notably slower than cgo SQLite.
- **Fix**: add `&_pragma=cache_size(-65536)&_pragma=mmap_size(268435456)` to the DSN. **One line**, and
  it is one of the highest ratio-of-benefit-to-effort changes in the repo.

### [NOTABLE] `Tx` does not cache placeholder rebinding
- **Where**: `internal/db/dialect.go:190` — `func (t *Tx) bind(query string) string { return rebind(...) }`,
  versus `Conn.bind` at `dialect.go:139` which memoises in a `sync.Map`.
- **What**: on Postgres, every statement executed inside a transaction rebuilds its `$n` form with a
  `strings.Builder` pass over the query text.
- **Cost**: one allocation and a full string scan per statement in every transaction. Small per call,
  but transactions are where the write path lives.
- **Fix**: give `Tx` a reference to the `*Conn` and reuse its cache. ~10 lines.

### [NOTABLE] `IN (?,?,…)` with variable arity defeats prepared-statement caching
- **Where**: `internal/store/store.go:109` (`placeholders`), used by `hydrate`
  (`messages.go:234`), `Members` (`servers.go:390`), `ReadStatesFor` (`readstates.go:39`),
  `UsersByIDs` (`users.go:110`).
- **What**: each distinct list length produces a distinct SQL string. On Postgres that is a distinct
  prepared statement in pgx's per-connection cache; page sizes vary from 1 to 1000.
- **Cost**: up to ~1000 prepared statements per connection per query shape, and a parse/plan on first
  use of each.
- **Fix**: on Postgres use `= ANY($1)` with an array parameter; on SQLite round the list up to a power
  of two and pad with a sentinel id. ~30 lines.

### [MINOR] `GC` and `Remove` do two queries per blob
- **Where**: `internal/media/store.go:343` (`GC`) → `:320` (`Remove`), which runs `DeleteBlob` then
  `CountBlobsByContent`.
- **Cost**: 2 queries + 1 `os.Remove` + a `filepath.Glob` (`variants.go:57`) per collected blob. It is
  background work, so this only matters for a large backlog.
- **Fix**: batch, or leave it. Low priority.

### [MINOR] Invite and guest-call pages read `index.html` from disk per request
- **Where**: `internal/api/static.go:~140` (`serveInvitePage`) and `:~185` (`serveGuestCallPage`), both
  `os.ReadFile(filepath.Join(dist, "index.html"))`, plus a string concat to inject meta tags.
- **Cost**: one file read and two string copies per invite-link hit. A popular invite link posted on
  social media turns this into steady syscall load.
- **Fix**: read `index.html` once into memory (with an mtime check) and keep the pre-split head/tail.
  ~20 lines.

### [MINOR] Static files cost a `Stat` plus an `Open` and never cache
- **Where**: `internal/api/static.go:~57` (`os.Stat`) then `serveStaticFile`'s `os.Open`.
- **Cost**: two syscalls per asset request. Fine behind a CDN, wasteful direct.
- **Fix**: keep an in-memory map of hashed assets (they are immutable by construction). ~40 lines.

### [MINOR] The generic rate limiter is one global mutex on every authenticated request
- **Where**: `internal/ratelimit/limiter.go:68` (`Allow`), used by `authed` (`router.go:171`).
- **What**: `l.mu.Lock()` around the map lookup and the token bucket; one `Limiter` instance shared by
  every request.
- **Cost**: negligible per call, but it serialises all requests through one lock. It becomes visible
  somewhere above a few thousand requests/second.
- **Fix**: shard by `fnv(key) % 16`. ~20 lines.

### [MINOR] `Logging` builds its argument slice even when the level is dropped
- **Where**: `internal/api/middleware.go:~68`.
- **What**: `log.Log(ctx, slog.LevelDebug, "http", …12 args…)` — the variadic `[]any` is allocated and
  every value boxed before `slog` checks whether Debug is enabled.
- **Cost**: ~7–10 allocations per request, on every request, thrown away in production.
- **Fix**: `if !log.Enabled(ctx, lvl) { return }` before the call. 3 lines.

### [MINOR] `RequestID` reads from `crypto/rand` per request
- **Where**: `internal/api/middleware.go:~45`.
- **Cost**: 8 bytes of CSPRNG plus a hex encode per request without an inbound `X-Request-Id`.
- **Fix**: a per-process counter plus a random prefix is equally unique for a log id. 5 lines.

### [MINOR] `Members` pages at 1000 rows joined to `users` just to filter
- **Where**: `internal/store/servers.go:355` — the `JOIN users u` exists only for the optional `q`
  filter, but is always present.
- **Cost**: an unnecessary index lookup per member row on the (very hot) `allMembers` path.
- **Fix**: only add the join when `q != ""`. 3 lines.

### [IDEA] Serve image variants as WebP/AVIF
- **Where**: `internal/media/variants.go:~145` — output is JPEG q90 or PNG (`BestSpeed`).
- **Cost/win**: WebP is typically 25–35 % smaller than JPEG q90 at equal quality; for an avatar-heavy
  UI that is real bandwidth. Requires an encoder dependency and `Accept` negotiation.

### [IDEA] Consider a per-channel subscription model instead of computing the audience per event
- **Where**: `internal/gateway/hub.go:363`.
- **What**: clients already know which channel they are reading. Having connections subscribe to
  channels (as Discord's `guild_subscriptions` does) makes fan-out a map lookup on a set that is
  bounded by *who is looking*, not by who is a member. It makes the viewer-cache finding above mostly
  unnecessary and caps typing-indicator cost at the number of people with the channel open.

---

## Web

### [SEVERE] The message list is not virtualised, and the dependency to fix it is already installed
- **Where**: `web/src/components/chat/MessageList.tsx:373-378`. `@tanstack/react-virtual` is in
  `web/package.json` dependencies and a grep for `useVirtualizer`/`react-virtual` across `web/src`
  returns **no hits**.
- **What**: `rows.map(...)` renders one `<MessageItem>` per loaded message. Each `MessageItem`
  (`MessageItem.tsx:79`) renders an avatar, a header row, markdown output, reactions, attachments and
  a hover toolbar of up to 8 buttons.
- **Cost**: after scrolling back 20 pages (1 000 messages at `PAGE = 50`) the DOM holds on the order of
  20 000–50 000 nodes. Every forced layout (see below) walks all of them; memory per tab grows without
  bound for the length of a reading session. The comparison target (Discord) virtualises.
- **Fix**: wrap the row list in `useVirtualizer` with dynamic measurement. The list already tracks
  `scrollRef`, `atBottom` and prepend compensation, so the surgery is contained — roughly 120 lines in
  one file. `MemberList.tsx:126-140` already contains a hand-rolled windowing implementation that can
  be copied.

### [SEVERE] Every mounted message row rebuilds a render context over every role of every server
- **Where**: `web/src/lib/markdownCtx.ts:12` (`useRenderCtx`), called from `MessageItem.tsx:88` and
  from `ReplyPreview` (`MessageItem.tsx:49`).
- **What**:
  ```ts
  const roles: Record<string, {name: string; color: number}> = {};
  for (const st of Object.values(servers)) for (const r of Object.values(st.roles)) roles[r.id] = {…};
  ```
  memoised on `[users, channels, servers, openModal, navigator]`. `users` is a brand-new object on
  every `useUsers.upsert` (`stores/users.ts:17`), which fires whenever a message author, a mention
  target or a profile update arrives.
- **Cost**: with 1 000 mounted rows, 20 servers and 30 roles each, one user upsert does
  1 000 × 600 = **600 000 loop iterations** and allocates 1 000 new `ctx` objects and 1 000 new
  `roles` maps — then hands each to `<Markdown ctx={ctx}>`, invalidating its memo.
- **Fix**: compute the context once in `ChatView` and pass it down through a React context, or make the
  roles map a module-level memo keyed on the servers object. **~20 lines**, and it is the cheapest
  large win on the web client.

### [SEVERE] One presence event re-sorts the whole member list with an Intl collator
- **Where**: `web/src/components/chat/MemberList.tsx:88-122`, dependency array at line 122:
  `[st, visible, users, presence, serverId]`.
- **What**: `presence` is `usePresence(p => p.byUser)`, and `usePresence.set`
  (`stores/presence.ts:15`) clones the whole map on every event. So every presence packet re-runs the
  grouping loop over all visible members and calls `list.sort(byName)` for each group, where `byName`
  uses `Intl.Collator.compare` (line 110).
- **Cost**: a 10 000-member server with 9 000 offline produces ~9 000·log₂(9 000) ≈ 120 000 collator
  comparisons at ~0.5–2 µs each = **60–250 ms of blocked main thread, per presence event**. Presence
  events arrive several per second in a large server. The tab visibly freezes.
- **Fix**: split into two memos — one that produces the sorted name order (depends on `st`/`users` only)
  and one that partitions it by status (depends on `presence`). Partitioning is O(n) with no sort.
  ~40 lines. Also subscribe to presence per row rather than the whole map.

### [SEVERE] `ChatView` and `MessageList` subscribe to the entire users and presence maps
- **Where**: `web/src/components/chat/ChatView.tsx:45-47`, `MessageList.tsx:63-64`.
- **What**: `useUsers(u => u.byId)`, `usePresence(p => p.byUser)`, `useChannels(c => c.byId)`. Both
  stores replace the whole map object on every write. `MessageList` uses `users` only inside the
  `intro` memo (line 291).
- **Cost**: every presence packet and every user upsert re-renders `ChatView`, which re-renders
  `MessageList` (not memoised), which re-runs `rows.map()` and re-creates every `MessageItem` element —
  1 000 element creations plus a full reconciliation pass, several times a second.
- **Fix**: select only what is needed (`useUsers(u => u.byId[id])` per consumer), and memoise
  `MessageList`. ~15 lines.

### [SEVERE] The `rows` memo and the scroll-anchoring layout effect run on every store mutation
- **Where**: `MessageList.tsx:104-129` (`rows` memo, deps `[ids, byId, pending, me?.id, loaded]`) and
  `:136-172` (`useLayoutEffect`, deps `[rows, newest, byId, …]`).
- **What**: `byId` gets a new identity on every message-store write, because every reducer clones it —
  `put` at `stores/messages.ts:118` does `{ ...c.byId }`, and `setReaction`/`setFlags`/`setDecryption`
  each do `{ ...c.byId, [id]: … }`. So a single reaction on one message rebuilds the whole `rows`
  array and re-runs the layout effect.
- **Cost**: O(n) per event where n is loaded messages, i.e. **O(n²) over a session**. The layout effect
  reads `el.scrollHeight` (line 142/163) and then writes `el.scrollTop` — a forced synchronous layout
  of the entire unvirtualised list on every incoming event.
- **Fix**: key `rows` on a cheap version counter rather than `byId` identity, and move the
  scroll-anchoring to a `ResizeObserver`-only path so it does not run for reactions and flag changes.
  ~40 lines. (Virtualisation makes the forced layout cheap regardless.)

### [SEVERE] The whole message map is cloned for every incoming message
- **Where**: `web/src/stores/messages.ts:110` (`withChannel`), `:118` (`put`), `:148` (`mergeIds`).
- **What**: `withChannel` clones `s.channels`; `put` clones `c.byId`; `mergeIds` clones `c.ids`.
- **Cost**: three O(n) copies per message. With 2 000 loaded messages that is 2 000 property copies
  plus a 2 000-element array copy per event, ~50–150 µs each — and, more importantly, new object
  identity for every subscriber.
- **Fix**: use a structural-sharing map (or Immer/Mutative), or keep `byId` as a `Map` and mutate it
  behind a version counter. ~60 lines.

### [SEVERE] `redecrypt` fires one store write per message
- **Where**: `web/src/stores/messages.ts:441-455`.
- **What**: iterates every message of every loaded channel, decrypts all of them concurrently via
  `Promise.all`, and calls `setDecryption` per message — each of which clones `channels` and `byId`.
- **Cost**: after a key rotation with 2 000 messages loaded, that is 2 000 store writes, each O(n) →
  **O(n²) ≈ 4 000 000 property copies**, plus 2 000 re-renders of the subscriber tree. Seconds of a
  frozen tab.
- **Fix**: collect the results and apply them in one `set`. ~15 lines. Very cheap for the size of the
  win.

### [SEVERE] The entry bundle carries the whole voice engine and app shell to the marketing page
- **Where**: `web/src/routes.tsx:5` — `import { AppShell } from "@/components/shell/AppShell"` is a
  static import, so everything the shell reaches lands in `main`. Confirmed from the build's source map:
  `main-*.js` contains 952 065 B of pre-minified sources, of which `src/voice` is **159 019 B (16.7 %)**
  — `sfu.ts` 44 534 B, `session.ts` 42 351 B, `mesh.ts` 20 359 B, `copyPlanner.ts` 14 441 B,
  `media.ts` 13 408 B, `playback.ts` 8 373 B, plus `e2ee.ts`, `guestKeys.ts`, `playoutDelay.ts`,
  `shareQuality.ts`, `redundancy.ts`.
- **What**: `dist/index.html` preloads `main`, `react` and `crypto`. First load is therefore
  **971 851 B raw / 290 138 B gzip** (main 547 615/169 991, react 164 932/53 908, crypto 44 978/18 044,
  CSS 147 434/37 715, `/twemoji/available.json` 66 892/10 465) — before the router has decided whether
  you are on `/` (the marketing page, a 11.6 KB lazy chunk) or in a channel.
- **Cost**: on a 4G connection at ~1.6 Mbps effective, 290 KB gzip is ~1.5 s of transfer plus roughly
  500 ms–1 s of parse/compile on a mid-range phone, for a page whose headline is that it is faster than
  Discord.
- **Fix**: (a) `const AppShell = lazy(() => import("@/components/shell/AppShell"))` — 1 line, moves the
  sidebar, rail, chat and voice out of the entry; (b) import `@/voice/session` dynamically from the
  call entry points so the SFU stack only loads when a call starts — that alone is worth roughly
  25–28 KB gzip. Together, expect the entry chunk to fall to ~250–300 KB raw / ~90–100 KB gzip.

### [NOTABLE] A page of history triggers one HTTP request per unknown author
- **Where**: `web/src/stores/messages.ts:13-29` (`resolveAuthors`), and `gateway/dispatch.ts:83`
  (`ensureUser`).
- **What**: for each unknown author or mention id it calls `usersApi.get(id)` individually.
- **Cost**: a 50-message page from 50 distinct authors = 50 parallel `GET /users/:id` requests, each
  costing the server 2 auth queries + 1 user query (150 queries) and each consuming one of the
  browser's 6 connections per origin on HTTP/1.1. Scrolling back through history multiplies this.
- **Fix**: add a batch endpoint (`GET /users?ids=…`) or reuse the existing `UsersByIDs` store method
  behind one; coalesce requests in a microtask. ~40 lines client, ~30 server.

### [NOTABLE] `importKey` runs on every message encrypt and decrypt
- **Where**: `web/src/crypto/aes.ts:28-30`, called from `gcmEncrypt` (`:38`) and `gcmDecrypt` (`:49`).
- **What**: `crypto.subtle.importKey("raw", …)` on every call. The raw channel key is already memoised
  (`lib/keyring.ts:8`) but the `CryptoKey` object is not.
- **Cost**: two WebCrypto round trips per message instead of one — roughly doubles the crypto cost of
  opening a channel (50 messages), and of `redecrypt` (thousands).
- **Fix**: a `Map<string, Promise<CryptoKey>>` next to `chanKeys`. **~15 lines**, halves the decrypt
  cost on every path.

### [NOTABLE] Reconnect re-reads 500 messages and `JSON.stringify`s each one twice
- **Where**: `web/src/stores/messages.ts:342-367` (`syncGap`) → `:139-146` (`refreshed`).
- **What**: `REFRESH_PAGES = 10` pages of 50 are re-fetched and compared with
  `JSON.stringify(prev.ciphertext) !== JSON.stringify(m.ciphertext)` and three more `JSON.stringify`
  comparisons for flags/reactions/attachments.
- **Cost**: up to 500 messages × up to 4 stringify pairs. At a typical 1–2 KB envelope that is ~2–4 MB
  of string building on the main thread per reconnect; the envelope cap is 64 KB, so the pathological
  case is ~64 MB. On a flaky link reconnecting every 30 s this is continuous jank. Each page also does
  a `set` that clones the whole channel map.
- **Fix**: compare `edited_at` and a cheap length/hash first, and compare reactions by
  `(emoji, count, me)` tuples rather than stringifying. ~25 lines.

### [NOTABLE] Each message row opens ~14 store subscriptions
- **Where**: `web/src/components/chat/MessageItem.tsx:80-100` — `useAuth`, `useUsers`, `useUI` ×4,
  `useSettings` ×2, `useChannels`, `useServers`, `useRelationships`, `useSelection` ×2, `useShiftHeld`,
  plus `useRenderCtx` which adds four more.
- **Cost**: with 1 000 unvirtualised rows that is ~14 000 selector functions re-evaluated on every
  write to any of those stores. Zustand walks every listener on every `set`.
- **Fix**: virtualisation caps this at ~30 visible rows automatically — the single biggest reason to do
  it. Additionally, pass `selecting`/`shift`/`editing` down from the list rather than subscribing per
  row.

### [NOTABLE] `useServers` selector returns the whole server state to every row
- **Where**: `web/src/components/chat/MessageItem.tsx:89`:
  `useServers((st) => (serverId ? st.byId[serverId] : undefined))`.
- **What**: `ServerState` identity changes on every member upsert, role change and permission
  recompute (`stores/servers.ts:76-120`).
- **Cost**: one member joining re-renders **every** message row in the channel — 1 000 re-renders for
  one event, each of which then re-runs markdown lookups and `memberColor`.
- **Fix**: select the two values actually used (`member?.nickname` and `memberColor(...)`) with a
  primitive selector. ~5 lines.

### [NOTABLE] Pressing Shift re-renders every message row
- **Where**: `web/src/hooks/useShiftHeld.ts:22-30`, used at `MessageItem.tsx:97`.
- **What**: the hook correctly uses one global listener pair, but calls `setV` on every subscriber.
- **Cost**: 1 000 `setState` calls and 1 000 re-renders on keydown and again on keyup, for a toolbar
  that is only visible on the hovered row.
- **Fix**: read shift state lazily in the hovered row only (e.g. via `:hover` + a CSS custom property,
  or by subscribing only when the row is hovered). ~15 lines.

### [NOTABLE] `onScroll` is unthrottled and reads layout on every scroll event
- **Where**: `web/src/components/chat/MessageList.tsx:218-241`.
- **What**: reads `scrollHeight`, `scrollTop`, `clientHeight` and calls `setShowJump` on every scroll
  event; a `ResizeObserver` on the inner container (`:177-184`) also reads `scrollHeight` and writes
  `scrollTop`.
- **Cost**: at 120 Hz on a trackpad, a forced layout of an unvirtualised 1 000-row list per frame.
- **Fix**: coalesce into `requestAnimationFrame` and cache the measurements. ~20 lines.

### [NOTABLE] Toggling selection measures every row
- **Where**: `web/src/components/chat/MessageList.tsx:199-205`.
- **What**: `el.querySelectorAll("[data-id]")` then `getBoundingClientRect()` per row until one is
  found below the viewport top.
- **Cost**: O(n) layout reads. Only on selection toggle, but on a 1 000-row list it is a visible stall.
- **Fix**: binary search using the known row heights, or rely on CSS `overflow-anchor`. ~20 lines.

### [NOTABLE] `usePresence` and `useUsers` clone their whole map on every event
- **Where**: `web/src/stores/presence.ts:15,17-22`, `web/src/stores/users.ts:17-22`.
- **Cost**: O(known users) per presence packet and per user update. In a 10 000-member server with the
  member list open, both maps are ~10 000 entries, so every presence packet copies 20 000 properties
  and invalidates every subscriber.
- **Fix**: keep a `Map` behind a version counter, or shard by user id. ~40 lines.

### [NOTABLE] `MemberList` recomputes permissions for every member on any server change
- **Where**: `web/src/components/chat/MemberList.tsx:78-85`, deps `[st, serverId, overwrites]`.
- **Cost**: `st` changes on every member/role event, so `compute()` runs for all 10 000 members —
  ~300 000 operations — each time someone joins or a role is edited.
- **Fix**: recompute only for the changed member when the change is a single member upsert. ~30 lines.

### [NOTABLE] `MemberList` allocates a heights array of every row on every render
- **Where**: `web/src/components/chat/MemberList.tsx:131`: `const heights = rows.map(...)`.
- **Cost**: a 10 000-element array allocated per render, plus two O(n) while-loops from index 0 to find
  the window.
- **Fix**: rows are fixed-height (`ROW_H`/`HEAD_H`) — keep a prefix-sum array alongside `rows` and
  binary-search it. ~25 lines.

### [NOTABLE] All CSS ships in one 147 KB stylesheet, render-blocking
- **Where**: `dist/index.html` — `<link rel="stylesheet" href="/assets/main-*.css">`, 147 434 B raw /
  37 715 B gzip.
- **What**: the shell's, chat's, voice's and pickers' CSS modules are merged into the entry stylesheet
  because they are reachable from `AppShell`'s static import.
- **Cost**: 37.7 KB gzip of render-blocking CSS before first paint, most of which the marketing page
  never uses.
- **Fix**: falls out of making `AppShell` lazy — Vite then emits per-chunk stylesheets.

### [NOTABLE] `/twemoji/available.json` is fetched on every cold load, including the landing page
- **Where**: `web/src/main.tsx:45` (`ensureTwemojiIndex()`), served from `dist/twemoji/available.json`
  = 66 892 B raw / 10 465 B gzip (3 721 names).
- **Cost**: an extra request and 67 KB of JSON parsed on the main thread on every cold start, before
  any emoji is on screen.
- **Fix**: gate it behind the first route that can render an emoji, and ship it as a compact encoding
  (a sorted string of code points rather than a JSON array of names) — should be well under 20 KB raw.
  ~20 lines.

### [MINOR] Home-page screenshots have no intrinsic dimensions
- **Where**: `web/src/pages/HomePage.tsx:40` — `<img src={src} alt={alt} loading="lazy"
  decoding="async" />` with no `width`/`height`.
- **Cost**: cumulative layout shift as each shot loads; the `<video>` usage at line 55 is done correctly
  (poster + `preload="none"` + webm).
- **Fix**: add `width`/`height` (or `aspect-ratio` in the module CSS). 2 lines.

### [MINOR] Emoji sprite sheets total 4.1 MB
- **Where**: `web/src/assets/twemoji-sprites/` — `g1.webp` alone is 513 718 B, ten sheets total
  ~4.1 MB.
- **What**: fetched as `background-image`, so only the sheets for groups the picker actually paints
  load — but scrolling the picker through all categories pulls all of them.
- **Cost**: up to 4 MB over a session for someone who browses the picker.
- **Fix**: emit a smaller cell size for the grid (the picker draws at 32 px; sheets appear to be built
  larger) or split the "People & Body" sheet by skin tone. Moderate work in `tools/twemoji_sprites.py`.

### [MINOR] `loadEmoji` makes nine full passes over the dataset on the main thread
- **Where**: `web/src/components/pickers/emojiIndex.ts:96-125` — a `filter`, a `sort`, a
  `filter(hasTwemoji)`, a `map`, then `groups().map(g => all.filter(...))` (nine group filters), then
  two `Map` builds.
- **Cost**: ~3 700 entries × ~12 passes ≈ 10–30 ms of main-thread work. It is `requestIdleCallback`-
  scheduled (`:147`), so it usually lands in a quiet moment.
- **Fix**: single pass building the groups as it goes. ~20 lines. Low priority given the idle
  scheduling.

### [MINOR] `searchEmoji` is a full linear scan with a sort per keystroke
- **Where**: `web/src/components/pickers/emojiIndex.ts:162-184`.
- **Cost**: ~3 700 entries × ~3 shortcodes = ~11 000 string comparisons plus a sort, per keystroke.
- **Fix**: build a prefix trie once at load, or debounce by one frame. ~30 lines.

### [MINOR] `emojibase` ships two shortcode datasets
- **Where**: `web/src/components/pickers/emojiIndex.ts:87-89` — both `iamcal.json`
  (47 723 B / 15.2 KB gz) and `emojibase.json` (157 712 B / 30.4 KB gz) are loaded, and merged so
  emojibase names stay "searchable behind" iamcal's.
- **Cost**: 30.4 KB gzip for the secondary naming scheme, plus the merge loop.
- **Fix**: keep only iamcal (the naming Slack and Discord use, which is the stated goal) unless the
  alias search is a shipped feature. 1 import removed.

### [IDEA] Move message decryption to a worker
- **Where**: `web/src/lib/decrypt.ts:13`. `crypto.subtle` does the AES off-thread already, but
  `JSON.parse` + `sanitizePayload` (`crypto/message.ts:88-95`) run on the main thread per message.
- **Win**: for a 50-message page it is only a few ms; for `redecrypt` over a whole session it is worth
  doing. The upload path already has a worker (`lib/attachments.ts:109`) and the voice frame crypto has
  one (`voice/e2ee.ts:60`), so the pattern exists.

### [IDEA] Per-emoji SVG requests
- **Where**: `dist/twemoji/` holds 3 721 individual SVGs (16 MB total) served immutably.
- **What**: each distinct emoji in a message list is its own HTTP request. A channel with 40 distinct
  emoji on screen is 40 requests on first view.
- **Win**: the sprite sheets already exist for the picker — using them for inline rendering too would
  make this zero extra requests after the first sheet.

---

## Android

### [SEVERE] The translation catalogue is parsed on the main thread before the first frame
- **Where**: `android/.../MainActivity.kt:65` (`Strings.init(this)` in `onCreate`) →
  `android/.../i18n/Strings.kt:100-105`, and again at `Strings.kt:112` (`use`) and
  `MainActivity.kt:~86` (`LaunchedEffect(settings) { Strings.use(SettingsStore.locale) }`).
- **What**: `read(tag)` opens the asset, reads the whole file into a `ByteArray`, `decodeToString()`s
  it, runs `Json.parseToJsonElement` to build a full JSON tree, then walks the tree into a `HashMap`.
  `init` does this for English (137 272 B) and `use(null)` immediately does it again for the phone's
  language — Hindi is 230 379 B, Arabic 174 049 B.
- **Cost**: two full parses of 137–230 KB, synchronously, before `setContent` is even called. On a
  mid-range phone that is roughly **100–250 ms added to every cold start**, plus ~3–6 MB of transient
  allocation and the resulting GC.
- **Fix**: keep the splash screen (`androidx.core:core-splashscreen` is already a dependency) up while
  the catalogue loads on `Dispatchers.IO`; or precompile the catalogues into a flat binary map at build
  time so loading is a mmap + index rather than a JSON parse. ~30 lines for the first option.

### [SEVERE] Every incoming message re-sorts the entire loaded history
- **Where**: `android/.../data/MessageService.kt:60-72` (`insert`).
- **What**: for each insert it builds a `LinkedHashMap` of the whole current list, runs
  `current.firstOrNull { … }` **per incoming message** (a linear scan of the list), and finishes with
  `byId.values.sortedWith(compareBy(…))` — a full re-sort — then publishes a new `List` to the
  `StateFlow`.
- **Cost**: with 1 000 loaded messages, every `message_create` costs a 1 000-entry map build, a
  1 000-element sort (~10 000 comparisons) and two full list copies. In a channel at 10 msg/s that is
  ~100 000 comparisons/s plus continuous allocation, which on Android means GC pressure during
  scrolling.
- **Fix**: the list is already sorted and ids are monotonic — binary-search the insertion point and
  splice. Keep the pending-nonce lookup in a `Map`. ~40 lines. Same applies to `update`/`setReaction`/
  `setFlags` (`:74-113`), which each rebuild the whole list with `list.map {}` for a one-item change.

### [SEVERE] `ChatScreen` reads the scroll index directly in composition
- **Where**: `android/.../ui/chat/ChatScreen.kt:152` — `if (listState.firstVisibleItemIndex > 4) { … }`.
- **What**: reading `firstVisibleItemIndex` in the composable body subscribes the *whole* `ChatScreen`
  scope to it, so the entire screen — header, `LazyColumn` content lambda, typing bar and composer —
  recomposes every time the first visible item changes.
- **Cost**: during a fling through 50 items, 50 full recompositions of the screen. This is the single
  most common cause of Compose scroll jank.
- **Fix**: `val showJump by remember { derivedStateOf { listState.firstVisibleItemIndex > 4 } }`.
  **2 lines.**

### [SEVERE] A `LaunchedEffect` is keyed on the scroll index, so it restarts per scrolled item
- **Where**: `android/.../ui/chat/ChatScreen.kt:99`:
  `LaunchedEffect(channelId, messages.lastOrNull()?.id, listState.firstVisibleItemIndex) { … delay(250); MessageService.ack(...) }`.
- **What**: the key changes on every item scrolled past, cancelling and relaunching the coroutine each
  time — and it also causes the composition read described above.
- **Cost**: 50 coroutine cancel/launch cycles per fling, each scheduling a 250 ms delay that may fire a
  network `ack`.
- **Fix**: key on a `derivedStateOf { listState.firstVisibleItemIndex <= 2 }` boolean. 3 lines.

### [SEVERE] The server rail walks every channel in the app, per server, per recomposition
- **Where**: `android/.../data/AppState.kt:~230` (`serverUnread`) called from
  `android/.../ui/main/Sidebar.kt:98`.
- **What**:
  ```kotlin
  for (c in channels.value.values) {
      if (c.serverId != serverId || !c.isText) continue
      if (!permissionsIn(c.id).has(P.VIEW_CHANNEL)) continue
      …
  }
  ```
  `permissionsIn` (`AppState.kt:~205`) recomputes permissions from roles, member and overwrites every
  call.
- **Cost**: O(all channels × roles) per server, and the rail renders one item per server. 20 servers ×
  500 total channels × 20 roles ≈ **200 000 operations per rail recomposition**, and the rail
  recomposes whenever `AppState.servers` changes.
- **Fix**: maintain unread counters incrementally in `AppState` as read-states and messages arrive, and
  index channels by server. ~60 lines.

### [SEVERE] Every visible message row opens four state-flow subscriptions of its own
- **Where**: `android/.../ui/chat/MessageRow.kt:196-200` (`rememberMdContext`), called from
  `MessageRow.kt:85`; plus `MessageRow.kt:70` (`AppState.me.collectAsState()`).
- **What**: `rememberMdContext` calls `AppState.users.collectAsState()`,
  `AppState.channels.collectAsState()`, `AppState.servers.collectAsState()` and
  `AppState.me.collectAsState()` — per row.
- **Cost**: ~15 visible rows × 4 = 60 collector coroutines, and any write to `users`, `channels` or
  `servers` invalidates every visible row's composition scope (the `remember(users.size, …)` key only
  stops the `MdContext` object from being rebuilt; it does not stop the recomposition). `putUser` fires
  on every new message author.
- **Fix**: build one `MdContext` in `ChatScreen` and pass it down, or provide it through a
  `CompositionLocal`. ~25 lines.

### [SEVERE] `ServerChannels` re-filters, re-sorts and recomputes permissions on every recomposition
- **Where**: `android/.../ui/main/Sidebar.kt:152`:
  `val channels = AppState.channelsOf(serverId).filter { AppState.permissionsIn(it.id).has(P.VIEW_CHANNEL) }`
  with no `remember`.
- **What**: `channelsOf` (`AppState.kt:~175`) filters **all** channels in the app and sorts them;
  `permissionsIn` then recomputes for each survivor.
- **Cost**: O(all channels · log n + channels × roles) per recomposition, and the composable collects
  `AppState.channels`, so it recomposes on every message (each `message_create` calls `putChannel` to
  bump `lastMessageId`, `data/Session.kt:392`).
- **Fix**: `remember(servers, channelMap, serverId) { … }`, and index channels by server id in
  `AppState`. ~20 lines.

### [NOTABLE] `ChannelRow` filters and sorts all voice states per channel per recomposition
- **Where**: `android/.../ui/main/Sidebar.kt:220` — `AppState.voiceIn(channel.id)` →
  `AppState.kt:~243`: `voiceStates.value.values.filter { … }.sortedBy { it.joinedAt }`.
- **Cost**: an allocation-and-sort over all voice states, once per channel row. A server with 100
  channels does 100 filter+sort passes per sidebar recomposition.
- **Fix**: group voice states by channel once in `AppState` and expose a `Map<String, List<VoiceState>>`.
  ~20 lines.

### [NOTABLE] Every `AppState` map write copies the whole map
- **Where**: `android/.../data/AppState.kt:104` (`putUsers`: `current + list.associateBy { it.id }`),
  `:112` (`putChannels`), `:152` (`putPresence`), `:154` (`putReadState`), `:162` (`setTyping`).
- **Cost**: O(n) copy per event. In a large server `putPresence` copies a 5 000-entry map on every
  presence packet, and `putChannel` copies the channel map on every incoming message
  (`Session.kt:392`).
- **Fix**: persistent maps (`kotlinx.collections.immutable`) or a mutable map behind a version counter.
  ~40 lines.

### [NOTABLE] LazyColumn items have keys but no `contentType`
- **Where**: `android/.../ui/chat/ChatScreen.kt:137`
  (`items(count = ordered.size, key = { ordered[it].id })`), `ui/main/Sidebar.kt:194,200,204,206`.
- **What**: without `contentType`, Compose cannot reuse a slot from one row type for another, so
  scrolling past a system message, a day divider or an attachment row forces fresh subcomposition.
- **Cost**: extra allocation and layout on every mixed-type scroll boundary.
- **Fix**: `contentType = { ordered[it].raw.type }`. 1 line each.

### [NOTABLE] Gateway events are parsed twice and each spawns a coroutine
- **Where**: `android/.../net/Gateway.kt:~126` — `Api.json.parseToJsonElement(text).jsonObject`, then
  `scope.launch { _events.emit(...) }`; the consumer at `data/Session.kt:~386` then does
  `Api.json.decodeFromJsonElement<Message>(d)`.
- **Cost**: every frame is materialised as a `JsonElement` tree (a `Map<String, JsonElement>` per
  object, boxed primitives throughout) and then re-decoded into the data class — roughly 2× the parse
  cost and several times the allocation of decoding straight to the model. Plus one coroutine
  allocation per event.
- **Fix**: decode the envelope with a sealed `@Serializable` type and `decodeFromString` once, and emit
  with `tryEmit` instead of `launch`. ~40 lines.

### [NOTABLE] `redecrypt` switches dispatcher once per message
- **Where**: `android/.../data/MessageService.kt:120-127`, with `decrypt` at `:40` wrapping each call in
  `withContext(Dispatchers.Default)`.
- **What**: `needs.map { decrypt(it.raw) }` is sequential; each element pays a dispatcher hop. It then
  calls `insert()`, which re-sorts the whole channel.
- **Cost**: 500 waiting messages = 500 dispatcher hops plus 500 suspensions, then a full re-sort per
  channel. The same pattern appears in `loadInitial` (`:133`) and `loadOlder` (`:143`).
- **Fix**: one `withContext(Dispatchers.Default) { list.map { … } }` around the batch. ~10 lines.

### [NOTABLE] No baseline profile
- **Where**: `android/app/build.gradle.kts` — no `androidx.profileinstaller` dependency, no
  `baselineProfile` block, no `src/main/baseline-prof.txt`.
- **What**: without one, all Compose and app code starts interpreted/JIT on first run and after every
  update.
- **Cost**: typically 20–30 % slower cold start and noticeably worse first-scroll jank for a
  Compose-heavy app. R8 (`isMinifyEnabled = true`, `isShrinkResources = true`) is correctly on, so this
  is the remaining free win.
- **Fix**: add `androidx.profileinstaller` and a `baselineprofile` module, or hand-write a profile for
  the chat screen. Half a day, and it is measurable with Macrobenchmark.

### [NOTABLE] Attachment previews download and decrypt the whole file
- **Where**: `android/.../media/CoilSetup.kt:65-73` (`AttachmentFetcher`) → `AttachmentStore.file(meta)`.
- **What**: the fetcher materialises the entire decrypted attachment on disk before the decoder sees
  it, for an inline preview that is drawn at most 320 dp wide.
- **Cost**: opening a channel with a 50 MB image attachment downloads and decrypts 50 MB. The chunked
  format (`crypto/fileChunks.kt` equivalent — 4 MB chunks with per-chunk IVs) makes partial decryption
  possible, but it is not used here.
- **Fix**: decrypt only the first chunk(s) needed for a downscaled decode, or have the server store an
  encrypted thumbnail alongside the blob at upload time. Moderate work; the second option is better
  and also fixes the web client.

### [NOTABLE] The typing bar ticks at 1 Hz forever
- **Where**: `android/.../ui/chat/ChatScreen.kt:265-272`:
  `LaunchedEffect(typing) { while (true) { delay(1000); now.value = … } }`.
- **What**: the loop runs whether or not anyone is typing, and each tick recomposes `TypingBar`, which
  does `typing[channelId].orEmpty().filterValues { … }.keys.toList()` — three allocations per second.
- **Cost**: a wake-up and a recomposition every second for the entire time a chat is open; on a locked
  or backgrounded screen it keeps the coroutine alive.
- **Fix**: only run the loop while `typing[channelId]` is non-empty, and `delay` until the earliest
  expiry rather than a fixed second. ~10 lines.

### [NOTABLE] `AppState.nameFor` is called two to three times per row and reads three maps each time
- **Where**: `android/.../ui/chat/MessageRow.kt:105,116` and inside `Avatar`
  (`MessageRow.kt:~101`); implementation at `AppState.kt:~186`.
- **Cost**: 3 map lookups × 3 calls × 15 visible rows per recomposition. Small individually, constant
  during scrolling. (Note these read `.value` rather than collected state, so the displayed names also
  do not update until something else recomposes — a correctness bug with the same root cause.)
- **Fix**: resolve the name once per row into a `remember`. ~5 lines.

### [MINOR] Lambdas are recreated per item in the LazyColumn body
- **Where**: `android/.../ui/chat/ChatScreen.kt:141-142` —
  `onLongPress = { actionsFor = message }, onReply = { replyTo = message }`.
- **What**: each captures `message`, so strong skipping can only memoise them if `UiMessage` is stable.
  `UiMessage` wraps `net.Message`, which carries `List<String>` and `List<ReactionSummary>` fields.
- **Cost**: two closure allocations per item per recomposition of the list content lambda — which, given
  the `firstVisibleItemIndex` finding above, happens on every scrolled item.
- **Fix**: mark the model types `@Immutable` (they are effectively so), and pass
  `onLongPress: (UiMessage) -> Unit` hoisted out of the item scope. ~10 lines.

### [MINOR] `previous` coupling makes one edit dirty two rows
- **Where**: `android/.../ui/chat/ChatScreen.kt:140` — `previous = ordered.getOrNull(index + 1)`.
- **Cost**: editing or deleting a message changes the parameters of the following row too, doubling the
  recomposition for single-message events.
- **Fix**: precompute `groupStart`/`dayBreak` booleans when the list is built and pass those instead of
  the whole previous message. ~20 lines.

### [MINOR] `ServerRail` sorts with `order.indexOf` inside the comparator
- **Where**: `android/.../ui/main/Sidebar.kt:75`:
  `sortedWith(compareBy({ order.indexOf(it.id).let { … } }, { it.server.name }))`.
- **Cost**: `indexOf` is O(n) inside a comparator called O(n log n) times → O(n² log n). With 20
  servers it is nothing; with 200 it is ~300 000 comparisons per recomposition.
- **Fix**: build a `Map<String, Int>` of positions once. 3 lines.

### [MINOR] `Mentions.extract` scans all known users per send
- **Where**: `android/.../data/MessageService.kt:~172` —
  `Mentions.extract(text, AppState.users.value.values)`.
- **Cost**: O(known users) per message sent.
- **Fix**: only scan when the text contains `@`. 2 lines.

### [IDEA] Enable Compose compiler metrics and check stability
- **Where**: `android/app/build.gradle.kts` `kotlin { compilerOptions { … } }`.
- **What**: adding `-P plugin:androidx.compose.compiler.plugins.kotlin:reportsDestination=…` produces a
  per-composable report of which parameters are unstable and which composables are skippable.
- **Win**: this is how to confirm (rather than infer) whether `UiMessage`, `Channel`, `Member` and
  `ServerState` are being treated as stable. Half an hour, and it tells you which of the findings above
  are already handled by strong skipping.

---

## Cross-cutting

### [SEVERE] Connecting is O(everything you can see), not O(what is on screen)
- **Where**: `internal/gateway/conn.go:628` (`buildReady`) plus `internal/api/server_glue.go:183`
  (`ReadyExtras`).
- **What**: `ready` contains every DM channel with recipients, every relationship, read states for
  **every channel in every server** (`ExtraChannels`), every key grant the user holds, every emoji of
  every server (`EmojisForUser`, `internal/store/expressions.go:117` — unbounded), every sticker pack,
  and a full `serverView` per server including up to 500 members each. Then `ReadStatesFor` counts
  unread mentions for all of those channels.
- **Cost**: a user in 20 servers with 250 custom emoji each gets 5 000 emoji rows; 20 × 500 members =
  10 000 member records; read states for perhaps 1 000 channels each with a mention-count subquery.
  Easily several hundred KB of JSON (uncompressed, per the compression finding) and several hundred
  queries per connect. Every deploy and every network blip makes every client pay this at once.
- **Fix**: page the parts that are not needed to paint the first screen — emoji and stickers on demand
  per server, read states for the servers actually opened, members only for the visible channel. This
  is the largest structural change proposed here (a week or so), but it is what separates "fast at
  100 users" from "fast at 100 000".

### [NOTABLE] Opening a channel costs more server work than it should
- **What**: `GET /channels/{id}/messages` costs `ChannelByID` (3 queries) + `ChannelPerms` (~9) +
  the page query + `hydrate` (2) ≈ 15 statements; the client then fires up to 50 `GET /users/:id`
  requests (`stores/messages.ts:20`), each costing 3 more. Total ≈ 165 statements to open a channel.
- **Fix**: the per-request permission memo and the batch user endpoint together take this to roughly
  6 statements.

### [NOTABLE] The desktop app and any non-Cloudflare deployment get no compression at all
- **What**: see the compression finding above. The hosted instance is fronted by a Cloudflare tunnel
  (`internal/auth/middleware.go:~170` trusts `CF-Connecting-IP` from loopback), which masks this for
  chat.evilion.xyz. Self-hosters — the audience for an end-to-end-encrypted chat product — do not get
  that.

### [IDEA] There is no way to see any of this in production
- **What**: there is no request-timing histogram, no slow-query log, no per-event fan-out counter, and
  no client-side performance beacon. `internal/api/crash_handlers.go` collects crashes but not timings.
- **Win**: a `/metrics` endpoint with request duration by route, SQL statements per request, gateway
  fan-out size and queue depth would have made every finding in this document measurable rather than
  inferred. It is also the only way to defend the front page's claim with numbers.
