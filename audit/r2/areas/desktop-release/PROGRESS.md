# Progress — desktop-release
State: auditing
Last checkpoint: 2026-09-19T10:58Z
Next finding id: 012

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
- [x] desktop/src/main/tray.ts
- [x] desktop/src/main/strings.ts
- [x] desktop/src/main/displayPicker.ts
- [x] desktop/src/main/appAudio.ts

### desktop — preload, shared, picker
- [x] desktop/src/preload/index.ts
- [x] desktop/src/shared/bridge.ts
- [x] desktop/src/picker/picker.html
- [x] desktop/src/picker/preload.ts
- [x] desktop/src/picker/ui.ts

### desktop — Rich Presence
- [x] desktop/src/main/rpc/activity.ts
- [x] desktop/src/main/rpc/discord.ts
- [x] desktop/src/main/rpc/frame.ts
- [x] desktop/src/main/rpc/ipcServer.ts
- [x] desktop/src/main/rpc/paths.ts
- [x] desktop/src/main/rpc/service.ts
- [x] desktop/src/main/rpc/session.ts
- [x] desktop/src/main/rpc/upstream.ts
- [x] desktop/src/main/rpc/wsServer.ts

### desktop — updater
- [x] desktop/src/main/update/index.ts
- [x] desktop/src/main/update/mac.ts
- [x] desktop/src/main/update/manifest.ts
- [x] desktop/src/main/update/releaseKey.ts

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
- [x] desktop/resources/koffi/README.md
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
2026-09-19T10:58Z. All of desktop/src read; DESK-001..011 written. Pending
evidence: (a) permissions.ts `pending` entry is never deleted on dismiss, so
the display-media callback is called again at the 120 s timeout — an Electron
throwaway test (/private/tmp/desk-audit-dm/main.js) is checking whether the
second call throws (would be an error dialog 2 min after dismissing the
stale-screen-permission explainer on macOS); (b) koffi.node provenance vs the
npm 3.2.1 tarball; (c) vitest + npm audit results. setBadgeCount(Infinity) was
tested and does NOT throw — not a finding. Next: test/*, then web bridge files,
Go routes, publish tools.
