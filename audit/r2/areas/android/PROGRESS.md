# Progress — android
State: auditing
Last checkpoint: 2026-09-19T05:24Z
Next finding id: 062

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
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionCells.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionSheet.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionState.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/Expressions.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/GifTab.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/StickerTab.kt

UI sheets:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/ChannelSheets.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Dismiss.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/KeyVerify.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Layers.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/Misc.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/sheets/ProfileSheet.kt

UI settings / server:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/settings/SettingsScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/server/ServerSettingsScreen.kt

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
Third agent. ui/chat/* and ui/markdown/* done (022-061). Pending: DROID-062 to write = scrolling past a video downloads and decrypts the whole file for its poster (CoilSetup.kt:74-82 AttachmentFetcher -> AttachmentStore.file; AttachmentViews.kt:138-143 AsyncImage(model = meta) for videos) — confirm the web's approach in VideoPlayer.tsx first. DROID-031 still needs a Where line for MessageActions.kt:122-131 (26 dp icon). Next: ExpressionCells, ExpressionSheet, Expressions, GifTab, StickerTab, then sheets/*.