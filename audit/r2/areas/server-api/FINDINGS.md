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

### SAPI-015 · P1 · security · One account can fill the disk: free space is checked when an upload is reserved, never when its bytes land
- Where: `internal/api/upload_handlers.go:73-76` (create: `free < req.Size+diskHeadroom`), `:104-180` (`handleUploadChunk`: no free-space check before `AppendSpool`), `:77-81` (`limUpload`: 60 reservations/min per account), `internal/api/disk.go`, `cmd/chatd/main.go:183` (stale uploads swept only 24 h after their last write)
- What: the create route compares the *current* free space with one file's size, but reserves nothing; the chunk route then appends to the spool without looking. Sixty reservations a minute, each up to `MAX_UPLOAD_BYTES` (100 MB on live), all pass while the disk is still empty; pushing their bytes afterwards fills the disk to zero, not to the 2 GiB headroom the create check promises. Touching each transfer once a day keeps it out of the sweep. `uploadIdleLife` at `:27` is declared and never used; `main.go` hard-codes its own 24 h.
- Impact: `data/chat.db` is on the same filesystem, so once the disk is full every write — sending a message, logging in, the gateway's read-state updates — answers 500 until someone frees space by hand. One signed-in account is enough; on live the captcha only meters how many accounts can be made.
- Fix: in `handleUploadChunk`, after staging the piece, refuse with `no_space` when `freeSpace(dir) - pieceLen < diskHeadroom` (one `statfs` per piece); count outstanding reservations in the create check (`SUM(size - received)` over open uploads, or a per-account cap of a few open transfers); delete the dead constant or use it.
- Effort: S
- Status: open

### SAPI-016 · P2 · security · Whoever holds a session gets 600 password guesses a minute on the routes that verify the password
- Where: `internal/api/user_handlers.go:212-225` (`handleMeDelete`: `VerifyAuthKey`, generic limiter only), `internal/api/auth_handlers.go:426,460` (`handlePasswordChange`, `handleRecoveryReplace`: `s.authed`, no `limAuthUsr`), `internal/api/mfa_handlers.go:221,300,320` (`requirePassword` before enabling TOTP, disabling MFA and minting backup codes); compare `auth_handlers.go:225` (login: 5/min per username) and `mfa_handlers.go:256` (the TOTP code is limited, the password beside it is not)
- What: `authed` routes share the generic 600/min bucket, and the ones that re-verify the password (`auth_key`) use nothing else. Login costs five wrong guesses a minute; the same guess through `POST /users/@me/delete` or `POST /auth/password` costs one six-hundredth of that. The KDF parameters are public, so a guess is one Argon2 run on the attacker's machine plus one request.
- Impact: an unattended or stolen session (shared computer, a token read from a device backup) turns into a 120×-faster offline-style attack on a weak password, and the password-change route is exactly the one that lets the attacker finish the takeover: new password, sessions revoked, the owner locked out.
- Fix: run the same `limAuthUsr.Allow("pw:"+u.ID)` check the MFA routes use before `VerifyAuthKey` in `handleMeDelete`, `handlePasswordChange`, `handleRecoveryReplace` and `handleMFADisable`; reset on success as login does.
- Effort: S
- Status: open

