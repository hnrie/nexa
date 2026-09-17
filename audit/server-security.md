# Server security

Scope: `internal/` and `cmd/` of chatd at working tree `main` (HEAD `47e5bb5`),
read in full — every handler file, the router and middleware, `internal/auth`,
`internal/gateway`, `internal/store`, `internal/perms`, `internal/media`,
`internal/unfurl`, `internal/voice`, `internal/realtime`, `internal/ratelimit`,
`internal/cache`, `internal/db`, `internal/config`, `internal/totp` and
`cmd/chatd`. Roughly 23,000 lines of non-test Go.

## Summary

The authorization model is in good shape. Every handler that takes an id was
traced: object-scoped ids are consistently re-checked against the container
(`m.ChannelID != ch.ID`, `role.ServerID != srv.ID`, `up.UserID != me.ID`,
`e.ServerID != srv.ID`, `g.ChannelID != ch.ID`, …), permission checks go through
`perms.Compute`, which resolves role bits *and* channel overwrites together, and
the "you may only grant what you hold" rule is applied against **effective
channel** permissions rather than server-level ones. I found no SQL injection —
every query is parameterised, the two places that build SQL from strings
(`SwapImage`, `Dialect.*`) draw from allow-lists or constants — no path
traversal, no command execution, no committed secrets, and no plaintext leaking
across the end-to-end-encryption boundary. There are no cookies and no CORS
headers anywhere, which makes the API structurally CSRF-proof.

Where it is weak is **unauthenticated, unmetered work**. The global middleware
chain (`internal/api/router.go:166`) has no rate limiter at all; limits are
opt-in per route, and four of the internet-facing routes opted out. The most
serious of these is the media proxy, which any anonymous request can use to make
the server fetch up to 25 MB from an attacker-chosen public host, as often as it
likes. Next to that sit a handful of smaller authorization and disclosure gaps
(a voice-moderation endpoint that answers before it checks anything, channel
permission overwrites with no role-hierarchy check) and one real data race.

Counts: **2 HIGH**, **5 MEDIUM**, **11 LOW**, **5 HARDENING** (23 findings). No
CRITICAL.

## Findings

### [HIGH] The media proxy is an unauthenticated, unlimited outbound fetcher
- **Where**: `internal/api/proxy_handlers.go:36-37` (routes), `:40-45` (signature),
  `:62-144` (handler); `internal/api/unfurl_handlers.go:52-58`;
  `internal/unfurl/fetch.go:37` (`MaxMediaBytes = 25 << 20`), `:511-521`
  (`resolveImage`)
- **What**: `GET|HEAD /media/proxy/{sig}/{url}` is registered with
  `mux.HandleFunc` — no `s.authed`, no `ipLimited`, and the global chain adds no
  limiter. The only gate is an HMAC over the base64 URL. That signature has **no
  expiry and no user binding** (`proxySignature` hashes only
  `"media-proxy/v1" + encoded`), so a signed URL is a permanent, world-usable
  capability. The handler then fetches up to `MaxMediaBytes` (25 MB) per request
  and honours a caller-supplied `Range`, so the response cannot be cached away.
- **Attack**: register an account (registration defaults to `open`), host
  `https://evil.example/p.html` containing
  `<meta property="og:image" content="https://victim.example/large.bin">`, and
  call `GET /api/v1/unfurl?url=https://evil.example/p.html`. `htmlResult`
  accepts *any* absolute http(s) `og:image` (`resolveImage` only checks scheme
  and host), and `handleUnfurl` returns `s.ProxyURL(out.Image)` — a signed proxy
  path for the victim's URL. From then on **anyone, with no account and no rate
  limit**, can hit `/media/proxy/<sig>/<b64>` in a loop. Each hit costs chatd one
  outbound request of up to 25 MB in and 25 MB out. Varying `Range` defeats any
  CDN caching in front. This is both a bandwidth-exhaustion attack on the
  instance and a DDoS reflector aimed at third parties, attributed to
  chat.evilion.xyz's egress address. Minting is limited (30/min/user via
  `limUnfurl`), but you only mint once per target.
- **Confidence**: verified — read `handleUnfurl` → `Fetcher.Fetch` →
  `htmlResult` → `resolveImage` → `ProxyURL` → `handleMediaProxy` end to end.
  The SSRF guard itself is sound (only public IPs are ever dialled); the problem
  is volume, not destination.
- **Fix**: require authentication on `/media/proxy/` (the web client already
  sends a bearer token for `/media/attachments/`, so the pattern exists), or at
  minimum wrap it in `ipLimited(s.limGeneric, …)`. Put an expiry and the minting
  user's id inside the signed payload. Cache fetched bytes on disk so a repeat
  request never leaves the box twice.

