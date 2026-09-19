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

### DROID-011 · P2 · bug · Any intermittent keystore failure signs the phone out and drops its keys; a refusal at write time silently stores the identity key in plaintext
- Where: `data/SecureStore.kt:59-80` (`read`), `:83-92` (`write`), `:147` (`keyOrNull` swallows every exception)
- What: the file has no header saying whether it is encrypted. `write` decides per call — `if (keyOrNull() != null) encrypt(bytes) else bytes` — and `read` decides per call the same way. The two decisions are made at different moments, so they can disagree: a vault written while the keystore refused (`keyOrNull()` returns null on *any* exception — `KeyStoreException: Keystore operation failed`, the daemon busy right after boot, a work profile's policy) is plain JSON on disk; at the next launch the key works, `decrypt(raw)` runs on plaintext, the GCM tag check fails and `read()` logs "could not read the key store; starting fresh". The reverse (encrypted file, keystore refusing at read time) parses ciphertext as JSON and ends the same way. Either way the result is `Vault()`: token, identity private key and every conversation root gone. The plaintext branch also means a single refused write leaves the account's identity private key and all conversation roots unencrypted in `files/secure.bin` — the comment calls that "no worse than the web", but the web never claimed hardware protection and this file is what the README says "lives in hardware".
- Impact: the "app randomly signed me out and every chat says waiting for the key" class of report (DROID-003 is the other cause). Rare per launch, but it is total when it happens, and it is silent: the user gets no line saying why.
- Fix: prefix the file with one byte (`0` plain / `1` sealed) and read by the header, not by today's keystore mood; on a keystore exception at read time keep the file untouched and surface `AuthStatus.OFFLINE` with "could not open the key store" instead of starting fresh; never fall back to a plaintext write silently — retry with backoff, and if the keystore is genuinely unavailable on this device, say so once in settings. Same change as DROID-003's atomic write; do both together.
- Effort: M
- Status: open

### DROID-012 · P2 · ux · The phone is listed as "Browser" among the account's devices, so a lost phone cannot be told apart from a browser tab
- Where: `net/ApiClient.kt:75-82` (no `User-Agent` set on `Api.http`, which the gateway shares), server `internal/api/auth_handlers.go:78-82` (stores `r.UserAgent()` per session), `web/src/components/settings/DevicesPage.tsx:11-16` (`describe()`: no browser match → "Browser", no OS match → nothing)
- What: OkHttp sends `okhttp/5.5.0` when nothing else is set. The server stores that as the session's user agent; the Devices page on the web derives the label from it and gets "Browser" with no OS. The app's own sessions list (`SettingsScreen`) shows the raw string.
- Impact: the one time this list matters — a phone lost or sold, "sign out that device" — the phone's entry reads "Browser", indistinguishable from a real browser session, on every platform.
- Fix: an interceptor on `Api.http` adding `User-Agent: Nexa/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})`; `[web-shell-ui]` teach `describe()` that `Nexa/` on Android is "Nexa on Android" (and the desktop app's UA likewise if it has one); the app's sessions list gets the same mapping.
- Effort: S
- Status: open

### DROID-013 · P2 · bug · The second accent colour never reaches the phone: `accentColor2` is serialised as `accent_color2`, the wire says `accent_color_2`
- Where: `net/Models.kt:25-26` (`PublicUser.accentColor2`), `:46-47` (`MeUser`), `net/ApiClient.kt:72` (`JsonNamingStrategy.SnakeCase`), `ui/sheets/ProfileSheet.kt:94`, `data/Session.kt:580`; wire: `web/src/api/types.ts:25`, `internal/store/users.go:31,191`
- What: kotlinx's `SnakeCase` strategy inserts an underscore only before an upper-case letter, never before a digit, so `accentColor2` is read from (and would be written to) the key `accent_color2`. The server sends `accent_color_2`. With `ignoreUnknownKeys` the field is silently dropped and `accentColor2` is always null; `ProfileSheet` therefore draws a one-colour banner for every profile that has a two-colour gradient on the web and desktop, and `user_update` events keep copying the null over.
- Impact: every profile with a gradient looks different on the phone from everywhere else; nobody gets an error.
- Fix: `@SerialName("accent_color_2")` on both fields (and a grep for other camelCase-digit names — `accentColor2` is the only one today).
- Effort: S
- Status: open

### DROID-014 · P3 · a11y · "Reduce motion" never turns off the image crossfade
- Where: `media/CoilSetup.kt:69` (`.crossfade(!SettingsStore.reducedMotion)`), `App.kt:45` (`Images.install` runs before any settings exist)
- What: the image loader is built once, in `Application.onCreate`, when `SettingsStore` still holds an empty document; `reducedMotion` is therefore always `false` at that moment, and every avatar, emoji, sticker and attachment fades in for the life of the process whatever the account chose. The comment says the loader "honours the account's reduce motion"; it cannot.
- Impact: someone who turned motion off (the setting the web honours) still gets a fade on every picture, including the hundred emoji in the picker.
- Fix: read the setting per request — a Coil `Interceptor` that sets `crossfade(false)` on the request when `SettingsStore.reducedMotion` is true — or rebuild the loader when the setting changes.
- Effort: S
- Status: open

### DROID-015 · P3 · bug · `MediaMetadataRetriever.use {}` needs Android 10; on 8 and 9 a video's size and duration are silently lost, and lint is not allowed to say so
- Where: `media/Uploads.kt:78-83`, `android/app/build.gradle.kts:161-163` (`lint { abortOnError = false }`)
- What: `MediaMetadataRetriever` implements `AutoCloseable` from API 29; the `use {}` call compiles against compileSdk 37 and on API 26–28 fails at runtime with an `IncompatibleClassChangeError`/`NoSuchMethodError` on `close()`. The surrounding `runCatching` swallows it (it catches `Throwable`), so every video or audio file picked on Android 8–9 goes out with no width, height or duration, and the retriever's native resources are never released. This is the same class of defect as round 1's `readNBytes` crash; the `NewApi` lint check reports exactly this, but `abortOnError = false` means nobody sees it.
- Impact: on Android 8–9 videos render without an aspect ratio placeholder on every receiving client; a native leak per pick. Small on its own; the disabled gate is the real cost.
- Fix: `MediaMetadataRetriever()` + `try { … } finally { release() }`; then let lint fail the build on `NewApi` (keep `abortOnError = false` for everything else if the rest is noisy: `lint { error += "NewApi" }`).
- Effort: S
- Status: open

### DROID-016 · P1 · bug · On Android 15 and newer the message socket's foreground service is a `dataSync` service, which the system stops after six hours a day — and this one has no `onTimeout`, so the stop is an ANR crash
- Where: `service/Services.kt:48` (`FOREGROUND_SERVICE_TYPE_DATA_SYNC`), `:30-69` (no `onTimeout` override), `android/app/src/main/AndroidManifest.xml:87-90` (`foregroundServiceType="dataSync"`), `android/app/build.gradle.kts:55` (`targetSdk = 37`)
- What: since Android 15, for apps targeting API 35 or higher, a `dataSync` foreground service may run for a total of six hours in any 24-hour window; when the budget is spent the system calls `Service.onTimeout(startId, fgsType)` and the service must call `stopSelf()` within a few seconds or the app is killed with the ANR "A foreground service of type dataSync did not stop within its timeout" (developer.android.com/about/versions/15/behavior-changes-15#datasync-timeout). The app targets 37 and never overrides `onTimeout`, so on a Pixel or any Android 15+ phone, the evening the app is left in the background is the evening it is killed: after six hours in the background the process is ANR-killed, the socket is gone, the "Connected" notification vanishes, and `GatewayService.start` from any later `onStop` throws `ForegroundServiceStartNotAllowedException` (swallowed by `runCatching`) until the person opens the app again. The `dataSync` type is also not on the list of types a `BOOT_COMPLETED` receiver may start, which closes the obvious fix for DROID-017.
- Impact: on current phones, notifications stop arriving every night, and each time it happens the app crashes silently. This is the core promise of the foreground service ("a message can arrive without a push service in the middle") failing on the newest half of the installed base. The web and desktop have no equivalent problem.
- Fix: declare the service as `specialUse` (`FOREGROUND_SERVICE_SPECIAL_USE` permission, `foregroundServiceType="specialUse"`, plus `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Keeps the end-to-end encrypted message socket open; there is no push service"/>` — the app is not on Play, so no review applies), which has no timeout; start it with `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`; and still override `onTimeout` to `stopSelf()` as a belt-and-braces. Test on an Android 15 emulator with `adb shell cmd activity fgs-timeout` if available, or simply by leaving it overnight.
- Effort: S
- Status: open

### DROID-017 · P2 · ux · After a reboot (or a force-stop, or DROID-016's kill) the phone receives no messages until someone opens the app, and nothing ever says so
- Where: `android/app/src/main/AndroidManifest.xml:5-21` (no `RECEIVE_BOOT_COMPLETED`, no receiver), `App.kt:78-93` (the socket only starts from the process lifecycle), `service/Services.kt:57` (`START_STICKY` only survives a kill of the process, not a reboot)
- What: the socket is opened when the app process starts and kept by the foreground service when it goes to the background. Nothing runs at boot, so from a reboot until the next tap on the icon the phone is silent; the "Connected" notification is simply absent and there is no state that tells the person "not connected since 07:12". The same silence follows a force-stop from the app info screen and the timeout in DROID-016. The app also never asks to be exempted from battery optimisation (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), which is what every push-less messenger on Android does (Signal without Play services, Conversations, Element) so that Doze does not defer the heartbeat and the reconnect after a network change.
- Impact: a person who reboots at night and does not open the app in the morning misses every message until they do — and blames the app for being unreliable. The web tab and the desktop app do not have this failure mode (the desktop reconnects at login).
- Fix: a `BOOT_COMPLETED` receiver that starts the (`specialUse`, see DROID-016) service when an account is signed in and notifications are on; a settings row under Notifications — "Keep receiving messages in the background" — that explains the battery-optimisation exemption and opens the system dialog, with the row showing the current state; and the service notification saying "Reconnecting…" while `Gateway.status` is not `OPEN` (today it says "Connected" whatever the state).
- Effort: M
- Status: open

### DROID-018 · P2 · ux · One notification per conversation, overwritten by every new message: the shade never shows more than the latest line, and there is no reply, no mark-read, no avatar, no conversation grouping
- Where: `notify/Notifications.kt:65-101` (`message`), `:53-62` (`openIntent`); web reference `web/src/lib/notify.ts`
- What: `post(context, raw.channelId.hashCode(), notification)` reuses one id per channel, so the second message from a conversation replaces the first in the shade; `setGroup(raw.channelId)` is set but no summary notification is ever posted, so nothing groups; the notification is a plain `BigTextStyle` — no `MessagingStyle` (Android 7+, which is what makes the shade show the last few lines with names), no `Person`/avatar, no `RemoteInput` reply action, no "mark as read" action, no `setShortcutId` (Android 11+ conversations section, bubbles), `setWhen` is the post time rather than the message time, and the "sounds" switch in the account's settings (`SettingsStore.soundsOn`) is never consulted. The title for a server channel is "author · channel" with no server name.
- Impact: on a phone, the shade is where most messages are read. Three quick messages from a friend show as one line; the person cannot answer or dismiss-as-read from the shade the way every other messenger allows; the app's "sounds off" setting does nothing here.
- Fix: `NotificationCompat.MessagingStyle` keyed on the channel, holding the last ~6 lines (kept in a small in-memory map, cleared on `clearMessages`), `Person` with the author's name and avatar (Coil into a `Bitmap`, sized 48 dp), a `RemoteInput` "Reply" action that calls `MessageService.send` via `NotificationActions` (as the decline action already does), a "Mark as read" action calling `MessageService.ack`, a summary notification per account, `setShortcutId`/`ShortcutInfoCompat` per conversation, `setWhen(raw.createdAt)`, and `setSilent(!SettingsStore.soundsOn)`.
- Effort: M
- Status: open

### DROID-019 · P3 · design · Message text goes to the lock screen with nothing to say otherwise
- Where: `notify/Notifications.kt:89-99` (no `setVisibility`, no `setPublicVersion`)
- What: the notification carries the decrypted text and the sender's name; on a phone whose lock-screen setting is the common default ("show all notification content"), an end-to-end encrypted message is readable by whoever picks the phone up. The system-wide "hide sensitive content" toggle exists but hides everything from every app, which is not the trade-off most people want. Signal, WhatsApp and Telegram each have a per-app "show name and message / name only / nothing" setting; Nexa has none.
- Impact: a design gap, not a defect: it is the one place the app's own privacy promise is decided by a system default.
- Fix: a "Notification content" setting under Notifications (name and message / name only / hidden), stored device-side, applied as `setVisibility(VISIBILITY_PRIVATE)` plus a `setPublicVersion` that carries only "New message" (or the sender's name) — the lock screen then shows the public version and the shade shows the full one after unlock.
- Effort: S
- Status: open

### DROID-020 · P1 · bug · Tapping a message notification (or a channel link) when the app is not running opens the empty "No conversation open" screen
- Where: `ui/main/MainScreen.kt:58-63` (`LaunchedEffect(route, channels.size)` drops any channel not in `AppState.channels`), `MainActivity.kt:155,164-183` (`handleIntent` runs in `onCreate`, before sign-in completes), `notify/Notifications.kt:53-62`, `data/Session.kt:375-380` (`goLive` sets READY and only then connects the socket)
- What: on a cold start `handleIntent` sets `Route.Chat(null, channelId)` at once. `bootstrap()` then reaches `goLive`, which flips the status to READY and starts the socket; `MainScreen` composes immediately, its guard effect runs with `AppState.channels` still empty (the `ready` frame is hundreds of milliseconds away), finds the channel "gone" and replaces the route with `Chat(null, null)`, whose branch opens the drawer on the DM list. The tap's intent is lost. Warm starts work because the map is already filled. The same guard also fires for `https://chat.evilion.xyz/channels/{server}/{channel}` links opened from a message or a browser while the app is not running. It is also wrong in a second way: for a server channel it passes `serverId = null`, so even when it survives, the drawer shows the DM list beside a server channel.
- Impact: the notification the person tapped — often the only reason they opened the app — lands them on an empty screen with a drawer, and the message they wanted is two taps away in a server they now have to find. Anyone whose process has been killed (overnight, low memory, DROID-016) hits this every morning.
- Fix: hold the requested channel until the account is live — in `MainScreen`, only treat a channel as gone when `Session.connection` has been `OPEN` at least once (or when the map is non-empty and still lacks it); in `handleIntent`, resolve `serverId` from `AppState.channels` after `ready` (a `readyHooks` entry can re-run `Nav.openChannel` with the real server id).
- Effort: S
- Status: open

### DROID-021 · P2 · ux · Back goes to the wrong place at the top level: closing Settings lands on the empty screen, and on that screen back can never leave the app
- Where: `ui/main/MainScreen.kt:74-81` (`BackHandler`), `:122` (`LaunchedEffect(Unit) { drawer.open() }`), `ui/settings/SettingsScreen.kt:100`, `ui/server/ServerSettingsScreen.kt:78,183,197`, `ui/invite/InviteScreen.kt:70,125` (all `Nav.go(Route.Chat(null, null))`), `ui/Nav.kt:44-60` (`previous`/`back()` exist and are used once, in `Misc.kt:331`)
- What: (1) Every screen that is not a conversation closes to `Route.Chat(null, null)` — the "No conversation open" placeholder with the drawer auto-opened on the DM list — instead of to the conversation the person came from. Open #general → gear → back: you are looking at your DM list. The web and desktop return to the previous URL. `Nav.back()` was written for exactly this and is used by one sheet. (2) On that placeholder, `BackHandler(enabled = … || emptyChat)` opens the drawer when it is closed and closes it when it is open, so back never reaches the system: the person presses back, the drawer toggles, forever. Android's convention (and what predictive back animates on 14+) is that back at the root leaves the app. (3) After process death the route is reset to `Chat(null, null)` too, so reopening the app from recents shows the placeholder rather than the conversation that was open (the web reopens at the same URL); the draft text survives, the place does not.
- Impact: a daily friction on the commonest paths (settings, server settings, friends, invites), and a back button that can feel broken.
- Fix: use `Nav.back()` from every screen's close/back (with `previous` defaulting to the last `Route.Chat` with a channel, kept in a small stack rather than one deep); remove `emptyChat` from the `BackHandler` condition once the drawer has been shown, so a second back exits; remember the last `Route.Chat` in device prefs and restore it on start when the channel still exists.
- Effort: S
- Status: open

### DROID-022 · P1 · parity · A password-locked subchat cannot be opened on the phone: no lock in the list, no password prompt, and "Could not load messages" with the server's English sentence
- Where: `net/Models.kt:88-112` (`Channel` has no `locked`), `ui/chat/ChatScreen.kt:103-109,189` (the load failure is the end of the road), `ui/sheets/ChannelSheets.kt:296` (subchat creation: a name, no password); server `internal/api/access.go:52-55` (403 `locked` "This subchat asks for its password first."), `internal/api/subchat_handlers.go:18-19,67` (`GET /channels/{id}/lock` gives `salt`/`params`, `POST /channels/{id}/unlock` takes `password_key`), `internal/api/subchat_lock_test.go:126-133` (the channel object and both channel lists carry `locked: true`); web `web/src/components/chat/ChatView.tsx:139-162`, `web/src/components/chat/LockedChannel.tsx`, `web/src/lib/subchatLock.ts`, `web/src/components/modals/SubchatModal.tsx:27-47`
- What: the web can put a password on a subchat (stretched on the device by `lib/subchatLock`, checked by the server per session); the channel then arrives with `locked: true` and every read is refused with 403 `locked` until `POST …/unlock` has been sent from that session. Android's `Channel` model drops the field (`ignoreUnknownKeys`), the sidebar draws the subchat like any other, and opening it runs `loadInitial` straight into the 403: `ChatScreen` shows the empty state "Could not load messages" with the detail "This subchat asks for its password first." — the server's English, in all eleven languages — and offers nowhere to type it. The phone can neither create nor edit a locked subchat.
- Impact: a person whose friends use locked subchats sees a conversation that looks normal in the list and is dead when opened, with a sentence telling them to do something the app cannot do. Round 1's "Android is a read-and-chat client" matrix predates this feature; it is a new parity hole.
- Fix: add `locked: Boolean = false` to `Channel`; a lock glyph in `Sidebar` beside a locked subchat; in `ChatScreen`, when `channel.locked`, ask `GET …/lock` for `salt`/`params`, show a password screen shaped like `LockedChannel.tsx` (title, one field, "Unlock"), stretch with `Kdf` exactly as `subchatLock.ts` does (same argon2id parameters — add a test vector against a web-made lock), post `password_key`, then load. Creation/edit with a password in `ChannelSheets` can follow.
- Effort: M
- Status: open

### DROID-023 · P2 · security · Signing out leaves the account's messages in the notification shade and its screens in the navigation state
- Where: `data/Session.kt:387-396` (`signOutLocally`), `notify/Notifications.kt:142-150` (only per-conversation cancels exist; `cancelAll` is never called), `ui/Nav.kt:40-42,104` (`route`, `layers`, `jump` are never reset), `ui/main/MainScreen.kt:52` (layers are drawn from `Nav.layers` whenever `MainScreen` is up), `MainActivity.kt:164-183` (`handleIntent`)
- What: `signOutLocally` — the Sign out row, and every forced sign-out (401, `session_expired`, DROID-009) — resets the token, the keys and `AppState`, but (1) never cancels the message notifications already posted: the decrypted text and sender names of the account stay readable on the lock screen and in the shade after sign-out, and tapping one runs `handleIntent` into `Route.Chat(null, thatChannel)` on top of the sign-in screen; (2) never resets `Nav`: `route` keeps `Route.Settings` (where the Sign out row lives) or whatever screen the 401 arrived on, `layers` keeps any open sheet (a profile, the members list, a channel's settings, built from the old account's ids) and `jump` its pending target — hidden while `AuthScreen` shows, back on the next sign-in, so a second account opens on the first account's Settings screen with the first account's sheet over it. (`SettingsStore` surviving sign-out is DROID-001.)
- Impact: signing out is what people do before handing a phone to someone; the shade defeats it. The stale navigation is a confusion on every account switch and every forced sign-out.
- Fix: in `signOutLocally`: `NotificationManagerCompat.from(App.instance).cancelAll()` (the foreground service re-posts its own if it is running), `Nav.route.value = Route.Chat(null, null)`, `Nav.clearLayers()`, `Nav.jump.value = null`, plus DROID-001's `SettingsStore.reset()`.
- Effort: S
- Status: open

### DROID-024 · P1 · bug · A file up to 90 MB is encrypted into memory twice before the upload starts — an `OutOfMemoryError` crash on phones with a small heap, and no progress until it is done
- Where: `media/Uploads.kt:109-112` (`ByteArrayOutputStream(total)` then `toByteArray()`), `net/ApiClient.kt:151-172` (`upload` takes a `ByteArray`), `net/Endpoints.kt:398-401`, `ui/chat/Composer.kt:199-205` (`singleLimit` = the server's `upload_single_bytes`; 90 MB on the live instance, `internal/api/upload_handlers.go:24`), `android/app/src/main/AndroidManifest.xml:43` (`largeHeap`)
- What: any file whose encrypted size is at or under the server's single-request ceiling is encrypted into a byte array sized to the whole file, then copied once more for the request body: a 60 MB video holds 120 MB of heap for the whole encryption and upload, on top of Compose and the image cache. `largeHeap` raises the limit (256–512 MB depending on the phone) so one such file usually survives on a recent phone; on the budget phones with a 256 MB large heap, a 90 MB video (180 MB plus the app's baseline) does not, and the `OutOfMemoryError` is not inside any `runCatching` — the app dies. The in-pieces path, which streams and resumes after a dropped connection, is used only above the ceiling, so on a mobile network — where a dropped connection is the normal case — a 60 MB single POST that fails at 95 % starts from zero. And because `onProgress` fires only while the body is written, the ring under the thumbnail shows nothing during the several seconds of encryption.
- Impact: videos are the file most likely to be sent from a phone and the one most likely to crash it here. Crash on some phones, a stall-then-restart on all.
- Fix: stream — a `RequestBody` whose `writeTo` runs `encryptChunks` straight into the sink, `contentLength() = total`, no buffer; lower the phone's single-request threshold to a few MB (8 MB, say) so anything larger goes in resumable pieces; report progress from the chunk loop.
- Effort: M
- Status: open

### DROID-025 · P3 · code · A server URL with a trailing slash breaks every attachment download, silently
- Where: `media/AttachmentStore.kt:54` (`Media.attachment(id).removePrefix(Api.baseUrl)`), `net/ApiClient.kt:97-98` (`url` trims the slash before joining, so the prefix eats the path's leading slash), `android/app/build.gradle.kts:59-62` (`-PserverUrl` is trimmed of whitespace only), `App.kt:54`; `ui/auth/AuthScreen.kt:333` strips the slash for a typed address, so the live build is safe
- What: the attachment path is built as an absolute URL and then turned back into a path by removing the base. With `Api.baseUrl = "http://10.0.2.2:1234/"` the result is `media/attachments/x` (no leading slash), which `Api.url` no longer recognises as a verbatim site path and prefixes with `/api/v1`, giving `…/api/v1media/attachments/x` → 404 on every image, video and file. A dev build made with `-PserverUrl=http://10.0.2.2:1234/` (the natural thing to paste) shows every attachment as failed with no clue why.
- Fix: `Media.attachmentPath(blobId) = "/media/attachments/$blobId"` and pass the path; `trimEnd('/')` on `DEFAULT_SERVER` in Gradle and on `Api.baseUrl`'s setter.
- Effort: S
- Status: open

### DROID-026 · P2 · ux · "Could not load messages" is a dead end: no Try again, no automatic retry, no retry when the network returns
- Where: `ui/chat/ChatScreen.kt:103-109,189`; web `web/src/components/chat/MessageList.tsx:436-445,485`
- What: `loadInitial` runs once per visit. If it fails — offline for a moment, a 502, the socket mid-reconnect — the screen shows "Could not load messages" with the raw error under it (DROID-007) and nothing else. The web retries with backoff, retries on `online`, and has a "Try again" button; the phone's only way out is to leave the conversation and come back, which nobody knows.
- Impact: on a phone transient failures are the normal case (tunnel, lift, Wi-Fi handover); each one turns the conversation into a wall until the person discovers the trick.
- Fix: a "Try again" button (`chat.messageList.tryAgain` exists) that re-runs `loadInitial`; a backoff retry in the effect; re-run when `Session.connection` becomes OPEN.
- Effort: S
- Status: open

### DROID-027 · P3 · bug · The status ring in a DM's header never changes while the conversation is open
- Where: `ui/chat/ChatScreen.kt:302` (`AppState.presences.value[other]?.status`), `data/AppState.kt:66`
- What: the header reads the presence map with `.value` instead of `collectAsState()`, so the ring is computed only when something else recomposes the header. The other person going online or offline does not redraw it; the sidebar, which subscribes, disagrees with the header on the same screen.
- Fix: `val presences by AppState.presences.collectAsState()`.
- Effort: S
- Status: open

### DROID-028 · P3 · perf · The typing bar ticks once a second for as long as any conversation is open
- Where: `ui/chat/ChatScreen.kt:381-388`
- What: `TypingBar` runs `while (true) { delay(1000); now = … }` whether or not anyone is typing, writing a state that recomposes the bar every second. The same waste as DROID-005, one per open chat.
- Fix: run the loop only while `typing[channelId]` has an entry whose expiry is in the future; stop when the last one lapses.
- Effort: S
- Status: open

### DROID-029 · P3 · i18n · [i18n-copy] The web's typing bar glues an English "and" between translated names; the phone joins with commas, so the two clients also differ
- Where: `web/src/components/chat/TypingBar.tsx:21-22`; `ui/chat/ChatScreen.kt:393-397` for the phone's shape
- What: for two or three people the web renders `<b>{a}</b> and <b>{b}</b> {t("chat.typingBar.areTyping")}`: a German reader sees "Alice and Bob schreiben…". The phone avoids the word and prints "Alice, Bob are typing", which is not English either. The catalogue only has the verb.
- Fix: one string per shape in the catalogue — `chat.typingBar.twoAreTyping` "{a} and {b} are typing…", `threeAreTyping` — used by both clients.
- Effort: S
- Status: open

### DROID-030 · P3 · i18n · The day divider ignores how the language writes a date, while the timestamps beside it do not
- Where: `ui/chat/MessageRow.kt:624-634` (`dayLabel`, fixed `"d MMMM yyyy"`), `:605-622` (`shortTime`/`messageStamp` use `DateTimePatternGenerator`)
- What: the divider between days is formatted with a fixed day-month-year pattern; the stamps beside names use the language's best pattern. An English (US) list reads "18 September 2026" over messages stamped "September 18, 2026 at 10:42 PM"; Japanese gets "18 9月 2026" instead of "2026年9月18日". "Yesterday" is decided with `DAY_OF_YEAR` under a same-year guard, so on 1 January yesterday is a full date.
- Fix: `format(bestPattern("yMMMMd"))`; decide yesterday with `sameDay(millis, now - 86_400_000L)` as `messageStamp` already does.
- Effort: S
- Status: open

### DROID-031 · P2 · a11y · Reaction pills, the failed-message actions and the remove-attachment cross are 11–24 dp tap targets
- Where: `ui/chat/MessageRow.kt:435-446` (reaction pills: 24 dp tall, 4 dp apart), `:469-474` (the add-reaction pill, 24 dp), `:247-268` ("Not sent, tap to try again" and "Discard": 11 sp words with no padding, 10 dp apart), `:182-188` (author name in a 22 dp row), `:358` (reply line, 24 dp), `ui/chat/Composer.kt:327-333` (the X on a staged attachment: 18 dp)
- What: these are `Modifier.clickable` on plain rows and texts, which Compose does not pad to the 48 dp minimum the way it does `IconButton`. A 24 dp pill is missed by a thumb often, and the two failure actions are two 11 sp words 10 dp apart where the wrong one deletes the message. The web's pills are the same size, but a mouse is not a thumb.
- Impact: reactions are the most-tapped control in a chat; the failure actions are the ones tapped in a hurry. Fails Android's 48 dp guideline and WCAG 2.5.8 for the failure actions.
- Fix: `Modifier.minimumInteractiveComponentSize()` on pills (the visual stays 24 dp; the hit area grows), buttons with 12 dp padding and 16 dp between them for retry/discard, a 32 dp hit area for the tray's X.
- Effort: S
- Status: open

### DROID-032 · P2 · bug · The upload ring under a staged file freezes at its first tick
- Where: `ui/chat/Composer.kt:198-205` (`staged.map { if (it === item) it.copy(progress = done) else it }`), `:92-97` (`Staged` is a data class; `copy` makes a new object)
- What: the first progress callback replaces the staged entry with a copy carrying the new fraction; the second compares by identity against the original `item`, which is no longer in the list, so nothing updates again. The ring stops at the first reported slice (64 KB of the file — a per-cent or less) for the whole upload. For a 40 MB video on a mobile connection that is a minute of a spinner that looks hung, while the send button is disabled.
- Fix: `it.id == item.id`.
- Effort: S
- Status: open

### DROID-033 · P3 · ux · The keyboard does not capitalise the start of a message
- Where: `ui/chat/Composer.kt:387-402`
- What: `BasicTextField` is used with the default `KeyboardOptions`, whose `capitalization` is `None`: the keyboard never proposes a capital at the start of a message or after a full stop. Every messenger on Android sets `Sentences`.
- Fix: `keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences)`.
- Effort: S
- Status: open

### DROID-034 · P3 · ux · Starting an edit throws away whatever was being typed
- Where: `ui/chat/Composer.kt:139-143`, `:217`, `:222-223`, `:281-284`
- What: editing replaces the composer's text with the message being edited; cancelling sets the field to empty; finishing clears the field and the stored draft. A half-typed message is gone the moment "Edit" is chosen from the long-press sheet (after a cancel it comes back only on re-entering the conversation, which is stranger than losing it). The web edits inline on the message (`EditMessage.tsx`), so its composer draft is untouched.
- Fix: park the draft in a `remember` when `editing` becomes non-null and restore it on cancel and finish, or edit inline in the row as the web does.
- Effort: S
- Status: open

### DROID-035 · P2 · bug · A message that fails to send is left in two places, and sending it again makes two
- Where: `ui/chat/Composer.kt:219-234` (the field and tray are cleared only on success), `data/MessageService.kt:290-312` (`send` marks the optimistic row failed and rethrows); web `web/src/components/composer/Composer.tsx:385` (`setText("")` at send time; the row carries the retry)
- What: on failure `send` keeps the optimistic row in the list as "Not sent. Tap to try again. · Discard" and throws; `doSend` catches, toasts `e.message` (raw, DROID-007) and leaves the text and the staged files in the composer. The person now has the same message in the box and in the list. Tapping Send again (the obvious move once the network is back) sends the composer's copy and leaves the failed row where it is; tapping "try again" on the row as well sends it twice. With attachments the composer's copy re-uploads the files.
- Impact: every failed send — a lift, a tunnel — ends with a duplicate or a stray "Not sent" row that has to be discarded by hand. The web clears the composer at send time and lets the row own the retry.
- Fix: clear `value`/`staged`/the draft as soon as the optimistic row is in the list (move the clearing before `work.await()` for the send case; edits can stay as they are), and stop toasting on failure — the row already says it.
- Effort: S
- Status: open

### DROID-036 · P2 · ux · Delete on the long-press sheet deletes at once, with no confirmation and no undo
- Where: `ui/chat/MessageActions.kt:179-187`; web `web/src/components/chat/messageMenu.ts:93-101` (a "Delete message — are you sure?" dialog; Shift skips it)
- What: the red "Delete" row is the last row of the sheet, directly above where the thumb rests after a long press; one tap removes the message for everyone with nothing in between. The web asks first.
- Fix: a small confirm (`chat.messageMenu.deleteMessage` / `chat.messageMenu.areYouSureYouWantTo` / `chat.messageItem.delete` all exist) — an `AlertDialog` or a second sheet.
- Effort: S
- Status: open

### DROID-037 · P3 · parity · The long-press sheet lacks "Remove embeds" and multi-select
- Where: `ui/chat/MessageActions.kt:103-188`; web `web/src/components/chat/messageMenu.ts:83-91`
- What: the web's menu offers "Remove embeds / Show embeds" (the `flags = 4` toggle; the phone honours the flag when rendering, `MessageRow.kt:233`, but cannot set it) and "Select messages" for bulk delete. The phone has neither, so a link preview posted by mistake can only be removed by editing the text.
- Fix: an "Remove embeds" row when `payload.embeds` is non-empty (one `MessagesApi.edit` with `flags`); multi-select can wait.
- Effort: S
- Status: open

### DROID-038 · P3 · parity · There is no way to see who reacted
- Where: `ui/chat/MessageRow.kt:435-446`; web `web/src/components/chat/Reactions.tsx:57-75` (names on hover, fetched from `/reactions/{emoji}`)
- What: a pill toggles the reaction and nothing else; the web's tooltip lists the people. On a phone the natural idiom is a long press on the pill (or a "Reactions" row in the sheet) opening a small list with avatars.
- Fix: `combinedClickable` on the pill; long press → a `ModalBottomSheet` listing users per emoji from `MessagesApi` (the endpoint the web uses).
- Effort: S
- Status: open

### DROID-039 · P3 · parity · A message link opens the conversation but does not go to the message
- Where: `MainActivity.kt:176-181` (`handleIntent`: `channels/{server}/{channel}` opens the channel; a fourth segment is ignored), `ui/chat/MessageActions.kt:143-149` (the phone itself copies links with the message id); web `web/src/routes.tsx:41,44` (`:messageId` routes jump and flash)
- What: "Copy link" on the phone and on the web both produce `…/channels/{server|@me}/{channel}/{message}`. Opened on the web it lands on the message; opened on the phone it lands at the bottom of the conversation. `Nav.jumpTo` exists and does exactly the right thing for replies, search and pins.
- Fix: `parts.getOrNull(3)?.let { Nav.jumpTo(parts[2], it) }` after `openChannel`.
- Effort: S
- Status: open

### DROID-040 · P2 · parity · A GIF from the picker shows as a bare URL line plus a boxed card; the web shows the GIF
- Where: `ui/chat/MessageRow.kt:220-233` (the text is always rendered), `ui/chat/AttachmentViews.kt:244-285` (`EmbedList` draws every embed as a card with a 4 dp colour bar, 10 dp padding, site/title/description, then the image), `ui/chat/Composer.kt:428-437` (the phone sends `text = url` + `Embed(type = "gif")`, as the web does); web `web/src/components/chat/mediaLinks.ts:18` (`isOnlyMediaLinks` hides the text), `web/src/components/chat/MessageItem.tsx:25`, `web/src/components/chat/Embeds.tsx` (a media embed is the picture alone in `fitMedia`'s frame; a YouTube `video_id` gets a player; an `invite_code` gets a card with member counts and Join)
- What: on the phone every GIF, every image link and every YouTube link is a raw URL in link colour followed by a card that looks like an article preview. The GIF picker is one of the app's headline features and its output looks broken in the phone's own list, and in the web's list looks right — so the same message renders differently on the two clients.
- Impact: every GIF, on every phone, in every conversation.
- Fix: port `isOnlyMediaLinks` (hide the text when it is only media links whose embeds are media); in `EmbedList` render `type == "gif"`/image embeds as the picture alone in the same frame as an image attachment, `video_id` as a thumbnail with a play glyph that opens YouTube, `invite_code` as an invite card with `member_count`/`online_count` and a Join button that routes to `Route.Invite`.
- Effort: M
- Status: open

### DROID-041 · P2 · ux · A tall screenshot takes more than a screen; a panorama is cropped
- Where: `ui/chat/AttachmentViews.kt:80-97` (`aspectRatio(ratio.coerceIn(0.4f, 2.5f))`, `ContentScale.Crop`, `widthIn(max = 320.dp).fillMaxWidth()`); web `web/src/components/chat/fitMedia.ts:1-19` (fit inside 550 × 350, never crop)
- What: the image box takes the full column width (about 290 dp on a 360 dp phone) and its height from the ratio, so a phone screenshot (1080 × 2400, ratio 0.45) is drawn 290 × 645 dp — most of the screen — and the list scrolls a screenful per screenshot. Ratios outside 0.4–2.5 are cropped rather than fitted, so a panorama loses its ends and a long chat screenshot its top and bottom, with nothing to say so. The web caps height at 350 px and never crops.
- Fix: size like `fitMedia`: `heightIn(max = 300.dp)` with the width derived from the ratio (`ContentScale.Fit` inside a box no wider than the column), no crop; the same for video posters.
- Effort: S
- Status: open

### DROID-042 · P2 · bug · A spoilered video, voice message or file is shown in the clear
- Where: `ui/chat/AttachmentViews.kt:117-170` (`VideoAttachment` never reads `meta.spoiler`), `:173-215` (audio and file rows likewise); web `web/src/components/chat/Attachments.tsx:205` (`VideoPlayer … spoiler={att.spoiler}` blurs the poster)
- What: the sender marked the attachment as a spoiler; on the phone only images honour the flag. A spoilered video shows its poster frame, playable at one tap; a spoilered file shows its name.
- Fix: the same blur-and-pill wrapper `ImageAttachment` uses, around the video poster; a "Spoiler" pill over the name for audio and files until tapped.
- Effort: S
- Status: open

### DROID-043 · P2 · bug · A video that cannot be downloaded turns into a spinner that never ends; a file that cannot be opened says nothing
- Where: `ui/chat/AttachmentViews.kt:146-155` (`runCatching { AttachmentStore.file(meta) }` then `playing = true` regardless), `ui/chat/Players.kt:56-65` (`VideoPlayer` swallows the failure and shows a spinner while `file` is null), `ui/chat/AttachmentViews.kt:192-199` (`openAttachment` failure: the spinner stops, no message), `ui/chat/Players.kt:121` (audio: same silence)
- What: a 404 (blob gone), a 401 mid-refresh, or plain lack of network on the play button flips the box into the player, which asks the store again, fails again, and shows an indefinite spinner over black; there is no message, no retry and no way back to the poster. Files and voice messages fail quietly to the idle state.
- Fix: keep the failure (`readable()`) in state; show it in the box with a "Try again"; only set `playing` when `file()` returned.
- Effort: S
- Status: open

### DROID-044 · P2 · ux · Video plays only inline, in a 340 dp box, with no way to go fullscreen or landscape
- Where: `ui/chat/Players.kt:75-78` (`PlayerView` with the default controller; no `setFullscreenButtonClickListener`, so the controller hides its fullscreen button), `ui/chat/AttachmentViews.kt:130-134`
- What: a landscape video from a phone camera plays in a box the width of the column; the system's rotation does nothing useful because the list is portrait. The web's player has the browser's fullscreen. There is also no share or save for a video (images have the viewer; whether it saves is checked under `ui/sheets/Misc.kt`).
- Fix: `setFullscreenButtonClickListener { Nav.push(Layer.VideoViewer(meta)) }` opening a full-screen layer with the same `ExoPlayer` instance (hand it over rather than re-preparing), landscape allowed there.
- Effort: M
- Status: open

### DROID-045 · P3 · bug · Media playback ignores audio focus and the app's lifecycle; two voice messages can play at once
- Where: `ui/chat/Players.kt:66-73` (`ExoPlayer.Builder(context).build()` with no `setAudioAttributes(…, handleAudioFocus = true)`), `:92-100` (same for audio; one player per row, none shared), no lifecycle observer on either
- What: playing a video or a voice message does not pause the music app underneath; pressing Home leaves a video's sound running in the background; tapping play on a second voice message plays it over the first.
- Fix: `setAudioAttributes(AudioAttributes.Builder().setUsage(USAGE_MEDIA).setContentType(CONTENT_TYPE_MOVIE/SPEECH).build(), true)`; pause on `Lifecycle.Event.ON_STOP`; one shared `ExoPlayer` for voice messages so starting one stops the other.
- Effort: S
- Status: open

### DROID-046 · P3 · bug · A voice message that has played to the end cannot be played again
- Where: `ui/chat/Players.kt:125-126` (`p.play()` on a player in `STATE_ENDED`)
- What: when playback ends `isPlaying` turns false and the button shows Play, but `Player.play()` on an ended player does nothing — the reference controller's own play button does `seekToDefaultPosition()` first (`Util.handlePlayButtonAction`). The row has to be scrolled out and back (which releases the player) to hear it again. Medium confidence: confirm on a device.
- Fix: `if (p.playbackState == Player.STATE_ENDED) p.seekTo(0); p.play()`.
- Effort: S
- Status: open

### DROID-047 · P3 · perf · The audio row polls the player five times a second for as long as it exists, playing or not
- Where: `ui/chat/Players.kt:103-112`
- What: `while (true) { …; delay(200) }` once a file is loaded, paused or ended included. One voice message left on screen is five wakeups a second.
- Fix: poll only while `isPlaying`, and use a `Player.Listener` for the state flips.
- Effort: S
- Status: open

### DROID-048 · P2 · parity · `:shortcode:` emoji typed on the web are literal text on the phone
- Where: `ui/markdown/Parser.kt:180-273` (`inlineLine` has no shortcode rule), `ui/pickers/EmojiIndex.kt:164-176` (the phone expands `:name:` only on its own way out); web `web/src/markdown/parse.ts:31,334-347` (`RE_SHORTCODE` → `shortcodeToEmoji` at render time; nothing expands at send time)
- What: the web stores `:shrug:` as typed and turns it into the emoji while drawing. The phone's parser does not know the form, so every message a web or desktop user typed with shortcodes — a common habit — shows `:shrug:` in plain text on Android. (The reverse is fine: the phone rewrites its own text before sending.)
- Fix: the same rule in `inlineLine`: at `:`, match `:([a-z0-9_+-]{1,60}):`, and if `EmojiIndex.byName` knows it, emit `UnicodeEmoji` (the index is loaded in a quiet moment already; if it is not yet loaded, leave the text).
- Effort: S
- Status: open

### DROID-049 · P2 · bug · A spoiler written `|| like this ||` is hidden on the web and shown in the clear on the phone
- Where: `ui/markdown/Parser.kt:297-336` (`emphasisAt`: the closer is rejected when the character before it is a space, for `|` and `~` as much as for `*`); web `web/src/markdown/parse.ts:383-397,559-579` (`findPair` has no whitespace rule)
- What: `|| the ending ||` (spaces inside the bars, which people type) is a spoiler on the web and desktop and literal text with the bars on the phone. The sender believes it is hidden; every phone reader sees it. Input: `|| Snape kills Dumbledore ||`. The same rule makes `~~ struck ~~` literal on the phone.
- Fix: for `~` and `|`, mirror `findPair` — the first later `||`/`~~` closes, whatever precedes it.
- Effort: S
- Status: open

### DROID-050 · P2 · parity · The phone's emphasis rules differ from the web's on everyday text: underscores in names, a `*` before a space, markers inside code spans
- Where: `ui/markdown/Parser.kt:252-258,297-336`; web `web/src/markdown/parse.ts:362-380,527-557`
- What, with inputs that render differently (web left, phone right):
  - `file_name_here` / `john_doe_99` → web literal (a `_` opener needs a non-word character before it, and its closer a non-word character after); phone: "file*name*here" with "name" in italics. Every identifier and every username with two underscores.
  - `2 * 3 * 4` → web literal (an opener needs a non-space after it); phone: " 3 " in italics.
  - `* not a list*` → web literal; phone: italics.
  - `*see `a*b` here*` → web: one italic run containing the code span (markers inside backticks are skipped); phone: the `*` inside the code closes the run early.
  - `_a_b` → web literal; phone: "a" italic, then "b".
- Fix: port `canOpen` (non-space after the opener; for `_` no word character before), the `_` word-boundary rule on the closer, and `skipCode` in the closer search. The web's `failed` memo would also make the phone's search linear (today `* * * * …` is quadratic on the main thread — 8 000 characters of it is tens of milliseconds per row).
- Effort: S
- Status: open

### DROID-051 · P2 · parity · A blank line between paragraphs disappears on the phone
- Where: `ui/markdown/Parser.kt:147-151` (a blank line flushes and is dropped), `ui/markdown/Render.kt:114-121` (blocks stack with no gap); web `web/src/markdown/parse.ts:215-220` (a blank line is a paragraph line, so `br` `br` renders an empty line)
- What: `first paragraph\n\nsecond paragraph` shows an empty line between them on the web and desktop; on the phone the two are stacked with no gap, so a message written in paragraphs reads as one block. Input: any message with a blank line.
- Fix: keep blank lines in the paragraph as the web does (the web's paragraph model), or give consecutive paragraphs a one-line gap.
- Effort: S
- Status: open

### DROID-052 · P3 · parity · Quotes on the phone parse headings, lists and fences inside them; the web keeps a quote's body inline
- Where: `ui/markdown/Parser.kt:107-128` (`blocks(quoted)`), `:107` (`>>>` needs a trailing space; a bare `>>>` line is not a quote); web `web/src/markdown/parse.ts:157-173` (`parseInline` for both forms; `>>>` alone on a line starts one)
- What: `> # Title` is a quote containing the literal "# Title" on the web and a quote containing a heading on the phone; `> - a` likewise (text vs. a bullet). `>>>` on a line by itself followed by text is a quote of everything after it on the web and a literal ">>>" paragraph on the phone.
- Fix: parse a quote's body with `inline(...)`; accept the bare `>>>`.
- Effort: S
- Status: open

### DROID-053 · P3 · parity · Keycaps, ©/®, clocks and arrows are not emoji on the phone
- Where: `ui/markdown/Parser.kt:260-266` (the emoji rule only runs for `c.code > 0x1000` or a high surrogate), `:29-36` (the class omits 231A–231B, 2328, 23CF, 23E9–23F3, 23F8–23FA, 24C2, 25AA–25AB, 25B6, 25C0, 25FB–25FE); web `web/src/markdown/parse.ts:44-45,349-360` (`\p{Extended_Pictographic}`, tried from `#`, `*`, digits and `©` up)
- What: `1️⃣`, `#️⃣`, `©️`, `⌚`, `⏰`, `▶️`, `◀️`, `⏸️` are Twemoji on the web (and jumbo when alone) and the phone's system glyph at text size. Input: `⏰ 5 minutes` or a message of just `1️⃣`.
- Fix: run the emoji rule for digits, `#`, `*` and any code ≥ 0xA9 as the web does; add the missing ranges to `RE_EMOJI`.
- Effort: S
- Status: open

### DROID-054 · P3 · parity · Remaining parser divergences (each with an input)
- Where: `ui/markdown/Parser.kt`; web `web/src/markdown/parse.ts`
- What:
  - URL trimming: `https://en.wikipedia.org/wiki/Foo_(bar)` — the web keeps a balanced `)` (`trimUrl`, `:582-616`), the phone strips every trailing `)` (`:240`), so the link 404s. Common with Wikipedia.
  - Backtick runs: `` ``a` `` — the web needs a closing run of the same length (`findBacktickClose`), the phone accepts any longer run, then re-parses leftovers one backtick at a time (`:209-218`).
  - Escapes: `\ ` or `\é` — the web escapes ASCII punctuation only (`RE_PUNCT`); the phone drops the backslash before any non-alphanumeric (`:203-207`).
  - `@everyone`/`@here` after a word character: `me@here.com` — the web needs a non-word character before `@`; the phone makes a mention chip inside the address (`:246-250`).
  - Lists: `- a\n    - b` — the web nests only at exactly two spaces and treats four as top level; the phone indents by `indent / 2` levels (`:130-145`), and every depth change starts a new list with its own 4 dp gaps.
  - After a fence closes mid-line: ` ```x```# h ` — the web treats "# h" as paragraph text (`atLineStart = false`); the phone re-runs `blocks()` on it and makes a heading (`:85-87`).
  - `\r\n` and leading newlines: the web normalises (`normalize`); the phone does not (harmless today, since both composers send `\n`).
- Fix: port the corresponding rules; a shared fixture file of inputs run by both `parse.test.ts` and a Kotlin test is the durable fix (see the tests section).
- Effort: M
- Status: open

### DROID-055 · P2 · parity · A link sent from the phone never gets a preview, on any client
- Where: `net/Endpoints.kt:407` (`MiscApi.unfurl` exists and has no caller), `ui/markdown/Parser.kt:345-348` (`Markdown.links` exists and has no caller), `data/MessageService.kt:230-312` (`send` takes `embeds` only from the GIF and sticker paths), `ui/chat/Composer.kt:175-235`; web `web/src/components/composer/linkPreviews.ts`, `web/src/components/composer/send.ts:15` (`extractUrls` → `/unfurl` → the embed rides inside the ciphertext)
- What: previews are made by the sender ("the server never makes one"), and the phone's sender makes none. A YouTube link, an article, a tweet posted from the phone is a bare URL everywhere — the web renders the same link with a card when it was posted from the web.
- Impact: every link from the phone, on every reader.
- Fix: at send time, `extractUrls` over the parsed tree — as the web does, skipping spoilers, code and `<…>` — `MiscApi.unfurl` each (max 5), and pass the results as `embeds`; the composer shows "Loading preview…" or sends without when unfurl fails. Note for the implementer: do not use `Markdown.links` (a regex over raw text) — it would preview URLs inside spoilers and code blocks, which reveals the spoiler to everyone.
- Effort: M
- Status: open

### DROID-056 · P2 · security · A masked link cannot be inspected before it is opened
- Where: `ui/markdown/Render.kt:482-486` (a tap opens `node.url` at once; no long press, no label showing the target), `ui/chat/MessageRow.kt:317-329` (`openLink`); web `web/src/markdown/render.tsx:190` (`title={url}` on hover)
- What: `[chat.evilion.xyz/settings](https://evil.example/login)` reads as a link to the site; on the phone there is no way to see where it goes before tapping, and tapping opens it in the browser. The web at least shows the target on hover; Discord asks "Leaving Nexa? This link takes you to …" for a masked link whose text is not its target.
- Fix: for `masked` links whose text is not the URL's host, open a small dialog with the real URL and "Open"/"Copy"/"Cancel" (`chat.chat.leavingNexa`-style copy shared with the web, which should get the same dialog); a long press on any link copies it.
- Effort: S
- Status: open

### DROID-057 · P3 · bug · A mention rendered before the name was known keeps saying `@unknown-user`
- Where: `ui/markdown/Render.kt:264-273` (`remember(nodes, revealed, colors, style, edited)` — `ctx` is not a key), `ui/chat/MessageRow.kt:290-315` (`rememberMdContext` makes a new context when the user/channel maps grow)
- What: the annotated string is built once per message text. When the member list, a DM's user or a channel arrives after the row first drew (a cold start, a jump into old history, the first page of a big server), the row recomposes with a fresh `ctx` but the string is not rebuilt, so the chip stays "@unknown-user" / "#deleted-channel" until the message text changes — i.e. never.
- Fix: add `ctx` to the `remember` keys (it is a data class, so equality is by content).
- Effort: S
- Status: open

### DROID-058 · P2 · bug · In right-to-left text the chips behind spoilers, inline code and mentions are not drawn — an Arabic spoiler is invisible with nothing to tap
- Where: `ui/markdown/Render.kt:373-405` (`drawChip`: `left = getBoundingBox(from).left`, `right = getBoundingBox(to - 1).right`, `if (right <= left) continue`), `:455-469` (a hidden spoiler's text is transparent; only the chip shows where it is)
- What: for a right-to-left run the first logical character sits at the visual right and the last at the visual left, so `right - left` is negative and the chip is skipped. Inline code in Arabic, Hebrew or Persian has no box; a mention has no background; a spoiler — transparent text plus no box — leaves an empty gap in the sentence with no visible thing to tap (the link annotation is still there, invisible). Medium confidence: from the geometry; the `ux-walkthrough` agent can confirm with an Arabic `||سر||`.
- Fix: per line, take `min`/`max` over the bounding boxes of `from` and `to - 1` (or use `getBoundingBox` of every character in the run — runs are short), and handle bidi runs that split within a line by iterating `getHorizontalPosition` for both directions.
- Effort: S
- Status: open

### DROID-059 · P3 · a11y · Emoji placeholders are sized in sp while the pictures are in dp, so at a large font size every emoji has a gap around it; jumbo emoji do not scale at all
- Where: `ui/markdown/Render.kt:281,292` (`Placeholder((glyph.value + 2).sp, …)` with `glyph` a `Dp`), `:336` (`Modifier.size(size)` in dp), `ui/chat/MessageRow.kt:212-219` (48/36/28 dp jumbo sizes)
- What: at the system's 200 % font size a 22 dp emoji sits in a 48 sp placeholder — a hole twice its size in every line that has one — and a message of three emoji stays 48 dp while the text around it doubled.
- Fix: size both in the same unit (`with(density) { glyph.toSp() }` for the placeholder), and derive jumbo sizes from the text style's font size.
- Effort: S
- Status: open

### DROID-060 · P3 · a11y · TalkBack reads a hidden spoiler aloud
- Where: `ui/markdown/Render.kt:455-469` (the hidden text is transparent but present in the `AnnotatedString`)
- What: a screen reader speaks the spoiler's content without any "spoiler" cue, revealed or not. The web's `plainText` substitutes "[spoiler]" for replies and notifications; the renderer should do the equivalent for semantics.
- Fix: while hidden, replace the run with "[spoiler]" (or `t("chat.messageItem.spoiler")`) in the string and keep the chip; reveal swaps the real text in.
- Effort: S
- Status: open

### DROID-061 · P3 · bug · The sheet offers "Pin" to authors who cannot pin, and the server's English refusal is the answer
- Where: `ui/chat/MessageActions.kt:168-178` (`if (canManage || mine)`), server `internal/api/server_glue.go:18` (`NeedPin` needs Manage Messages in a server channel); web `web/src/components/chat/messageMenu.ts:36-40` (`canPin`: DM → yes, server → `MANAGE_MESSAGES`)
- What: in a server channel an ordinary member sees "Pin" on their own message, taps it, and gets a toast "You do not have permission to do that here." — the server's sentence, untranslated.
- Fix: `if (canManage || channel.isDm)`, as the web does.
- Effort: S
- Status: open
