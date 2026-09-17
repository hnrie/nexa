# Desktop app and release

## Summary

The Electron shell is, on the fundamentals, well built. `contextIsolation`, `sandbox`,
`nodeIntegration: false` and `webSecurity` are all set correctly and never relaxed
(`desktop/src/main/window.ts:72-86`); there is no `webRequest` mangling, no custom
protocol handler, no `certificate-error` override and no `setCertificateVerifyProc`
anywhere in `desktop/src/`. The preload exposes named calls only, gated on
`location.origin` (`desktop/src/preload/index.ts:24`), and every `ipcMain` channel is
gated again in the main process on both the sending `webContents` and the sending
frame's URL (`desktop/src/main/index.ts:57-59,141-150`). `shell.openExternal` is
scheme-limited (`desktop/src/main/window.ts:15-22`), so the classic Electron
`openExternal("file://…")` RCE is closed. The Rich Presence servers validate their
handshakes, cap frame sizes, rate-limit activity updates, and the WebSocket transport
refuses any connection carrying an `Origin` header, which is the right control against
browser pages. The server behind all of this re-validates every Rich Presence field and
proxies every image (`internal/gateway/activity.go:226-309`), so the local-program
tracking-pixel path I expected to find is already closed.

What is weak is everything that decides *which code runs*. The macOS updater's only
integrity check is a SHA-512 taken from the same manifest, on the same host, as the
payload; the `codesign --verify` on an ad-hoc signature proves nothing about who built
it; and the install script then strips the quarantine attribute, removing Gatekeeper.
Compromise the host that serves `chat.evilion.xyz` and you own every desktop install
within sixty seconds. `EVILION_URL` is honoured in packaged builds, so anything that can
set an environment variable can point the app at a site of its choosing and inherit the
Nexa bundle's camera, microphone and screen-recording grants. The screen-share picker is
drawn by the renderer, so a renderer compromise is a whole-screen capture. `clipboard-read`
is granted and the web client never uses it. And the release path itself runs no tests, no
typechecker and no audit; `desktop/dist` is never cleaned, and `publish_desktop.py` will
copy a stale `latest.yml` over the live one and point every Windows client at a file that
does not exist.

Nothing secret is committed. `chatd.env`, `android/release.jks` and
`android/keystore.properties` are all correctly gitignored and `chatd.env.example` carries
only empty placeholders. The Android keystore, however, exists on exactly one Mac and is in
no backup, and a missing keystore makes `make android` silently produce a **debug-signed**
release.

**Counts** — CRITICAL 0 · HIGH 4 · MEDIUM 9 · LOW 10 · POLISH 8.

---

## Findings

### [HIGH] The macOS updater installs anything the release host serves, and then strips Gatekeeper

- **Where**: `desktop/src/main/update/mac.ts:91-113` (stage), `desktop/src/main/update/mac.ts:120-151` (install), `desktop/src/main/update/index.ts:100-121` (Windows/AppImage path), `desktop/electron-builder.yml:22-25,29-31`
- **What**: `stageMacUpdate` fetches `latest-mac.yml`, downloads the zip it names, and compares the download's SHA-512 against the `sha512:` field **in that same manifest** (`mac.ts:99-103`). Manifest and payload come from the same origin over the same connection, so the hash proves only that the file was not corrupted in transit — it is not a signature and carries no author identity. The one thing that looks like a signature check, `codesign --verify --deep` at `mac.ts:111`, verifies the internal consistency of an *ad-hoc* signature (`electron-builder.yml:29` `identity: "-"`); anyone can ad-hoc sign their own bundle and pass it. `installMacUpdate` then runs `xattr -dr com.apple.quarantine "$1"` (`mac.ts:134`), deliberately removing the last thing macOS would have checked. The Windows and AppImage paths go through electron-updater against the same generic feed (`index.ts:103`); because the NSIS build is unsigned (no `certificateFile`/`publisherName` anywhere in `electron-builder.yml`), electron-updater has no publisher to verify against either.
- **Attack or failure**: The attacker is anyone who gets write access to `DESKTOP_DIR` on the Mac that serves `chat.evilion.xyz` — the operator's own user account on that box, a compromise of the Cloudflare tunnel or account, or anyone who reaches `data/desktop/`. They drop a malicious `nexa-1.0.5-mac-arm64.zip` and a `latest-mac.yml` naming it with the matching SHA-512 (which they compute themselves). Every running desktop client polls every 60 s (`index.ts:19-20,59-61`), sees the higher version, downloads it, matches the hash, passes the ad-hoc `codesign` check, unpacks it, and on the next restart the script at `mac.ts:129-147` moves the real app aside, moves the malicious bundle into `/Applications`, strips quarantine and `open`s it. On macOS the new bundle sits at the old bundle's path, so it inherits the TCC grants the user already gave Nexa for Screen Recording, Camera and Microphone. Windows and AppImage users get the same thing through electron-updater. There is no second factor anywhere in the chain.
- **Confidence**: traced — every step read end to end, and the live feed verified: `data/desktop/latest-mac.yml`'s SHA-512 for `nexa-1.0.3-mac-arm64.zip` does match the file on disk, so the mechanism is live and working exactly as written.
- **Fix**: Sign the manifest with an offline Ed25519 key (minisign is enough), ship the public key inside the app, and verify the manifest signature in `stageMacUpdate` *before* trusting any hash in it. Then the SHA-512 becomes meaningful. Stop stripping quarantine; if the app cannot run without it, that is Gatekeeper working. On Windows, get a code-signing certificate and set `publisherName` so electron-updater's signature check engages. Until a signing key exists, treat `data/desktop/` as production-critical: it is currently as sensitive as the SQLite database.

### [HIGH] `EVILION_URL` is honoured in packaged builds, so an env var re-points the whole app and its OS permissions

