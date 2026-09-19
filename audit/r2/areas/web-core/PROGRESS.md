# Progress — web-core
State: audit-done
Last checkpoint: 2026-09-19T05:20Z
Next finding id: 030

## Inspected

### Entry / config
- [x] web/src/main.tsx
- [x] web/src/App.tsx
- [x] web/src/routes.tsx
- [x] web/index.html
- [x] web/vite.config.ts
- [x] web/vitest.config.ts
- [x] web/tsconfig.json
- [x] web/package.json
- [x] web/scripts/deploy-guard.mjs
- [x] web/public/manifest.webmanifest
- [x] web/src/vite-env.d.ts
- [x] web/src/smoke.test.ts
- [x] web/src/sw.ts
- [x] web/src/download-sw.ts

### api/
- [x] web/src/api/client.ts
- [x] web/src/api/client.test.ts
- [x] web/src/api/types.ts
- [x] web/src/api/index.ts
- [x] web/src/api/activities.ts
- [x] web/src/api/admin.ts
- [x] web/src/api/android.ts
- [x] web/src/api/auth.ts
- [x] web/src/api/auth.test.ts
- [x] web/src/api/channels.ts
- [x] web/src/api/channels.test.ts
- [x] web/src/api/desktop.ts
- [x] web/src/api/expressions.ts
- [x] web/src/api/guests.ts
- [x] web/src/api/keys.ts
- [x] web/src/api/messages.ts
- [x] web/src/api/messages.test.ts
- [x] web/src/api/relationships.ts
- [x] web/src/api/relationships.test.ts
- [x] web/src/api/servers.ts
- [x] web/src/api/testing.ts
- [x] web/src/api/unfurl.ts
- [x] web/src/api/uploads.ts
- [x] web/src/api/users.ts
- [x] web/src/api/users.test.ts
- [x] web/src/api/voice.ts

### crypto/
- [x] web/src/crypto/index.ts
- [x] web/src/crypto/index.test.ts
- [x] web/src/crypto/aes.ts
- [x] web/src/crypto/bytes.ts
- [x] web/src/crypto/bytes.test.ts
- [x] web/src/crypto/conv.ts
- [x] web/src/crypto/conv.test.ts
- [x] web/src/crypto/file.ts
- [x] web/src/crypto/file.test.ts
- [x] web/src/crypto/fileChunks.ts
- [x] web/src/crypto/fingerprint.ts
- [x] web/src/crypto/fingerprint.test.ts
- [x] web/src/crypto/kdf.ts
- [x] web/src/crypto/kdf.test.ts
- [x] web/src/crypto/keys.ts
- [x] web/src/crypto/keys.test.ts
- [x] web/src/crypto/keystore.ts
- [x] web/src/crypto/keystore.test.ts
- [x] web/src/crypto/message.ts
- [x] web/src/crypto/message.test.ts
- [x] web/src/crypto/streamDecrypt.ts
- [x] web/src/crypto/streamDecrypt.test.ts

### stores/
- [x] web/src/stores/auth.ts
- [x] web/src/stores/auth.test.ts
- [x] web/src/stores/keys.ts
- [x] web/src/stores/keys.test.ts
- [x] web/src/stores/messages.ts
- [x] web/src/stores/messages.test.ts
- [x] web/src/stores/channels.ts
- [x] web/src/stores/servers.ts
- [x] web/src/stores/servers.test.ts
- [x] web/src/stores/users.ts
- [x] web/src/stores/relationships.ts
- [x] web/src/stores/readStates.ts
- [x] web/src/stores/readStates.test.ts
- [x] web/src/stores/settings.ts
- [x] web/src/stores/settings.test.ts
- [x] web/src/stores/settings.slowstart.test.ts
- [x] web/src/stores/ui.ts
- [x] web/src/stores/ui.test.ts
- [x] web/src/stores/panes.ts
- [x] web/src/stores/presence.ts
- [x] web/src/stores/typing.ts
- [x] web/src/stores/selection.ts
- [x] web/src/stores/selection.test.ts
- [x] web/src/stores/expressions.ts
- [x] web/src/stores/expressions.test.ts
- [x] web/src/stores/slowmode.ts
- [x] web/src/stores/keyAlerts.ts
- [x] web/src/stores/desktop.ts
- [x] web/src/stores/serverNav.ts

### gateway/
- [x] web/src/gateway/client.ts
- [x] web/src/gateway/client.test.ts
- [x] web/src/gateway/dispatch.ts
- [x] web/src/gateway/dispatch.test.ts
- [x] web/src/gateway/events.ts
- [x] web/src/gateway/session.ts