### [HIGH] No cap on gateway connections, and each one runs a very expensive ready build
- **Where**: `cmd/chatd/main.go:114` (`mux.Handle("GET /gateway", hub)`),
  `internal/gateway/hub.go:205-215` (`register`),
  `internal/gateway/conn.go:209-289` (`ServeHTTP`), `:628-699` (`buildReady`),
  `internal/api/server_glue.go:183-217` (`ReadyExtras`)
- **What**: `/gateway` carries no rate limiter and no per-user, per-session or
  per-IP connection cap. `register` unconditionally adds to `h.conns`. After a
  successful identify, every connection independently runs `buildReady`, which
  is roughly 30–100 database round trips: `DMChannelsForUser`, `Relationships`,
  `ChannelsForUser` (per server: `Member`, `Roles`, `ServerChannels`,
  `OverwritesForServer`), `ReadStatesFor` (a correlated sub-select per channel,
  `internal/store/readstates.go:75-86`), `GrantsForUser`, `GetSettings`,
  `UsersByIDs`, then `ReadyExtras` → `serverView` per server (`Member`, `Roles`,
  `ViewableServerChannels`, `ServerChannels`, `MemberCount`, `Members(500)`,
  `UsersByIDs`) plus emoji and sticker-pack queries.
- **Attack**: with one ordinary account, open WebSockets in a loop and send
  `identify` with the same token on each. Nothing stops the *n*th connection.
  On SQLite (the live configuration) all writes funnel through one connection
  and reads through eight, so a few dozen concurrent identifies per second
  saturate the database and the whole instance stalls. A second, weaker path
  needs no account at all: `websocket.Accept` completes before identify, and
  each pre-identify socket holds a goroutine for up to `identifyTimeout` (10 s,
  `hub.go:72`), so anonymous clients can pin goroutines and sockets.
- **Confidence**: verified for the code path (no cap exists; `buildReady` runs
  per connection). The exact throughput at which the instance falls over is
  **not measured** — that part needs confirmation with a load test.
- **Fix**: cap connections per user (Discord uses a handful per account) and per
  IP, reject beyond it with a close code; add `ipLimited` around the upgrade;
  and consider caching the ready payload per session for a few seconds so a
  reconnect storm from one account does not multiply the query cost.

### [MEDIUM] Unauthenticated invite preview does O(members) work with no rate limit
- **Where**: `internal/api/server_handlers.go:60` (route), `:1629-1664`
  (`handleInvitePreview`, the online-count loop at `:1644-1653`);
  `internal/api/static.go:75-79` and `internal/api/unfurl_handlers.go:81-134`
  (the same work behind `GET /invite/{code}`)
- **What**: `GET /api/v1/invites/{code}` is registered with `mux.HandleFunc`,
  not `ipLimited`. Per request it runs `InviteByCode`, `ServerByID`,
  `MemberCount`, then `MemberIDs` (the full membership of the server) and calls
  `hub.Online(id)` for **every member**, each taking `h.mu.RLock()`. It also
  loads the invited channel and the inviter. `GET /invite/{code}`, served by the
  static handler, reaches the identical loop through `inviteUnfurl`.
- **Attack**: invite codes are meant to be shared, so any member of any server
  has one. An anonymous attacker replays it as fast as the network allows; each
  request costs a full member scan plus N read-lock acquisitions on the hub
  mutex, which also contends with every event fan-out. Two unauthenticated URLs
  give the same amplification.
- **Confidence**: verified — the registration line has no limiter, the chain in
  `router.go:166` adds none, and `s.Bcast` is the hub (`cmd/chatd/main.go:110`),
  so the `Online` branch is live.
- **Fix**: wrap both routes in `ipLimited(s.limGeneric, …)` and cache the
  member/online counts per server for ~30 s instead of recomputing them per
  request.

### [MEDIUM] Any server member can read another member's private voice-channel presence and write audit entries
- **Where**: `internal/api/voice_glue.go:570-699` (`handleVoiceModerate`),
  specifically `:571` (`serverCtx(w, r, 0)`), `:580-589`, `:596-599`, `:692`
  (audit write), `:693-698` (response)
- **What**: the route requires only membership (`serverCtx` with `need == 0`).
  It looks the target up in the voice registry and checks the channel belongs to
  this server, but **never checks the caller may view that channel**. Each field
  (`mute`, `deaf`, `channel_id`) has its own permission check, but a body of
  `{}` skips all three and falls through to `s.audit(...)` and
  `WriteJSON(w, 200, statePayload(final))`.
- **Attack**: as any member of a server, `PATCH /api/v1/servers/{sid}/members/{uid}/voice`
  with body `{}`. The status code alone distinguishes "not in voice" (400) from
  "in a voice channel of this server" (200 or 403). When the target ranks below
  the caller (`perms.CanActOn`), or is a guest — for whom the hierarchy check is
  skipped entirely (`:596`) — the 200 body returns the full `voiceStatePayload`:
  `channel_id` of a voice channel the caller may have no `VIEW_CHANNEL` on,
  plus `self_mute`, `self_deaf`, `video`, `streaming`, `joined_at`, display name
  and avatar. Separately, every such call appends a `member_voice` row to the
  server's audit log with no permission required, so any member can flood the
  audit log at the generic 600/min rate.
