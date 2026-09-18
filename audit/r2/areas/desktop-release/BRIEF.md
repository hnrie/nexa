# Brief — desktop-release (finding prefix `DESK`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

The Electron app, the release and publish paths of all three apps, the
repository's tooling, and the accuracy of what the docs claim.

```
desktop/                     everything (package.json, build.mjs, electron-builder.yml,
                             scripts/sign-release.mjs, src/main/**, src/preload/**,
                             src/picker/**, src/shared/**, test/**, resources/**)
web/src/lib/desktopBridge.ts  web/src/stores/desktop.ts  web/src/api/desktop.ts  web/src/api/android.ts
web/src/components/settings/DesktopPage.tsx   (the page as the app's client; UX is web-shell-ui's)
web/src/components/shell/UpdateBanner.tsx DownloadBanner.tsx RpcBanner.tsx (mechanics)
web/src/pages/DownloadPage.tsx                (what it offers; UX is web-shell-ui's)
internal/api/desktop_handlers.go android_handlers.go static.go (release routes, headers, caching)
internal/rpcapps/rpcapps.go                   (the Rich Presence app registry)
tools/publish_desktop.py tools/publish_android.py tools/licenses.py tools/check.sh
tools/e2e.py tools/screenshot.py tools/i18n_*.py tools/android_i18n.py tools/lucide_map.py
tools/gen_lucide.py tools/twemoji_sprites.py tools/home_*.py tools/trace_wordmark.py
tools/device/*  tools/netsim/*  tools/requirements.txt  tools/README.md
Makefile  .gitignore  README.md  docs/STATUS.md  docs/superpowers/**  deploy/README.md
web/scripts/deploy-guard.mjs  web/public/manifest.webmanifest  web/public/icons/*
```

`appAudio.ts`, `displayPicker.ts`, `permissions.ts` and the picker are also
`voice`'s for call semantics; you cover their Electron security and
correctness.

## What this area is