- **Where**: `desktop/src/main/config.ts:7-18` (no `app.isPackaged` gate), `desktop/src/main/window.ts:85`, `desktop/src/preload/index.ts:24`, `desktop/src/main/permissions.ts:20-21,36-41`, `desktop/src/main/index.ts:58`
- **What**: `baseUrl()` reads `process.env.EVILION_URL` and accepts **any** `https:` URL (and `http:` for loopback). Everything downstream keys off the resulting `ORIGIN`: the preload only exposes the bridge when `location.origin === origin` (`preload/index.ts:24`), the permission handlers only allow the origin that equals `ORIGIN` (`permissions.ts:21,40`), and `fromApp()` only accepts IPC from a frame whose URL matches `ORIGIN` (`index.ts:58`). Set the env var and the attacker's site *becomes* the trusted origin. Nothing checks `app.isPackaged`. The same is true of the other test switches: `EVILION_USER_DATA` (`index.ts:19`), `EVILION_DEBUG` (`index.ts:26`), `EVILION_SHARE_AUDIO_MODE` (`permissions.ts:283`), `EVILION_WINDOW_AUDIO` (`appAudio.ts:26-27`), `EVILION_UPDATE_TEST` (`update/index.ts:57`), `EVILION_UPDATE_NO_RELAUNCH` (`update/mac.ts:148`).
- **Attack or failure**: The attacker is a local program running as the user — or a tampered autostart entry, and note the app writes one itself at `index.ts:253-268` (`~/.config/autostart/nexa.desktop` on Linux; on macOS the equivalent is a LaunchAgent, on Windows a shortcut). They arrange for Nexa to be launched with `EVILION_URL=https://evil.example`. On next start the app loads the attacker's page as its own origin. That page gets `window.evilionDesktop` in full, and — the part that matters — gets `media` (camera + microphone), `display-capture`, `clipboard-read` and `notifications` auto-granted for *its* origin (`permissions.ts:15,21,34`). On macOS, TCC keys Screen Recording, Camera and Microphone to the *app bundle*, which is unchanged, so the attacker's page uses the grants the user already gave Nexa and no system prompt fires. It can then call `getDisplayMedia()`, answer its own picker (see the next finding), and stream the whole screen with system audio. It also gets the signed-in identity via `setIdentity` and the Rich Presence `READY`.
- **Confidence**: traced through the code. The TCC-inheritance step is standard macOS behaviour rather than something I executed — flagged as such, but it follows from the bundle path being unchanged.
- **Fix**: `if (!app.isPackaged)` around the `EVILION_URL` branch in `config.ts:8-16`, and the same gate on the other `EVILION_*` switches. This is a one-line change with no cost to the local-dev workflow, which is unpackaged by definition. (Note that `hardenedRuntime: false` at `electron-builder.yml:30` means a local attacker can also just edit the bundle and re-ad-hoc-sign it — fixing that is part of the previous finding, but `EVILION_URL` is the version that needs no write access to `/Applications`.)

### [HIGH] The screen-share consent UI is drawn by the page it is meant to protect

- **Where**: `desktop/src/main/permissions.ts:159-256` (especially `:226-249`), `desktop/src/main/index.ts:206`, `web/src/components/desktop/DesktopEffects.tsx:124,150`, `web/src/components/desktop/DisplayPicker.tsx`
- **What**: `setDisplayMediaRequestHandler` deliberately does not use the OS picker (the reasoning is at `permissions.ts:147-158`). Instead it enumerates every screen and window with `desktopCapturer.getSources`, sends the whole list plus a `requestId` to the renderer (`permissions.ts:248`), and waits for the renderer to send back a `sourceId` over `IPC.displayChoose` (`index.ts:206` → `permissions.ts:293-295`). The renderer both makes the request and answers it. `display-capture` is in the auto-granted `ALLOWED` set (`permissions.ts:15`), so there is no second gate.
- **Attack or failure**: The attacker is anything with script execution in the renderer: a stored XSS in the chat surface, a compromised `web/dist` (see the deploy findings — `make build` writes straight into the live serving directory), or the `EVILION_URL` path above. They call `navigator.mediaDevices.getDisplayMedia({audio:true})`, receive their own `IPC.displaySources` event, and immediately reply `chooseDisplaySource(requestId, "screen:0", true)` without ever rendering `DisplayPicker`. They get a full-screen video track plus system loopback audio and can push it into a call or upload frames. The only signals the user gets are `win.show()` (`permissions.ts:249`) and, on macOS, the system recording indicator — nothing names *what* is being shared, and nothing required a click. The 120 s timeout at `permissions.ts:238` is the only other constraint.
- **Confidence**: traced. Mitigating factor worth stating: the site's CSP is genuinely strong — `script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com` with no `'unsafe-inline'` and no `blob:` (`internal/api/static.go:19`), and the built `index.html` has no inline scripts — so injecting script into the real origin is hard. The severity here is about what happens *if* that holds fails, which is the whole point of the sandboxed renderer.
- **Fix**: Draw the picker in the main process — a small, frameless `BrowserWindow` loading a local `file:`/`data:` page with its own preload, which the site's renderer cannot script. Failing that, require a `userGesture` on the `getDisplayMedia` request and have the main process show a persistent, main-process-owned banner naming the shared source for the duration of the capture.

### [HIGH] The Android signing key lives on one machine, is in no backup, and its absence silently produces a debug-signed release