- **Confidence**: verified by reading the handler end to end.
  `ReadJSON` into `map[string]json.RawMessage` accepts `{}` without error, so the
  no-op path is reachable.
- **Fix**: return 403 when the body carries none of the three fields; check
  `ChannelPerms(cur.ID, me.ID).Has(perms.ViewChannel)` before revealing anything
  about the target; write the audit entry only when something actually changed.

### [MEDIUM] Channel permission overwrites have no role-hierarchy check
- **Where**: `internal/api/server_handlers.go:788-810` (`channelManageCtx`),
  `:812-865` (`handleOverwritePut`), `:889-907` (`handleOverwriteDelete`)
- **What**: setting an overwrite needs `MANAGE_ROLES` or `MANAGE_CHANNELS` in
  the channel, and the requested `allow|deny` bits must be a subset of the
  actor's own effective bits (`:846`). Both are correct. What is missing is the
  `perms.CanManageRole` / `perms.CanActOn` check that every other role-touching
  handler applies (`roleCtx:1027-1031`, `handleMemberRole:1404-1408`,
  `handleMemberPatch:1310-1339`). A role target is validated only for belonging
  to the server (`:836-840`); a member target only for membership (`:841-844`).
- **Attack**: a low-ranked member who has been given `MANAGE_ROLES` in one
  channel writes an overwrite denying `VIEW_CHANNEL` to a moderator role far
  above their own, or to a specific higher-ranked member, locking them out of
  that channel. `syncVisibility` then emits `channel_delete` to them and flags
  the conversation for key rotation, so it also churns E2EE keys. Server owners
  and instance admins are unaffected (`perms.Compute` short-circuits to `All`
  for them), which bounds the damage but does not remove it.
- **Confidence**: verified — the hierarchy helpers exist and are simply not
  called on this path.
- **Fix**: in `handleOverwritePut`/`handleOverwriteDelete`, for `type == "role"`
  require `perms.CanManageRole(actorHighest, actorIsOwner, role)`, and for
  `type == "member"` require `s.canActOn(ctx, srv, me.ID, target)`.

### [MEDIUM] Any member of a conversation can force unlimited key rotations
- **Where**: `internal/api/key_handlers.go:146-218` (`handleKeyEpochCreate`),
  `internal/api/server_glue.go:123-128` (`CanRotate` returns `true, nil` on
  every path)
- **What**: creating a new key epoch requires only being in `Entitled(convID)`.
  `CanRotate` is wired to always allow. The route carries no dedicated limiter —
  only the generic 600/min per account from `s.authed`. Sending any `reason`
  other than the literal `"membership change"` takes the `CreateEpoch` branch,
  which succeeds whenever `epoch == latest+1`.
- **Attack**: the newest member of a large server posts
  `POST /api/v1/keys/epochs {"conv_id": "<server id>", "reason": "x"}` 600 times
  a minute. Each accepted epoch writes a `key_epochs` row and makes every online
  key-holder re-wrap and distribute a fresh grant to every entitled member
  (`Hub.KeysMaybeNeeded` → `EvKeysNeeded`), so the cost is amplified by the
  member count on the clients and in `key_grants`. Older epochs still decrypt,
  so this is disruption and unbounded growth rather than data loss.
- **Confidence**: verified by reading the handler and `CanRotate`. The
  client-side amplification is inferred from `KeysMaybeNeeded`
  (`internal/gateway/hub.go:401-426`) and is **not** measured.
- **Fix**: give epoch creation its own limiter (a handful per conversation per
  hour), and make `CanRotate` mean something for server conversations —
  `MANAGE_SERVER` for the server root, `MANAGE_CHANNELS` for a private channel.

### [MEDIUM] No read or write timeout on the HTTP server
- **Where**: `cmd/chatd/main.go:126`
- **What**: `&http.Server{Addr: …, Handler: …, ReadHeaderTimeout: 10 * time.Second,
  IdleTimeout: 120 * time.Second}` — `ReadTimeout` and `WriteTimeout` are unset
  (they must be, for WebSockets and 90 MB uploads, but nothing replaces them
  per-route). Combined with the absent connection cap, a client can open a
  request, send headers within 10 s, and then dribble the body one byte per
  minute forever.
- **Attack**: `POST /api/v1/channels/{id}/attachments` with
  `Content-Length: 94371840` and a body sent at 1 byte/min. `MaxBytesReader`
  caps the total but not the duration. `media.spool` has already created a temp
  file in `data/media/tmp` and holds it open for the life of the request; the
  hourly `sweepTemp` only removes files idle for an hour, and a trickle keeps
  the mtime fresh. Repeat to hold arbitrarily many goroutines, sockets and
  half-written spool files.