The desktop app is a `BrowserWindow` on the live site plus: a
Discord-compatible Rich Presence server (IPC socket + WebSocket, moving
Discord's own socket aside on Mac/Linux and forwarding upstream —
`rpc/*`), a tray, notifications with real window focus state, a screen
share picker in its own window with its own preload (round 1's fix), share
audio per OS, and an updater (`electron-updater` for Windows/Linux, a
custom Mac updater because builds are unsigned, release manifests signed
with `update-key.pem` and verified by `releaseKey.ts`). Installers are
built on this Mac (`make desktop`), published into `data/desktop` by
`tools/publish_desktop.py` (keeps two versions, refuses to overwrite a
published version), served by chatd at `/desktop/` with manifests at
`/api/v1/desktop/latest`. Android APKs are published by
`tools/publish_android.py` (checks the signing certificate against a pinned
one and refuses a build aimed at a local server). The web download page
and banners read both manifests. `tools/check.sh` is the pre-publish gate.

## Checklist

Electron security (read every line of `src/main/**` and `src/preload/**`):
- `webPreferences`: `contextIsolation`, `sandbox`, `nodeIntegration`,
  `webSecurity`, `allowRunningInsecureContent`, `enableRemoteModule`,
  `spellcheck`, `backgroundThrottling` (off by design — note the CPU cost),
  `preload` paths, `additionalArguments`.
- Navigation: `will-navigate`, `will-redirect`, `setWindowOpenHandler`,
  subframe guards (round 1 added), `will-attach-webview`, `permission
  request/check handlers` (which permissions are granted to which origins;
  `originOf` comparison; `clipboard-read` removed), `openExternal`
  allow-list (`https:` only?), protocol handlers, `session.setCertificate
  VerifyProc`, `webRequest` hooks.
- The preload's exposed surface (`bridge.ts`, `preload/index.ts`): every
  function, its arguments, validation on the main side (round 1: identity
  capped and validated — verify), whether any lets the page read files,
  spawn processes, or talk to the RPC server as a client; IPC channel
  names and `ipcMain.handle` validation of `event.senderFrame`/origin.
- The RPC servers (`ipcServer.ts`, `wsServer.ts`, `upstream.ts`,
  `discord.ts`, `frame.ts`, `session.ts`, `activity.ts`, `service.ts`):
  socket permissions (`umask 0o177`), the WebSocket's reachability by every
  local user (round 1 declined to fix, wants the settings page to say so —
  does it?), frame size caps, JSON depth, the activity sanitiser (matches
  the server's rules? round 1 aligned them), what is forwarded upstream to
  Discord and what could be logged (round 1: `AUTHORIZE`/`AUTHENTICATE`
  frames carry OAuth tokens — a deny-list for logging), reconnect storms,
  the "Restart Discord" path (`tasklist`/`taskkill` by absolute path now),
  the Mac/Linux socket rename (what happens if Discord starts after us, or
  we crash and leave the rename in place — does Discord RPC break for the
  user until reboot?).
- Updater: manifest signature verification order (verify before parse?),
  downgrade protection, the Mac swap (atomic? what if the app is in
  `/Applications` owned by root? what if the download is truncated?),
  Windows NSIS silent install flags, Linux `.deb` "just says a new version
  is out" (acceptable?), the minute poll (jitter? ETag? cost to chatd?),
  the banner's "Download" vs "Restart" states, `EVILION_UPDATE_NO_RELAUNCH`
  test hook cannot be set by a page.
- `config.ts`/`settings.ts`: what is stored where, the env-var test hooks
  (`EVILION_*`) — could a user's environment change security behaviour?
- Tray, window state persistence, single-instance lock, deep links
  (`nexa://`? invite links?), `app.setAsDefaultProtocolClient`, launch at
  login, quit vs. close on each OS, SIGTERM (round 1 fixed), crash
  handling, logs (what and where; secrets?).
- Notifications: the focus-state path, click routing, badge counts, the
  Windows AppUserModelId.
- `strings.ts` (menus in eleven languages — complete? RTL menus?).
- Dependencies: `electron` 44.3, `electron-updater`, `electron-builder`,
  `ws`, `koffi` (native; committed binary at `resources/koffi/win32_x64` —
  provenance recorded? version pinned to the npm one?), `@xhayper/
  discord-rpc`. Known advisories (`npm audit --omit=dev` in `desktop/`
  and `web/`; report, do not fix).

Release path (every step from a commit to a user's machine, on all three
apps):
- `Makefile`: the guards (`DEPLOY=1`, `bin/chatd.prev`), `build` depending
  on the tests, `desktop`/`android` targets, `licenses`, a target that can
  still deploy by accident, the `VERSION` ldflag.
- `tools/check.sh`: what it does not check (Android is opt-in; e2e is not
  run; `-race` is not used), false positives/negatives, runtime.
- `publish_desktop.py`: version parsing, the two-version retention, refusal
  rules, manifest generation for each platform (`latest.yml`,
  `latest-mac.yml`, `latest-linux.yml`, `manifest.json`), signing with
  `update-key.pem` (`sign-release.mjs` — the key's protection, the
  signature's coverage), atomicity of the publish (a half-published
  release served for a moment?), the 3 GB incident's lesson.
- `publish_android.py`: certificate pin, server-URL refusal, manifest
  fields (per-ABI `files` — and the web type that lacks them), checksum,
  the `assetlinks.json` derivation, atomicity, retention.
- `desktop_handlers.go`/`android_handlers.go`/`static.go`: caching headers
  on manifests (must be uncached) vs. installers (range requests, long
  cache), content types, directory traversal, symlink following,
  `no-store` on missing assets, the seven-day asset retention plugin in
  `vite.config.ts` (open tabs survive a deploy — verify the mechanism and
  that `index.html` is written last), the service worker's caching of
  `index.html` (`web-core` owns `sw.ts`; you own the deploy interaction).
- `deploy-guard.mjs`: can it be bypassed by `npx vite build` in `web/`?
  (Yes by design for scratch builds — but what stops `vite build` with no
  `--outDir` from writing `web/dist`? Say whether that is a real hole.)
- The signing keys' existence and backup: `desktop/update-key.pem`,
  `android/release.jks` — `backup.sh` copies neither (round 1's highest-
  consequence item, still not code; propose the smallest safe step, e.g.
  an encrypted copy in the backup with a documented passphrase location —
  as a finding for the owner, not something to do).
- Version consistency: `desktop/package.json` 1.0.5, Android 1.0.3
  (versionCode 4), the web's idea of both, the download page's copy about
  unsigned builds, `docs/STATUS.md`'s claims (it still says calls are
  peer-to-peer mesh — every stale claim is a `docs` finding), `README.md`
  likewise, `deploy/README.md`, `tools/README.md`.

Tooling quality (they are used before every publish; a wrong tool is a
wrong release):
- `tools/e2e.py`: flakiness sources (fixed sleeps, timing), coverage gaps
  vs. the feature list in `README.md`, the `--flows` dependency quirk
  (voice needs expressions first), whether it can run against a build
  without deploying (it can — `E2E_*`; is that documented at the top?).
- `licenses.py`: completeness (all four lockfiles), licence texts, what
  Settings → Licenses shows vs. what ships.
- The i18n tools: `i18n_keys_used.py`'s dynamic-key handling (what could
  slip through), `i18n_check.py`, `i18n_apply.py`, `android_i18n.py`.