- **Where**: `android/app/build.gradle.kts:10-13,81-90,112`, `android/README.md:60-62`, `.gitignore:16-17`, `backup.sh:1-12`, `tools/publish_android.py:140,146-147`
- **What**: Two things. First, `android/release.jks` and `android/keystore.properties` (which holds `storePassword`/`keyPassword` in plaintext, in the same directory as the key) exist only at `/path/to/nexa/android/`. They are correctly gitignored, and `backup.sh:9-10` copies only `data/chat.db` and `data/media` — nothing in the repository backs up the keystore. Second, `build.gradle.kts:112` reads `signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")`, and the `release` config is only created `if (keystoreProps.containsKey("storeFile"))` (`:82`). So if `keystore.properties` is missing, unreadable, or has a typo in the key name, `make android` does not fail — it produces a release APK signed with the **debug** key.
- **Attack or failure**: No attacker needed; this is a one-way door. Losing that Mac's disk means every installed Android app can never be updated again — a different key produces an APK Android refuses to install over the existing one, so every user must uninstall (losing their local encrypted key material) and reinstall. The silent-debug-signing path makes it worse and quieter: `make android && make publish-android` would succeed, and `publish_android.py:140` would write a `signing_sha256` for the debug certificate into `data/android/manifest.json`. That manifest feeds `/.well-known/assetlinks.json` (`internal/api/android_handlers.go:124-126`), so App Links would start advertising the wrong certificate, in-app updates would fail to install for every existing user, and the only warning printed is the unrelated note at `publish_android.py:146-147`.
- **Confidence**: traced.
- **Fix**: Make the release build fail loudly when `keystore.properties` is absent — replace the `?: signingConfigs.getByName("debug")` fallback with `?: error("release build needs android/keystore.properties")`. Pin the expected certificate SHA-256 in `publish_android.py` and refuse to write the manifest if it does not match. Get the keystore off this machine: an encrypted copy in two places, with the passwords stored separately from the key (a password manager, not the adjacent file). Record the fingerprint `1C:44:61:22:7C:06:8E:AF:55:91:FC:52:13:2E:8E:8B:BF:45:87:94:72:5A:8F:3E:FD:25:DF:6D:F2:6A:37:CA` somewhere outside the machine so a swap is detectable.

---

### [MEDIUM] `clipboard-read` is auto-granted and the web client never uses it

- **Where**: `desktop/src/main/permissions.ts:15`, `desktop/src/main/permissions.ts:34`
- **What**: `ALLOWED` includes `"clipboard-read"`, and any permission in that set is granted with `callback(true)` and no prompt. Grepping the entire web client turns up **only** `navigator.clipboard.writeText` and `navigator.clipboard.write` — every call site is a "copy" action (`web/src/components/chat/messageMenu.ts:72,88,133`, `web/src/components/modals/InviteModal.tsx:72`, `web/src/lib/imageActions.ts:108-111`, and eleven others). There is no `readText`/`read` call anywhere. The capability is granted and unused.
- **Attack or failure**: A compromised renderer calls `navigator.clipboard.readText()` and silently exfiltrates whatever is on the system clipboard. In a browser this prompts; here it does not. The stakes are specific: this app *writes* the account recovery key to the clipboard (`web/src/pages/RegisterPage.tsx:84`, `web/src/pages/RecoverPage.tsx:70`, `web/src/components/settings/AccountPage.tsx:132`) and the 2FA backup codes (`web/src/components/settings/SecurityPage.tsx:156`), and the user's clipboard on a chat machine routinely holds password-manager output.
- **Confidence**: traced — the grant and the absence of any read call are both verified.
- **Fix**: Remove `"clipboard-read"` from `ALLOWED`. Nothing breaks.

### [MEDIUM] Camera and microphone are granted with no prompt on Windows and Linux

- **Where**: `desktop/src/main/permissions.ts:19-35`
- **What**: For `permission === "media"` the handler prompts only on macOS, via `systemPreferences.askForMediaAccess` (`:25-32`). On every other platform control falls through to `callback(true)` at `:34`. Electron's `setPermissionRequestHandler` replaces Chromium's prompt entirely, so on Windows and Linux there is no user-facing consent for `getUserMedia({audio:true, video:true})` at all — first time or any time. On macOS the system prompt fires once and is silent thereafter.
- **Attack or failure**: A compromised renderer turns on the camera and microphone and records, with no prompt and no in-app indicator. The OS indicator (the Windows 11 privacy icon, the macOS orange dot) is the only signal, and on Linux there is generally none.
- **Confidence**: traced.
- **Fix**: This is partly a product decision — a chat app that prompts on every call is annoying — but the current shape grants the capability to *any* script in the renderer forever. At minimum, gate the first grant per platform behind a main-process dialog and remember it in `SettingsStore`, and show a main-process-owned indicator while a track is live.

### [MEDIUM] `publish_desktop.py` copies every `latest*.yml` it finds, and `desktop/dist` is never cleaned

- **Where**: `tools/publish_desktop.py:55-57,70-73`, `Makefile:36-38` (`desktop:`), `Makefile:55-56` (`clean:`)
- **What**: `manifests = [p for p in dist.glob("latest*.yml")]` takes whatever update manifests are sitting in `desktop/dist`, with **no check that their `version:` matches the version the script just derived from the artifacts** (`:50-54`). The `desktop:` target never empties `dist`, and `clean:` removes `bin web/dist android/app/build android/build` — not `desktop/dist` and not `desktop/dist-app`.
- **Attack or failure**: A half-applied release. `desktop/dist` right now holds a **pre-rebrand** build: `Evilion-Chat-1.0.3-*.dmg/.zip/.exe/.AppImage/.deb` plus `latest.yml`, `latest-mac.yml` and `latest-linux.yml` naming those files (all dated 14 Sep), while the live `data/desktop` holds `nexa-1.0.3-*`. Today the script fails safe, because `PATTERN` (`:18`) only matches `nexa-*` and it aborts with "no nexa artifacts" before touching anything. But the next build is the problem: bump to 1.0.4, run `make desktop`, and suppose the `--win` or `--linux` leg fails (cross-building NSIS on macOS is the fragile one). `dist` now contains `nexa-1.0.4-mac-*` — one version, so the guard at `:50-53` passes — alongside the stale `latest.yml`/`latest-linux.yml` from 1.0.3. The script copies all three manifests over the live ones (`:70-73`), so every Windows client is now told to fetch `Evilion-Chat-Setup-1.0.3-win-x64.exe`, which does not exist in `data/desktop` — every Windows auto-update 404s until someone notices. Meanwhile `manifest.json` (`:74-77`) lists only the mac files, so the download page silently stops offering a Windows build.
- **Confidence**: traced. The stale-manifest state in `desktop/dist` is present on disk right now; the failure is the next build away.
- **Fix**: `rm -rf dist` at the start of the `desktop:` target (and add `desktop/dist desktop/dist-app` to `clean`). In `publish_desktop.py`, parse each `latest*.yml`'s `version:` and refuse any that does not equal `version`, and refuse to publish unless the expected set of platforms is present.

### [MEDIUM] Installers are copied non-atomically into the live download directory and served `immutable` for a year

