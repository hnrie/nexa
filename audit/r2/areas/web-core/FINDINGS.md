# Findings — web-core (prefix `WCORE`)

## Summary

State: audit-done, 2026-09-19. Three agents; every file in the brief read, test files skimmed by test name, `Parser.kt` read for parity. 29 findings.

**By priority:** P0 0 · P1 0 · P2 9 · P3 20.
**By kind:** bug 7 · perf 6 · i18n 3 · parity 3 · code 3 · a11y 2 · security 2 · design 2 · test 1.

**Read first**
1. WCORE-023 · P2 security — the grant recipient cross-check (round 1's CRITICAL fix) fails open for every subchat; one condition plus a test.
2. WCORE-024 · P2 perf — a message in any channel re-renders every message on screen (round 1's `performance.md:479`, still present); the `last_message_id` write is the trigger.
3. WCORE-004 · P2 bug — removing an uploading file from the tray does not stop the upload; nothing can cancel a send.
4. WCORE-006 · P2 bug — every upload under 90 MB (most photos and videos) is one POST with no retry and no resume.
5. WCORE-018 · P2 bug — when streaming is unavailable (iOS home-screen app, private windows) a file up to 1 GiB is decrypted in the page: a tab crash on phones.
6. WCORE-015 · P2 bug — the data export walks history with no pacing, so large accounts get error files instead of channels.
7. WCORE-001 · P2 bug — captive-portal HTML on a 2xx still throws a bare `SyntaxError` from `api.request` (round 1 fixed only `upload`).
8. WCORE-002 · P2 a11y — pinch zoom is disabled on every phone (viewport tag plus `noZoom.ts`).
9. WCORE-026 · P2 parity `[android]` — a link sent from Android never gets a preview, on any client.
10. WCORE-013 · P3 bug — a reconnect drops the pending copy of a message in any channel but the focused one; the one unrecoverable draft-loss path found.

**Cross-area** (in this file, prefixed or noted): 004 `[android]` upload abort in the tray · 008 `[voice]` what a lock should do to a call · 009 `[android]` the lock policy is web-only · 016 `[android]` notification preview setting · 017, 019, 021 `[i18n-copy]` words · 020 `[android]` concatenated strings · 023 `[android]` KeyService's recipient check for subchats · 024 `[web-chat-ui]` MessageItem is the consumer · 025 `[android]` the Kotlin parser's side of fourteen divergences · 026 `[android]`.

**Round 1 cross-check.** Done claims that touch this area, verified in code: shared abort signal (`api/client.ts:126-145`), bare network failure → `ApiError` (`:215-221`), 401 sign-out keyed on `err.code === "unauthorized"` so a wrong current password no longer signs out (`:229-231`), key pinning on first sight (`stores/users.ts:27` `judgeKey`, `keyPins.test.ts`), argon2 floor in `deriveMaster` on both platforms (`Kdf.kt`, agent 1), rotation on `key_rotation_needed` (`dispatch.ts:334`), fingerprint vector shared by both suites, dates through the app locale (`lib/time.ts`), message-list anchoring on the store side (`messages.test.ts`). Half-fix: captive portal (WCORE-001). Round-1 items seen still present and re-reported with a fix: `performance.md:479` (WCORE-024), `:555` the voice engine in the entry chunk (WCORE-027, now measured: `main` 806 kB / 250 kB gzip), `:574` double author fetch (WCORE-011). Seen still open and *not* re-reported: `crypto.md` MEDIUM "AAD binds channel and author but not the message" — `crypto/message.ts:53` is still `conv|epoch|channelId|authorId`, so cross-channel replay fails as the brief requires but same-channel replay of an old ciphertext does not; `performance.md`'s web NOTABLE/MINOR items, which REVIEW.md declines as a class. WCORE-009 and WCORE-016 overlap `crypto.md`'s HARDENING passcode-counter and LOW notification-body items, neither of which REVIEW.md lists as done or declined; both here propose the concrete change.

**Bundle, from a scratch build:** loaded before any route: `main` 805.7 kB (249.5 gzip), `react` 161.1 (52.6), `crypto` 43.9 (17.6), `main.css` 183.6 (43.1). Lazy: `compact` (emoji catalogue) 528.5 (81.8), locale catalogues 140-248 kB each, `LicensesPage` 110 kB, Twemoji COLR font 465 kB (unicode-range gated), sprite sheets 4.1 MB webp. Only `react` and `crypto` are manual chunks.

**Not done here:** no Playwright or device runs (Chromium-only Playwright; Safari/iOS claims in 018 are from documented WebKit behaviour); the two perf findings (024, 028) are from reading, not a profile.

---

### WCORE-001 · P2 · bug · `api.request` still throws a bare `SyntaxError` on a 200 with an HTML body; only `api.upload` got the captive-portal fix
- Where: `web/src/api/client.ts:234-235`; the guarded twin is `client.ts:292-296`; test coverage only for upload at `web/src/api/client.test.ts:419-426`
- What: after `res.ok`, `JSON.parse(raw)` runs unguarded. The `!res.ok` branch already tolerates a non-JSON body (`errorFrom` falls back to `http_<status>`), and `upload` catches the parse and rejects with `bad_response`, but the 2xx path of `request` — every JSON call in the app — does not. A captive portal, a CDN interstitial or a proxy answering `200 text/html` rejects with `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which is not an `ApiError`.
- Impact: on hotel/airport Wi-Fi every call that awaits `api.request` fails with the parser's untranslated text; the callers that branch on `instanceof ApiError` fall through to `err.message`, so that string lands in toasts and error rows (thirteen call sites show `err.message`, per the comment at `client.ts:83`). Login and register are the first two things a person tries on such a network.
- Fix: wrap the parse exactly as `upload` does (`new ApiError(res.status, "bad_response", t("attachments.theServerSAnswerCouldNot"))`), and add the missing test next to the upload one. Optionally treat a 2xx whose `Content-Type` is not `application/json` the same way before parsing.
- Effort: S
- Status: open

### WCORE-002 · P2 · a11y · Pinch-zoom is disabled on every phone: `user-scalable=no`/`maximum-scale=1` in the viewport tag and WebKit gesture events cancelled
- Where: `web/index.html:5`; `web/src/lib/noZoom.ts:14-22` (installed unconditionally from `web/src/main.tsx:46`)
- What: the viewport meta forbids zoom where browsers honour it (Chrome and Firefox on Android), and for iOS Safari — which ignores the meta for pinch — `installNoZoom` cancels `gesturestart/gesturechange/gestureend` so the pinch is blocked there too. The stated reason (`noZoom.ts:3-9`) is to stop iOS zooming into a focused text field, which is achieved by keeping inputs at 16 px or larger; double-tap zoom is already removed by `touch-action` without blocking pinch.
- Impact: WCAG 2.1 SC 1.4.4 (AA) fails on phones — a low-vision reader cannot enlarge message text, a small avatar, an emoji, or the safety-number digits and QR code in the key-verification sheet. axe's `meta-viewport` rule flags exactly this tag, so round 1's "zero axe violations" was measured on a viewport where it does not apply. (OS-level magnification still works, which is why this is P2 rather than P1.)
- Fix: drop `maximum-scale=1, user-scalable=no` (keep `viewport-fit=cover`), keep `touch-action: manipulation` on the page, and make sure no input on the phone layout is under 16 px (`web-chat-ui`/`web-shell-ui` to confirm); delete `noZoom.ts` and its test. Verify on the iOS Simulator that focusing the composer no longer zooms.
- Effort: S
- Status: open

### WCORE-003 · P3 · code · `@tanstack/react-virtual` is still a dependency nothing imports
- Where: `web/package.json:20`; `grep -rn react-virtual web/src` matches only `web/src/data/licenses.json:95`
- What: round 1 noted the message list is not virtualised although the library is installed; it is still installed and still unused. Vite tree-shakes it out of the bundle, so the cost is install time and a licences page that credits a library the app does not ship.
- Impact: none for users beyond an inaccurate credits list; a maintenance trap (someone will assume the list is virtualised).
- Fix: remove the dependency and regenerate `licenses.json`, or actually adopt it (that is `web-chat-ui`'s decision for `MessageList`).
- Effort: S
- Status: open

### WCORE-004 · P2 · bug · Removing a file from the tray while it uploads does not stop the upload, and nothing can cancel a send
- Where: `web/src/components/composer/Composer.tsx:503` (Remove only adds the id to `removedFiles`), `:365-371` (a removed file is skipped only if it has not started, and filtered out only after it has finished), `web/src/lib/attachments.ts:82` (`PieceSender` takes no signal), `:107-178` (the page never tells its worker to stop), `web/src/lib/upload.worker.ts:38-60` (no abort message exists).
- What: the trash button on an uploading card deletes the card and remembers the id, but the transfer already in flight runs to the end: `uploadInPieces` keeps sending every remaining piece, then `finish`es the session (a blob nobody will reference), and only then does the composer leave it out of the message. Files after it in the tray wait behind it (`await uploadStaged` in a `for` loop), the text of the message waits too, and the reload hold (`holdReload`, `attachments.ts:195`) stays. There is no other way out: Send is disabled while `sending`, Escape does nothing.
- Impact: on a phone, a 1 GB video picked by mistake keeps uploading for minutes after the person "removed" it — data, battery, and the message they actually wanted to send sits until it is done. The server ends up with an orphan blob.
- Fix: give `PieceJob` an `AbortSignal`; the worker accepts an `{ type: "abort" }` message and calls `xhr.abort()`; `uploadInPieces` checks the signal between pieces and calls `uploadsApi.cancel`; the composer holds one `AbortController` per staged file and aborts on Remove, and shows a cancel affordance while `sending`. Android's tray should get the same check (`android/.../media/Uploads.kt` — `[android]`).
- Effort: M
- Status: open

### WCORE-005 · P3 · code · `api.upload` never settles when handed a signal that is already aborted
- Where: `web/src/api/client.ts:310-315`; tests at `web/src/api/client.test.ts:428-457` cover abort-after-start and abort-after-settle, not abort-before-start.
- What: when `signal.aborted` is already true, `xhr.abort()` runs before `xhr.send()` and the function returns. The XHR spec's `abort()` runs the request-error steps — the only thing that fires `abort` — solely when the state is OPENED *with the send() flag set*; before `send()` there is no event, so `onabort` never fires and the promise neither resolves nor rejects. Unreachable today: the only callers that build the options (`attachments.ts:91,119`, `channels.ts:74-82`) never pass a signal — so it is a trap for the fix to WCORE-004, which will.
- Impact: none yet; an upload that would hang for the life of the page once a signal is threaded through.
- Fix: `if (signal.aborted) { reject(new ApiError(0, "aborted", …)); return; }` plus a test.
- Effort: S
- Status: open

### WCORE-006 · P2 · bug · A file under the single-request limit that fails mid-upload starts again from zero; only the chunked path can resume
- Where: `web/src/lib/attachments.ts:197-199` (one `send`, no retry, no `landedSoFar`) against `:288-337` (pieces: four tries, a five-minute wait for the connection, resume from the server's `received`); the worker's 60 s stall (`web/src/lib/upload.worker.ts:36,44`) aborts into `failed`, which `Composer.tsx:404-407` shows as an error and a toast. Android is the same shape: `android/app/src/main/java/xyz/evilion/chat/media/Uploads.kt:109-112`.
- What: the resumable session exists only for a ciphertext over `limits.single` (90 MB by default, `attachments.ts:18`). Everything under it is one POST with zero retries: a phone moving from Wi-Fi to cellular, a 60 s stall, a Cloudflare 52x, and the whole transfer is thrown away; pressing Send again encrypts and sends it from byte 0 (with a new key and IV).
- Impact: most videos and every photo burst are under 90 MB, so the everyday upload is the unprotected one. A 70 MB clip on a train that dies at 95 % is 70 MB to send again, learned from a toast after the fact. Round 1 made the big-file path resilient; the blips happen on the small one.
- Fix: route anything over a few MB (say 8 MB — the cost is one `POST /uploads` more) through the session path on both platforms, and retry the small single POST once or twice on `network`/5xx (a duplicate can only leave an orphan blob for the server's sweep). Effort is the two `if (total <= limits.single)` lines plus tests.
- Effort: S
- Status: open

### WCORE-007 · P3 · perf · `ingestGrants` unwraps grants one at a time and opens one IndexedDB write per grant, while ready and every later event wait
- Where: `web/src/stores/keys.ts:173-183`; `web/src/crypto/keystore.ts:150-157` (one readwrite transaction per `saveRoot`, awaited to commit); awaited by the ready handler at `web/src/gateway/dispatch.ts:164`; the server sends every grant the account holds (`internal/gateway/conn.go:754`, `GrantsForUser`).
- What: each grant not yet in the ring costs an X25519 unwrap and a committed transaction, sequentially. Grants already in the ring are skipped (`keys.ts:174`), so a reconnect is cheap; the full cost is paid on the first login on a device and — because `stopSession` empties the ring (`session.ts:118`) — after every passcode unlock (with a passcode the IndexedDB half is skipped, the unwraps are not). The ready handler is still awaiting, so `onReady` hooks and `syncGap` wait, and every gateway event received meanwhile queues behind it (`session.ts:56`).
- Impact: an account with 1,000 grants (years of DMs and rotations) waits a second or two of unwraps plus a few seconds of sequential commits on a phone before anything is "ready", once per login or unlock. Invisible on small accounts.
- Fix: unwrap in `Promise.all` batches of 32 and add `keystore.saveRoots(userId, roots[])` that writes them in one transaction.
- Effort: S
- Status: open

### WCORE-008 · P3 · security · Locking drops the keys only through `RequireAuth`'s effect: on the invite page the keyring, decrypted messages and socket stay alive behind the passcode screen; a call is never hung up by a lock
- Where: `web/src/stores/auth.ts:256-260` (`lockApp` only nulls `identity` and `settingsKey`); `web/src/components/shell/RequireAuth.tsx:21-26` (the effect that actually calls `stopSession()`); `web/src/pages/InvitePage.tsx:73-75,132` (starts the session and shows `PasscodePage` on `pinlocked`, never calls `stopSession`); `web/src/gateway/session.ts:109-124` (`stopSession` drops ring, messages, search index, media cache, settings — but not the call; `endSession` at `:131-141` does `leaveVoice`).
- What: the lock's contract (`appLock.ts:1-10`) is that locking "only has to forget what is held in memory". That forgetting lives in a React effect on one route guard. `AppLockEffect` is mounted app-wide (`App.tsx:22`), so idle and blur locks fire on `/invite/<code>` too: there the passcode page appears while the keyring, the plaintext search index and the settings key stay in memory and the gateway keeps decrypting new messages into the store. After unlocking, `startSession` re-runs `useKeys.init` over the live ring (`openPins` is idempotent, `keyPins.ts:124`, so no damage). On every page, a call survives the lock: `stopSession` closes the socket but never calls `leaveVoice`, so the microphone stays open behind a screen whose only control is the passcode, until the server's grace for a socket-less call runs out — `[voice]` to decide what a lock should do to a call and whether the hang-up button belongs on the passcode page.
- Impact: low in practice (reading the memory needs DevTools), but it is the one path where the lock does not do what its comment says, and it is fragile: any future page outside `RequireAuth` inherits the gap.
- Fix: do the teardown in `lockApp` itself (`stopSession()` after the `set`), or subscribe to `useAuth` once in `session.ts`, so no route guard has to remember.
- Effort: S
- Status: open

### WCORE-009 · P3 · design · The passcode's ten-try limit lives in the same `localStorage` record as the wrapped key, so a copied record can be brute-forced offline; four digits is the minimum, and the record says they are digits
- Where: `web/src/lib/appLock.ts:22-24` (`LOCK_KDF` 64 MiB × 6, `MAX_FAILURES = 10`, `MIN_PASSCODE = 4`), `:81-83,110-112` (the record under `ec.lock.<uid>` holds `salt`, `params`, `wrapped`, `failures`, `numeric`), `:244-248` (the counter is the only thing enforcing the limit); copy at `settings.security.passcodeIsOnForThisAccount`.
- What: anyone who can copy the profile's storage (a household member with the unlocked laptop and DevTools, a backup of the profile) has the wrapped identity, the salt, the KDF parameters and `numeric: true` telling them the alphabet is ten digits. Offline, 10⁴ candidates at roughly 0.3–0.5 s each (Argon2id 64 MiB × 6 on one laptop core) is under an hour on one core, minutes on eight; the try counter is theirs to reset. The header comment says ten wrong tries "throw the wrapped copy away" — true in-app, irrelevant to a copy. Android has no app lock at all (no `appLock` in the Kotlin sources), so the account-wide policy `applyLockPolicy` pushes to each device is web-only while the settings page says it is "on for this account".
- Impact: the lock is a screen lock and that is a fine thing to be; but the comment, the copy and a 4-digit minimum promise more than an Argon2 wrap of four digits can deliver against the realistic attacker, who is exactly the person the lock is meant for.
- Fix: (a) six digits minimum for numeric passcodes (what phones settled on) — one constant plus copy; (b) say in the security settings what the passcode protects against (someone picking up the open device) and that the account password is the real key; (c) `[android]` decide whether the policy should be honoured there (the native equivalent is `BiometricPrompt` with device credential), and until then the web copy should say "on your web and desktop sessions".
- Effort: S
- Status: open

### WCORE-010 · P3 · bug · Signing out leaves the next account on this browser with the previous one's tab layout, last-visited channels, per-person volumes and a few live counters
- Where: `web/src/stores/panes.ts:72,177,313` (`ec:panes` is one key for every account, restored at module load); `web/src/stores/serverNav.ts:9` (`lastChannel:<serverId>`); `web/src/stores/voice.ts:172,179` (`voiceVolumes`, `voiceStreamVolumes`, keyed by user id); `web/src/components/chat/ChatView.tsx:73` and `web/src/components/voice/VoiceView.tsx:808` (panel widths); `web/src/gateway/session.ts:131-141` (`endSession` resets `useUI` only); stores with no logout path: `usePanes`, `useSelection` (`selection.ts`), `useSlowmode` (`slowmode.ts`, no `clear` at all), `readStates.ts:36,69-87,123` (`unsent` acks survive `clear()`), `mediaCache.ts:178-182` (`clearMediaCache` neither aborts nor forgets `inflight`, so a download finishing after logout caches the old account's plaintext blob).
- What: the auth store's `logout` clears the token, the lock and the keystore, and `endSession` resets the account stores, but everything under `storage` is one namespace. Person B logging in after person A on the same browser starts with A's tab bar (tab count, splits, and pane channel ids that B may not be able to see — `PaneView` then shows "That conversation is no longer here" per pane), A's last-opened channel in any server both are in, and A's per-person volume choices. `readStates.unsent` is the one that crosses accounts as a write: an ack that failed for A (5xx/offline) is re-sent under B's token by `setMany` on B's first ready if B can see the channel, moving B's read marker.
- Impact: shared and family computers, and the owner's own "log out, log in as the test account" workflow. Nothing readable leaks (channel ids only), but the first thing B sees is A's layout, and the stale ack is a wrong read marker B never asked for.
- Fix: namespace the per-account keys by user id (`ec:panes:<uid>`, `lastChannel:<uid>:<server>`, volumes likewise) and load them in `startSession` rather than at module load; give `usePanes`, `useSelection`, `useSlowmode` a `reset` and call it from `endSession`; clear `unsent` in `readStates.clear()`; have `clearMediaCache` abort `inflight` jobs.
- Effort: M
- Status: open

### WCORE-011 · P3 · perf · The first message from someone this device has not seen fetches their profile twice
- Where: `web/src/gateway/dispatch.ts:177` (`messages.insert`) → `web/src/stores/messages.ts:13-29` (`resolveAuthors` → `usersApi.get`, guarded by `authorFetches`); then `dispatch.ts:181` (`ensureUser` → `usersApi.get`, guarded by `userFetches`, `dispatch.ts:107-121`).
- What: the two guards do not know about each other. `insert` starts the first request synchronously; `ensureUser` runs next, finds the user still absent from `useUsers` and its own set empty, and starts the second. Every page load (`loadInitial`, `loadOlder`) plus a live message from the same unknown author does the same dance.
- Impact: two `GET /users/:id` per unknown author per burst; on a large server where members arrive lazily that is most authors after a cold start. Small, but it is the request path the rate limiter counts.
- Fix: one shared fetch guard (`ensureUser` exported from a small module both import), or drop `resolveAuthors` from `insert` and let dispatch own it.
- Effort: S
- Status: open

### WCORE-012 · P3 · code · A gateway handler that throws is swallowed without a trace
- Where: `web/src/gateway/session.ts:56` (`.catch(() => undefined)` on the event queue); `web/src/gateway/dispatch.ts:134-377`.
- What: the queue keeps going after a failed handler, which is right, but the error goes nowhere — not `console.warn`, not `crashReport`. A `message_create` whose handler throws (a malformed payload, a store bug) is simply a message that never appears, with nothing in the console to explain it.
- Impact: none for users directly; it is the reason a silent-drop bug in this area would be undiagnosable from a user report.
- Fix: `.catch((err) => console.warn("gateway: event handler failed", e.t, err))` and, for non-network errors, `reportCrash`.
- Effort: S
- Status: open

### WCORE-013 · P3 · bug · A reconnect throws away every channel but the focused one: a split pane loses its place, and an unsent message in a channel just left loses its retry copy
- Where: `web/src/gateway/dispatch.ts:144-145` (`resetAll(active)`), `web/src/stores/messages.ts:285-292` (`clearAll(keep)` keeps one channel; every other channel's `ids`, `byId` *and* `pending` go); `web/src/components/shell/PaneView.tsx` and `web/src/components/chat/MessageList.tsx:434-446` (a cleared channel reloads from its newest page); `web/src/components/composer/send.ts:78-79` (`failPending` on a channel that is gone creates an empty record with no failed copy).
- What: only the address-bar channel is spared and gap-filled by `syncGap`. A second pane of a split reloads from the newest page and loses the reader's scroll position on every reconnect. Worse for messages: send, switch channel, and if the socket drops before the reply comes back — a phone changing networks does exactly this — the pending copy is dropped; if the send then fails, the toast says so but there is nothing left to retry from, and the text is gone.
- Impact: phones reconnect on every network change (8 s ack timeout, `gateway/client.ts:31`); the lost-draft case is rare but unrecoverable when it hits. Split panes are a desktop power feature and lose their place every time.
- Fix: keep `pending` across `clearAll` (it belongs to the sender, not to the loaded page); spare every channel a pane is showing (`usePanes` knows them) and `syncGap` each, not just the focused one.
- Effort: S
- Status: open

### WCORE-014 · P3 · perf · Every live message of every channel is kept in memory for the session, whether or not the channel was ever opened
- Where: `web/src/gateway/dispatch.ts:171-177` (`insert` for any channel), `web/src/stores/messages.ts:175-179,138-142` (`arrived` on an `emptyChannel()` keeps the message); nothing evicts until the next `ready` (`clearAll`) or `channel_delete`.
- What: a message for a channel that is not loaded is decrypted, its author resolved (WCORE-011), and stored in `channels[id].byId`. On a busy server with twenty channels the store accumulates every message posted anywhere for as long as the socket stays up, which on the desktop app is days.
- Impact: slow growth (a few MB a day on a lively instance) plus a decrypt and a `resolveAuthors` pass per message; not felt on small instances.
- Fix: for a channel with `loaded === false` and no pane showing it, keep only what the unread logic needs (`last_message_id`, already done by `setLastMessage`) and drop the body; `loadInitial` fetches the page anyway.
- Effort: S
- Status: open

### WCORE-015 · P2 · bug · The data export walks history with no pacing and no retry, so a large account's export comes back with error files where its channels should be
- Where: `web/src/lib/export.ts:126-159` (`allMessages`: a page every round trip, one `catch` at `:179-184` that writes `messages/errors/<id>.txt` and moves on); compare `web/src/lib/fullSearch.ts:37,487-521` (200 ms gap, 429/5xx backoff, Retry-After honoured — built for exactly this walk).
- What: the history endpoint sits behind the per-user limiter (600/min, burst 300, per the comment in `fullSearch.ts:30`). An account with more than ~300 pages of history — 30,000 messages — trips it part-way; from then on every page is a 429, every remaining channel is an "error", and the zip is quietly missing most of what the person asked for. The README inside the zip does not mention the `errors/` folder, and the progress text never says a channel failed.
- Impact: the one feature that promises "everything" delivers a fraction for exactly the accounts that most want it; a person leaving the instance discovers the hole later, when they no longer have access.
- Fix: reuse `fetchPage` from `fullSearch.ts` (or lift its pacing/backoff into a shared helper) in `allMessages`; count and show failed channels in the final progress and the README; fail the export, not the channel, on anything but a 403/404.
- Effort: S
- Status: open

### WCORE-016 · P3 · design · Notification bodies show the decrypted message text with no way to hide it
- Where: `web/src/lib/notify.ts:96-107,132` (`previewOf` puts up to 140 characters of plaintext in the body, and the author's name and avatar in the title/icon); settings at `web/src/stores/settings.ts:78` have no "hide content" flag.
- What: the notification is the one place E2EE text is rendered outside the app — on a locked phone's lock screen, on a desktop's notification centre, and in the OS's notification history. Signal, WhatsApp and Discord each offer "name only" / "nothing" levels for this reason.
- Impact: anyone who can glance at the lock screen reads the last message; people who care are exactly the ones an E2EE chat is for.
- Fix: a `notifications.preview: "full" | "name" | "none"` setting (default `full` to keep current behaviour), honoured in `onMessage` and `onFriendRequest`; the same field on Android (`[android]`) since settings are shared.
- Effort: S
- Status: open

### WCORE-017 · P3 · i18n · `[i18n-copy]` The export's progress lines and the README inside the zip are hard-coded English
- Where: `web/src/lib/export.ts:164,168,178,180,186`.
- What: "Profile…", "Friends…", "(n messages)" and the README text bypass `t()`, while the surrounding page is translated.
- Impact: a person using the app in another language gets English in the progress panel and in the file they keep.
- Fix: keys under `export.*`; the README could stay English with a translated line on top, since it travels with the data.
- Effort: S
- Status: open

### WCORE-018 · P2 · bug · When the streaming download is unavailable, a file up to 1 GB is decrypted in the page — on a phone that is a tab crash, not a download
- Where: `web/src/lib/download.ts:22,204-210` (`IN_PAGE_MAX = 1 GiB`; the fallback runs whenever `streamThroughWorker` answers "unavailable"), `:168-201` (`saveInPage`: the whole ciphertext as a Blob, then `decryptFile`); `web/src/crypto/file.ts:65-100` (plaintext folded into Blobs, so both copies exist at once); compare `web/src/lib/mediaCache.ts:22` (`INLINE_MAX = 256 MiB`, chosen for the same reason).
- What: "unavailable" is the normal case in more places than the comment suggests: any browser without a service worker (Firefox and Safari private windows, browsers with site data blocked), an iOS home-screen app — where a navigation to a `Content-Disposition: attachment` response has no download manager to land in, so `started` never arrives and the 15 s `START_TIMEOUT` (`:29,123`) falls through — and any worker that has not activated yet. The fallback then holds ciphertext plus plaintext of up to 1 GiB. WebKit keeps both Blobs in memory (Chromium spills large Blobs to disk, which is what the 1 GiB figure was presumably sized for), and iOS terminates a page well before 2 GiB. This is from WebKit's documented Blob storage and iOS memory behaviour, not from a device run; Playwright here is Chromium-only.
- Impact: on an iPhone, tapping Download on a 700 MB video in the home-screen app waits 15 s, then the app reloads with nothing saved and no message. The same on any phone in a private window.
- Fix: size the in-page cap to the device — `navigator.deviceMemory` where present, otherwise 256 MiB on phones (`isMobile`/`isHomeScreenApp`) and 1 GiB on desktop — and say "too large to save on this device; use a computer" above it, before starting the fetch rather than after. Longer term, the same streamed path through `showSaveFilePicker` where it exists.
- Effort: S
- Status: open

### WCORE-019 · P3 · a11y · The captcha sheet is hand-built DOM outside the app's dialog rules: English-only "Cancel"/"Captcha", no focus move, no Escape
- Where: `web/src/lib/captcha.ts:100-116` (`role="dialog"`, `aria-label="Captcha"`, `cancel.textContent = "Cancel"`), `:131` (cancel only by click); `web/src/styles/base.css:44-45` (the overlay is `pointer-events: none` until Turnstile asks for a click, then `captcha-shown`).
- What: when Turnstile needs an interaction the overlay fades in over the login form, but focus stays on the Sign in button underneath it, Escape does nothing, and the only two words the sheet owns are not in the catalogue while the title next to them (`captcha.oneQuickCheck`) is. A keyboard user tabs from the sign-in button into whatever comes after it in the form, not into the sheet; a screen-reader user hears "dialog, Captcha" in English in an app they set to Arabic. Every other sheet in the app (the React modals) traps focus and closes on Escape.
- Impact: sign-up, sign-in, recovery, friend requests and joining a server all pass through this sheet whenever Turnstile is unsure — which is precisely the case for people on VPNs, Tor, or shared IPs, and for automation-like assistive tech.
- Fix: `t("captcha.cancel")` and `t("captcha.dialogLabel")` (`[i18n-copy]` for the words); move focus into the sheet in `before-interactive-callback` and back to the previously focused element in `finish`; a `keydown` listener for Escape that calls the cancel path; `aria-modal="true"`.
- Effort: S
- Status: open

### WCORE-020 · P3 · i18n · Names and activity lines are assembled by concatenation, so word order and list separators are English in every language
- Where: `web/src/lib/activity.ts:28` (`${verb} ${name}`), `:33` (`${activityVerb(a)} ${a.name}`); `web/src/lib/names.ts:15` (`names.join(", ")` for an unnamed group DM); Android's equivalents are in `android/.../ui/` (`[android]` to check the same two).
- What: the verb is translated (`activity.listeningTo`) but the sentence is built in code as verb-then-object. In Japanese, Korean, Turkish or Hindi the object comes first ("Rick Astley を再生中"), and in German the verb splits ("Hört Rick Astley" works, but "Spielt ein Spiel" vs "Spielt Minecraft" needs the article rule the translator cannot express). The comma-space list separator is likewise English; `Intl.ListFormat` exists in every supported browser (Safari 14.1+) and produces "Ann、Bob、Carl" or "Ann, Bob und Carl" from the app locale.
- Impact: every translated UI shows English grammar in the member list's presence line, the profile card heading, and the sidebar name of every unnamed group.
- Fix: templates with a placeholder — `t("activity.listeningToX", { name })` per verb — and `new Intl.ListFormat(locale, { type: "conjunction" }).format(names)` (or `unit` style for the short sidebar form) in `channelDisplayName`; `i18n/core.ts` should expose the current locale for it.
- Effort: S
- Status: open

### WCORE-021 · P3 · i18n · `[i18n-copy]` The "Removed '<pack>'." toast after uninstalling a sticker or emoji pack is hard-coded English
- Where: `web/src/lib/packRemoval.ts:44`.
- What: every other sentence in the file goes through `t()` (the question, the failure toast, the confirm label); the success toast does not, and it uses straight quotes around the name where the catalogue's other strings use typographic ones.
- Impact: the one line a person sees after the action is in the wrong language.
- Fix: `t("packRemoval.removedNamed", { name: pack.name })`.
- Effort: S
- Status: open

### WCORE-022 · P3 · parity · `perms.base()` does not strip a timed-out member the way the server's `perms.Base()` does
- Where: `web/src/lib/perms.ts:149-156` against `internal/perms/perms.go:127-150` (`if m.TimedOut { p &= TimedOutKeep }` in `Base`, with the comment "so a moderator in timeout cannot kick, ban or manage anything until it ends"); the header of `perms.ts:1-2` promises a mirror.
- What: the client applies the timeout only inside `compute()` (`:178`). `base()` is exported, documented as the server-level answer, and returns a timed-out moderator's full role permissions. No component calls `base()` directly today (`stores/servers.ts` goes through `compute`), so nothing on screen is wrong yet; the next person who reaches for `base()` for a server-level check (the settings gear, the kick item) ships a control the server answers with 403.
- Impact: none for users today; a trap in a security-relevant helper that claims parity.
- Fix: add the two lines after the administrator check, and a test in `perms.test.ts` mirroring `perms_test.go`'s timeout case.
- Effort: S
- Status: open

### WCORE-023 · P2 · security · The grant recipient cross-check fails open for every subchat, so the one attack `convMembers.ts` exists to make visible is silent again inside subchats
- Where: `web/src/lib/convMembers.ts:42-54` (`membershipOf`: a channel that is neither `dm`/`group_dm` nor has a `server_id` is `{ known: false }`), `:82` (`checkRecipients` then returns `checked: false`, allowing every id as asked); `web/src/components/composer/send.ts:31-36` (`convForChannel` returns `ch.key_conv_id`); `internal/store/channels.go:228-291` (`CreateSubchat`: "It gets its own key conversation", participants copied into `dm_participants`, `KeyConvID = ch.ID`), `:148` (`IsDMLike` → `Recipients` filled from `Participants`); `web/src/stores/keys.ts:67` (the only caller).
- What: a subchat is its own key conversation, typed `"subchat"`, with no `server_id`, and its `recipient_ids` are the parent's members at creation. `membershipOf(subchatId)` never looks at `type === "subchat"`, so it reports "nothing can be said" and `grantTo` seals the subchat root for whatever `user_ids` the `keys_needed` event or `GET /keys/needs` names — exactly the fabricated-recipient case round 1 rated a top crypto finding (`audit/crypto.md:24,150`) and REVIEW.md:182 marks as done. The data to check is already on the channel object: `ch.recipient_ids` is complete for a subchat just as for a group DM.
- Impact: a compromised or malicious server obtains the keys of any subchat — the feature people use for a side conversation "with the same people", often the more private one — through any online member, with nothing on screen, while the parent DM is protected. The fix is one condition; the risk is that the check's coverage silently excludes a whole channel type and there is no test asserting each type is covered (`convMembers` has no test file).
- Fix: `if (ch.type === "dm" || ch.type === "group_dm" || ch.type === "subchat")` in `membershipOf` (or `isDMLike(ch.type)` mirroring the server's helper); a test per channel type in a new `convMembers.test.ts`; `[android]` check `KeyService.kt`'s equivalent for the same gap.
- Effort: S
- Status: open

### WCORE-024 · P2 · perf · A message arriving in any channel re-renders every message on screen, because the markdown render context subscribes to the whole channel map and `setLastMessage` replaces that map
- Where: `web/src/lib/markdownCtx.ts:12-14` (`useUsers(u => u.byId)`, `useChannels(c => c.byId)`, `useServers(st => st.byId)` — whole maps), `:19-34` (a `useMemo` that walks every role of every server to rebuild `roles`); `web/src/stores/channels.ts:31-37` (`setLastMessage` returns a new `byId` whenever the id is newer); `web/src/gateway/dispatch.ts:178` (called on every `message_create`); consumers `web/src/components/chat/MessageItem.tsx:50,85` (one `useRenderCtx()` per message row and per reply preview — `memo` does not help, the subscription is inside), `web/src/markdown/render.tsx:24-26` (the parse is memoised on `source`, the `RenderNodes` tree is not, so it re-renders on the new `ctx`).
- What: every `message_create` for any channel the account can see — other servers, muted channels, DMs — bumps `channels.byId`, which wakes every mounted `MessageItem` and `ReplyPreview`; each one rebuilds the roles map from scratch (`useMemo` is per component instance, so the walk runs N times) and re-renders its markdown tree. The same happens on every `users.upsert` and every change to `servers.byId`. Read from the code; not measured here (Playwright is available, no device) — but the shape is N visible rows × (roles walk + React render) per event, on the main thread that is also scrolling.
- Impact: on an instance with a few busy servers this is a steady background CPU cost on every open tab and phone, proportional to how many messages are on screen, and it shows as scroll jank and battery use while reading a quiet DM. Small instances will not notice.
- Fix: (1) keep `last_message_id` out of `byId` — a separate `lastMessage: Record<channelId, messageId>` in the channels store, so `byId` only changes when a channel really changes; (2) build the ctx once per list (`MessageList`) and pass it through a React context, or give `RenderCtx` lazy lookups (`userName(id)`, `channelName(id)`, `role(id)`) that read `getState()` without subscribing, plus a narrow subscription to the ids actually mentioned; (3) a test that a `setLastMessage` on another channel does not re-render a mounted `MessageItem`.
- Round 1: `audit/performance.md:479` (SEVERE, "every mounted message row rebuilds a render context over every role of every server") — neither in REVIEW.md's Done nor its Not-doing list; still in the code as described.
- Effort: M
- Status: open

### WCORE-025 · P3 · parity · The web and Android markdown parsers disagree on fourteen inputs, and nothing shared would catch a fifteenth
- Where: `web/src/markdown/parse.ts` against `android/app/src/main/java/xyz/evilion/chat/ui/markdown/Parser.kt` (which says at `:3-7` it "follows parse.ts closely enough that a message reads the same in both clients"); fixtures: 80+ inline in `web/src/markdown/parse.test.ts:45`, nine hand-written cases in `android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt:192-270`, nothing shared (the safety-number vector is shared; these are not).
- What, from reading both (no device run; each is checkable in the two test suites):
  1. Intraword underscores: `snake_case_name` — web keeps it literal (`parse.ts:367`, `_` cannot open after a word character, as Discord); Android italicises `case` (`Parser.kt:297-335` has no such rule). Every identifier, filename and username with underscores reads differently on the phone.
  2. Trailing `)` on a URL: `https://en.wikipedia.org/wiki/Foo_(bar)` — web keeps the balanced bracket (`parse.ts:582-616`); Android strips every trailing `)` (`Parser.kt:240`, `:347`), so the link is broken on Android for the commonest kind of Wikipedia URL.
  3. Emoji the phone does not recognise: keycaps `1️⃣ #️⃣`, `©`/`®` (guard `Parser.kt:260` needs `code > 0x1000`), and the whole U+2300 block — `⏰ ⌚ ⏳ ⏩ ⏸` — plus `◻️◼️` (ranges `Parser.kt:29-36`); web's `\p{Extended_Pictographic}` (`parse.ts:44-45`) takes them all. On Android these draw in the system font, are not Twemoji, and a lone `⏰` is not jumbo.
  4. `:shortcode:` names — web resolves them once the table loads (`parse.ts:335-347`); Android never does, so `:thumbsup:` typed on web shows as text on the phone.
  5. Escapes: web unescapes only ASCII punctuation (`parse.ts:299-306`); Android drops the backslash before any non-alphanumeric including a space or an emoji (`Parser.kt:203`).
  6. Inline code closers: web requires the same run length (`` `a``b` `` is one span, `parse.ts:508-518`); Android takes the first run of at least that length (`Parser.kt:211`).
  7. An opener followed by a space (`* a*`): literal on web (`parse.ts:366`), italic on Android (`Parser.kt:314` only checks the content is not blank).
  8. `foo@everyone`: web requires a non-word character before `@` (`parse.ts:400`); Android does not (`:246`).
  9. Blocks inside quotes: `> # Title` and `> - item` are a heading and a list on Android (`Parser.kt:115,126` call `blocks()`), literal text inside the quote on web (`parse.ts:166-172` uses `parseInline`). Android matches Discord here; web should follow.
  10. `>>>` alone on its line quotes the rest on web (`parse.ts:158`), is plain text on Android (`Parser.kt:107` needs the space).
  11. List indent: web nests only at exactly two spaces and treats four as a top-level item (`parse.ts:195`); Android makes indent 3-4 a depth-1/2 sibling block (`Parser.kt:134,139`).
  12. Blank lines: web keeps them as `br`s inside one paragraph (`parse.ts:215-220`); Android starts a new paragraph (`Parser.kt:147-151`) — spacing differs.
  13. Pathological input: web memoises failed closer searches (`parse.ts:290-292,527-557`); Android rescans to the end from every `*a *a *a…` opener (`Parser.kt:308-334`): 8,000 characters is about 2,700 scans of 8,000 — tens of milliseconds per recomposition on a phone.
  14. `Markdown.links()` (`Parser.kt:345-348`) has no callers and, unlike `extractUrls` (`parse.ts:730-765`), would not skip `<no-embed>` links, code, or spoilers, nor cap at five — worth deleting before someone wires it up (see WCORE-026).
- Impact: the same message renders differently on the two clients the same person uses; 1-3 are the ones people will actually hit (code identifiers, Wikipedia links, common emoji).
- Fix: a shared fixture file (`tools/fixtures/markdown.json`: source, expected node shape, inline flag) read by `parse.test.ts` and a `MarkdownTest.kt`, exactly as the safety-number vector is shared; then fix Android for 1-3, 5-8, 13-14, and web for 9. `[android]` owns the Kotlin side.
- Effort: M
- Status: open

### WCORE-026 · P2 · parity · `[android]` A link sent from the Android app never gets a preview, on any client
- Where: `android/app/src/main/java/xyz/evilion/chat/net/Endpoints.kt:407` (`unfurl` is defined and has no caller in `android/app/src/main`); `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:433` (the only embed Android builds is a GIF's); web readers render only what the sender put in `payload.embeds` (`web/src/components/composer/Composer.tsx:124,361` builds them on send; `MessageItem` has no receive-side unfurl).
- What: previews are sender-generated so the E2EE payload carries them. The web composer unfurls every URL (through the server's `/unfurl`) and attaches the result; the Android composer does not, so a link posted from a phone shows as bare text for everyone, including web readers, while the same link posted from web shows a card on Android.
- Impact: the most-shared thing in a chat looks broken depending on which device the sender used; people learn to "resend from the laptop".
- Fix: on send, `extractUrls`-equivalent over the text (skipping `<…>`, code and spoilers, five max — not `Markdown.links()` as it stands), `unfurl` each with the same timeout the web uses (`PREVIEW_WAIT`), and attach `embeds` in `MessageService`.
- Effort: M
- Status: open

### WCORE-027 · P3 · perf · The entry chunk is 806 kB (250 kB gzip) and carries the voice engine, every store and the gateway to the marketing, login and invite pages — round 1's "still open #3", measured
- Where: scratch build (`npx vite build --outDir $TMPDIR/dist-wcore`, 2026-09-19): `main-*.js` 805.7 kB / 249.5 kB gzip, `react-*.js` 161 kB / 52.6 kB, `crypto-*.js` 44 kB / 17.6 kB, `main-*.css` 184 kB / 43 kB — 363 kB gzip before any route renders; `index.html` preloads all four. `main` statically imports only `react` and `crypto`; everything else is inside it. Voice is reachable statically from the entry through `web/src/gateway/dispatch.ts:11` (`handleVoiceEvent, onReadyVoice` from `@/voice/session`), `web/src/gateway/session.ts:9,15` and `web/src/stores/settings.ts:5`; `web/src/voice/*.ts` is 230 kB of source. `web/vite.config.ts` `manualChunks` splits only `react` and `crypto`. Pages are lazy (`HomePage`, `LoginPage`, `InvitePage` … are separate chunks) but they cannot render before `main`.
- What: a visitor opening `/`, `/invite/<code>` or `/download` waits for the whole application core, including WebRTC, SFU signalling and frame crypto, before the lazy marketing chunk even starts loading. Round 1 (`audit/performance.md:555`) reported it; `audit/REVIEW.md` lists it as still open; this is the number.
- Impact: on a phone on a slow connection the first paint of the landing or invite page is a few seconds later than it needs to be; the person who was sent an invite link is exactly the one with no reason to wait.
- Fix: make `voice/` a dynamic import at its three entry-side seams (`dispatch.ts`: `import("@/voice/session")` inside the `voice_*` cases and when `ready` carries voice states; `session.ts`: the same for `leaveVoice`; `settings.ts`: move `fromStreamQuality` into a small module without the engine), which cuts the engine from `main` for everyone who never joins a call; then, larger, a pre-auth entry (home, login, register, invite, download) that does not import the stores at all. Report the new numbers in the fix.
- Effort: M
- Status: open

### WCORE-028 · P3 · perf · Any visible message containing a colon — every link — loads both emoji shortcode catalogues on cold start
- Where: `web/src/markdown/render.tsx:32-41` (`useShortcodes`: `wants = source.includes(":")` → `ensureShortcodes()`), `web/src/lib/shortcodes.ts:36-55` (imports `iamcal.json` and `emojibase.json`: 46.6 kB + 154 kB, 15 + 30 kB gzip, then builds a Map of every name); the comment at `shortcodes.ts:5-7` says "most of a session never needs it".
- What: the trigger is a bare `:`, which every `https://` link, every `12:30`, every `re: ` satisfies. In practice the first page of almost any channel fetches and parses both catalogues (45 kB gzip, ~200 kB parsed, a Map of ~6,000 entries built on the main thread) during the cold start the comment says it avoids — and then every message on screen with a `:` re-parses when the table lands (`render.tsx:26` keys the parse memo on `codes`).
- Impact: small — one extra download and a main-thread pause of tens of milliseconds at the worst moment (first render), on every device, every session.
- Fix: test for a candidate name instead — `/:[a-z0-9_+-]{2,60}:/.test(source)` is the parser's own pattern and excludes URLs and times; and let the emoji picker's index (which already imports both) hand the table to `shortcodes.ts` instead of importing it twice.
- Effort: S
- Status: open

### WCORE-029 · P3 · test · The modules with the trickiest runtime behaviour in this area have no tests: dispatch ordering, the session lifecycle, streamed downloads, the recipient check, dates, tabs
- Where (no test file exists): `web/src/gateway/session.ts` (start/stop, the double-client race round 1 fixed, the lock/unlock path of WCORE-008), `web/src/gateway/events.ts`, `web/src/lib/download.ts` (the streaming path and its 15 s fallback of WCORE-018), `web/src/lib/upload.worker.ts`, `web/src/lib/convMembers.ts` (WCORE-023 — a per-type test would have caught it), `web/src/lib/time.ts` (every formatter; round 1's locale fix has no regression test), `web/src/stores/panes.ts` (tabs, splits, the persisted layout of WCORE-010), `web/src/stores/channels.ts`, `users.ts`, `relationships.ts`, `presence.ts`, `typing.ts`, `slowmode.ts`, `keyAlerts.ts`, `serverNav.ts`, `web/src/lib/workerTimers.ts`, `keyring.ts`, `storage.ts`, `decrypt.ts`, `unread.ts`, `theme.ts`, `names.ts`, `captcha.ts`, `guestLink.ts`, `sw.ts`, `download-sw.ts`. Thin where a file exists: `web/src/gateway/dispatch.test.ts` has 4 tests and none for event order (`channel_delete` before its `message_create`), an event for an unloaded channel, or a throwing handler (WCORE-012); `web/src/stores/messages.test.ts` covers one of the three races the brief names (send while switching channel; not edit-while-saving or delete-while-loading); `web/src/lib/attachments.test.ts` has no abort case because there is no abort (WCORE-004).
- What: 993 tests pass, and they are concentrated in the crypto, the API client, key pinning and the message store's paging; the code that decides what a reconnecting phone shows, what a lock forgets and what a download does on Safari runs untested.
- Impact: none directly; it is why WCORE-008, 013, 018 and 023 could exist unnoticed, and why the fix phase for them needs tests written first.
- Fix: in the fix phase, each of those findings lands with a test in the file named here; separately, a `dispatch.test.ts` ordering suite (apply a recorded event stream in two orders, assert the same store) is the single most valuable addition.
- Effort: M
- Status: open