- `.gitignore`: anything tracked that should not be (`.DS_Store` files are
  committed? `tools/android_i18n_added.json`?), anything ignored that
  should be tracked.
- `docs/superpowers/**` and `docs/design/**`: stale plans presented as
  current; keep or mark historical.

## Round 1

`audit/REVIEW.md`, `audit/desktop-and-release.md` (25, 4 HIGH in the
release path — every one was claimed fixed on the 17th; verify each in the
code: the picker window, `clipboard-read`, `will-navigate` and subframes,
`openExternal`, `tasklist` by name, the activity sanitiser, the identity
cap, `data/desktop` retention, the signing guards).

## Facts you would otherwise rediscover

- `make desktop` produces Windows x64 NSIS, macOS x64+arm64 dmg+zip, Linux
  x64 AppImage+deb, all unsigned; Windows, Linux and arm64 builds have
  never been run on real machines.
- Electron passes any string through as the display-media device id; a
  malformed `applicationLoopback:` id CHECK-crashes the audio service, so
  ids are validated.
- Test Electrons: launch `desktop/node_modules/.bin/electron .` with
  `--remote-debugging-port` and connect over CDP; give it a temp `TMPDIR`,
  `EVILION_USER_DATA`, `EVILION_NO_LOGIN_ITEM=1`. Kill leftovers; a stale
  one on port 9333 breaks the next run. The owner's own Discord owns
  `$TMPDIR/discord-ipc-0` — find it by connecting only, never handshake
  (Discord rate-limits).
- `desktop/update-key.pem` and `android/release.jks` exist only on this
  Mac. Never move, copy elsewhere, or print them.
- 41 desktop tests pass at the start of this round.

## Reading order

`desktop/package.json`, `build.mjs`, `electron-builder.yml`,
`scripts/sign-release.mjs` → `src/main/index.ts`, `window.ts`,
`permissions.ts`, `config.ts`, `settings.ts` → `src/preload/index.ts`,
`src/shared/bridge.ts` → `src/main/rpc/*` → `src/main/update/*` →
`displayPicker.ts`, `appAudio.ts`, `src/picker/*` → `tray.ts`, `strings.ts`
→ `test/*` → the web bridge files → the Go release routes and `static.go`
→ `tools/publish_*.py`, `check.sh`, `Makefile`, `deploy-guard.mjs`,
`vite.config.ts`'s prune plugin → `licenses.py`, the i18n tools, `e2e.py`,
the rest of `tools/` → the docs.
