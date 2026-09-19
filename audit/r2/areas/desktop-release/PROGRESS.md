# Progress — desktop-release
State: auditing
Last checkpoint: 2026-09-19T10:41Z
Next finding id: 001

Scope = BRIEF.md globs expanded with `git ls-files` (2026-09-19), plus
`backup.sh`, `web/vite.config.ts` (prune plugin), the `deploy/` scripts and
`docs/design/**` which the checklist names. Binary files (png, .node) are
ticked after a provenance/size check, not a read.

## Inspected

### desktop — build and release
- [x] desktop/package.json
- [ ] desktop/package-lock.json                 (skim: versions, integrity, koffi)
- [x] desktop/build.mjs
- [x] desktop/electron-builder.yml
- [x] desktop/scripts/sign-release.mjs
- [x] desktop/tsconfig.json
- [x] desktop/vitest.config.ts
- [x] desktop/.gitignore

### desktop — main process
- [x] desktop/src/main/index.ts
- [x] desktop/src/main/window.ts
- [x] desktop/src/main/permissions.ts
- [x] desktop/src/main/config.ts
- [x] desktop/src/main/settings.ts
- [ ] desktop/src/main/tray.ts
- [ ] desktop/src/main/strings.ts
- [ ] desktop/src/main/displayPicker.ts
- [ ] desktop/src/main/appAudio.ts

### desktop — preload, shared, picker
- [ ] desktop/src/preload/index.ts
- [ ] desktop/src/shared/bridge.ts
- [ ] desktop/src/picker/picker.html
- [ ] desktop/src/picker/preload.ts
- [ ] desktop/src/picker/ui.ts

### desktop — Rich Presence
- [ ] desktop/src/main/rpc/activity.ts
- [ ] desktop/src/main/rpc/discord.ts
- [ ] desktop/src/main/rpc/frame.ts
- [ ] desktop/src/main/rpc/ipcServer.ts
- [ ] desktop/src/main/rpc/paths.ts
- [ ] desktop/src/main/rpc/service.ts
- [ ] desktop/src/main/rpc/session.ts
- [ ] desktop/src/main/rpc/upstream.ts
- [ ] desktop/src/main/rpc/wsServer.ts

### desktop — updater
- [ ] desktop/src/main/update/index.ts
- [ ] desktop/src/main/update/mac.ts
- [ ] desktop/src/main/update/manifest.ts
- [ ] desktop/src/main/update/releaseKey.ts

### desktop — tests
- [ ] desktop/test/activity.test.ts
- [ ] desktop/test/displayPicker.test.ts
- [ ] desktop/test/frame.test.ts
- [ ] desktop/test/frameable.test.ts
- [ ] desktop/test/manifest.test.ts
- [ ] desktop/test/release-signature.test.ts
- [ ] desktop/test/service.test.ts
- [ ] desktop/test/session.test.ts
- [ ] desktop/test/strings.test.ts

### desktop — resources
- [ ] desktop/resources/koffi/README.md
- [ ] desktop/resources/koffi/LICENSE.txt
- [ ] desktop/resources/koffi/win32_x64/koffi.node   (binary: provenance, size, version)
- [ ] desktop/resources/icon.png badge.png tray.png tray@2x.png trayTemplate.png trayTemplate@2x.png (binary: sizes)

