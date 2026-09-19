# Findings — server-core (prefix `SCORE`)

State: auditing

> **Note on missing SCORE-001..013.** The first agent for this area recorded in
> `PROGRESS.md` that it had written findings 001–013, but `FINDINGS.md` was
> never created on disk (no copy exists anywhere in the repo or in `$TMPDIR`);
> the `Write` tool refuses `.md` files in this harness, which is very likely
> why. Those write-ups are lost. Ids are never reused, so this file starts at
> **014**. Where the predecessor's ticked files carried risk, this agent
> re-read them and re-derived findings under new ids. Gaps in 001–013 are lost
> work, not declined findings.

### SCORE-014 · P0 · bug · `backup.sh` leaves out `data/server.secret`, so a restore locks every 2FA user out for good
- Where: `backup.sh:9-12`, `cmd/chatd/main.go:255-300` (`loadOrCreateSecret`), `internal/api/mfa_handlers.go:46-86` (`derivedKey`, `sealSecret`, `openSecret`), `internal/api/mfa_handlers.go:159`
- What: the backup copies `data/chat.db` and `data/media` only. The key that makes half of that database readable lives in a third file, `data/server.secret`, and is not copied. `loadOrCreateSecret` **silently generates a new random secret when the file is missing** (it only refuses when the file exists and is too short). TOTP seeds are stored sealed under `derivedKey("mfa-seal-v1")` and backup-code hashes are HMAC'd with `derivedKey("mfa-backup-v1")`, both off that secret.
- Impact: restore `chat-*.db` + `media-*.tgz` onto a clean machine (the entire point of the backup) and chatd starts happily with a brand-new secret. Every account with 2FA on can no longer sign in: `openSecret` fails on `user_mfa.totp_secret` so authenticator codes never verify, *and* the backup codes the user wrote down hash to something else, so the documented escape hatch is gone too. Recovery needs a DB edit by the operator. The same restore also invalidates every signed media URL (`internal/api/proxy_handlers.go:54,67`) and every in-flight MFA/setup ticket.
- Fix: add `data/server.secret` to `backup.sh` (into the tarball or as its own `0600` copy) and say in `deploy/README.md` that it is the one file whose loss cannot be undone. Separately, make `loadOrCreateSecret` refuse to mint a new secret when the database it is about to serve already has `user_mfa` rows — a missing secret next to a populated database is a restore mistake, not a first run.
- Effort: S
- Status: open

### SCORE-015 · P1 · bug · The backup prints "written" even when the media tarball failed, and nothing ever prunes `backup/`
- Where: `backup.sh:10-12`
- What: `tar czf "backup/media-$stamp.tgz" -C data media 2>/dev/null || true` throws away both the error text and the exit status; the final `echo "backup/chat-$stamp.db and backup/media-$stamp.tgz written"` then runs unconditionally. Disk full, a missing `data/media`, an unreadable blob, a `tar` that is not installed — all report success. `chmod 600 ... || true` hides the same way. There is also no pruning: every run writes a full copy of the database plus every blob ever uploaded, into `backup/` on the same volume as the live data.
- Impact: the operator's only signal that backups work is a line that is printed whether or not they worked; the first time anyone looks is when they need a restore. And because nothing prunes, a weekly backup of a growing media directory eventually fills the disk the live SQLite database is on — which takes the site down rather than just the backup.
- Fix: check `tar`'s status, print the real sizes of what landed (and fail loudly otherwise); keep the N newest of each kind (`ls -t | tail -n +N | xargs rm -f`); say in `deploy/README.md` that `backup/` on the same disk is not an off-box backup.
- Effort: S
- Status: open