### lib/ (callLayout, callPanel, audioKeeper are `voice`'s)
- [x] web/src/lib/attachments.ts
- [x] web/src/lib/attachments.test.ts
- [x] web/src/lib/upload.worker.ts
- [x] web/src/lib/download.ts
- [x] web/src/lib/mediaLinks.ts
- [x] web/src/lib/mediaLinks.test.ts
- [x] web/src/lib/mediaCache.ts
- [x] web/src/lib/mediaCache.test.ts
- [x] web/src/lib/keyPins.ts
- [x] web/src/lib/keyPins.test.ts
- [x] web/src/lib/keyring.ts
- [x] web/src/lib/appLock.ts
- [x] web/src/lib/appLock.test.ts
- [x] web/src/lib/storage.ts
- [x] web/src/lib/notify.ts
- [x] web/src/lib/notify.test.ts
- [x] web/src/lib/sounds.ts
- [x] web/src/lib/sounds.test.ts
- [x] web/src/lib/search.ts
- [x] web/src/lib/search.test.ts
- [x] web/src/lib/fullSearch.ts
- [x] web/src/lib/fullSearch.test.ts
- [x] web/src/lib/export.ts
- [x] web/src/lib/export.test.ts
- [x] web/src/lib/activity.ts
- [x] web/src/lib/activity.test.ts
- [x] web/src/lib/avatarColor.ts
- [x] web/src/lib/avatarColor.test.ts
- [x] web/src/lib/busy.ts
- [x] web/src/lib/busy.test.ts
- [x] web/src/lib/captcha.ts
- [x] web/src/lib/color.ts
- [x] web/src/lib/color.test.ts
- [x] web/src/lib/convMembers.ts
- [x] web/src/lib/crashReport.ts
- [x] web/src/lib/decrypt.ts
- [x] web/src/lib/desktopBridge.ts
- [x] web/src/lib/errors.ts
- [x] web/src/lib/errors.test.ts
- [x] web/src/lib/fullscreen.ts
- [x] web/src/lib/fullscreen.test.ts
- [x] web/src/lib/gifFavorites.ts
- [x] web/src/lib/gridKeys.ts
- [x] web/src/lib/gridKeys.test.ts
- [x] web/src/lib/guestLink.ts
- [x] web/src/lib/ids.ts
- [x] web/src/lib/imageActions.ts
- [x] web/src/lib/imageActions.test.ts
- [x] web/src/lib/inviteLink.ts
- [x] web/src/lib/inviteLink.test.ts
- [x] web/src/lib/lazyChunk.ts
- [x] web/src/lib/longPress.ts
- [x] web/src/lib/longPress.test.ts
- [x] web/src/lib/markdownCtx.ts
- [x] web/src/lib/masonry.ts
- [x] web/src/lib/masonry.test.ts
- [x] web/src/lib/names.ts
- [x] web/src/lib/nextPath.ts
- [x] web/src/lib/nextPath.test.ts
- [x] web/src/lib/noZoom.ts
- [x] web/src/lib/noZoom.test.ts
- [x] web/src/lib/packRemoval.ts
- [x] web/src/lib/perms.ts
- [x] web/src/lib/perms.test.ts
- [x] web/src/lib/platform.ts
- [x] web/src/lib/platform.test.ts
- [x] web/src/lib/playableType.test.ts
- [x] web/src/lib/readPosition.ts
- [x] web/src/lib/serverKdf.ts
- [x] web/src/lib/settingsCrypto.ts
- [x] web/src/lib/shortcodes.ts
- [x] web/src/lib/subchatLock.ts
- [x] web/src/lib/theme.ts
- [x] web/src/lib/time.ts
- [x] web/src/lib/title.ts
- [x] web/src/lib/title.test.ts
- [x] web/src/lib/twemoji.ts
- [x] web/src/lib/twemoji.test.ts
- [x] web/src/lib/unread.ts
- [x] web/src/lib/workerTimers.ts
- [x] web/src/lib/zoomPan.ts
- [x] web/src/lib/zoomPan.test.ts

### hooks/
- [x] web/src/hooks/useIsMobile.ts
- [x] web/src/hooks/useNow.ts
- [x] web/src/hooks/usePortalRoot.ts
- [x] web/src/hooks/useReorder.tsx
- [x] web/src/hooks/useReorder.test.tsx
- [x] web/src/hooks/useReveal.ts
- [x] web/src/hooks/useShiftHeld.ts
- [x] web/src/hooks/useWakeLock.ts

### i18n/ (locale JSON contents are `i18n-copy`'s)
- [x] web/src/i18n/core.ts
- [x] web/src/i18n/core.test.ts
- [x] web/src/i18n/index.tsx
- [x] web/src/i18n/locales.test.ts

### markdown/ (render.tsx is `web-chat-ui`'s)
- [x] web/src/markdown/ast.ts
- [x] web/src/markdown/parse.ts
- [x] web/src/markdown/parse.test.ts
- [x] web/src/markdown/index.ts
- [x] android/.../ui/markdown/Parser.kt (parity read only)

### test/
- [x] web/src/test/setup.ts
- [x] web/src/test/fakeAudio.ts

### Round 1 cross-check
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/crypto.md
- [x] audit/web-bugs.md (non-component parts)
- [x] audit/performance.md (web section)

## Handoff note
Audit complete (agent 3, 2026-09-19T05:20Z). Every file in scope is read; test files were skimmed by
test name (counts and names recorded in this session, gaps in WCORE-029); Parser.kt read in
full for parity (WCORE-025). Findings 001-029; Summary written at the top of FINDINGS.md.
No Playwright or device run was made: Safari/iOS claims (018) come from documented WebKit
behaviour, perf claims (024, 028) from reading, bundle numbers (027) from a scratch build
(`npx vite build --outDir $TMPDIR/dist-wcore`, since removed). Round-1 Done claims that
touch this area were verified and are listed in the Summary; the captive-portal one is a
half-fix (WCORE-001). Nothing outside audit/r2/areas/web-core/ was edited.