- **Confidence**: verified for the server configuration and the spool lifetime
  (`internal/media/store.go:79-100`, `cmd/chatd/main.go:205-241`). Whether
  cloudflared in front imposes its own origin-request timeout is **not
  confirmed** and should be checked.
- **Fix**: set a per-request deadline with `http.ResponseController.SetReadDeadline`
  in the upload handlers (refreshed as bytes arrive, the way
  `unfurl.Watchdog` already does for outbound fetches), and cap concurrent
  in-flight uploads per account.

### [LOW] Data race on `conn.user`
- **Where**: write at `internal/gateway/conn.go:465` (`c.user = u` inside
  `applyPresence`), reached from the timer goroutine at `:397-412`
  (`flushPresence`); concurrent reads at `internal/gateway/activity.go:432` and
  `:439` (`h.broadcastUser(ctx, c.user.ID)` inside `resolveLoop` and a
  `time.AfterFunc` callback) and `internal/gateway/hub.go:208` / `:221`
  (`h.conns[c.user.ID]`)
- **What**: `c.user` is a plain `*store.User` field with no mutex or atomic.
  `applyPresence` replaces it, and when it runs from `flushPresence` that is a
  different goroutine from the activity resolver and the timer that reads it.
- **Attack**: not directly exploitable — the replacement user always has the
  same `ID`, and a pointer-sized write is not torn on the platforms this runs
  on. It is still undefined behaviour and `go test -race` on the gateway package
  under load would flag it; a future field read off `c.user` (display name,
  flags) could observe a stale or inconsistent struct.
- **Confidence**: verified by tracing the goroutines that call each site.
- **Fix**: store the user in an `atomic.Pointer[store.User]`, or guard it with
  the existing `presMu`, and have readers that only need the id use an immutable
  `c.userID` captured at construction.

### [LOW] Rate-limiter keys are built from unbounded user-controlled usernames
- **Where**: `internal/api/auth_handlers.go:224-228` (`"login:" + req.Username`),
  `:293` (`"recover:" + username`); `internal/ratelimit/limiter.go:83-102`
  (in-process map), `internal/cache/redis.go:148-163` (shared counter)
- **What**: the username is lowercased and trimmed but never length-checked
  before it becomes a map key. `ReadJSON` caps the login body at 4 KiB, so a
  single key can be ~4 KB. `limAuthUsr` forgets idle keys only every 10 minutes
  (`router.go:118`).
- **Attack**: 20 login attempts per minute per IP (`limAuthIP`), each with a
  distinct 4 KB username, adds ~800 KB per IP per sweep window. From a few
  thousand addresses that is hundreds of megabytes of limiter state (or of
  Redis keys, where the same unbounded string becomes `chatd:rate:login:<4KB>`).
- **Confidence**: verified by reading the code path; the memory arithmetic is
  an estimate.
- **Fix**: reject usernames longer than 32 characters (the `ValidUsername`
  bound) before touching the limiter, or hash the key.

### [LOW] `Limiter.Reset` does not clear the shared counter
- **Where**: `internal/ratelimit/limiter.go:104-109`
- **What**: `Reset` deletes only `l.entries[key]`. When `Share` is set, `Allow`
  goes to Redis and never consults `l.entries`, so the resets after a successful
  login (`auth_handlers.go:247`, `:256`, `mfa_handlers.go:278`, `:428-429`) are
  no-ops in multi-process mode.
- **Attack**: not an attacker capability — the effect is that a user who mistypes
  their password four times and then gets it right stays throttled for the rest
  of the window, and an attacker can lock a known account out of login for a
  minute at a time by burning its five attempts. Availability only.
- **Confidence**: verified.
- **Fix**: add a `Reset(ctx, key)` to the `Shared` interface (a Redis `DEL` on
  `chatd:rate:<key>`) and call it alongside the local delete.

### [LOW] User enumeration on registration, friend requests and the KDF endpoint
- **Where**: `internal/api/auth_handlers.go:187-199` (`handleKDF`),
  `internal/api/relationship_handlers.go:77-80`,
  `internal/store/users.go:73-86` (`ErrUsernameTaken` → 409 in `errors.go:42`)
- **What**: `handleKDF` goes to real lengths to hide non-existent accounts — a
  deterministic HMAC "fake salt" keyed on the persisted server secret — but then
  returns the *real* `u.KDFParams` for existing users and the constant
  `defaultKDF` for everyone else. Any account whose parameters differ from
  `{"m":65536,"t":3,"p":1,"v":1}` (anyone who changed their password from a
  client with different settings, or who registered from the Android app if its
  defaults differ) is distinguishable. `POST /api/v1/users/@me/relationships`
  answers a distinct `404 user_not_found` for an unknown username, and
  registration answers `409 username_taken`.