### SCORE-016 · P1 · docs · The README still says calls are peer-to-peer with "no media server", which has been false since the SFU went live
- Where: `README.md` ("Voice and video: **peer-to-peer** voice channels and DM calls…"), `README.md` ("**Calls** are peer-to-peer WebRTC (encrypted by construction); the tunnel only carries HTTP, so there is no media server on this box.")
- What: since 2026-09-13 every call goes through Cloudflare Realtime (`internal/realtime/client.go`, `chatd.env.example`'s `REALTIME_APP_ID`/`REALTIME_APP_SECRET`, `internal/api/voice_glue.go`). `chatd.env.example` describes this accurately — "every call goes through Cloudflare … frames stay end-to-end encrypted" — and even explains that guest links are refused peer-to-peer because a guest would otherwise see members' addresses. The README says the opposite.
- Impact: the one document a self-hoster (or the owner, months later) reads to learn where voice data travels is wrong in the privacy-relevant direction. Someone deciding whether to enable guest links, or answering "does my audio leave my machine", gets the wrong answer.
- Fix: rewrite both claims: media is relayed by the Cloudflare Realtime SFU when `REALTIME_APP_ID`/`REALTIME_APP_SECRET` are set (so nobody in a call learns another person's address, and frames stay end-to-end encrypted through the relay), peer-to-peer when they are not; mention the monthly allowance behaviour. Also add the packages the README's `internal/` line omits (`cache`, `perms`, `ratelimit`, `realtime`, `rpcapps`, `totp`, `voice`, `textutil`).
- Effort: S
- Status: open

### SCORE-017 · P2 · docs · The Postgres move tells you to stop chatd with a command that cannot work, then to copy a live database
- Where: `deploy/README.md` ("Moving to Postgres": `launchctl unload ~/Library/LaunchAgents/xyz.evilion.chat.plist`), vs `deploy/install.sh:61-70` and the same file's "Day to day" block
- What: chatd is installed as a system **LaunchDaemon** at `/Library/LaunchDaemons/xyz.evilion.chat.plist` and is stopped with `sudo launchctl bootout system/xyz.evilion.chat`. The path in the Postgres section points at a per-user LaunchAgent that does not exist, so the command fails and chatd keeps running.
- Impact: the operator follows the steps, sees a `launchctl` complaint they may read as "already stopped", and runs `chatmigrate` against a database chatd is still writing to — which `cmd/chatmigrate/main.go:12` warns about and which the row-count check at the end can then fail on after a long copy (or, worse, pass while having missed rows written during the read).
- Fix: use `sudo launchctl bootout system/xyz.evilion.chat` (and `bootstrap` to start again), consistent with the rest of the file. Consider making `chatmigrate` warn when the source database's WAL is non-empty or its `-shm` shows an active connection.
- Effort: S
- Status: open

### SCORE-018 · P2 · docs · The README says GIF search needs a Tenor key; the server only knows Klipy
- Where: `README.md` ("sticker packs … and GIF search when a Tenor key is configured", and Configuration: "optional Tenor key for GIF search") vs `chatd.env.example:48` (`KLIPY_API_KEY`), `internal/config/config.go`, `internal/api/expression_handlers.go`, `web/src/components/pickers/GifPicker.tsx`
- What: "tenor" appears nowhere in the codebase. The provider is Klipy, configured with `KLIPY_API_KEY`.
- Impact: a self-hoster following the README obtains a Tenor key, finds no setting for it, and concludes the feature is broken.
- Effort: S
- Status: open

### SCORE-019 · P2 · perf · `logs/chatd.log` grows forever — nothing rotates it, and it sits on the disk the database is on
- Where: `deploy/xyz.evilion.chat.plist.in:62-67` (`StandardOutPath`/`StandardErrorPath`), `deploy/install.sh` (creates `logs/` and nothing else), no `newsyslog.d` drop-in, no rotation in the Go code
- What: launchd appends stdout and stderr to one file for the process's whole life, across restarts. Nothing truncates or rotates it. (93 KB today, after a week of light use — so this is a slow leak, not an outage waiting this month.)
- Impact: any change that logs per request or per error (the client error reporter, an SFU that starts failing — the log already carries repeated "sfu close session … context deadline exceeded" warnings) turns this into a file that fills `data/`'s volume; SQLite then fails writes, which is a site outage. It is also the file `deploy/README.md` tells the operator to `tail -f`, so it gets slower to open over time.
- Fix: install a `/etc/newsyslog.d/xyz.evilion.chat.conf` drop-in from `install.sh` (size-based, keep 5, with `logs/` owned by the daemon user), or rotate in-process at a size cap. Add the rotation line to `deploy/README.md`.
- Effort: S
- Status: open

### SCORE-020 · P2 · bug · `make clean` deletes the live deployment, including the rollback copy
- Where: `Makefile:76-77` (`clean: rm -rf bin web/dist android/app/build android/build`), `run.sh:5`, `deploy/xyz.evilion.chat.plist.in` (`KeepAlive`), `deploy/install.sh:47`
- What: `bin/chatd` is the file launchd starts and `web/dist` is what chatd serves — the two things the Makefile's own comments call "the deploy". `clean` removes both, plus `bin/chatd.prev`, which is the documented way back. Every other target that writes those paths grew a guard on 2026-09-17 (`DEPLOY=1`, the `.next`/`.prev` dance); `clean` did not.
- Impact: one `make clean` takes chat.evilion.xyz down. `run.sh` exits 1 with "bin/chatd missing", launchd's `KeepAlive` retries every 5 s forever, and the rollback binary is gone, so the only way back is a full `make build` (which needs `npm ci` and a working network). Anybody's reflex "clean and rebuild" does this.
- Fix: leave `bin/` and `web/dist` alone by default (clean only `android/*/build`, `web/node_modules/.vite`, scratch dirs), or require the same explicit opt-in the deploy targets use and print what it is about to remove.
- Effort: S
- Status: open

### SCORE-021 · P2 · bug · chatd starts without complaint on a database newer than the binary — which is exactly what a rollback does
- Where: `internal/db/db.go:162-225` (`Migrate`), `internal/db/db.go:131-146` (`Version`)
- What: `Migrate` skips every migration whose number is `<= current` and has no upper bound check. A binary that embeds migrations up to 0011 started against a database at `user_version = 12` applies nothing, logs nothing and serves traffic against a schema it was never compiled for.
- Impact: the documented rollback is `cp bin/chatd.prev bin/chatd` (`deploy/README.md`, `Makefile:29`). Do that after any release that added a migration and chatd comes up on a schema with columns and tables it does not know: what breaks depends on the migration (a `NOT NULL` column the old insert path omits fails every write to that table; a renamed column makes one feature return 500s), and it breaks silently, at request time, per feature. A one-line check turns that into a refusal to start.
- Fix: in `Migrate`, after reading the embedded names, refuse to run when `current` is greater than the highest embedded number ("database is at 12, this build knows 11 — use a newer binary"), for both dialects. Log the version it did start at.
- Effort: S
- Status: open

### SCORE-022 · P3 · test · `chatmigrate`'s byte-for-byte check covers keys and sessions but not the second factor
- Where: `cmd/chatmigrate/main.go:183-195` (`keyColumns`)
- What: the digest list — the columns whose bytes are compared on both sides because "a key or a session token that came across wrong would lock somebody out" — covers `users`, `key_epochs`, `key_grants`, `messages`, `user_settings`, `blobs`, `sessions`, `attachments`. It omits `user_mfa.totp_secret` (the sealed TOTP seed, `internal/store/mfa.go:29`) and `mfa_backup_codes.code_hash`, which are precisely "would lock somebody out" values, and were added by migration 0004 after this list was written. `guest_links`/`invites` codes are in the same category.
- Impact: none today (the row counts still match and the buffer-reuse bug at `main.go:295` is handled), but the one check designed to catch a silently mangled credential does not look at the credential that locks a user out hardest.
- Fix: add `{"user_mfa", "user_id", "totp_secret, last_step, enabled"}` and `{"mfa_backup_codes", "user_id, code_hash", "used_at"}` to `keyColumns`; consider generating the list from the schema instead (every BLOB and every `*_hash` column).
- Effort: S
- Status: open

### SCORE-023 · P3 · code · Per-server avatars and role icons exist in the schema, the models, the data export and the web render path — nothing can set them
- Where: `internal/db/migrations/0001_init.sql:93` (`server_members.avatar_id`), `:110` (`roles.icon_id`); `internal/store/models.go:202,212,226,237`; `internal/store/servers.go:433` (`UpdateMember`), `:550` (`UpdateRole` — both write the columns); `internal/api/server_handlers.go:1554` (the member PATCH builds a patch with only `Nickname`/`TimeoutUntil`), `:1220-1262` (the role PATCH sets only name/color/hoist/mentionable/permissions); `internal/api/legal_handlers.go:472` ("Per-community avatar:"); `web/src/components/chat/MemberList.tsx:188` (`row.member.avatar_id ?? row.user?.avatar_id`); `web/src/api/types.ts:124`
- What: `MemberPatch.AvatarID` is constructed nowhere outside a store test, and `RolePatch.IconID` nowhere at all. Both columns are therefore permanently NULL for every row on the instance.
- Impact: no user-visible breakage, but it reads like a shipped feature: the data export prints a "Per-community avatar" line that can only ever be empty, the member list's first-choice avatar can never resolve, and anyone reading `Role.icon_id` in the API types assumes role icons exist. Two features Discord charges for are one handler field away from working, which is exactly the README's pitch.
- Fix: either finish them — accept `avatar_id` in the member PATCH (self only, an `avatar`-kind upload, `null` to clear) and `icon_id` in the role PATCH (emoji-sized blob, drawn before the role name in the member-list group headers and in role mentions) — or delete the columns, the two patch fields and the export line. The store side already works either way.
- Effort: M to finish, S to delete
- Status: open

### SCORE-024 · P2 · bug · The legal record prints "Custom emoji uploaded: 500" when the account uploaded more — a wrong number in the one document that must not have wrong numbers
- Where: `internal/store/legal.go:768` (`SELECT … FROM emojis WHERE creator_id = ? ORDER BY created_at LIMIT ?`, `LegalListCap`), `internal/api/legal_handlers.go:733` (`d.field("Custom emoji uploaded:", legalCount(len(rec.Emojis)))`)
- What: `rec.Emojis` is a list capped at 500 rows, and the renderer derives the *count* from `len()` of that capped list. Every other count in the record comes from a `count(*)` (`rec.Stickers`, `rec.Messages.Count`, `rec.Reactions.Count`), so this is the only field where the cap leaks into a number presented as a total. The renderer's own `capped()` helper (`legal_handlers.go:145`) is not called for this list either.
- Impact: a record produced under legal process understates how many custom emoji an account uploaded, with nothing saying it was capped. The file's opening comment is explicit that the point of reading rows back is that "a description drifts … a SELECT cannot", and `legal_handlers.go:134` says "A report that silently truncates is worse than one that does not list at all". This is both at once.
- Fix: add an `EmojisTotal int` (a `count(*)` on `emojis WHERE creator_id = ?`) to `AccountRecord` and print that, then `d.capped(len(rec.Emojis))` under the list. Same for any future list whose count is taken from `len()`.
- Effort: S
- Status: open

### SCORE-025 · P3 · bug · Two more capped lists in the legal record truncate without saying so
- Where: `internal/store/legal.go:573-575` (`PerChannel`, `LIMIT LegalListCap`), `:642` (`Emoji`, reaction emoji, same limit); rendered at `internal/api/legal_handlers.go:555-560` and `:631-640` with no `d.capped(...)` call
- What: `capped()` is called for `PlainBlobs`, `AuditOnThem` and `Crashes` but not for the per-channel message breakdown or the reaction-emoji breakdown.
- Impact: milder than SCORE-024 because the true totals are printed elsewhere (`rec.Messages.Count`, `rec.Reactions.Count`), so no number is wrong — but an account active in more than 500 channels gets a table that looks complete and is not.
- Fix: one `d.capped(len(...))` after each of the two lists.
- Effort: S
- Status: open

### SCORE-026 · P1 · perf · Every message in a server channel recomputes permissions for every member of the server, from the database, with no cache
- Where: `internal/store/perms.go:109-142` (`ChannelPerms`), `:145-186` (`ChannelViewers`/`channelViewers`), `:189-203` (`allMembers`), `internal/api/server_glue.go:160-177` (the hub's `ViewerResolver`, `Access`, `SendAccess` all call straight into the store), `internal/gateway/hub.go:584-593` (`EmitChannel`)
- What: exact query counts, read off the code. One `message_create` in a server channel does
  - `ChannelPerms` for the author: `ChannelByID` 1 + `ServerByID` 1 + `Member` 2 (`servers.go:331,335`) + `Roles` 1 + `Overwrites` 1 + `IsInstanceAdmin` 1 (skipped only for the owner) = **7–8 queries**;
  - `ChannelViewers` for the audience: `ChannelByID` 1 + `ServerByID` 1 + `Roles` 1 + `Overwrites` 1 + `allMembers` 2 per 1000 members (`Members` is two queries per page, `servers.go:372-403`) + `instanceAdmins` 1 = **7 + 2·⌈N/1000⌉ queries**, and then one `perms.Compute` per member — N of them, each walking every role and every overwrite of that channel.
  So ~16 queries and N permission computations per message, per reaction, per edit, per pin, per read-state ack that fans out. Nothing is cached anywhere: `internal/cache` holds presence, rate limits and cross-process events, not permissions.
- Impact: on this instance (small servers) it is invisible. It sets the ceiling, though: a 5,000-member server turns every single message into 26 queries and 5,000 permission computations, and SQLite's reader pool is 8 connections (`internal/db/db.go:66`). It is also what makes SCORE-027 exploitable.
- Fix: one per-server cache of (roles, overwrites-by-channel, members-with-their-roles, owner, instance admins) with a version counter bumped by every role, overwrite, member, and membership write; `channelViewers` and `ChannelPerms` read from it. The viewer set per channel can be memoised on the same version. A cheaper first step: have `EmitChannel` reuse the viewer list a handler has already computed for its permission check instead of resolving it a second time, and pass the `*Channel` that `ChannelPerms` already returned instead of re-reading it.
- Effort: L
- Status: open

### SCORE-027 · P2 · security · One socket can make the server resolve a whole server's permissions several times a second, by typing
- Where: `internal/gateway/conn.go:586-624` (`OpTyping`), `:669-702` (`typingAudience`), `internal/api/server_glue.go:171` (`SendAccess`), `internal/store/perms.go:156` (`channelViewers`)
- What: a typing op costs `SendAccess` (a full `ChannelPerms`, 7–8 queries) plus `ViewerResolver` (a full `channelViewers`, 7+ queries and one `perms.Compute` per member) — see SCORE-026. The only brakes are the per-channel 5 s cooldown (`typingCooldown`) and the per-connection op limiter (`opRate` 20/s, burst 100). Neither bounds the work: a client that rotates between the channels it can see pays the cooldown once per channel, so ~20 channels sustain 4 typing ops a second on one socket, and an account may hold 32 sockets (`hub.go:131`), 256 per address.
- Impact: an ordinary member of a large server can, from one browser tab, drive a few hundred queries and tens of thousands of permission computations a second — enough to hold SQLite's 8-connection reader pool and slow the instance for everyone — and it looks like normal traffic in the log. No authentication beyond "member of the server" is needed, and the same trick works through the REST typing endpoint.
- Fix: a per-connection typing budget independent of channel (say 5 in 10 s across all channels), and resolve the audience from the cache in SCORE-026 rather than from the database per op. Cheapest immediate mitigation: check `SendAccess` first and cache its answer per (conn, channel) for the cooldown window, so a repeat inside the window costs nothing.
- Effort: M
- Status: open

### SCORE-028 · P2 · perf · The `ready` payload walks every server twice and then fetches each online co-member one query at a time
- Where: `internal/gateway/conn.go:744-750` (`ExtraChannels`), `internal/api/server_glue.go:193` (`ExtraChannels` = `ChannelsForUser`), `internal/store/perms.go:206-242` (`ChannelsForUser`), `internal/api/server_glue.go:194-227` (`ReadyExtras`), `:45-70` (`serverView` → `ViewableServerChannels`), `internal/store/perms.go:245-276`
- What: for each of the user's servers, `ChannelsForUser` reads `Member` (2), `Roles` (1), `ServerChannels` (1), `OverwritesForServer` (1) and computes the visible channel set; a moment later `ReadyExtras` → `serverView` → `ViewableServerChannels` reads `ServerByID` (1), `Member` (2), `Roles` (1), `ServerChannels` (1), `OverwritesForServer` (1) and computes **the same set again**, and `serverView` re-reads `Member`, `Roles` and `ServerChannels` around it. `ServersForUser` itself runs twice. Then, per co-member that is online, `ReadyExtras` issues one more `UserByID` (`server_glue.go:220`) purely to build a presence, although the member list it is walking is already `[]store.PublicUser`.
- Impact: a user in 10 servers with 50 online co-members spends roughly 10 + 18·10 + 50 ≈ 240 queries on one connect, against an 8-connection reader pool; every reconnect of every tab pays it (the connect rate limiter is what keeps this from being a DoS, `hub.go:134`). Round 1's estimate of "30–100 queries" for ready is out of date.
- Fix: resolve each server once — one pass that produces (visible channels, my member, my permissions) and is used by both the read-state list and the server view; give `PresenceOf` an overload that takes the fields it needs (status text/emoji/expiry/pref) so the per-member `UserByID` disappears (`store.PublicUser` already carries the status; only `presence_pref` is missing from it).
- Effort: M
- Status: open

### SCORE-029 · P2 · perf · Every presence and Rich Presence update re-reads the id of every co-member from the database
- Where: `internal/gateway/hub.go:596-612` (`interestedIn`), `internal/api/server_glue.go:178-192` (`Interested`), `internal/gateway/hub.go:706-716` (`broadcastPresence`), `internal/gateway/activity.go:438-462` (`activitiesChanged` → `broadcastUser`)
- What: `interestedIn` runs `Friends` (1), `DMChannelsForUser` (1 + participants), and `Interested` = `ServersForUser` (1) + `MemberIDs` per server (1 each, every row of `server_members` for that server). That whole set is rebuilt on every status change, every connect, every disconnect, and every activity flush — the desktop app's Rich Presence pushes one at most every 4 s per connection (`activityEvery`), and each flush also re-reads the user (`broadcastUser` → `UserByID`).
- Impact: with 10 servers of 1,000 members, one status flip is ~13 queries returning 10,000 ids, deduped and walked to find open sockets. A room of desktop users listening to music turns that into the instance's steadiest load, and it scales with the largest server, not with the number of people online.
- Fix: keep the co-member set per user in `internal/cache` (it changes only on join/leave/DM-create/friend changes, all of which already fan out events), or invert it: keep a per-server set of *online* member ids in the hub and intersect, so presence fan-out costs nothing but memory. Either way `broadcastUser` should take the user it already has rather than re-reading it.
- Effort: M
- Status: open

### SCORE-030 · P2 · perf · Listing sticker packs runs one extra query per pack — 101 of them for a public-pack search, and every connect pays it too
- Where: `internal/store/expressions.go:261-285` (`packsQuery`, the `for _, p := range out { s.PackStickers(...) }` tail), `:288` (`PacksForUser`), `:304-323` (`PublicPacks`, `limit` up to 100), `:446` (`PackStickers`), and `internal/api/server_glue.go:200` (`PacksForUser` runs inside every `ready`)
- What: `packsQuery` loads the pack rows in one query and then issues one `PackStickers` query per pack. `PublicPacks` allows a limit of 100, so browsing or searching public packs is 1 + 100 queries; `PacksForUser` does it for every pack a user owns, installed, or shares a server with, on every gateway connect. Nothing caps how many packs a user can accumulate.
- Impact: the sticker browser is the slowest read-only page on the instance for no reason, and its cost lands on the same 8-connection reader pool as message sends; the per-connect cost rides on top of the `ready` build (SCORE-028). It is invisible today (few packs) and grows with exactly the feature the README advertises ("sticker packs that any user can create and share by link").
- Fix: fetch the stickers for the whole set in one query — `WHERE s.pack_id IN (…)` with the ids of the packs just loaded, grouped in Go — which is the pattern `Members` already uses for member roles (`internal/store/servers.go:390`). Add a sticker-count cap per pack while there, since nothing bounds it.
- Effort: S
- Status: open

