# Brief — android (finding prefix `DROID`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

The native Android app, except calls:

```
android/app/build.gradle.kts  android/build.gradle.kts  android/settings.gradle.kts
android/app/proguard-rules.pro
android/app/src/main/AndroidManifest.xml
android/app/src/main/res/**            (drawables, mipmaps, values, values-night, xml)
android/app/src/main/java/xyz/evilion/chat/
  App.kt  MainActivity.kt
  crypto/    Aes Bytes Conv FileCrypto Fingerprint Identity Kdf MessageCrypto
  data/      AppState AppUpdate Captcha CrashReport Errors InviteLink KeyPins KeyService
             MessageService Perms SecureStore Session SettingsStore WebEngines
  i18n/      Strings.kt
  media/     AttachmentStore CoilSetup Media MediaLinks Twemoji Uploads
  net/       ApiClient Endpoints Gateway Models
  notify/    Notifications.kt
  service/   Services.kt          (the message-socket foreground service; the call service parts are `voice`'s)
  ui/        Detached Nav
  ui/auth/   AuthScreen RecoveryKeyOverlay
  ui/chat/   AttachmentViews ChatScreen Composer MessageActions MessageRow Players SwipeToReply
  ui/common/ Common TwemojiImage      (HangUp is `voice`'s)
  ui/friends/ FriendsScreen
  ui/icons/  Lucide.kt
  ui/invite/ InviteScreen
  ui/main/   MainScreen Sidebar
  ui/markdown/ Ast Highlight Parser Render
  ui/pickers/ EmojiIndex EmojiTab ExpressionCells ExpressionSheet ExpressionState Expressions GifTab StickerTab
  ui/server/ ServerSettingsScreen
  ui/settings/ SettingsScreen
  ui/sheets/ ChannelSheets Dismiss KeyVerify Layers Misc ProfileSheet
  ui/theme/  Theme.kt
android/app/src/test/            AppUpdateTest CryptoTest MediaLinksTest i18n/PickTest
tools/android_i18n.py  tools/publish_android.py (what it checks; the release path is desktop-release's)
```

Out of scope: `voice/*`, `ui/voice/*`, `ui/common/HangUp.kt`, `cpp/*`
(`voice`).

## What this area is

A Kotlin + Jetpack Compose app, 1.0.3 live (versionCode 4, minSdk ~26?,
compileSdk 37), no web view except Cloudflare's captcha. OkHttp for the API
and the gateway; a foreground service holds the socket while the app is
closed because there is no push service; libwebrtc for calls. The same E2EE
as the web client (argon2id, x25519 sealed boxes, AES-256-GCM messages,
settings and chunked files), with tests against ciphertext the web client
produced; identity and conversation keys in a file encrypted under a
keystore key (`SecureStore`). Coil for images (the media proxy quirk:
"/media/proxy/…" must not be taken for a file). A markdown parser and
renderer of its own (`ui/markdown`) that must agree with the web's. One
expression sheet for emoji/GIFs/stickers. Strings come from the shared
catalogue (`web/src/i18n/locales/*.json`, read by `i18n/Strings.kt`).
Eleven languages, RTL. The in-app updater (`AppUpdate.kt`) reads the
published manifest; per-ABI APKs exist.

The owner's yardstick is the web client: the phone should read like it,
and where the phone has a better idiom (swipe to reply, sheets), the phone
should use it.

## Checklist

Crashes and lifecycle:
- Every `!!`, unchecked cast, `first()`, index, `toInt()` on untrusted
  input; coroutine scopes tied to compositions that are gone (round 1's
  bottom-sheet pattern — verify every sheet uses the fix); exceptions in
  `LaunchedEffect`/`rememberCoroutineScope` swallowed or crashing;
  `MainActivity` recreation on rotation/theme change/locale change (state
  hoisted? uploads survive? the composer draft?), process death and restore
  (what is lost — a half-typed message, a pending upload, the current
  channel?), the `Detached` path, low-memory behaviour, Android 8–12 API
  differences (round 1's `readNBytes`), the R8 config (`proguard-rules.pro`:
  what else could R8 strip — reflection in OkHttp/kotlinx, the crypto?),
  `CrashReport.kt` (what it sends: PII? stack only? user consent?).
- The foreground service: start/stop conditions, the notification it must
  show (copy, actions, channel importance), battery (does it hold a wake
  lock? reconnect backoff when the network is gone?), Doze, being killed
  and restarted, Android 14+ foreground service type declarations, the
  "app is running" notification's dismissability, what happens when
  notifications are denied.
- Notifications: channels and importance, grouping, reply action?, mark
  read action?, tapping opens the right channel, badge, sounds, DND, the
  ringing path (`voice`'s), privacy on the lock screen (message text
  shown? setting?), notifications for muted channels, dedupe when the app
  is open.