- **Attack**: an authenticated attacker walks a username list against the friend
  request endpoint (600/min) and learns which accounts exist; the endpoint does
  have a captcha, which blunts but does not remove it. Anonymous enumeration via
  `/api/v1/auth/kdf` is limited to 600/min/IP and only works against accounts
  with non-default parameters.
- **Confidence**: verified for the code paths. Whether real accounts actually
  carry non-default KDF parameters is **not confirmed** — it depends on what the
  web and Android clients send.
- **Fix**: always return `defaultKDF` parameters shape for the enumeration
  answer, or better, echo the *stored* params for everyone by deriving fake ones
  deterministically too. Answer friend requests with a generic "request sent"
  regardless of whether the username exists.

### [LOW] Authenticated users can walk the whole user directory by snowflake
- **Where**: `internal/api/user_handlers.go:292-304` (`handleUserGet`), `:313-345`
  (`handleUserProfile`), `:347-359` (`handlePublicKey`)
- **What**: any signed-in account may fetch any user by id with no relationship
  or shared-server requirement. IDs are snowflakes: 41 bits of milliseconds plus
  a 12-bit sequence (`internal/ids/ids.go:19-55`), so the id space around a
  known registration time is small and walkable.
- **Attack**: iterate ids near a known account's; each hit returns username,
  display name, avatar, banner, about-me, pronouns, custom status and public key.
  At the generic 600/min this is a slow but complete directory dump of a
  small instance.
- **Confidence**: verified. Note `PublicUser` correctly masks everything
  sensitive (`internal/store/models.go:70-74` keeps only `FlagAdmin`), so this is
  exposure of intentionally-public fields, not of private ones.
- **Fix**: if the instance is meant to be private, gate `GET /users/{id}` on a
  shared server, a DM or a relationship, as `handleMemberGet` already does within
  a server.

### [LOW] Unescaped LIKE wildcards in two searches
- **Where**: `internal/store/instance.go:88-89` (`AdminUsers`),
  `internal/store/expressions.go:313-314` (`PublicPacks`)
- **What**: both build `"%" + q + "%"` without `escapeLike`, unlike
  `SearchUsers` (`users.go:137`) and `Members` (`servers.go:358`), which escape
  correctly.
- **Attack**: `q = "%"` matches everything; `q = "%_%_%_%_%_%_%_%_%_%_"` is the
  pattern shape SQLite's `LIKE` matcher backtracks on, so a long one turns a
  search into a CPU burn. `PublicPacks` is reachable by any authenticated user
  via `GET /api/v1/stickers/packs/public?q=…` at 600/min. `AdminUsers` needs an
  instance admin.
- **Confidence**: verified for the missing escape; the SQLite backtracking cost
  is a known property of `patternCompare` but was **not** measured here.
- **Fix**: use `escapeLike(q)` and `ESCAPE '\'` in both, and cap `q` length.
  `AdminUsers` also uses SQLite's ASCII-only `lower()` instead of
  `s.db.Dialect.Lower(...)`, which the rest of the store uses.

### [LOW] `X-Forwarded-For` is trusted from loopback when `CF-Connecting-IP` is absent
- **Where**: `internal/auth/middleware.go:172-190`
- **What**: when the peer is loopback, `ClientIP` prefers `CF-Connecting-IP` and
  falls back to the first entry of `X-Forwarded-For`. Cloudflare overwrites
  `CF-Connecting-IP` but *appends* to any client-supplied `X-Forwarded-For`, so
  the first entry of that header is attacker-controlled.
- **Attack**: if any request ever reaches the origin through the tunnel without
  `CF-Connecting-IP` — a Cloudflare configuration change, a direct
  `cloudflared` access rule, or anything else placed on loopback — a client that
  sends `X-Forwarded-For: 1.2.3.4` controls its own rate-limit bucket and the
  `remoteip` sent to Turnstile, evading `limAuthIP`, `limReg` and `limGuest`.
- **Confidence**: the code path is verified. Whether `CF-Connecting-IP` can ever
  be missing in this deployment **needs confirmation**.
- **Fix**: drop the `X-Forwarded-For` fallback and rely on `CF-Connecting-IP`
  alone, with `r.RemoteAddr` as the fallback.

### [LOW] The gateway origin allow-list always includes `localhost:*` and `127.0.0.1:*`
- **Where**: `internal/gateway/hub.go:73-77`
- **What**: `originPatterns` is `[PUBLIC_URL host, "localhost:*", "127.0.0.1:*"]`
  in every build, production included.
- **Attack**: bounded. A page served from `http://localhost:<port>` on a
  victim's machine could open a gateway socket to chat.evilion.xyz — but the
  token travels in the `identify` frame, not in a cookie, so an attacker's page
  has nothing to authenticate with. It is a widened attack surface, not a live
  hole.