- **Where**: `tools/publish_desktop.py:63-66`, `tools/publish_android.py:121,144`, `internal/api/desktop_handlers.go:105-108`
- **What**: `shutil.copy2(p, dest / p.name)` writes each installer straight to its **final** name in the live directory. The `.yml` manifests immediately below get the careful treatment — `.tmp` then `Path.replace` (`:70-77`) — so the author knew; the 100–130 MB installers were missed. `publish_android.py:121` has the same shape, and `:144` writes `manifest.json` in place. chatd serves these with `Cache-Control: public, max-age=31536000, immutable` and full Range support (`internal/api/desktop_handlers.go:105-111`).
- **Attack or failure**: For the ~10 s it takes to copy a 127 MB zip, the file is servable at its real URL, truncated. A client or Cloudflare's edge that fetches it in that window gets a short file and pins it for a year — and because it is `immutable`, nothing will re-fetch it. The Mac updater will at least reject it on the SHA-512 check and back off (`update/index.ts:90-94`), but the *download page* hands the truncated file to a human with no checksum at all. Republishing the same version is worse: the live file is truncated and rewritten in place while clients may be mid-download, and the manifest's hash changes underneath them.
- **Confidence**: traced.
- **Fix**: Copy to `dest / (name + ".tmp")` and `Path.replace` into place, exactly as the manifests already do. Same in `publish_android.py`.

### [MEDIUM] The Rich Presence WebSocket port is reachable by every local user, not just the signed-in one

- **Where**: `desktop/src/main/rpc/wsServer.ts:31-48` (bind), `:50-69` (accept), contrast `desktop/src/main/rpc/ipcServer.ts:56-71`
- **What**: The IPC transport is protected: `process.umask(0o177)` around `server.listen` (`ipcServer.ts:60`) makes the socket file `0600`, so only the running user can connect. The WebSocket transport has no equivalent — `new WebSocketServer({ host: "127.0.0.1", port })` (`wsServer.ts:33`) is reachable by every process on the machine regardless of which user owns it. The only admission check is `if (origin) { ws.close(4001) }` (`:52-56`) plus a `^\d{1,20}$` `client_id` (`:65-69`). That origin check is the correct control against browser pages — the WebSocket API always sends `Origin`, and a `file:` page's `"null"` is truthy so it is rejected too — but loopback TCP carries no user identity to check.
- **Attack or failure**: A program running as a *different* local user (a second account, a low-privilege service account, a container sharing the host network namespace) connects to `ws://127.0.0.1:6463`, handshakes with any 17-digit number, and is answered by `RpcService.readyUser()` (`service.ts:169-182`) with the signed-in user's Nexa **id, username and display name**. It can then `SET_ACTIVITY` arbitrary text and arbitrary `https://` links, which the app publishes as that user's presence to their friends, and — when relaying is on — forwards to their real Discord account (`session.ts:124-127`). The activity fields are well sanitised on both sides, so this is impersonation-of-presence and identity disclosure, not injection.
- **Confidence**: traced.
- **Fix**: Discord has the same hole, so full compatibility and full safety are not both available. The practical options: write a per-run token into a `0600` file in the user's data directory and require it as a query parameter, accepting that only cooperating clients work; or make the WebSocket transport opt-in in settings (the IPC transport already covers most clients) and default it off. At minimum say so in the settings page, which currently presents the WebSocket port as a neutral fact (`RpcState.listening.ws`).

### [MEDIUM] Nexa interposes on the user's real Discord RPC connection and passes every frame through untouched

- **Where**: `desktop/src/main/rpc/session.ts:107-129`, `desktop/src/main/rpc/discord.ts:37-62,65-75`, `desktop/src/main/rpc/upstream.ts:26-73`
- **What**: On macOS and Linux the app *renames Discord's own socket* out of `discord-ipc-0` and takes that name for itself (`discord.ts:49-59`), so every program that speaks Discord RPC now reaches Discord only through Nexa. `RpcSession.handle` inspects the frame for `SET_ACTIVITY` (`session.ts:123`) and otherwise forwards `frame.raw` verbatim to the upstream Discord socket (`:124-127`), in both directions (`:88-90`). That includes `AUTHORIZE` and `AUTHENTICATE`, which carry Discord OAuth codes and access tokens.
- **Attack or failure**: No attacker today — nothing reads or logs those frames, and `log()` is only called with activity metadata. The finding is the position: Nexa has quietly become a man-in-the-middle on the user's Discord credentials, and any future logging, crash report or telemetry that captures RPC frames would leak OAuth tokens. The second half is availability: if the app is killed before `restore()` runs (`discord.ts:65-75`), Discord's socket is left at a higher index, and the only record of where it went is `movedSocket` in `settings.json` (`settings.ts:20,36`). `stopForExit()` (`service.ts:119-136`) deliberately does not wait, so a shutdown or a SIGKILL during quit leaves Discord's socket misplaced for programs that only try index 0.
- **Confidence**: traced.
- **Fix**: Document the interposition in the settings page (people should know the app sits between their programs and Discord). Add an explicit deny-list so `AUTHORIZE`/`AUTHENTICATE` frames are never touched by any future logging. For the socket move, consider writing the `movedSocket` record to a file Discord's own recovery would not clobber, and add a startup repair pass that runs even when `settings.json` is lost.

### [MEDIUM] Nothing in the release path runs the tests, the typechecker, or an audit — and there is no linter anywhere

