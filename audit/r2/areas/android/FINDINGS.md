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
