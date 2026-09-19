# Findings — server-api

(Summary is written at the top when the audit is done.)

## Findings

### SAPI-001 · P2 · bug · A recovery that succeeds can still answer 500, after the password has already changed
- Where: `internal/api/auth_handlers.go:406-407`
- What: after `UpdateAuth`, `DeleteUserSessions` and `DisableMFA` have all landed, the handler re-reads the user with `u, _ = s.Store.UserByID(...)` and passes the result to `keyBundle(u)`. A failed read leaves `u` nil and the next line dereferences it; `Recover` turns the panic into a 500. Round 1 listed this (`server-correctness.md`, "nil dereference after a successful recovery") and it is unchanged.
- Impact: the person sees "Something went wrong on the server" and believes recovery failed, but their old password and every session are already gone and MFA is off. If they sent a new recovery key in the same request, the old one no longer works either, so a retry of the same form fails with `invalid_credentials`. Rare (a read failing right after a write), but the failure mode is the worst possible one for this route.
- Fix: build the bundle from what was just written (`upd` plus the unchanged `PublicKey`) instead of re-reading, or treat a failed re-read as a logged warning and still return the token.
- Effort: S
- Status: open

### SAPI-002 · P3 · security · Username enumeration: where it exists, and a decision on whether it matters
- Where: `internal/api/auth_handlers.go:308-310` (`verifyRecovery`: `no_recovery_key`), `:187-199` (`handleKDF`), `internal/api/errors.go:42-43` (`username_taken`), `internal/api/relationship_handlers.go` (friend request answers `user_not_found`)
- What: three routes reveal whether a username exists. Registration must (a person needs to know the name is taken); friend requests must (a username is how you find someone, and Discord behaves the same). The one that need not is `POST /auth/recover/begin`: an unknown name gets `401 invalid_credentials`, an existing account without a recovery key gets `400 no_recovery_key`, so an anonymous caller (20/min per address, behind the captcha on live) can tell those two apart. `handleKDF` only distinguishes accounts whose parameters differ from `{"m":65536,"t":3,"p":1,"v":1}`; both clients send exactly those (`web/src/crypto/kdf.ts:25`, `android/.../crypto/Kdf.kt:21`), so that channel is closed in practice.
- Impact: low. Usernames are public handles in this product; the information is available to any account via the friend-request route anyway. My judgement is that enumeration is acceptable here and the coordinator can decline this; the `no_recovery_key` answer is the only free win, at the cost of a less helpful message.
- Fix: none required. If desired, fold `no_recovery_key` into the generic `invalid_credentials` message ("Username or recovery key is wrong, or this account has no recovery key") and let the client say so.
- Effort: S
- Status: open

### SAPI-003 · P3 · code · `retryAfter` still contains its no-op and a hand-rolled `itoa`
- Where: `internal/api/auth_handlers.go:266-286`
- What: `time.Duration(secs).String()[:0] + itoa(secs)` evaluates a string and slices it to nothing; `itoa` reimplements `strconv.Itoa`. Round 1 listed this (`server-correctness.md`, POLISH) and it is unchanged. `middleware.go:108-112` does the same computation correctly with `strconv.Itoa`.
- Impact: none for users; a reader stops on it.
- Fix: `return strconv.Itoa(secs)`; delete `itoa`; or share the helper with `RateLimit`.
- Effort: S
- Status: open

### SAPI-004 · P3 · security · Limiter keys are still built from unbounded usernames
- Where: `internal/api/auth_handlers.go:225` (`"login:" + req.Username`), `:293` (`"recover:" + username`), `:188-193` (`handleKDF` queries the store with an unbounded username)
- What: the username is lowercased and trimmed but not length-checked before it becomes a map key (or a Redis key when limiters are shared). `ReadJSON` caps the body at 4 KiB, so each distinct wrong username adds up to ~4 KB of limiter state that lives until the 10-minute sweep. Round 1 listed this (`server-security.md`, LOW); unchanged.
- Impact: 20 attempts/min/address × 4 KB × many addresses is real but slow memory growth; on live the captcha makes each attempt cost a solve, which bounds it further.
- Fix: refuse anything `!ValidUsername(...)` before touching the limiter (a valid name is ≤ 32 chars and never matches a real account otherwise), in all three places.
- Effort: S
- Status: open