Data and security:
- `SecureStore`: keystore key parameters (StrongBox? user auth required?
  what happens on biometric change), the file's encryption, backup rules
  (`data_extraction_rules.xml` — keys must never reach cloud backup), what
  is in `SharedPreferences` in plaintext (tokens? settings? drafts?),
  logging of secrets (`Log.d` anywhere near keys/tokens), the network
  security config (cleartext for `10.0.2.2` only in debug?), certificate
  handling, `Captcha.kt`'s WebView (JavaScript enabled, what URL it may
  load, what it exposes).
- `Session.kt` (768 lines): login/register/recover flows, token storage,
  401 handling, logout clearing everything, account switch, the recovery
  key overlay (can it be dismissed unsaved? copy? share sheet?), MFA,
  captcha in each flow.
- `KeyService`/`KeyPins`: same trust model as the web (pin on first sight,
  block on change with side-by-side safety numbers, grant recipient
  cross-check); parity of `Fingerprint.kt` (the shared test vector).
- `MessageService`: send queue (survives leaving the channel — round 1;
  survives process death?), retries, optimistic UI, dedupe against the
  gateway echo, edit/delete, reactions, read markers, catch-up after a
  gap, attachments (encrypt → upload in pieces → message; failure at each
  step; cancel), decryption failures shown honestly.
- `Gateway.kt`: reconnect/backoff, resume, heartbeat, the "first frames
  thrown away" fix, ordering (one coroutine per frame was a bug), queue
  full behaviour, network callbacks.
- `AppUpdate.kt`: manifest parsing, signature/checksum verification before
  install, the per-ABI choice (does the phone download its ABI's APK or the
  universal one?), `REQUEST_INSTALL_PACKAGES` flow, what a failed install
  shows, update prompts' frequency.
- `AppState`: single source of truth? Stale state after resume? Memory
  growth (messages of every channel visited kept forever?).
- `Perms.kt` parity with `internal/perms` and the web's `lib/perms.ts` —
  same bits, same overwrite algorithm, same hierarchy rules.
- `Models.kt`/`Endpoints.kt`: fields the server sends that the app ignores
  (a feature gap) or fields the app expects that the server does not send.

UI and UX (the bulk of it — compare each screen with the web's equivalent,
read-only: `web/src/components/**`, `web/src/pages/**`):
- `MainScreen`/`Sidebar`/`Nav`: navigation model (drawer + back stack —
  does system back do the expected thing at every level?), the rail and
  channel list on a phone, unread/mention badges, presence, DMs, friends,
  the user panel (status, settings), deep links (`InviteLink`,
  `assetlinks`), tabs? (no; is that fine on a phone — yes, say so).
- `ChatScreen`/`MessageRow`/`Composer`: grouping, timestamps, day dividers,
  the unread divider, scroll position on new messages (round 1: a sent
  message landed below the list), pagination both ways, jump to bottom,
  swipe to reply (direction, haptics, threshold, RTL), long-press actions
  sheet (`MessageActions`) parity with the web's context menu (every action
  present? reactions row? copy? select?), reactions (add via `+`, who
  reacted?), replies (quote bar, tap to jump), edits, pins, mentions
  rendering and autocomplete (`@`, `#`, `:`), the composer (attachments,
  paste images, camera/gallery/file pickers, GIF/sticker/emoji sheet, send
  button state, multi-line, IME actions, drafts per channel, slowmode),
  the keyboard/insets handling (`WindowInsets.ime`, edge-to-edge on
  Android 15 — is `enableEdgeToEdge` used and are insets consumed
  correctly on every screen?), typing indicator, link previews.
- `AttachmentViews`/`Players`: image sizing, spoilers, tap to open (zoom?
  save to gallery? share?), video (inline player, fullscreen, controls,
  encrypted streaming — is the whole file decrypted to disk first? where?
  cleaned up?), audio, generic files (open with?), progress, failures,
  the proxy-refresh path for old link previews.
- `ui/markdown/Render.kt`: parity with the web's `render.tsx` for every
  node (headings, subtext, quotes, lists, code with highlighting
  (`Highlight.kt`), spoilers, timestamps, mentions, emoji sizing, links);
  `Parser.kt` vs. `web/src/markdown/parse.ts` — list every divergence,
  with an input that shows it. `tools/device/seed.py` posts one message of
  every kind; the `ux-walkthrough` agent will screenshot them on both
  platforms — you read the code.
