# Progress — android
State: auditing
Last checkpoint: 2026-09-19T10:46Z
Next finding id: 085

## Inspected

Build and manifest:
- [x] android/app/src/main/AndroidManifest.xml
- [x] android/app/build.gradle.kts
- [x] android/build.gradle.kts
- [x] android/settings.gradle.kts
- [x] android/gradle.properties
- [x] android/app/proguard-rules.pro
- [x] android/README.md

App shell:
- [x] android/app/src/main/java/xyz/evilion/chat/App.kt
- [x] android/app/src/main/java/xyz/evilion/chat/MainActivity.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/Nav.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/Detached.kt

Data:
- [x] android/app/src/main/java/xyz/evilion/chat/data/Session.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/SecureStore.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/AppState.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt

Net:
- [x] android/app/src/main/java/xyz/evilion/chat/net/ApiClient.kt
- [x] android/app/src/main/java/xyz/evilion/chat/net/Endpoints.kt
- [x] android/app/src/main/java/xyz/evilion/chat/net/Gateway.kt
- [x] android/app/src/main/java/xyz/evilion/chat/net/Models.kt

Data (rest):
- [x] android/app/src/main/java/xyz/evilion/chat/data/MessageService.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/KeyService.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/KeyPins.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/Perms.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/Errors.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/InviteLink.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/Captcha.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/CrashReport.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/AppUpdate.kt
- [x] android/app/src/main/java/xyz/evilion/chat/data/WebEngines.kt

Crypto:
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Aes.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Bytes.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Conv.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/FileCrypto.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Fingerprint.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Identity.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/Kdf.kt
- [x] android/app/src/main/java/xyz/evilion/chat/crypto/MessageCrypto.kt

Media:
- [x] android/app/src/main/java/xyz/evilion/chat/media/AttachmentStore.kt
- [x] android/app/src/main/java/xyz/evilion/chat/media/CoilSetup.kt
- [x] android/app/src/main/java/xyz/evilion/chat/media/Media.kt
- [x] android/app/src/main/java/xyz/evilion/chat/media/MediaLinks.kt
- [x] android/app/src/main/java/xyz/evilion/chat/media/Twemoji.kt
- [x] android/app/src/main/java/xyz/evilion/chat/media/Uploads.kt

Service and notifications:
- [x] android/app/src/main/java/xyz/evilion/chat/service/Services.kt (message-socket parts only)
- [x] android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt

UI foundations:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/theme/Theme.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/common/Common.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/common/TwemojiImage.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/icons/Lucide.kt

UI main:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/main/MainScreen.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt

UI chat:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageActions.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/AttachmentViews.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/Players.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/chat/SwipeToReply.kt

UI markdown (+ web parser for parity):
- [x] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Ast.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Parser.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Render.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Highlight.kt
- [x] web/src/markdown/parse.ts (read-only reference)

UI pickers:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/EmojiIndex.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/EmojiTab.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionCells.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionSheet.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionState.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/Expressions.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/GifTab.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/StickerTab.kt

UI sheets:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/ChannelSheets.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Dismiss.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/KeyVerify.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Layers.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Misc.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/sheets/ProfileSheet.kt

UI settings / server:
- [x] android/app/src/main/java/xyz/evilion/chat/ui/settings/SettingsScreen.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/server/ServerSettingsScreen.kt

UI auth / invite / friends:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/auth/AuthScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/auth/RecoveryKeyOverlay.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/invite/InviteScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/friends/FriendsScreen.kt

i18n and resources:
- [ ] android/app/src/main/java/xyz/evilion/chat/i18n/Strings.kt
- [x] android/app/src/main/res/values/strings.xml
- [x] android/app/src/main/res/values/themes.xml
- [x] android/app/src/main/res/values/colors.xml
- [x] android/app/src/main/res/values-night/colors.xml
- [x] android/app/src/main/res/xml/data_extraction_rules.xml
- [x] android/app/src/main/res/xml/file_paths.xml
- [x] android/app/src/main/res/xml/network_security_config.xml
- [ ] android/app/src/main/res/drawable/*.xml (ic_launcher_background, ic_launcher_foreground, ic_launcher_monochrome, ic_notification, nexa_mark)
- [x] android/app/src/main/res/mipmap-anydpi-v26/*.xml
- [ ] android/app/src/main/res/drawable-*dpi/nexa_wordmark.png (presence only)
- [ ] android/app/src/main/assets/emoji.tsv (format only)

Tests:
- [ ] android/app/src/test/java/xyz/evilion/chat/AppUpdateTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/MediaLinksTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/i18n/PickTest.kt

Tools:
- [x] tools/android_i18n.py
- [x] tools/publish_android.py

Round 1 cross-check:
- [x] audit/REVIEW.md (Done / Not doing / Still open for Android)
- [ ] audit/android-correctness.md (skim)
- [ ] audit/android-ui.md (skim)
- [ ] audit/android-expression-picker.md (skim)
- [ ] audit/product-gaps.md (Android column)

## Handoff note
Fourth agent. Pickers, sheets, settings, server settings done (062-079). AuthScreen, RecoveryKeyOverlay, InviteScreen, FriendsScreen READ, findings not yet written: (a) P2 ux: no autofill hints on sign-in/register (password managers cannot fill/save) — check Compose BOM >= 1.8 for ContentType; (b) P3: username/recovery-key fields have autocorrect on; (c) P2 i18n: inline English "a conversation", "N members · N online" (InviteScreen.kt:85,92), "N members"/"N channels"/"N uses of M" (ServerSettingsScreen.kt:132-133,412) — tools/android_i18n.py --dry says 6 strings in 2 files; (d) P2 i18n: FriendsScreen.kt:178 shows raw presence "Online"/"Idle"/"Dnd" capitalised; (e) InviteScreen: group-DM invite → joined.server may be null (check JoinedServer model + server invite handler); no "already a member" state; (f) DROID-074 Where lines for FriendsScreen.kt:185-206; DROID-031 Where for FriendsScreen ActionIcon 36 dp, "Send" text, KeyVerify.kt:119-128, Misc.kt:133-138, ChannelSheets.kt:404-407, ServerSettingsScreen.kt:350-361,379-389, SettingsScreen.kt:285-296; DROID-004 Where for inline error lines (AuthScreen.kt:315-318, FriendsScreen.kt:147-149). Still to check: whether the phone can block anyone at all (grep RelationshipsApi.block) → if not, P1 safety finding. Next: Strings.kt, drawables, emoji.tsv, tests, round-1 skim, then Summary.