### SAPI-005 · P3 · security · Anyone can keep a known account locked out of login with five wrong passwords a minute
- Where: `internal/api/auth_handlers.go:225-229`, `internal/api/router.go:130` (`limAuthUsr`: 5/min, burst 5)
- What: the per-username limiter is consumed before the credentials are checked and only reset on success, so five wrong attempts against `alice` from anywhere make her own correct login answer `429` for the rest of the minute; repeating that every minute locks her out indefinitely. Round 1 mentioned this inside the `Limiter.Reset` finding; it is a known trade-off of per-account limits, and the captcha on live makes each of those attempts cost a Turnstile solve.
- Impact: targeted availability only; no credential exposure.
- Fix: key the account limiter on (username, address) so an attacker only exhausts their own bucket, or let a correct password through regardless of the per-username count (the timing floor and per-address limit still bound guessing). Say which in the code comment either way.
- Effort: S
- Status: open

### SAPI-006 · P3 · security · `ClientIP` still falls back to the first `X-Forwarded-For` hop from loopback
- Where: `internal/auth/middleware.go:182-187`
- What: when the peer is loopback and `CF-Connecting-IP` is absent, the first `X-Forwarded-For` entry is trusted. Cloudflare appends to a client-supplied `X-Forwarded-For` rather than replacing it, so that first entry is attacker-controlled for any request that reaches loopback without `CF-Connecting-IP`. Round 1 listed this (LOW, "needs confirmation whether CF-Connecting-IP can ever be missing"); unchanged. The tunnel always sets it, so today this only affects local processes — which are already on the box.
- Impact: none in the current deployment; a config change (a second local proxy, a direct `cloudflared` access rule) would silently hand every client its own rate-limit bucket and its own Turnstile `remoteip`.
- Fix: drop the `X-Forwarded-For` branch; `CF-Connecting-IP` or `RemoteAddr`. The test at `auth_test.go:143-148` would need its XFF case removed.
- Effort: S
- Status: open