- Pickers (`ui/pickers/*`, round 1's redesign): search, categories,
  recents, skin tones, GIF search and favourites, sticker packs, sheet
  height and keyboard interplay, performance (`EmojiIndex`, `Twemoji`).
- `SettingsScreen` (793 lines) and `ServerSettingsScreen` (488): every
  setting the web has — present, missing (parity), or different; saves
  (round 1: they never saved — verify the CAS fix), theme (`Theme.kt`:
  dynamic colour? accent parity with the web's tokens; the launch screen
  theme), language, notifications, security (MFA, sessions, safety number,
  recovery key, app lock — does Android have one? biometric?), privacy,
  account deletion, export (parity: the web has a zip export).
- `AuthScreen`/`RecoveryKeyOverlay`/`InviteScreen`/`FriendsScreen`: flows,
  errors, captcha, autofill hints (`AutofillType`), password managers,
  keyboard actions, the first-run experience.
- Sheets (`ui/sheets/*`, `Layers`, `Dismiss`): dismiss semantics, back
  button, scrim, keyboard, nested sheets, `KeyVerify`/`ProfileSheet` parity
  with the web's profile card.
- Compose quality: recomposition hot spots (`LazyColumn` keys and
  `contentType`, unstable lambdas/params on every row, `derivedStateOf`
  where needed, images decoded at display size), `Modifier` order bugs,
  `Common.kt` primitives reused vs. hand-rolled copies, semantics
  (`contentDescription` on every icon-only control — grep for
  `contentDescription = null` and judge each), touch targets 48 dp,
  TalkBack order, RTL (`LayoutDirection`, `Icons.AutoMirrored`, `start`/
  `end` paddings), font scaling (does the layout survive 200 % font size?),
  dark/light parity, `values-night`, splash/launch, the icon
  (monochrome/adaptive — present), predictive back (Android 14+).
- Strings: any inline English left (`tools/android_i18n.py --dry` finds
  them), plurals, formatting of dates/times/numbers in the app locale,
  string keys used that differ in meaning from the web's use of the same
  key.

Build and release hygiene (the publish path itself is `desktop-release`'s):
- `build.gradle.kts`: versions, `minSdk`, ABI splits, `isMinifyEnabled`,
  `isShrinkResources`, debug vs release differences that can hide bugs
  (round 1's R8 crash), dependency versions with known issues, the
  `serverUrl` property, signing config failing without the keystore
  (verify), `compileSdkMinor`.
- The manifest: permissions and whether each is used (`READ_MEDIA_*`,
  `POST_NOTIFICATIONS` request flow, `FOREGROUND_SERVICE_*` types,
  `REQUEST_INSTALL_PACKAGES`), exported components, intent filters
  (`assetlinks` domain), `allowBackup`, `usesCleartextTraffic`.
- Tests: what exists (4 files) vs. what should — parser parity, Perms
  parity, Gateway ordering, MessageService queue, SecureStore.

## Round 1

`audit/REVIEW.md`, `audit/android-correctness.md` (71, 4 CRASH, 4
DATA-LOSS), `audit/android-ui.md` (74, 15 BROKEN — round 1 said these were
"still open beyond the calls work"; each is either fixed since or a finding
now), `audit/android-expression-picker.md` (the design that was built —
check it against what shipped), `audit/product-gaps.md` (the parity
matrix: "Android is a read-and-chat client" — what has changed since, what
has not).

## Facts you would otherwise rediscover

- Toolchain: `source ~/.local/toolchain/env.sh` (JDK 21, Gradle 9.7.1,
  SDK at `/usr/local/share/android-commandlinetools`). AGP 9 has Kotlin
  built in; do not apply `org.jetbrains.kotlin.android`. `gradle
  :app:compileDebugKotlin -q` compiles; `gradle :app:testDebugUnitTest -q`
  tests; `gradle --stop` afterwards, always. Do not start the emulator
  (the `ux-walkthrough` agent owns it).
- 1.0.3 fixed: calls surviving network changes (`voice`), link-preview
  pictures (Coil vs. "/media/proxy/…"), swipe to reply direction and RTL,
  sent messages landing below the list, the launch screen theme,
  `readNBytes` on Android 8–12.
- Round 1's "Done" for Android: sheet actions racing their own
  cancellation, settings never saving (CAS version), the gateway's first
  frames dropped, events raced per frame, catch-up after a gap, the `+`
  on the reaction row, the unified picker, the in-app updater.
- Known open from round 1: per-ABI APKs published but never offered by the
  web download page (that page is `web-shell-ui`'s; the app's own updater
  choosing an ABI is yours).
- The Android signing key exists only on this Mac (not code; do not chase).

## Reading order

`AndroidManifest.xml`, `build.gradle.kts`, `proguard-rules.pro` → `App.kt`,
`MainActivity.kt`, `ui/Nav.kt`, `ui/Detached.kt` → `data/Session.kt`,
`SecureStore.kt`, `AppState.kt`, `SettingsStore.kt` → `net/*` →
`data/MessageService.kt`, `KeyService.kt`, `KeyPins.kt`, `Perms.kt`,
`Errors.kt`, `InviteLink.kt`, `Captcha.kt`, `CrashReport.kt`,
`AppUpdate.kt`, `WebEngines.kt` → `crypto/*` → `media/*` → `service/*`,
`notify/*` → `ui/theme`, `ui/common`, `ui/icons` → `ui/main/*` →
`ui/chat/*` → `ui/markdown/*` (+ the web parser) → `ui/pickers/*` →
`ui/sheets/*` → `ui/settings`, `ui/server` → `ui/auth`, `ui/invite`,
`ui/friends` → `i18n/Strings.kt`, `res/**` → the tests →
`tools/android_i18n.py`.