- **Where**: `Makefile:14-15,36-38,44-46`, `Makefile:20-34` (the unused test targets), absence of `.github/`, absence of any lint config
- **What**: `desktop:` is `npm ci --no-audit --no-fund && npm run build && npx electron-builder …` — it never runs `npm run typecheck` or `npm test`, both of which exist (`desktop/package.json:14-15`) and are wired into `test-desktop` (`Makefile:28-29`), which nothing depends on. `android:` runs `assembleRelease` with no `testDebugUnitTest`. `web:` runs `npm run build`, which does include `tsc --noEmit` (`web/package.json:8`), so the web side typechecks but runs no tests. There is no CI — `.github` does not exist — and no git hooks (`.git/hooks` holds only `.sample` files). There is **no linter or formatter configured anywhere in the repository**: no `.eslintrc*`, `eslint.config.*`, `.prettierrc*` or `biome.json` at any depth. `--no-audit` on both `npm ci` calls means no advisory check ever runs in the release path.
- **Attack or failure**: A release can ship code that does not compile in the shell process (the desktop bundle is only typechecked by a target nobody is required to run), or that fails its own tests. Given the next finding — that the security-critical code paths have no tests at all — this compounds.
- **Confidence**: traced.
- **Fix**: Make `desktop:` depend on `test-desktop`, `android:` on `test-android`, and `build:` on `test-web test-go`. Add ESLint with `eslint-plugin-security` or at least `no-restricted-properties` rules for the Electron footguns.

### [MEDIUM] Every security control in the desktop app is untested

- **Where**: `desktop/test/` (6 files, 531 lines), `desktop/test/service.test.ts:119,141`
- **What**: The tests cover the RPC subsystem thoroughly — framing, activity normalisation, session rate limiting, socket takeover and crash recovery, manifest parsing, string hardening. They cover **none** of the controls this audit is about:
  - `src/preload/index.ts` is never imported. The origin gate at `:24` and the argv parser at `:9` are unexercised, as is `fromApp()` at `src/main/index.ts:57-59` and its enforcement at `:144`/`:149`.
  - `src/main/config.ts` — `isAppUrl`, `originOf`, and the `EVILION_URL` allowlist at `:12` — has no test, despite being the single source of truth for every origin decision.
  - `src/main/window.ts` is never imported: `setWindowOpenHandler`, `will-navigate`, `will-redirect`, and `openExternal`'s scheme allowlist are all untested.
  - `src/main/permissions.ts` (295 lines) is never imported: neither permission handler, nor `will-download`, nor the whole `handleDisplayMedia` flow.
  - `src/main/update/mac.ts` is never imported: the `/bin/sh` swap script, its rollback branch, `canReplace`, and the SHA-512 check are all untested — and `EVILION_UPDATE_NO_RELAUNCH` (`mac.ts:148`) was clearly added for a test that was never written.
  - `src/main/rpc/wsServer.ts` is never exercised: `service.test.ts:119` passes `websocket: false`, and `service.ts:92` skips construction on that flag. So the `Origin` rejection at `wsServer.ts:52-56` — the app's one anti-cross-site-WebSocket control, per that file's own header — never runs.
  - `service.test.ts:141` is `describe.skipIf(process.platform === "win32")` and `:117` forces `platform: "linux"`, so the Windows branches at `service.ts:128,244` are never taken on any platform.
- **Attack or failure**: A refactor that widens `isAppUrl`, drops a scheme check in `openExternal`, or removes the `Origin` guard on the WebSocket server passes every test and ships.
- **Confidence**: traced.
- **Fix**: These are the cheapest tests in the codebase, because they are nearly all pure functions. `isAppUrl`/`originOf` against a table of hostile URLs; `openExternal` with a stubbed `shell`; `setNativeStrings` is already done — do the same for `normalizeActivity`'s `image()`. For `wsServer`, flip `websocket: true` in one test and assert that a connection with `Origin: https://evil.example` is closed with 4001.

### [MEDIUM] Confirmed advisories: `react-router-dom` (shipped) and `vitest` (dev)

- **Where**: `web/package.json:26` (`react-router-dom ^6.30.6`), `web/package.json:41` and `desktop/package.json:28` (`vitest 3.2.7`)
- **What**: `npm audit` run against both lockfiles, with network, reports:
  - `react-router` 6.0.0–7.17.0 — **GHSA-wrjc-x8rr-h8h6**, open redirect via backslash in `<Link>` and `useNavigate` (a CVE-2025-68470 bypass), and **GHSA-337j-9hxr-rhxg**, arbitrary constructor injection via `deserializeErrors()` in SSR hydration. Both moderate. Installed version is 6.30.6; fixed in 7.18.4, a major bump. This one **ships to users**.
  - `@vitest/mocker` 2.1.0–4.1.10 — **GHSA-82fw-gwwq-j7x9**, path traversal / arbitrary file read. Moderate, dev-only, present in both `web` and `desktop`.
- **Attack or failure**: The open redirect is the one that matters, and it matters *more* inside the desktop app than in a browser: a crafted in-app link that resolves to `\\evil.example` navigates off-origin, `will-navigate` (`desktop/src/main/window.ts:99-104`) sees a non-app URL, prevents it, and hands it to `openExternal` — so the app opens the attacker's page in the user's default browser, from a click inside a trusted chat window. The scheme check keeps it to http/https, so this is phishing, not RCE. The SSR hydration issue does not apply (no SSR here).
- **Confidence**: traced — advisories confirmed by running `npm audit` against the actual lockfiles, not recalled.
- **Fix**: Upgrade `react-router-dom` to 7.x (a real migration) or apply the fix via an override if 6.x gets a backport. Bump `vitest` in both projects. Drop `--no-audit` from the `Makefile` so this surfaces on its own next time.

---

### [LOW] `will-navigate` allows any `data:text/html` URL, and the exemption is dead

- **Where**: `desktop/src/main/window.ts:101`, `desktop/src/main/window.ts:108-111`
- **What**: `if (isAppUrl(url) || url.startsWith("data:text/html")) return;` — a prefix match on the whole URL, so *any* `data:text/html,…` payload is allowed to navigate the main frame. The exemption exists for the offline page, but the offline page is loaded programmatically with `wc.loadURL(offlinePage())` at `:110`, and Electron does not emit `will-navigate` for `loadURL`. So the allowance is never needed.
- **Attack or failure**: A `data:` document gets an opaque origin (verified: `new URL("data:text/html,x").origin === "null"`), so the preload would not expose the bridge (`preload/index.ts:24`) and `fromApp` would reject its IPC. The practical risk is low. Whether a renderer can even reach this path is uncertain — Chromium has blocked renderer-initiated top-level `data:` navigations since M60, which would make the branch unreachable.
- **Confidence**: the code path is traced; whether Chromium permits the navigation at all is **needs confirmation**.
- **Fix**: Delete the `data:text/html` clause.