### SAPI-017 · P2 · bug · Anything up to 64 bytes is accepted as an "emoji" for reactions and custom status, and the web client shows it as text
- Where: `internal/api/message_handlers.go:503-513` (`parseEmoji`: only whitespace and `/` refused), `internal/api/user_handlers.go:128-138` (`status_emoji`: `CleanText(v, 64)` and no space/newline), `web/src/components/chat/Reactions.tsx:76` → `web/src/components/common/Twemoji.tsx:35` (no picture for the string → it is rendered as a text span)
- What: `PUT …/reactions/FREE_NITRO_at_example_dot_com/@me` creates a reaction pill reading exactly that; the emoji-name regex that exists for custom emoji (`expression_handlers.go:22`) is not applied to reactions, and a custom reaction `name:id` is not checked to be a real emoji id. `status_emoji` accepts "✓Admin", shown beside the display name wherever presence is.
- Impact: a text banner under any message, visible to everyone, that only the reacter (or deleting the message, see SAPI-018) can remove; a status "emoji" that reads as part of the name.
- Fix: accept either one Unicode emoji sequence (every rune in Extended_Pictographic, or a modifier, ZWJ, VS16, keycap or tag; at most ~10 code points) or `^a?:?[A-Za-z0-9_]{2,32}:\d+$` whose id `EmojiByID` finds; apply the same helper to `status_emoji` and to the gateway's presence op (`textutil` is where the gateway shares rules).
- Effort: S
- Status: open

### SAPI-018 · P3 · parity · A moderator cannot remove someone else's reaction or clear a message's reactions
- Where: `internal/api/message_handlers.go:36-38` (only the `/@me` routes exist)
- What: Discord has `DELETE …/reactions/{emoji}/{user_id}` and `DELETE …/reactions` behind Manage Messages; here the only way to get rid of an offensive reaction (or the text pill of SAPI-017) is to delete the message.
- Impact: moderation gap that a normal community hits.
- Fix: add both routes behind `canDeleteOthers`, emitting `reaction_remove` (and a `reaction_remove_all` the clients already have a store action for, or a `message_update`).
- Effort: S
- Status: open

### SAPI-019 · P2 · perf · A re-signed proxy link is a new URL every time, so nothing older than a day is ever served from a cache
- Where: `internal/api/proxy_handlers.go:157-170` (`ProxyURL`: expiry is `now + 24 h` to the second and is signed), `:27` (`proxyCacheCtl`: 7 days, immutable), `:125-152` (`handleMediaRefresh`), `web/src/lib/mediaLinks.ts:118`, `android/app/src/main/java/xyz/evilion/chat/net/Endpoints.kt:308`
- What: a picture in a message older than 24 h is re-signed on every load, and each signing yields a different path, so the browser cache, the service worker and Cloudflare's edge never hit again: the upstream site is fetched through the proxy for every reader on every scroll-back. The "immutable, 7 days" header only ever helps within the first day of a link's life.
- Impact: scrolling back through a picture-heavy channel re-downloads every picture from the internet each time (the instance's outbound bandwidth, the reader's 120/min proxy budget, and slower rendering), and every such fetch is a request to the third-party host the proxy exists to hide readers from — timing-correlated with the reader opening the chat.
- Fix: quantize the deadline so re-signing inside a window gives the same path, e.g. `expires = (now/12h + 3) * 12h` (valid 24–36 h; every refresh in the same 12-h window is byte-identical), and let clients keep refreshed links for the session.
- Effort: S
- Status: open

### SAPI-020 · P3 · security · A member who holds a key can plant a junk grant for another member, and the first grant stored wins for good
- Where: `internal/api/key_handlers.go:108-131` (any holder may write a grant for any entitled member), `internal/store/keys.go:93-112` (`PutGrants`: `ON CONFLICT DO NOTHING`), comment at `key_handlers.go:111-115` (the risk is named for self-grants only)
- What: the server cannot open a grant, so it cannot tell a real wrapped key from garbage. Whoever holds the epoch may write one row per (conv, epoch, user); the first row is final and there is no route by which the recipient can reject it and ask again. Members are told when keys are needed, so a rogue member is in the race by design.
- Impact: the victim (typically the newest member) sees "could not decrypt" for that epoch, permanently; another rotation can be raced the same way. The trust boundary is the membership, which is defensible, but the failure is silent and there is no recovery path even for an honest mistake (a buggy client wrapping to the wrong public key).
- Fix: let a recipient delete their own unusable grant (`DELETE /keys/grants?conv_id&epoch`), which re-raises the need; prefer the epoch creator's grant when several arrive (replace when `wrapped_by` is the creator); a per-wrapper grant limiter.
- Effort: M
- Status: open

