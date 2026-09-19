# Progress — android
State: auditing
Last checkpoint: 2026-09-18T12:55Z
Next finding id: 011

## Inspected

Build and manifest:
- [ ] android/app/src/main/AndroidManifest.xml
- [ ] android/app/build.gradle.kts
- [ ] android/build.gradle.kts
- [ ] android/settings.gradle.kts
- [ ] android/gradle.properties
- [ ] android/app/proguard-rules.pro
- [ ] android/README.md

App shell:
- [ ] android/app/src/main/java/xyz/evilion/chat/App.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/MainActivity.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/Nav.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/Detached.kt

Data:
- [ ] android/app/src/main/java/xyz/evilion/chat/data/Session.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/SecureStore.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/AppState.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt

Net:
- [ ] android/app/src/main/java/xyz/evilion/chat/net/ApiClient.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/net/Endpoints.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/net/Gateway.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/net/Models.kt

Data (rest):
- [ ] android/app/src/main/java/xyz/evilion/chat/data/MessageService.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/KeyService.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/KeyPins.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/Perms.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/Errors.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/InviteLink.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/Captcha.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/CrashReport.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/AppUpdate.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/data/WebEngines.kt

Crypto:
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Aes.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Bytes.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Conv.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/FileCrypto.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Fingerprint.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Identity.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/Kdf.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/crypto/MessageCrypto.kt

Media:
- [ ] android/app/src/main/java/xyz/evilion/chat/media/AttachmentStore.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/media/CoilSetup.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/media/Media.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/media/MediaLinks.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/media/Twemoji.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/media/Uploads.kt

Service and notifications:
- [ ] android/app/src/main/java/xyz/evilion/chat/service/Services.kt (message-socket parts only)
- [ ] android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt

UI foundations:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/theme/Theme.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/common/Common.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/common/TwemojiImage.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/icons/Lucide.kt

UI main:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/main/MainScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt

UI chat:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageActions.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/AttachmentViews.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/Players.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/chat/SwipeToReply.kt

UI markdown (+ web parser for parity):
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Ast.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Parser.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Render.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/markdown/Highlight.kt
- [ ] web/src/markdown/parse.ts (read-only reference)

UI pickers:
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/EmojiIndex.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/EmojiTab.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionCells.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionSheet.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/pickers/ExpressionState.kt
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
- [ ] android/app/src/main/res/values/strings.xml
- [ ] android/app/src/main/res/values/themes.xml
- [ ] android/app/src/main/res/values/colors.xml
- [ ] android/app/src/main/res/values-night/colors.xml
- [ ] android/app/src/main/res/xml/data_extraction_rules.xml
- [ ] android/app/src/main/res/xml/file_paths.xml
- [ ] android/app/src/main/res/xml/network_security_config.xml
- [ ] android/app/src/main/res/drawable/*.xml (ic_launcher_background, ic_launcher_foreground, ic_launcher_monochrome, ic_notification, nexa_mark)
- [ ] android/app/src/main/res/mipmap-anydpi-v26/*.xml
- [ ] android/app/src/main/res/drawable-*dpi/nexa_wordmark.png (presence only)
- [ ] android/app/src/main/assets/emoji.tsv (format only)

Tests:
- [ ] android/app/src/test/java/xyz/evilion/chat/AppUpdateTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/MediaLinksTest.kt
- [ ] android/app/src/test/java/xyz/evilion/chat/i18n/PickTest.kt

Tools:
- [ ] tools/android_i18n.py
- [ ] tools/publish_android.py

Round 1 cross-check:
- [ ] audit/REVIEW.md (Done / Not doing / Still open for Android)
- [ ] audit/android-correctness.md (skim)
- [ ] audit/android-ui.md (skim)
- [ ] audit/android-expression-picker.md (skim)
- [ ] audit/product-gaps.md (Android column)

## Handoff note
Fresh start 2026-09-18. Nothing inspected yet. Reading order per BRIEF.md:
manifest/build → App/MainActivity/Nav/Detached → Session/SecureStore/AppState/SettingsStore → net → data rest → crypto → media → service/notify → ui.