### [LOW] `will-frame-navigate` is not handled, so subframes may navigate anywhere

- **Where**: `desktop/src/main/window.ts:99-107`
- **What**: `will-navigate` fires for the main frame only. There is no `will-frame-navigate` handler and no `app.on("web-contents-created")` guard, so an iframe on the page may navigate to any origin. The CSP's `frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com` (`internal/api/static.go:19`) is what actually constrains this, and `webviewTag` defaults to false.
- **Attack or failure**: A cross-origin subframe gets no bridge (`preload/index.ts:24`) and its IPC is rejected (`index.ts:58`), so this is defence-in-depth rather than a hole. Worth knowing: `isAppUrl` returns **true** for `blob:https://chat.evilion.xyz/…` — verified, `new URL("blob:https://chat.evilion.xyz/abc").origin === "https://chat.evilion.xyz"` — so a blob document the page creates keeps the bridge. That is correct (blob URLs are same-origin and inherit the creator's CSP), but it means a page that navigates itself to a blob does not lose its privileges.
- **Confidence**: traced.
- **Fix**: Add `wc.on("will-frame-navigate", …)` with the same `isAppUrl` test, so the app does not depend on the server's CSP for this.

### [LOW] `data/desktop` is 3.0 GB and nothing prunes it

- **Where**: `tools/publish_desktop.py:6-10` (docstring), `data/desktop/`
- **What**: 52 files across four versions (1.0.0 through 1.0.3), roughly 750 MB per release, on the same volume as the SQLite database and media blobs. Keeping the previous release is deliberate — so an update already downloading can finish — but there is no retention step at all, and `publish_desktop.py` never deletes anything.
- **Attack or failure**: A full disk on the box that also runs the database. At the current cadence that is a handful of releases away.
- **Confidence**: traced.
- **Fix**: Keep N−1 and N; delete everything older after a publish, or after a grace period.

### [LOW] The live desktop release predates the rebrand, and `package.json` is a version ahead of anything published

- **Where**: `desktop/package.json:4` (`1.0.4`), `data/desktop/manifest.json` (`1.0.3`), `data/desktop/latest*.yml` (`1.0.3`), `deploy/README.md:48`
- **What**: `unzip -l data/desktop/nexa-1.0.3-mac-arm64.zip` shows the bundle inside is **`Evilion Chat.app/`** — the live "Nexa" download installs an app called Evilion Chat. Meanwhile `desktop/package.json` is already at 1.0.4 (bumped in `47e5bb5`, the localized-native-menus change), and 1.0.4 has never been built or published. Nothing checks that the source version matches what is live; the entire release checklist is the sentence at `deploy/README.md:48`, "bump version in desktop/package.json first".
- **Attack or failure**: User-visible inconsistency, and a silent trap: running `make desktop && make publish-desktop` without bumping overwrites the live files for the same version in place (see the non-atomic copy finding) while every client's `compareVersions` sees no change and nobody updates.
- **Confidence**: traced.
- **Fix**: Have `publish_desktop.py` refuse to publish a version that already exists in `DESKTOP_DIR` unless `--republish` is passed, and have it read `desktop/package.json` to confirm the built version is the intended one.

### [LOW] The Android release is published but switched off, with no record of why

- **Where**: `data/android/manifest.json.held`, `internal/api/android_handlers.go:64-71,76,124-126`
- **What**: The live directory contains `manifest.json.held`, not `manifest.json`. `androidManifest()` returns false, so `/api/v1/android/latest` 404s `no_release` **and** `/.well-known/assetlinks.json` 404s — Android App Links are silently off — while `/android/evilion-chat-1.0.1.apk` still serves to anyone with the URL. The `.held` convention appears nowhere in the repository: not in `android/README.md`, not in `deploy/README.md`, not in `tools/publish_android.py`.
- **Attack or failure**: Not an attack. It is an undocumented production state that the next person (or the next you) will not be able to reason about, and the failure mode — App Links quietly disabled — is invisible.
- **Confidence**: traced.
- **Fix**: Either restore the manifest or record the reason. If holding a release is a real workflow, give `publish_android.py` a `--hold`/`--release` pair so it is a command rather than a hand-rename.

### [LOW] `web/dist/.DS_Store` is served publicly

- **Where**: `internal/api/static.go:42-55`
- **What**: The SPA handler cleans the path and joins it under `WebDist` with only a prefix-containment check. There is no dotfile filter, unlike `/desktop/` and `/android/`, which reject dotfiles via their filename regexes (`internal/api/desktop_handlers.go:19`, `internal/api/android_handlers.go:22`). A `.DS_Store` exists in `web/dist` right now, so `GET /.DS_Store` returns it with a sniffed content type.
- **Attack or failure**: Leaks the build directory's filenames. Low value on a Vite build with hashed assets, but it is free to close. (`data/desktop/.DS_Store` also exists but is correctly unreachable.)
- **Confidence**: traced by the static-file audit; I did not issue the HTTP request.
- **Fix**: Reject any path segment starting with `.` in the SPA handler.

### [LOW] `make build` writes straight into the live serving directory, non-atomically

- **Where**: `Makefile:12-15`, `internal/config/config.go:84,104`, `deploy/install.sh:57`, `deploy/README.md:31`
- **What**: There is no deploy step. `make web` runs `vite build` into `web/dist`, and that *is* the live directory chatd serves (`WEB_DIST=./web/dist`, daemon `WorkingDirectory` is the repo root). `install.sh` only checks that `web/dist/index.html` exists. Rollup rewrites `index.html` in place, so a request landing during the write can read a truncated document, which `static.go:86-95` serves as a 200 (it only handles `os.Open` failure). `npm ci` at `Makefile:15` deletes and reinstalls `node_modules` first, which widens the whole window to minutes — though during that stretch `web/dist` is stale-but-complete, which is fine; the dangerous moment is the write itself.
- **Attack or failure**: A user loading the site during a deploy gets a blank page with no error to retry on. Two real mitigations already exist and are deliberate: `emptyOutDir: false` plus `pruneOldAssets()` keeping replaced hashed chunks for 7 days (`web/vite.config.ts:72-96,118`), so an open tab survives; and missing assets 404 with `no-store` rather than being served as HTML (`static.go:60-64`). Only `index.html` is exposed.
- **Confidence**: traced (by the static-serving audit).
- **Fix**: Build into `web/dist.next`, then `rename` the directory into place — one atomic syscall — and point `WEB_DIST` at a symlink you swap. Or simply write `index.html` via a temp file and rename, which is where the whole risk lives.

### [LOW] `restartDiscordWindows` resolves `tasklist` and `taskkill` by bare name, and is reachable from the page

- **Where**: `desktop/src/main/rpc/discord.ts:108,119,126`, `desktop/src/main/index.ts:166`
- **What**: `execFile("tasklist", …)` and `execFile("taskkill", …)` go through Windows' `CreateProcess` search order, which includes the process's current directory. It then launches `%LOCALAPPDATA%\<build>\Update.exe` (`:126`), a user-writable path. Separately, `IPC.rpcRestartDiscord` is exposed to the renderer (`preload/index.ts:36` → `index.ts:166`).
- **Attack or failure**: The PATH/CWD hijack is same-user, so no privilege boundary is crossed — but it is free to close. The renderer reachability means a compromised page can force-kill the user's Discord with `/T /F` at will.
- **Confidence**: traced.
- **Fix**: Use `path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe")` and likewise for `taskkill`. Consider requiring a recent user gesture for `rpcRestartDiscord`.

### [LOW] `openExternal` allows `mailto:`, and any page-initiated `window.open` opens the browser

- **Where**: `desktop/src/main/window.ts:15-22,95-98`
- **What**: The scheme allowlist is `https:`, `http:`, `mailto:`. The important part is right: `file:`, `smb:`, `ms-msdt:`, `search-ms:` and every other locally-handled scheme are refused, which closes the standard Electron `openExternal` RCE. `mailto:` hands an attacker-controlled subject/body/recipient to the system mail client. Separately, `setWindowOpenHandler` opens the default browser for **any** `window.open` from the page, with no user-gesture requirement.
- **Attack or failure**: A compromised renderer can pop the user's browser at arbitrary https URLs in a loop, and compose mail. Nuisance and phishing, not code execution.
- **Confidence**: traced.
- **Fix**: Consider dropping `mailto:` unless a feature needs it (nothing in `web/src` appears to emit one). Consider requiring `disposition !== "background-tab"` or a gesture in the window-open handler.

### [LOW] `link()` in the desktop's activity sanitiser accepts password-only userinfo

- **Where**: `desktop/src/main/rpc/activity.ts:31-39`
- **What**: The check is `u.hostname && !u.username`. `new URL("https://:pw@evil.com/")` has `username === ""` and `password === "pw"`, so it passes. The server's equivalent uses `u.User == nil` (`internal/gateway/activity.go:226-236`), which does catch it.
- **Attack or failure**: A local RPC program could relay a `https://:x@evil.example` URL through the desktop app; the server strips it before anyone sees it, so the impact is nil today. It is an inconsistency between two copies of the same rule.
- **Confidence**: traced.
- **Fix**: `!u.username && !u.password`.

### [LOW] `setIdentity` has no length limits, and the identity is handed to every local RPC program

- **Where**: `desktop/src/preload/index.ts:40`, `desktop/src/main/index.ts:167-169`, `desktop/src/main/rpc/service.ts:169-182`
- **What**: The preload coerces with `String()` but caps nothing; the main process accepts the object if `typeof user.id === "string"`. That identity goes verbatim into the `READY` payload every connected local program receives. Also, when `user` is a truthy non-object the preload produces `id: "undefined"`, which passes the type check.
- **Attack or failure**: A compromised renderer makes the app hand a megabyte-long username to every local RPC client, or publish a nonsense identity. Trivial, but the identity is the one piece of user data that crosses the process boundary outward.
- **Confidence**: traced.
- **Fix**: Cap each field to a sane length in `index.ts:167-169` and require `typeof user === "object"`.

### [LOW] Electron is pinned exactly with no update path, and the release target never audits

- **Where**: `desktop/package.json:18-30`, `Makefile:15,38`
- **What**: Every desktop dependency is pinned to an exact version with no caret. `npm outdated` (run with network) reports `electron 44.3.0 → 44.4.1` — one patch behind. Electron patch releases are where Chromium security fixes land, and this app ships a browser to people's machines. Both `npm ci` invocations pass `--no-audit`.
- **Attack or failure**: Chromium CVEs fixed in 44.4.x are live in the shipped app until someone bumps by hand, and nothing reminds them.
- **Confidence**: traced — the version gap is confirmed against the registry. I have **not** confirmed what is in 44.4.0/44.4.1, so I am not claiming a specific CVE.
- **Fix**: Track Electron's release notes, or at minimum add a `make outdated` and run it before each release. Keep the exact pins — reproducibility is worth more than drift — but make the bump a deliberate, scheduled step.

---

## Polish

- `desktop/src/main/window.ts:8,195` — `BASE` is imported and used nowhere except the no-op discard `void BASE;`. Both lines can go.
- `desktop/src/main/index.ts:196-197` — `IPC.setCallActive` is a registered no-op, still exposed to the page (`preload/index.ts:53`) and still called by it (`web/src/components/desktop/DesktopEffects.tsx:108`). Intentional per the comment, but it is dead weight in the bridge contract and is not marked as such in `src/shared/bridge.ts`.
- `desktop/src/main/rpc/activity.ts:41-43` — `image()` accepts any string up to 1024 characters, not a URL. It is the one field in the file that validates nothing. Harmless in practice: `internal/gateway/activity.go:262-309` is the real gate, and everything the desktop page renders comes back through `/activities/preview` already resolved and proxied (`web/src/components/settings/DesktopPage.tsx:45-53`). Worth tightening anyway, so the two sanitisers agree.
- `desktop/src/main/update/manifest.ts:61` — `v.split("-", 2)` drops everything after a second hyphen, so `1.0.0-rc-2` compares as `1.0.0-rc`.
- `desktop/src/main/update/index.ts:124,134` — `checkMac` fetches and parses `latest-mac.yml` twice (once via `newerThanRunning`, once inside `stageMacUpdate`). A publish between the two calls is unhandled.
- `desktop/electron-builder.yml:16` — `- "trayTemplate*.png"` is already covered by `- "tray*.png"` on line 15. Separately, the root `extraResources` ships `badge.png` to macOS and Linux where `setBadge` only uses it on Windows (`src/main/index.ts:272-277`), and ships each platform's tray art to the platforms that ignore it.
- `desktop/dist/` holds ~1.5 GB of untracked pre-rebrand `Evilion-Chat-1.0.3-*` build leftovers, plus `mac/`, `mac-arm64/`, `win-unpacked/` and `linux-unpacked/`. Safe to delete; see the `make clean` finding.
- `README.md:52-54,77-78` still describes calls as peer-to-peer WebRTC with "no media server on this box". Voice went to the Cloudflare SFU; the README did not follow.
- No `Strict-Transport-Security` header is set anywhere in the repository. The origin binds `127.0.0.1:8090` behind the Cloudflare tunnel, so it would have to come from the edge — but nothing in `deploy/` records that it is set, which means nobody can tell whether it is.
- `internal/api/android_handlers.go:204-222` — `/native/captcha` is the one HTML response the server sends with no CSP. Its interpolated values are tightly validated (`:216-218,224`), so it is not injectable today; it is the only page with nothing behind it if that changes.

## What I checked and found clean

Worth recording, so the next audit does not re-derive it:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` — set at `desktop/src/main/window.ts:74-77` and relaxed nowhere. `nodeIntegrationInSubFrames` and `webviewTag` are left at their safe defaults.
- No `webRequest` handler, no `protocol.*` registration, no `setAsDefaultProtocolClient`, no `certificate-error` listener, no `setCertificateVerifyProc` anywhere in `desktop/src/`.
- Every `ipcMain` channel is wrapped by `fromApp()` (`desktop/src/main/index.ts:141-150`), which checks both `e.sender === win.webContents` **and** `isAppUrl(e.senderFrame?.url)` — the current recommended pattern, and it fails closed when the frame is gone.
- `IPC.rpcSetHidden` validates its `clientId` against `^\d{1,20}$` (`index.ts:162`); `IPC.settingsSet` copies only four known boolean keys (`index.ts:186-189`); `IPC.setStrings` goes through `setNativeStrings`, which type-checks, trims and caps each field at 120 characters (`strings.ts:38-49`) and is the one control that *is* tested. `chooseDisplaySource` requires a `requestId` the main process generated (`permissions.ts:226,293-295`).
- The offline and splash pages are built as `data:` URLs with HTML-escaping on every interpolated string (`window.ts:44-53`), and the escaped set covers what those insertion points need.
- Permission handling correctly excludes `geolocation`, `midi`, `midiSysex`, `openExternal`, `hid`, `serial` and `usb` — `ALLOWED` is a closed list (`permissions.ts:15`) and the origin check comes first.
- `will-download` cancels anything not from the app origin, `blob:` or `data:` (`permissions.ts:43-45`).
- The IPC Rich Presence socket is created under `umask(0o177)` (`ipcServer.ts:60`), handshake-first with a 10 s timeout (`:96,110-113`), and the frame decoder caps payloads at 64 KiB and rejects unknown opcodes (`frame.ts:39-40`).
- The mac updater's swap script passes its paths as `$1`–`$6` positional parameters to `/bin/sh -c`, never interpolated into the script text (`mac.ts:129-149`). A path containing quotes, `$`, backticks or newlines cannot inject; only `process.pid` is interpolated and it is a number. The rollback branch (`mv "$3" "$1"` at `:141`) restores the old bundle if the second move fails, and the old app is kept in the work directory until an app is back in place (`:144`).
- `canReplace()` correctly refuses to update from `/Volumes/` or an AppTranslocation path (`mac.ts:81`).
- Packaging is correct and I verified it against the real bundle: `electron-updater` is a static-string dynamic import, so esbuild fully inlined it; `koffi`'s two-stage loader falls through to `process.resourcesPath + "/koffi/win32_x64/koffi.node"`, which `electron-builder.yml:46-48` does supply (confirmed present in `dist/win-unpacked/resources/koffi/`, which also proves `win.extraResources` merges with the root block rather than replacing it); `bufferutil`/`utf-8-validate` are optional and try/caught. Nothing that ships is missing from the installer.
- No dependency in `desktop/package.json` is unused. `@xhayper/discord-rpc` exists only to drive one integration test (`desktop/test/service.test.ts:291`) and never enters the bundle.
- `desktop/dist-app/main.js` and `preload.js` are **not** tracked in git (`desktop/.gitignore:2-3`).
- No secrets are committed. `chatd.env`, `android/release.jks` and `android/keystore.properties` are all gitignored (`.gitignore:5,16,17`) and `git ls-files` turns up no key, certificate or token material. `chatd.env.example` carries only empty placeholders for `REGISTRATION_KEY`, `TURN_*`, `KLIPY_API_KEY`, `REALTIME_APP_SECRET` and `TURNSTILE_*`.
- Server-side Rich Presence validation is thorough and is the real gate: `internal/gateway/activity.go:107-309` caps the count, forces the displayed name to the real Discord application's name, whitelists types, strips control and bidi characters, rejects any non-http(s) or userinfo-bearing URL, clamps timestamps and party sizes, allowlists image forms, and rewrites every image through this server's own sandboxed media proxy.
- The site's CSP is real and enforceable: `script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com`, no `'unsafe-inline'`, no `blob:`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` backed by `X-Frame-Options: DENY` (`internal/api/static.go:19`, `internal/api/middleware.go:94-97`). The built `index.html` has no inline scripts, so the policy is not decorative.
- `/desktop/` and `/android/` file serving is tight: a strict filename regex, an explicit `..` check, a `filepath.Dir` containment check and an `IsRegular` check — three independent traversal guards, dotfiles rejected by the regex's first character class (`internal/api/desktop_handlers.go:19,69,79,90`).
