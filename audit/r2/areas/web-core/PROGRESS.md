# Progress — web-core
State: auditing
Last checkpoint: 2026-09-19T00:02Z
Next finding id: 004

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
- [ ] web/src/stores/auth.test.ts
- [x] web/src/stores/keys.ts
- [ ] web/src/stores/keys.test.ts
- [ ] web/src/stores/messages.ts
- [ ] web/src/stores/messages.test.ts
- [ ] web/src/stores/channels.ts
- [ ] web/src/stores/servers.ts
- [ ] web/src/stores/servers.test.ts
- [ ] web/src/stores/users.ts
- [ ] web/src/stores/relationships.ts
- [ ] web/src/stores/readStates.ts
- [ ] web/src/stores/readStates.test.ts
- [ ] web/src/stores/settings.ts
- [ ] web/src/stores/settings.test.ts
- [ ] web/src/stores/settings.slowstart.test.ts
- [ ] web/src/stores/ui.ts
- [ ] web/src/stores/ui.test.ts
- [ ] web/src/stores/panes.ts
- [ ] web/src/stores/presence.ts
- [ ] web/src/stores/typing.ts
- [ ] web/src/stores/selection.ts
- [ ] web/src/stores/selection.test.ts
- [ ] web/src/stores/expressions.ts
- [ ] web/src/stores/expressions.test.ts
- [ ] web/src/stores/slowmode.ts
- [ ] web/src/stores/keyAlerts.ts
- [ ] web/src/stores/desktop.ts
- [ ] web/src/stores/serverNav.ts

### gateway/
- [ ] web/src/gateway/client.ts
- [ ] web/src/gateway/client.test.ts
- [ ] web/src/gateway/dispatch.ts
- [ ] web/src/gateway/dispatch.test.ts
- [ ] web/src/gateway/events.ts
- [ ] web/src/gateway/session.ts

### lib/ (callLayout, callPanel, audioKeeper are `voice`'s)
- [x] web/src/lib/attachments.ts
- [ ] web/src/lib/attachments.test.ts
- [x] web/src/lib/upload.worker.ts
- [ ] web/src/lib/download.ts
- [ ] web/src/lib/mediaLinks.ts
- [ ] web/src/lib/mediaLinks.test.ts
- [ ] web/src/lib/mediaCache.ts
- [ ] web/src/lib/mediaCache.test.ts
- [x] web/src/lib/keyPins.ts
- [ ] web/src/lib/keyPins.test.ts
- [x] web/src/lib/keyring.ts
- [x] web/src/lib/appLock.ts
- [ ] web/src/lib/appLock.test.ts
- [x] web/src/lib/storage.ts
- [ ] web/src/lib/notify.ts
- [ ] web/src/lib/notify.test.ts
- [ ] web/src/lib/sounds.ts
- [ ] web/src/lib/sounds.test.ts
- [ ] web/src/lib/search.ts
- [ ] web/src/lib/search.test.ts
- [ ] web/src/lib/fullSearch.ts
- [ ] web/src/lib/fullSearch.test.ts
- [ ] web/src/lib/export.ts
- [ ] web/src/lib/export.test.ts
- [ ] web/src/lib/activity.ts
- [ ] web/src/lib/activity.test.ts
- [ ] web/src/lib/avatarColor.ts
- [ ] web/src/lib/avatarColor.test.ts
- [x] web/src/lib/busy.ts
- [ ] web/src/lib/busy.test.ts
- [ ] web/src/lib/captcha.ts
- [ ] web/src/lib/color.ts
- [ ] web/src/lib/color.test.ts
- [ ] web/src/lib/convMembers.ts
- [x] web/src/lib/crashReport.ts
- [ ] web/src/lib/decrypt.ts
- [ ] web/src/lib/desktopBridge.ts
- [ ] web/src/lib/errors.ts
- [ ] web/src/lib/errors.test.ts
- [ ] web/src/lib/fullscreen.ts
- [ ] web/src/lib/fullscreen.test.ts
- [ ] web/src/lib/gifFavorites.ts
- [ ] web/src/lib/gridKeys.ts
- [ ] web/src/lib/gridKeys.test.ts
- [ ] web/src/lib/guestLink.ts
- [ ] web/src/lib/ids.ts
- [ ] web/src/lib/imageActions.ts
- [ ] web/src/lib/imageActions.test.ts
- [ ] web/src/lib/inviteLink.ts
- [ ] web/src/lib/inviteLink.test.ts
- [x] web/src/lib/lazyChunk.ts
- [ ] web/src/lib/longPress.ts
- [ ] web/src/lib/longPress.test.ts
- [ ] web/src/lib/markdownCtx.ts
- [ ] web/src/lib/masonry.ts
- [ ] web/src/lib/masonry.test.ts
- [ ] web/src/lib/names.ts
- [ ] web/src/lib/nextPath.ts
- [ ] web/src/lib/nextPath.test.ts
- [x] web/src/lib/noZoom.ts
- [ ] web/src/lib/noZoom.test.ts
- [ ] web/src/lib/packRemoval.ts
- [ ] web/src/lib/perms.ts
- [ ] web/src/lib/perms.test.ts
- [ ] web/src/lib/platform.ts
- [ ] web/src/lib/platform.test.ts
- [ ] web/src/lib/playableType.test.ts
- [ ] web/src/lib/readPosition.ts
- [ ] web/src/lib/serverKdf.ts
- [ ] web/src/lib/settingsCrypto.ts
- [ ] web/src/lib/shortcodes.ts
- [ ] web/src/lib/subchatLock.ts
- [ ] web/src/lib/theme.ts
- [ ] web/src/lib/time.ts
- [ ] web/src/lib/title.ts
- [ ] web/src/lib/title.test.ts
- [ ] web/src/lib/twemoji.ts
- [ ] web/src/lib/twemoji.test.ts
- [ ] web/src/lib/unread.ts
- [ ] web/src/lib/workerTimers.ts
- [ ] web/src/lib/zoomPan.ts
- [ ] web/src/lib/zoomPan.test.ts