### web — bridge, stores, pages, banners
- [ ] web/src/lib/desktopBridge.ts
- [ ] web/src/stores/desktop.ts
- [ ] web/src/api/desktop.ts
- [ ] web/src/api/android.ts
- [ ] web/src/components/settings/DesktopPage.tsx
- [ ] web/src/components/shell/UpdateBanner.tsx
- [ ] web/src/components/shell/DownloadBanner.tsx
- [ ] web/src/components/shell/RpcBanner.tsx
- [ ] web/src/pages/DownloadPage.tsx
- [ ] web/scripts/deploy-guard.mjs
- [ ] web/vite.config.ts                       (prune plugin, index.html order)
- [ ] web/public/manifest.webmanifest
- [ ] web/public/icons/*                        (12 files: sizes, manifest references)

### server — release routes
- [ ] internal/api/desktop_handlers.go
- [ ] internal/api/android_handlers.go
- [ ] internal/api/static.go
- [ ] internal/rpcapps/rpcapps.go
- [ ] internal/rpcapps/rpcapps_test.go

### tools — publish and gate
- [ ] tools/publish_desktop.py
- [ ] tools/publish_android.py
- [ ] tools/check.sh
- [ ] tools/licenses.py
- [ ] tools/licenses/CC-BY-4.0.txt
- [ ] Makefile
- [ ] backup.sh
- [x] .gitignore
- [x] desktop/.gitignore (listed above)

### tools — tests and screenshots
- [ ] tools/e2e.py
- [ ] tools/screenshot.py
- [ ] tools/home_shots.py
- [ ] tools/home_gifs.py
- [ ] tools/call_quality.py
- [ ] tools/sfu_call.py
- [ ] tools/sfu_guest.py
- [ ] tools/emulator.sh
- [ ] tools/device/ui.py
- [ ] tools/device/seed.py
- [ ] tools/device/call_peer.py
- [ ] tools/device/call_soak.py
- [ ] tools/device/handover.py
- [ ] tools/device/media_check.py
- [ ] tools/device/sfu_server.py
- [ ] tools/netsim/main.go

### tools — i18n and assets
- [ ] tools/i18n_keys_used.py
- [ ] tools/i18n_check.py
- [ ] tools/i18n_apply.py
- [ ] tools/i18n_extract.py
- [ ] tools/android_i18n.py
- [ ] tools/android_i18n_added.json
- [ ] tools/lucide_map.py
- [ ] tools/gen_lucide.py
- [ ] tools/twemoji_sprites.py
- [ ] tools/trace_wordmark.py
- [ ] tools/pg_schema.py
- [ ] tools/gen_pg_schema.sh
- [ ] tools/requirements.txt
- [ ] tools/README.md

### docs
- [ ] README.md
- [ ] docs/STATUS.md
- [ ] deploy/README.md
- [ ] deploy/install.sh
- [ ] deploy/route-dns.sh
- [ ] deploy/xyz.evilion.chat.plist.in
- [ ] docs/superpowers/plans/2026-09-11-phase1-foundation.md
- [ ] docs/superpowers/plans/2026-09-11-phase2-servers.md
- [ ] docs/superpowers/plans/2026-09-13-desktop-app.md
- [ ] docs/superpowers/plans/2026-09-13-voice-sfu.md
- [ ] docs/superpowers/specs/2026-09-11-chat-design.md
- [ ] docs/design/reference/*                   (7 files: pngs + json; current or historical?)

### round 1 cross-check
- [ ] audit/REVIEW.md (Done / Not doing / Still open for desktop-release)
- [ ] audit/desktop-and-release.md (25 findings; verify each claimed fix)

### checks to run (read-only, scratch)
- [ ] `cd desktop && npx vitest run` (41 expected)
- [ ] `npm audit --omit=dev` in desktop/ and web/ (report only)
- [ ] version consistency: desktop/package.json, android build.gradle, data/desktop manifests (read only), web copy

## Handoff note
2026-09-19T10:41Z. Read the build files and main/index,window,permissions,config,
settings. Keys are gitignored + untracked (checked). Findings being written now:
will-redirect has no isMainFrame/frameable check (cancels subframe redirects);
permissions.ts `pending` entry never deleted on dismiss so the display-media
callback is called twice (dismiss + 120s timeout) - verifying whether Electron
throws on the 2nd call; Windows/Linux have no menu so no Ctrl+R/zoom/F11;
settings.ts typeof-loop cannot load `lastUpdateSeen` (default null) - grep to
see if it is used; setBadge(Infinity) would throw in app.setBadgeCount;
restartApp uses app.exit(0) which skips will-quit (stopRpc/flush).
Next: preload/index.ts, shared/bridge.ts, then rpc/*.