### SAPI-007 · P3 · bug · A kick's reason goes into the audit log uncleaned and uncapped, unlike a ban's
- Where: `internal/api/server_handlers.go:1662`, compare `:1725` (`CleanText(req.Reason, maxBanReason)`)
- What: the kick handler reads `?reason=` from the query string and only trims it: no control-character stripping, no UTF-8 check, no length cap (Go's default header limit makes the ceiling about 1 MB). The ban handler cleans and caps the same field at 512 runes, and reads it from the JSON body, so the two routes also disagree on where the reason travels.
- Impact: a moderator can put a megabyte, or invisible bidi controls, into every viewer's audit-log page.
- Fix: `reason, ok := CleanText(reason, maxBanReason)`, 400 when `!ok`; consider accepting it in the body like ban does and keeping the query form for compatibility.
- Effort: S
- Status: open

### SAPI-008 · P3 · bug · Timing out a member who holds Administrator is recorded and shown, but does nothing
- Where: `internal/api/server_handlers.go:1482-1500` (`timeout_until`), `internal/perms/perms.go:144-149` (`Base` returns `All` for Administrator before the timeout is applied), `:156` (`Compute` likewise)
- What: the handler checks Moderate Members and hierarchy, but not whether the target's roles carry Administrator. `perms.Base` short-circuits to `All` for Administrator before `TimedOutKeep` is applied, so the timed-out administrator keeps every permission; the member row, the audit entry and the `member_update` event all say they are timed out. Discord refuses the action ("cannot time out an administrator").
- Impact: a moderator (below the owner but above an admin role in the hierarchy) sees a timeout icon on someone who can still post, kick and ban.
- Fix: in the `timeout_until` branch, compute the target's base permissions and refuse with `cannot_timeout_admin` when they include Administrator (the owner is already refused by `CanActOn`).
- Effort: S
- Status: open

### SAPI-009 · P3 · bug · Transferring a server does not re-sync what the old and new owner can see
- Where: `internal/api/server_handlers.go:537-569` (`handleServerTransfer`)
- What: ownership changes both people's effective permissions (owner → `All`) but the handler only emits `server_update`. Every other permission change (`handleRolePatch`, `handleMemberPatch`, overwrites) snapshots visibility before and calls `syncVisibility` after, which sends `channel_create`/`channel_delete` to whoever gained or lost a private channel. Here the new owner is not told about private channels they now see, and the old owner keeps channels they may no longer read until they reload; `my_permissions` in their server view is stale on both sides.
- Impact: after "Transfer ownership", the new owner does not see the moderators' private channel until a reload; the old owner sees a channel that now answers 403.
- Fix: `before := snapshotVisibility(...)` before `UpdateServer`, `syncVisibility(..., before, nil)` after, and emit `member_update` for both members so clients recompute permissions.
- Effort: S
- Status: open

### SAPI-010 · P3 · code · Role creation swallows the cap's read error and silently clamps a bad colour that PATCH rejects
- Where: `internal/api/server_handlers.go:1150-1157` (create), `:1237-1244` (patch)
- What: `roles, _ := s.Store.Roles(...)` makes a failed read look like zero roles, which passes the 250-role cap — the same pattern `handleServerChannelCreate` fixed at `:645-655`. Two lines above, a colour outside 0–0xFFFFFF is quietly replaced with 0 on create, while the same value on PATCH is a 400 `invalid_color`.
- Impact: a client sending a colour with an alpha channel gets a grey role on create and an error on edit; the cap can be exceeded during a database hiccup.
- Fix: return the read error; reject the colour on create as PATCH does.
- Effort: S
- Status: open

### SAPI-011 · P3 · ux · A disabled account is told its password is wrong
- Where: `internal/api/auth_handlers.go:231` (login), `:299` (recovery), `internal/api/mfa_handlers.go:392` (MFA step)
- What: an account an admin has disabled fails every sign-in path with `invalid_credentials` ("Username or password is wrong") — including after a correct password. The person then tries recovery, which says the recovery key is wrong.
- Impact: someone who was disabled concludes they forgot their password or were hacked, and there is no route by which they could learn otherwise. Discord answers "This account has been disabled" once the password is right, which reveals nothing to someone who does not have it.
- Fix: after `VerifyAuthKey` succeeds, answer `403 account_disabled` for `FlagDisabled`; keep the generic answer for a wrong password and for deleted accounts.
- Effort: S
- Status: open

### SAPI-012 · P3 · security · No cap on servers per account, members per server, or people in a group
- Where: `internal/api/server_handlers.go:231-274` (create), `:1953-2019` (join), `internal/api/channel_handlers.go:11-16` (comment: "a group grows without limit"), `:298-339` (`handleRecipientAdd`), `internal/api/group_handlers.go:234-287` (invite join); the store has caps only for subchats (`ErrTooMany`) and per-message objects (`ErrLimit`)
- What: one account may create servers at the generic 600/min (each with default channels and roles), join any number, and grow a group DM without bound by adding friends or sharing a link. Server creation and joins are behind the captcha on live, which is the only thing metering them; `handleRecipientAdd` is not.
- Impact: bounded disk and fan-out growth from one account; every message and every key grant in a group is fanned out to each recipient, so a thousand-person "group DM" is the expensive shape. Discord caps groups at 10 and servers per account at 100–200.
- Fix: caps in the store, mapped through the existing `ErrTooMany`: ~100 servers per account, ~25 recipients per group (`maxGroupCreate` is already 50 for the one-shot form), and a configurable members-per-server ceiling.
- Effort: M
- Status: open

### SAPI-013 · P3 · bug · A locked subchat can be deleted without its password
- Where: `internal/api/server_handlers.go:840-847` → `internal/api/subchat_handlers.go:226-238`; compare `internal/api/access.go:52-55` (every other route refuses a locked subchat until this session typed the password)
- What: `DELETE /channels/{id}` for a subchat checks recipiency and `canManageSubchat`, never `s.unlocked`. Rename and re-lock go through `s.channel`, which does. Round 1 listed this (LOW); unchanged.
- Impact: the lock exists to keep a subchat shut on a shared or borrowed device; whoever is at that device cannot read it but can destroy it and its history in one click.
- Fix: `if !s.unlocked(r, ch) { locked 403 }` at the top of `handleSubchatDelete`.
- Effort: S
- Status: open

### SAPI-014 · P3 · security · In invite-only registration, an invite is checked but never spent, so a one-use link registers any number of accounts
- Where: `internal/api/auth_handlers.go:118-125`, `internal/api/server_glue.go:140-143` (`InviteCheck` is `InviteByCode` succeeding)
- What: with `REGISTRATION=invite`, a request carrying any live server or group invite code may register. The check only asks whether the code is currently valid; it does not spend a use, and registration does not join the server. A `max_uses: 1` invite therefore admits unlimited registrations until somebody joins with it, and a 30-day invite admits them for 30 days.
- Impact: "invite" registration means "anyone who has ever seen a live invite link", which is weaker than the word suggests; the registration key path is unaffected.
- Fix: decide what an invite means for registration. Either spend a use at registration (and auto-join the server, so the use is not wasted), or document that invite-mode registration is gated on possession of any live link.
- Effort: M
- Status: open
