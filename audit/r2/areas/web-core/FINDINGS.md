# Findings — web-core (prefix `WCORE`)

(Summary is written at the top when the audit is done.)

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