### hooks/
- [ ] web/src/hooks/useIsMobile.ts
- [ ] web/src/hooks/useNow.ts
- [ ] web/src/hooks/usePortalRoot.ts
- [ ] web/src/hooks/useReorder.tsx
- [ ] web/src/hooks/useReorder.test.tsx
- [ ] web/src/hooks/useReveal.ts
- [ ] web/src/hooks/useShiftHeld.ts
- [ ] web/src/hooks/useWakeLock.ts

### i18n/ (locale JSON contents are `i18n-copy`'s)
- [ ] web/src/i18n/core.ts
- [ ] web/src/i18n/core.test.ts
- [ ] web/src/i18n/index.tsx
- [ ] web/src/i18n/locales.test.ts

### markdown/ (render.tsx is `web-chat-ui`'s)
- [ ] web/src/markdown/ast.ts
- [ ] web/src/markdown/parse.ts
- [ ] web/src/markdown/parse.test.ts
- [ ] web/src/markdown/index.ts
- [ ] android/.../ui/markdown/Parser.kt (parity read only)

### test/
- [x] web/src/test/setup.ts
- [ ] web/src/test/fakeAudio.ts

### Round 1 cross-check
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [ ] audit/crypto.md
- [ ] audit/web-bugs.md (non-component parts)
- [ ] audit/performance.md (web section)

## Handoff note
Read so far: entry/config, sw, download-sw, all api/, all crypto/ (+tests skimmed by
name; fingerprint vector confirmed in both suites; KDF floor confirmed in Kdf.kt),
stores/auth.ts, stores/keys.ts, lib/attachments.ts, upload.worker.ts, keyPins, keyring,
appLock, storage. Findings 001-003 written. Pending write-ups (evidence gathered next):
- upload cancel: uploadStaged/PieceSender have no abort; check the composer's cancel.
- api.upload pre-aborted signal hang: unreachable if nobody passes a signal (grep).
- single-request uploads (<= 90 MB) are not resumable; a stall restarts from zero.
- keys store: one IndexedDB transaction per grant on ready (perf).
- lockApp only nulls the auth store's identity; check session.ts tears down keys/ring/messages.
- app lock: 4-digit numeric minimum vs offline brute force of ec.lock.<uid> (P3 design).
Successor (2nd agent) resumed 2026-09-19T00:02Z: gathering evidence for the six pending write-ups above, then gateway/* and stores/messages.ts.