### SAPI-021 · P3 · bug · A retried message that was already delivered can answer 429 instead of the duplicate's 200
- Where: `internal/api/message_handlers.go:215-230` (`limMsg.Allow` runs before the nonce lookup)
- What: the per-channel limiter (5 per 5 s) is charged before the nonce is checked, so a client re-sending after a lost response (the case the nonce exists for) can be told "too fast" for a message the server already stored and broadcast.
- Impact: the sender's message shows as failed while everyone else has it; a second retry after the wait then dedupes correctly. Rare, but it is the exact path the nonce was built to make safe.
- Fix: look the nonce up first and return the existing row before touching the limiter (the lookup is one indexed read).
- Effort: S
- Status: open

### SAPI-022 · P3 · design · There is no "who can send me friend requests", so the only defence against unwanted requests is the captcha and blocking one sender at a time
- Where: `internal/api/relationship_handlers.go:73-129`; compare `dm_privacy` (`everyone|friends|nobody`) at `internal/api/user_handlers.go:192-198`
- What: any account may request any username; the target has no setting, and the request is not metered per account beyond the captcha (off in any deployment without Turnstile keys) and the generic 600/min.
- Impact: usernames are public handles (see SAPI-002), so a person can be pestered from throwaway accounts with nothing to set.
- Fix: a `friend_request_privacy` of `everyone|mutual_servers|friends_of_friends|nobody` next to `dm_privacy`, checked in `handleFriendRequest` (mutual servers and mutual friends are already computed for profiles); a small per-account limiter (e.g. 20/hour) on outgoing requests.
- Effort: M
- Status: open

### SAPI-023 · P3 · perf · `about_me` may be 100 000 runes and travels inside every public user object
- Where: `internal/api/user_handlers.go:15` (`maxAboutMe = 100000`), `internal/store/models.go:70-74` (`Public()` includes `AboutMe`), `internal/api/server_handlers.go:1394,1695,2105` (member and reactor lists are built from `Public()`), `internal/gateway/hub.go:618` (`user_update` fans `Public()` out to everyone who shares a server), `internal/api/relationship_handlers.go:47`
- What: the bio is capped at a hundred thousand characters (Discord: 190) and is part of the public user view, so it rides in member lists, friend lists, reactor lists, invite previews and every `user_update` about that person — not only on the profile route where it is shown.
- Impact: one member with a 200 KB bio makes a 500-member list 200 KB heavier for every viewer and every `user_update` about them (each presence-pref or avatar change) a 200 KB event to every online person in their servers. The profile card cannot usefully show more than a few hundred characters anyway.
- Fix: cap `about_me` at ~1 000 runes (announce it in the settings UI), and/or drop it from `Public()` in list contexts and return it only from `GET /users/{id}/profile`.
- Effort: S
- Status: open

### SAPI-024 · P3 · security · GIF search is unmetered per account, so one account can spend the instance's Klipy quota
- Where: `internal/api/expression_handlers.go:791-834` (`handleGifSearch`/`gifProxy`: generic limiter only; `q` unbounded), `:908-924` (each cache miss is one upstream call carrying the API key)
- What: every distinct `q`/`pos` pair that is not in the 2-minute cache is an upstream request; a client can send 600 distinct queries a minute (a random suffix defeats the cache), and the query string is forwarded at any length.
- Impact: the provider throttles or suspends the key and the GIF picker stops for everyone (`gif_unavailable`); costs money on a paid plan.
- Fix: `s.limUnfurl`-style limiter per account (the picker debounces, 30–60/min is plenty), cap `q` at 100 runes, and count misses rather than hits.
- Effort: S
- Status: open