- **Confidence**: verified.
- **Fix**: add the loopback patterns only when `PUBLIC_URL` is itself a loopback
  address, or behind a build tag.

### [LOW] Sessions never expire while they are used
- **Where**: `internal/config/config.go:92` (`SessionTTL: 90 * 24 * time.Hour`),
  `internal/auth/middleware.go:43-55`
- **What**: the TTL is measured from `LastSeenAt`, which is refreshed every five
  minutes of use. There is no absolute lifetime, no re-authentication step, and
  no binding to IP or user agent. A token stolen today is good for 90 days of
  idleness and indefinitely with periodic use.
- **Attack**: a stolen bearer token (from a shared device, a backup, the desktop
  app's storage) stays valid until the owner notices and revokes the session in
  `GET /api/v1/auth/sessions`.
- **Confidence**: verified. Password change and account recovery do revoke other
  sessions (`auth_handlers.go:444-445`, `:395-396`), which is correct.
- **Fix**: add an absolute maximum session age alongside the idle TTL, and
  consider re-checking the password for sensitive actions beyond the four that
  already do (MFA setup/disable, backup codes, account delete).

### [LOW] A subchat's password does not gate deletion or the realtime feed
- **Where**: `internal/api/access.go:83-96` (`unlocked`),
  `internal/api/server_handlers.go:740-747` →
  `internal/api/subchat_handlers.go:229-241` (`handleSubchatDelete`),
  `internal/gateway/hub.go:327-339` (`Viewers`) with
  `internal/store/perms.go:113-120` (`ChannelPerms` returns `perms.All` for any
  recipient of a server-less channel)
- **What**: `s.channel` refuses a locked subchat until this *session* has typed
  the password, but `DELETE /api/v1/channels/{id}` reaches
  `handleSubchatDelete` through a path that only checks recipiency
  (`server_handlers.go:741`), and `EmitChannel` pushes `message_create` for a
  locked subchat to **every** connection of every recipient, including sessions
  that never unlocked it.
- **Attack**: your DM partner puts a password on a subchat; you cannot open it
  through REST, but you can delete it and its whole history, and your client
  receives every new message in it over the WebSocket regardless.
- **Confidence**: verified. The code comment at `access.go:83-85` says plainly
  that the lock "keeps a subchat shut on the screen" and the messages are
  encrypted for the same people either way — so the realtime behaviour matches
  the stated model. The deletion path is a genuine inconsistency with the REST
  gate.
- **Fix**: apply `s.unlocked` in `handleSubchatDelete` (and to `PATCH` of a
  locked subchat, which already goes through `s.channel`), or document that the
  lock never gates writes. Leave the gateway behaviour as it is but say so.

### [LOW] Public media is unauthenticated and can be made to do image work
- **Where**: `internal/api/media_handlers.go:13` (route), `:34-49`
  (`handleMediaPublic`), `internal/media/variants.go:37` (`variantWork`,
  capacity 2), `:73-106` (`ServePublicSized`), `:128-166` (`variant`)
- **What**: `GET /media/{kind}/{id}` takes no token and no rate limit. Avatars,
  banners, icons, emoji and stickers are fetchable by id by anyone. A `?size=`
  that has not been generated yet decodes the full image and rescales it with
  `draw.CatmullRom` while holding one of two semaphore slots; a banner may be
  8192×4096, which is ~134 MB as NRGBA during the resize.
- **Attack**: `VariantSize` snaps to seven powers of two (16…1024), so disk and
  the number of distinct jobs are bounded — but requests that miss the cache
  queue on `variantWork` and each holds a goroutine waiting on `ctx.Done()`.
  Separately, walking snowflake ids dumps every avatar and emoji on the instance
  to an anonymous client.
- **Confidence**: verified for the code path; the memory figure is arithmetic
  from `limitsFor("banner")` (`media_handlers.go:24`), not measured.
- **Fix**: `ipLimited(s.limGeneric, …)` on the route; pre-generate the common
  sizes at upload time so the request path never decodes.

### [HARDENING] No HSTS, and CSP only on HTML responses
- **Where**: `internal/api/middleware.go:91-100` (`SecurityHeaders`),
  `internal/api/static.go:19` (`CSP`), applied at `:103`, `:131`, `:186`, `:219`
- **What**: the global header middleware sets `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY` and a `Permissions-Policy`, but not
  `Strict-Transport-Security`. CSP is attached only to `index.html` and `.html`
  assets; API JSON, `/media/attachments/`, error envelopes and the Android
  captcha page get none (the media and proxy handlers do each set their own
  `default-src 'none'; sandbox`, which is the important case). No
  `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy` outside the
  proxy handler.
- **Confidence**: verified. HSTS may well be set by Cloudflare at the edge —
  that **needs confirmation** — but it is worth setting at the origin too so the
  guarantee does not depend on a dashboard toggle.
- **Fix**: add `Strict-Transport-Security: max-age=63072000; includeSubDomains;
  preload` and a restrictive default CSP (`default-src 'none'; frame-ancestors
  'none'`) in `SecurityHeaders`, letting `static.go` override it for HTML.

### [HARDENING] The media proxy builds a new `http.Transport` per request
- **Where**: `internal/unfurl/cache.go:105-116` (`MediaFetcher`),
  `internal/unfurl/fetch.go:118-130` (`transport`),
  `internal/api/proxy_handlers.go:82`
- **What**: `MediaFetcher()` returns a fresh `Fetcher` with `Transport` copied
  from the base — which is `nil` in production (`NewService` never sets it) — so
  `f.transport()` allocates a new `http.Transport` on every proxied request.
  `DisableKeepAlives: true` limits the damage, but connection pools and their
  goroutines are created and discarded per request. `MediaFetcher` also drops
  `ParentHost` (harmless here, but a copy that silently loses a field).
- **Confidence**: verified.
- **Fix**: build the media transport once in `NewService` and reuse it.

### [HARDENING] The end-to-end-encryption boundary rests on the server for identity
- **Where**: `internal/api/user_handlers.go:347-359` (`handlePublicKey`),
  `internal/store/models.go:64` (`PublicUser.PublicKey`),
  `internal/api/key_handlers.go:56-144` (`handleKeyGrantsPut`)
- **What**: the cryptography is otherwise well-placed — the server stores only
  Argon2id hashes of client-stretched keys, never sees a password, never
  decrypts a message envelope (`validEnvelope` checks structure only,
  `message_handlers.go:49-66`), seals TOTP seeds under a derived key, and the
  grant endpoint enforces both entitlement and "you must actually hold this key
  to share it" with a deliberate refusal of self-wrapped grants as proof of
  holding (`:108-126`). But every public key a client uses comes from this
  server, and the server also decides who is entitled to a conversation. A
  compromised server can hand out a key it controls for a user id and then
  receive a grant wrapped for it, or add a member and wait for a legitimate
  holder to grant.
- **Confidence**: verified as a property of the design. This is the standard
  malicious-server problem, not a bug.
- **Fix**: nothing on the server side alone. What closes it is a client-side
  fingerprint the two people can compare out of band, plus a visible warning
  when a peer's public key changes. Worth confirming whether the web and native
  clients already do this; if not, it belongs on the roadmap, because the
  product's claim is end-to-end encryption.

### [HARDENING] GIF search proxies user queries upstream at the generic rate
- **Where**: `internal/api/expression_handlers.go:775-818` (`gifProxy`),
  `:892-949` (`klipyPage`)
- **What**: `q` has no length cap and every cache miss (2-minute TTL, 500-entry
  cache flushed wholesale when it overflows) becomes an outbound request to
  `api.klipy.com` carrying the instance's API key. The only limit is
  `s.authed`'s 600/min per account.
- **Confidence**: verified.
- **Fix**: cap `q` at ~100 characters and give the two GIF routes their own
  limiter (`limUnfurl` would do).

### [HARDENING] `handleMessages` and friends clamp page sizes in the store, not the handler
- **Where**: `internal/api/message_handlers.go:175-177`, `:581`,
  `internal/api/server_handlers.go:1173-1175`, `:1790-1791`
- **What**: `limit` is read with `strconv.Atoi` and passed through unchecked;
  the clamping happens inside the store (`Messages` at
  `internal/store/messages.go:185-188`, `Reactors` at `:425-427`, `Members` at
  `internal/store/servers.go:352-354`, `AuditEntries` at
  `internal/store/invites.go:178-180`, `AdminUsers`, `PublicPacks`,
  `RecentClientErrors`). Every one of them clamps correctly, so there is no
  unbounded page today — but the invariant lives far from the parsing and a new
  store method would inherit no protection.
- **Confidence**: verified — I checked all seven and each clamps.
- **Fix**: parse and clamp in a shared helper at the handler layer as well.

## Checked and found correct

Worth recording, so the coverage is legible:

- **SQL**. Every query in `internal/store` uses `?` placeholders rebound by
  `internal/db/dialect.go:78-112`, which correctly skips `?` inside string
  literals. The only SQL assembled from Go strings is column/table names from
  the `imageColumns` allow-list (`blobs.go:95-107`), `placeholders(n)`
  (count-derived), `prefixed()` over package constants, and the dialect helpers
  — all constant input. No `fmt.Sprintf` reaches a query. `escapeLike` is
  applied in `SearchUsers`, `Members` and `CountBlobsByContent`.
- **Path handling**. `staticHandler` does `path.Clean("/" + r.URL.Path)` then
  checks the joined result still has the `dist` prefix (`static.go:42-54`).
  `/android/{file}` and `/desktop/{file}` match strict regexes, reject `..`, and
  re-check `filepath.Dir(fp) == dir` (`android_handlers.go:83-98`,
  `desktop_handlers.go:67-82`). Blob paths derive from hex hashes only
  (`media/store.go:70-76`, `shaOf` at `:310-316`). No user-supplied filename
  ever reaches the filesystem.
- **Attachments cannot become stored XSS**. `ServeEncrypted` forces
  `application/octet-stream` + `nosniff` (`media/handler.go:44-49`);
  `ServePublic` serves only the four sniffed image types with
  `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff`
  (`:26-32`), and `PublicKinds` excludes `attachment`. `Sniff`
  (`media/validate.go:30-46`) accepts only PNG/JPEG/GIF/WebP by magic bytes, so
  an SVG or HTML upload is refused. Upload dimensions are read with
  `image.DecodeConfig` (header only), not a full decode, so an upload is not a
  decompression bomb. The manual GIF frame walker (`:49-100`) is bounds-checked
  on every index I traced.
- **CSRF**. There are no cookies and no `Access-Control-*` headers anywhere in
  the tree. Every authenticated route reads a bearer token from the
  `Authorization` header. A cross-origin page therefore has no ambient
  credential and cannot read responses.
- **Token handling**. 256 bits from `crypto/rand`, base64url, stored as SHA-256
  only (`auth/tokens.go`); lookup is by hash, so a database leak does not yield
  usable tokens. Password verification is Argon2id with `subtle.ConstantTimeCompare`
  and rejects unsafe stored parameters (`auth/password.go:41-64`). Login has a
  300 ms timing floor, per-IP (20/min) and per-username (5/min) limits, and does
  not distinguish "no such user" from "wrong password". MFA tickets are HMAC-signed,
  expiring, purpose-separated and compared in constant time
  (`mfa_handlers.go:97-125`); TOTP steps and backup codes are burned atomically
  in SQL (`store/mfa.go:62-69`, `:98-105`).
- **Guest isolation**. Guest tokens live in a separate table, so
  `Authenticator.Resolve` can never return a guest and `ResolveGuest` can never
  return an account (`auth/middleware.go:35-72`). `buildGuestReady`
  (`gateway/conn.go:615-625`) hands a guest nothing but their own call.
  `conn.handle` drops every op but heartbeat and the two voice ops for guests
  (`:471-477`). Guest codes carry ~70 bits. The guest-join path is captcha-gated,
  IP-limited (30/hour) and capped per link and per channel.
- **SFU authorization**. `sfuCaller` binds each request to the caller's live
  voice state *and* their session; every handler re-checks
  `req.SessionID == st.SFUSession`; `handleSFUSubscribe` refuses any track
  whose owner is not in the same channel, and track names are server-generated
  with random suffixes and never disclosed — clients see only a hash
  (`voice.TrackTag`). The app secret never leaves the server.
- **SSRF**. `internal/unfurl/guard.go` blocks a thorough CIDR list plus
  `IsPrivate`/loopback/link-local/multicast, refuses userinfo and `localhost`,
  and — critically — re-resolves and re-checks in the transport's
  `DialContext`, so DNS rebinding cannot slip past the pre-check. Redirects are
  re-validated. Bodies are capped and a watchdog cancels a stalled transfer.
- **Concurrency**. `voice.Registry`, `ratelimit.Limiter`, `unfurl.Cache`,
  `media.Store`'s upload locks, `rpcapps.Cache` and the gateway hub all guard
  their maps consistently; `Registry` returns copies of `State` rather than
  pointers. The gateway's `pending`/`live` handshake around the ready payload
  and the `ConnID` ownership checks on voice state are careful work. The one
  race I found is `conn.user`, above.
- **Secrets**. `chatd.env` and `data/` are git-ignored; a repository-wide grep
  for inline credentials found nothing. `server.secret` is created 0600,
  written-then-renamed, and startup refuses to replace a short existing one
  (`cmd/chatd/main.go:243-284`). Errors are logged server-side and answered to
  clients with a generic envelope (`api/errors.go:54-60`); the panic recoverer
  keeps the stack out of the response. Turnstile's secret key never appears in
  `/api/v1/instance`, which returns only the site key.
- **IDOR sweep**. Every handler taking an id was traced to its ownership or
  membership check: messages, reactions, pins, attachments, uploads, sessions,
  invites (server and group), bans, roles, member roles, overwrites, emoji,
  sticker packs and stickers, guest links and guests, channels, subchats and
  servers. Bulk operations validate the whole set before acting
  (`handleMessageBulkDelete`), invite uses are spent in the same transaction as
  the join so a one-use link cannot be raced (`store/servers.go:265-285`), and
  bans are written before the removal so a rejoin racing a ban is refused.
  The only gaps I found are the two authorization findings above.
