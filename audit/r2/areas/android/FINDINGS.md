# Findings — android (prefix DROID)

Appended as found. Format per `audit/r2/README.md`. Line numbers are as of
commit `d7af1d9` (working tree at audit start). Paths under
`android/app/src/main/java/xyz/evilion/chat/` are written from that root.

### DROID-001 · P1 · bug · Signing out leaves the previous account's settings in memory; the next account inherits them and may never save again
- Where: `data/Session.kt:387-396` (`signOutLocally`), `data/SettingsStore.kt:77-86` (`load`), `:66-68`, `:138-180` (`flush`)
- What: `signOutLocally` resets `SecureStore`, `KeyService` and `AppState` but never `SettingsStore`. `_doc`, `version`, `pending` and `sending` survive the sign-out. On the next sign-in, `onReady` calls `SettingsStore.load(blob, version)`, whose guard `if (this.version > 0 && version < this.version) return` refuses the new account's document whenever its version number is lower than the old account's — and the old document stays in force: theme, language, muted list, collapsed categories, `serverPositions` and the plaintext message drafts of the other account. Every later `put` → `flush` sends the stale version → 409 → `reload()` → refused again by the same guard → after three failures it backs off and retries forever; nothing this account changes is ever stored. When the new account's version happens to be higher, the old `pending`/`sending` edits are laid over its document (`load`, lines 83-85) and saved into it: drafts typed in account A land in account B's encrypted settings.
- Impact: anyone who signs out and into a second account on the same phone (a test account, a partner's account) sees the first account's settings and drafts, and may find that settings "never save" — the symptom round 1 fixed for a different cause. A cross-account leak of message drafts.
- Fix: add `SettingsStore.reset()` (empty doc, `version = 0`, `pending`/`sending` cleared, `saveJob` cancelled, `failures = 0`) and call it from `signOutLocally`; additionally key the version guard on the user id so a different account can never be judged "stale".
- Effort: S
- Status: open

### DROID-002 · P2 · ux · The notification permission is requested on every cold start, before sign-in, with nothing to explain it and no way back after a denial
- Where: `MainActivity.kt:78,94-96`
- What: `notificationPermission.launch(POST_NOTIFICATIONS)` runs unconditionally in `onCreate` on Android 13+: over the sign-in form on first launch, and again on every activity recreation (a system locale change). Android shows the system dialog at most twice; after that the launch is a silent no-op. The app's own "notifications" switch (`SettingsStore.deviceBool("notifications", true)`) is independent of the permission, so it reads "on" while the OS blocks every notification, and nothing in settings says so or links to the app's notification settings.
- Impact: a first-time user is asked for a permission before they know what the app is; someone who tapped "Don't allow" twice never receives a message notification again while the app claims they are on. The web client asks when notifications are turned on.
- Fix: ask after sign-in, when the first message could arrive, or when the switch is turned on; if `checkSelfPermission` is denied, show a line under the switch with a button to `Settings.ACTION_APP_NOTIFICATION_SETTINGS`.
- Effort: S
- Status: open

### DROID-003 · P2 · bug · The key store is rewritten in place; a kill mid-write signs the phone out and drops every conversation root it held
- Where: `data/SecureStore.kt:82-92` (`write`), `:58-80` (`read`)
- What: `file.writeBytes(out)` truncates and rewrites `secure.bin` on every `saveRoots` — once per new grant, including ones that arrive in the background through the foreground service, which is exactly when the system is most likely to kill the process. A kill between truncate and completion leaves a short or partial file; on the next launch the GCM tag check fails and `read()` logs "could not read the key store; starting fresh" — token, identity key and every root gone. `cache = next` is also set before the write is attempted, so a failed write looks saved until the next launch.
- Impact: rare but total: the phone is signed out with no explanation, and after signing back in every conversation shows "waiting for the encryption key" until the grants are fetched again. The class of bug reported as "the app randomly logged me out".
- Fix: write through `android.util.AtomicFile` (temp file, fsync, rename), and set the cache only after the write succeeded.
- Effort: S
- Status: open

### DROID-004 · P2 · a11y · Toasts are silent for TalkBack
- Where: `MainActivity.kt:278-310`
- What: the app's only channel for "the message could not be sent", "the upload was refused", "copied" and every other notice is a `Box` + `Text` that appears for four seconds. It carries no `liveRegion` semantics, so a screen reader never announces it, and it cannot be tapped or dismissed.
- Impact: a blind user sends a message that fails and hears nothing; the message sits marked failed in the list with no announcement.
- Fix: `Modifier.semantics { liveRegion = LiveRegionMode.Polite }` on the toast text, or move to `SnackbarHost`, which has the semantics built in.
- Effort: S
- Status: open

### DROID-005 · P3 · perf · The toast queue polls the main thread ten times a second for the app's lifetime
- Where: `MainActivity.kt:281-291`
- What: `while (true) { if (queue.isEmpty()) { delay(100); continue } … }` in the root composition wakes the main dispatcher every 100 ms whether or not there is anything to show.
- Impact: a needless wakeup, forever, on a phone; small but pure waste.
- Fix: collect `Session.toasts` into a buffered `Channel` and show each with `delay(4000)` inside the collector — the queueing the comment wants without the polling.
- Effort: S
- Status: open

### DROID-006 · P3 · code · A request cancelled after the response arrived leaks the response and its connection
- Where: `net/ApiClient.kt:245-247`
- What: `onResponse` calls `cont.resume(response)`. When the coroutine was already cancelled (leaving a channel while its page loads, closing a sheet mid-fetch), the value is discarded and the `Response` — and the pooled connection behind it — is never closed. OkHttp reports it as "A connection to … was leaked" and opens a fresh socket next time.
- Fix: `cont.resume(response) { _, _, _ -> response.close() }` (the `onCancellation` overload), the standard pattern.
- Effort: S
- Status: open

### DROID-007 · P2 · i18n · Network failures are shown as OkHttp's raw exception text
- Where: `net/ApiClient.kt:241`, `:229`, `data/Errors.kt:17-22`
- What: a transport failure becomes `ApiException(0, "network", e.message)` and `readable()` returns `message` verbatim. What reaches the toast, the auth screen's error line and "Could not load messages (…)" is `failed to connect to chat.evilion.xyz/104.21.x.x (port 443) from /10.0.0.4 (port 44712) after 15000ms` or `Unable to resolve host "chat.evilion.xyz": No address associated with hostname` — in English, in all eleven languages. An unparseable server error is `Request failed with status 502.`, also inline English.
- Impact: every offline error on the phone is a stack-trace fragment. The web client shows a translated "Could not reach the server".
- Fix: in `readable()` map `code == "network"` (and `status == 0`) to `t("offline.couldNotReachTheServer")` and `http_5xx` to a generic translated line; keep the raw text in the logcat line that `readable()` already writes.
- Effort: S
- Status: open

### DROID-008 · P3 · perf · Every first-seen user rewrites the whole pin file
- Where: `data/KeyPins.kt:144-169` (`pin`), `data/AppState.kt:118` (`putUsers` → `judgeKey` per user)
- What: `putUsers` judges each user in turn; every `FIRST` verdict calls `pin`, which re-encodes the entire pin map to JSON and writes it to `SharedPreferences`. On a device's first `ready` on a server with N members that is N encodes of a map that grows to N entries — quadratic — on the gateway's single event-collector thread, so every event behind `ready` waits for it.
- Impact: on the live instance (tens of users) invisible; on a server with a few thousand members the first connection of a fresh device stalls for seconds. Cheap to fix now.
- Fix: a `pinAll(list)` that judges the batch and writes once, used from `putUsers`.
- Effort: S
- Status: open

### DROID-009 · P1 · bug · A wrong current password in any account-security flow signs the phone out and wipes its local keys
- Where: `net/ApiClient.kt:213` (`if (res.code == 401 && token != null) onUnauthorized?.invoke()`), `data/Session.kt:95` (`Api.onUnauthorized = { signOutLocally() }`); server `internal/api/auth_handlers.go:428` (`POST /auth/password`), `:462` (`POST /auth/recovery`), `internal/api/mfa_handlers.go:181-185` (`requirePassword`, used by TOTP setup, MFA disable, new backup codes)
- What: the server answers a wrong `auth_key` — a mistyped current password — with **401 `invalid_credentials`** on password change, recovery-key replacement, two-factor setup, two-factor disable and backup-code regeneration. The Android client treats every 401 on an authenticated request as "the session is gone": `signOutLocally()` closes the gateway, wipes token, identity and conversation roots from `SecureStore`, and drops to the sign-in screen. `Session.changePassword`, `newRecoveryKey`, `totpSetup`, `mfaDisable` and `newBackupCodes` all go through this path.
- Impact: one typo in the "current password" box throws the user out of the app; after signing back in every conversation is "waiting for the key" until the grants are fetched again. A normal person hits this the first time they change their password on the phone. The web client keys its sign-out on the error code, not the status (see `web/src/api/client.ts`).
- Fix: sign out only when the 401 carries a session code (what `authed` writes — `unauthorized`/`invalid_token`), never on `invalid_credentials`; equivalently, the server could answer these with 403. Client fix is enough and is one line. Cross-ref for `[server-api]`: consider 403 for "wrong current password" so no client can make this mistake.
- Effort: S
- Status: open

### DROID-010 · P2 · bug · A session revoked from another device leaves the phone with a dead socket and no sign-out
- Where: `net/Gateway.kt:189-191`; server `internal/gateway/conn.go:65-66` ("tells the client its session is gone; it signs out"), `:182`, `:247`, `:412`, `internal/gateway/hub.go:343`
- What: when a session is revoked — from the sessions list on another device, a password change elsewhere, account deletion — the server closes the socket with 4001. The Android gateway logs "closed (4001)" and returns without reconnecting; nothing reaches `Session`. The `session_expired` event the client does handle (`Session.kt:653`) has no sender on the server (`EvSessionExpired` is defined in `protocol.go:81` and never emitted).
- Impact: after "sign out other devices" on the web, the phone keeps showing the account with a closed connection until the next API call happens to return 401. In the background none does, so the foreground service's notification keeps saying it is connected while it is not.
- Fix: on close code 4001 invoke a `revoked` callback that runs the same path as `session_expired` (`signOutLocally`).
- Effort: S
- Status: open