### SAPI-025 · P3 · ux · One member can use up a call's 50 guest links and nobody else can make one until a moderator revokes them all
- Where: `internal/api/guest_handlers.go:154-162` (`maxGuestLinks` is per channel, across creators), `:175-192` (a member sees only their own links), `:196-230` (only `managesGuests` may revoke others')
- What: the cap is on the channel, the visibility and the revoke are per creator. The error says "Revoke some first" to someone who cannot see the links in the way.
- Impact: in a server voice channel a member who made 50 links (or forgot 50 over a week) blocks every other member from inviting a guest, and the message sends them to revoke links they cannot list.
- Fix: cap per creator (e.g. 10) with the channel cap kept as a ceiling; when the channel cap is hit by others' links, say so ("a moderator can clear the call's links").
- Effort: S
- Status: open

### SAPI-026 · P3 · security · No cap on emojis per server, stickers per pack, or packs per account
- Where: `internal/api/expression_handlers.go:77-107` (`handleEmojiCreate`), `:276-321` (`handlePackCreate`), `:530-587` (`handleStickerCreate`); `internal/store/expressions.go` has no count check and never returns `ErrTooMany` (compare subchats and reactions, which do)
- What: anyone with Manage Expressions may add emoji without limit (each a public blob up to `MAX_EMOJI_BYTES`), and any account may create any number of personal packs each holding any number of stickers (up to `MAX_STICKER_BYTES` each), all at the generic 600/min. Discord: 50 emoji and 5 stickers per free server, 30 stickers per pack.
- Impact: unbounded disk from one account (dedup by hash helps only for identical files); a server's emoji picker and `emoji_update` payload (the full list on every change, `:56-62`) grow without bound.
- Fix: caps in the store mapped through `ErrTooMany` → `limit_reached`: ~100 emoji per server, ~50 stickers per pack, ~20 packs per account; announce them in the create errors.
- Effort: S
- Status: open

### SAPI-027 · P2 · bug · Removed from a group by its owner, a member stays in the group's call
- Where: `internal/api/channel_handlers.go:341-399` (`handleRecipientRemove`: no `dropVoice`), compare `internal/api/group_handlers.go:173-176` (`removeFromGroup` drops the call first, "while they are still a recipient to hear it") and `internal/api/server_handlers.go:473,1568` (kick, ban, timeout do too); `internal/api/voice_glue.go:821-836`
- What: `DELETE /channels/{id}/recipients/{uid}` — the route the web client's "Remove from group" uses — takes the person out of the recipient list, revokes invites and asks for a key rotation, but never touches the voice registry. Their `voice.State` stays in the channel: their SFU session and published tracks stay up, everyone else keeps pulling them, and they keep pulling everyone else's until the removed client decides to hang up by itself. `voiceAudience` is built from the new recipient list, so the remaining members are never sent a leave for them either.
- Impact: whoever was just removed from a group call is still in it (a stock client hangs up on `channel_delete`; a modified one need not, and until the key rotation lands the media key is one they hold); the others' rosters show them until they leave; because `Voice.Count` never reaches zero, `call_end` for the group is never emitted after everyone else hangs up, so the group shows a call in progress with a ghost in it. There is no test for the recipients route and voice (`voice_handlers_test.go` covers the server kick only).
- Fix: call `s.dropVoice(ctx, uid, func(c *store.Channel) bool { return c.ID == ch.ID })` before `RemoveParticipant`, as `removeFromGroup` does — or route the handler through `removeFromGroup`, which already carries every other step and differs only in who is told what. Add the test.
- Effort: S
- Status: open

### SAPI-028 · P3 · security · Instance-admin actions leave no record anywhere
- Where: `internal/api/admin_handlers.go:93-175` (`handleAdminUserPatch`: disable, enable, promote, demote), `:181-217` (`handleAdminUserDelete`), `:318-355` (`handleAdminSettingsPatch`), `internal/api/crash_handlers.go:98-104` (clearing the crash log); compare `internal/api/legal_handlers.go:64-66` (the one admin action that is logged) and every server route, which writes `audit_log`
- What: none of these writes a log line or an audit row. Disabling an account, promoting a second admin, changing the registration policy, deleting somebody's account and wiping the crash log all happen silently; the legal report itself says "there is no instance-wide moderation log on this deployment" (`legal_handlers.go:724-727`).
- Impact: with two or more admins nobody can tell who disabled whom or when; an admin account that was compromised leaves no trail; the owner cannot answer "when did registration get closed?".
- Fix: `s.Log.Warn` with actor, target and the change for each of the five, as the legal report does — or an `instance_audit` table shown on the admin page. Consider protecting the first account / `ADMIN_USERNAME` from demotion and disablement by later admins.
- Effort: S
- Status: open

### SAPI-029 · P3 · docs · Two statements in the law-enforcement report are not quite what the code does
- Where: `internal/api/legal_handlers.go:875-878` ("Call records … held in memory … not attributed to any account") and `:867-871` (third parties: "any reverse proxy or network provider in front of this instance"), against `internal/api/voice_glue.go:541` (`customIdentifier: me.ID.String()` sent to Cloudflare when minting a relay credential) and `internal/api/sfu_handlers.go` (every call device opens a session at Cloudflare Realtime); `legal_handlers.go:447-455` (rows "from other accounts, about this one" print the *other* person's private nickname for the subject)
- What: (1) the relay credential is minted with the subject's account id as Cloudflare's `customIdentifier`, and SFU sessions are opened per device at Cloudflare, so a third party does hold call-attributable records keyed to the account id, with its own retention — the report says the operator keeps one monthly byte total and names no third party for calls. (2) A private nickname is the note one person keeps about another (`handleRelationshipNickname`, never shown to the other side, per `admin_handlers_test.go:98-107`); the report discloses everyone else's notes about the subject as if they were the subject's records.
- Impact: a document whose whole value is being complete and true has one omission an officer could later find (Cloudflare records) and one over-disclosure of third persons' data.
- Fix: in DATA NOT COLLECTED → call records, add that relay and SFU sessions are provided by Cloudflare, are opened with the account id as identifier, and that Cloudflare's own logs are not this instance's records; drop the nickname from the incoming rows (or state it is another person's note and omit its text).
- Effort: S
- Status: open

### SAPI-030 · P3 · security · The CSP still lets the page load pictures, media and fetches from any https host, so the proxy's privacy promise is not enforced by the browser
- Where: `internal/api/static.go:22` (`img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' wss: https:`), comment at `:17-21` ("embeds may load https images/media directly"); compare `internal/api/proxy_handlers.go:20-23` and commit d9c7b43 ("link pictures … only ever through the proxy")
- What: every picture the app shows now comes from this origin (avatars, emoji, Twemoji, the media proxy, GIF search results, unfurl cards, guest pages), so the `https:` sources are no longer used by the app — they only remain usable by a bug or an injected node. Likewise `connect-src https:` lets script reach any host, which is what an XSS would use to exfiltrate a session token, and `style-src 'unsafe-inline'` allows injected `<style>` elements when only style *attributes* (role colours) are needed.
- Impact: the "opening a chat never reveals your address to the picture's host" guarantee rests on every client code path remembering to proxy; a regression like the one d9c7b43 fixed would again leak readers' addresses silently, with nothing in the browser to stop it.
- Fix: `img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss://<PublicURL host>` (build the header from `Cfg.PublicURL`), `style-src 'self'; style-src-attr 'unsafe-inline'`, and run the web e2e suite to find anything still loading directly (the YouTube thumbnail in an embed is the likely one — proxy it too). Keep `https://challenges.cloudflare.com` for script/frame. The Cloudflare beacon warning is expected and stays.
- Effort: M
- Status: open

### SAPI-031 · P3 · bug · One client in a crash loop evicts every other crash report before the admin sees it
- Where: `internal/api/crash_handlers.go:44-86` (`handleCrashReport`: generic 600/min per account, no per-account limiter), `internal/store/errors_log.go:26-59` (`KeepClientErrors = 500`, global FIFO trim)
- What: the crash log is capped at 500 rows across all users and trimmed oldest-first; a render loop (the case the code comment at `errors_log.go:28-33` describes) reports 600 times a minute, so within a minute the log holds only that one client's reports and everything anyone else reported is gone.
- Impact: the admin's error page — the only way crashes on other people's devices are seen — shows one person's loop; the reports that would have explained a different bug are lost. Also 600 × ~7 KB/min of write traffic on the single SQLite writer from one client.
- Fix: a per-account limiter on the route (say 10/min, burst 20) and/or keep at most N rows per user (`DELETE … WHERE user_id = ? AND id NOT IN (last 20)`); the client could also collapse repeats of the same message.
- Effort: S
- Status: open

### SAPI-032 · P3 · security · Any admin can disable or demote any other admin, and `ADMIN_USERNAME` only takes effect at registration, so the owner can be locked out of admin for good
- Where: `internal/api/admin_handlers.go:113-116` (only self-demotion/self-disable are refused), `internal/api/auth_handlers.go:166-168` (`ADMIN_USERNAME` and "first account" grant the flag at `CreateUser` only), `internal/config/config.go:122,136`
- What: a second admin — appointed to help, or acting from a compromised session — can `PATCH /admin/users/{owner} {"admin": false}` or `{"disabled": true}`; nothing distinguishes the instance owner. The env setting reads as "this account is the admin", but a restart does not re-grant the flag, and there is no CLI or other path back besides editing `data/chat.db` by hand (which `chatmigrate` does not offer).
- Impact: a lost or hostile co-admin ends with the owner locked out of their own instance's admin page; the fix is a hand-written SQL statement against the live database.
- Fix: refuse demoting or disabling the account named by `ADMIN_USERNAME` (and, when unset, the first account) for anyone but itself; re-apply the flag for `ADMIN_USERNAME` at startup (`main.go`, after `store.Open`) so the env file is the source of truth it looks like.
- Effort: S
- Status: open

### SAPI-033 · P3 · security · No `Strict-Transport-Security` header from the application
- Where: `internal/api/middleware.go:90-100` (`SecurityHeaders`), `internal/api/static.go` (none either); round 1 `audit/server-security.md:426-440` (HARDENING, not triaged in `audit/REVIEW.md`)
- What: the process sets nosniff, referrer policy, frame denial and a permissions policy, but no HSTS. Cloudflare can add it at the edge; whether it does is a dashboard setting nobody in this repository can see, and a copy of this server run anywhere else (the `PUBLIC_URL` default is an https origin) has none.
- Impact: a first visit typed as `http://` can be intercepted before the redirect; without preload the browser never learns to insist on https.
- Fix: when `Cfg.PublicURL` starts with `https://`, set `Strict-Transport-Security: max-age=63072000; includeSubDomains` in `SecurityHeaders` (harmless if the edge sets it too); the operator can then submit the domain for preload.
- Effort: S
- Status: open

### SAPI-034 · P3 · parity · Invites created by a member survive their kick, ban or departure
- Where: `internal/api/server_handlers.go:461-480` (`removeMember`: drops voice, removes the member row, no invite revocation), `:1945-2019` (join through an invite checks the code, its uses and expiry, not whether its inviter is still a member); compare `internal/api/channel_handlers.go:378-381` (a group revokes its invites when someone is removed) and Discord, which deletes a member's invites when they leave or are removed
- What: a banned or kicked member's invite links keep admitting people (unlimited, up to 30 days), and appear in the invite list only to someone with Manage Server who thinks to look.
- Impact: banning the person who posted the server's link everywhere does not close the door they opened; the moderator has to find and delete each code by hand.
- Fix: in `removeMember` (kick, ban, leave, account deletion) delete the invites whose `inviter_id` is the departing member and emit `invite_delete` to Manage Server holders, as `handleInviteDelete` does; optionally refuse joins through an invite whose inviter is no longer a member.
- Effort: S
- Status: open
