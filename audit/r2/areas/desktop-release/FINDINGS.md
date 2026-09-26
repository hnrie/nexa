# Findings — desktop-release (prefix `DESK`)

(Summary is written at the top when the audit is done.)

## Findings

### DESK-001 · P1 · security · The release-manifest signature is only checked on macOS; Windows and Linux AppImage install whatever `/desktop/` serves
- Where: `desktop/src/main/update/index.ts:100-121` (`checkAuto`), `desktop/src/main/update/mac.ts:102-117` (`manifestIsOurs`, the only caller of `RELEASE_PUBLIC_KEY`), `desktop/scripts/sign-release.mjs:2-15`, `desktop/electron-builder.yml:43-57` (no `publisherName`)
- What: `checkAuto` hands the feed to `electron-updater` and never fetches `latest.yml.sig`. electron-updater's generic provider verifies only the sha512 written in `latest.yml`, which is served from the same directory as the installer; its Windows Authenticode check is skipped because `publisherName` is unset and the builds are unsigned. `grep -rn "\.sig\|manifestIsOurs\|RELEASE_PUBLIC_KEY" desktop/src` hits mac.ts only.
- Impact: the property `sign-release.mjs` states ("an app will only install a build this machine released") holds on macOS only. Whoever can write `data/desktop/` on the server, or the server if it is compromised, can push arbitrary code to every Windows and AppImage user at the next minute poll; it is downloaded in the background and installed silently on quit (`autoInstallOnAppQuit = true`, NSIS silent). The download page offers both builds.
- Fix: in `checkAuto`, before `checkForUpdates()`, fetch `latest.yml` and `latest.yml.sig`, verify with `manifestIsOurs` (move it from mac.ts to manifest.ts), parse the signed body and require `updateInfo.version` and the chosen file's `sha512` reported by electron-updater to equal the signed manifest's; otherwise refuse and set `error`. Do the same for `checkManual` (the deb only shows a version and a link, so that one is low stakes).
- Effort: M
- Status: open

### DESK-002 · P2 · bug · macOS/Linux: Discord quitting while its socket is renamed deletes Nexa's own RPC socket; Rich Presence silently stops until Nexa restarts
- Where: `desktop/src/main/rpc/discord.ts:49-60` (the rename), `desktop/src/main/rpc/service.ts:79-99` (nothing re-checks the socket after `open()`), `service.ts:211-214` (`refreshDiscord` skips `this.ipc.path`)
- What: `claimFirst` renames Discord's `discord-ipc-0` to a free index and Nexa listens on `discord-ipc-0`. Discord's server still holds `discord-ipc-0` as its bound path, and libuv unlinks the bound path when a pipe server closes. Verified on this Mac with Node: a server listening on `s0`, renamed to `s1`, then closed, deleted the unrelated file that had been put at `s0` (`after close: p0 exists = false | p1 exists = true`). So a clean Discord quit — the user quitting it, or Discord's own update restart — deletes Nexa's live socket file. Nexa's server keeps running with no filesystem entry; when Discord starts again it binds `discord-ipc-0` itself. From then on every RPC program connects straight to Discord and never reaches Nexa, and `refreshDiscord()` probes every index except `this.ipc.path` (index 0, where Discord now is), so the settings page reports Discord absent while it is running.
- Impact: Rich Presence in Nexa disappears after any Discord restart, with a wrong status, until Nexa is restarted. Discord restarts itself for updates, so this is routine. Windows (named pipes, no rename) is unaffected.
- Fix: on the minute timer or in `refreshDiscord()`, `fs.existsSync(this.ipc.path)`; when the file is gone, `await stop(); await start()` (which renames Discord's new socket and re-listens). Also let `endpoints()` consider `ours` when it no longer exists on disk. A test: start the service against a fake "Discord" `net.Server`, close that server, assert the service re-listens.
- Effort: M
- Status: open

### DESK-003 · P2 · parity · Windows and Linux ship with no application menu, so there is no Reload, zoom, full-screen or DevTools shortcut
- Where: `desktop/src/main/window.ts:168-172` (`Menu.setApplicationMenu(null)` off macOS), `window.ts:75` (`autoHideMenuBar: true`, which now hides nothing)
- What: on macOS the View menu supplies Cmd+R, Cmd+0/+/-, full screen and DevTools. Off macOS the menu is null, and Electron has no accelerators without a menu.
- Impact: a Windows or Linux user with a stuck page (a JS error, a lost socket the page's own recovery did not catch) cannot reload; the X button hides to the tray (`closeToTray` defaults on), so the only way out is Quit from the tray and reopening. Ctrl+wheel still zooms, and then nothing resets it. F11 does nothing.
- Fix: build the same template on every platform and keep `autoHideMenuBar: true` so Windows/Linux see it only on Alt — that is what the option was for.
- Effort: S
- Status: open

### DESK-004 · P2 · i18n · The screen-share picker window is English-only while every other native surface follows the page's language
- Where: `desktop/src/picker/picker.html:12,114-115,119-121`, `desktop/src/picker/ui.ts:95-96,100`, `desktop/src/main/displayPicker.ts:62,97` (the offer carries `sources`, `audio`, `dark` and no strings)
- What: "Choose what to share", "Everyone in the call will see the screen or window you pick…", "Screens", "Windows", "Share this computer's sound", "Cancel", "Share" and "This computer is not letting Nexa see the screen." are literals. The tray, menu bar, text menu and offline page take `NativeStrings` from the page in eleven languages (`shared/bridge.ts:92-107`); the picker was rebuilt as its own window in round 1 and did not get them.
- Impact: every non-English desktop user meets an English dialog at the moment of sharing a screen, on every share; `<html lang="en">` is fixed and there is no RTL direction.
- Fix: add the eight strings to `NativeStrings` (and to `en.json` plus the other locales — `[i18n-copy]`), pass `nativeStrings()` and the page's direction in the offer from `askForDisplaySource`, set them with `textContent` in `ui.ts`, and set the window `title` from them too.
- Effort: M
- Status: open

### DESK-005 · P3 · bug · `will-redirect` cancels every redirect inside an allowed subframe
- Where: `desktop/src/main/window.ts:119-121`
- What: `will-redirect` is emitted for subframe navigations as well (the event carries `isMainFrame`), but the handler prevents anything whose target is not the app origin. `will-frame-navigate` (lines 115-118) has the frameable exception; this one does not.
- Impact: a server-side redirect inside the Turnstile or YouTube iframe — even to the same host — blanks that frame, only in the desktop app, with nothing logged. Not reproducible today (`curl -sI https://www.youtube-nocookie.com/embed/<id>` answers 200 with no redirect), so this is latent: the day Cloudflare or Google adds a redirect hop, sign-in or embeds break on desktop only.
- Fix: `wc.on("will-redirect", (event, url, _inPlace, isMainFrame) => { if (isMainFrame ? !isAppUrl(url) : !isFrameableUrl(url)) event.preventDefault(); })`.
- Effort: S
- Status: open

### DESK-006 · P3 · security · Eight `EVILION_*` environment hooks are honoured by packaged builds; only `EVILION_URL` is gated on `app.isPackaged`
- Where: `desktop/src/main/index.ts:19` (`EVILION_USER_DATA`), `index.ts:26` (`EVILION_DEBUG`), `index.ts:256` (`EVILION_NO_LOGIN_ITEM`), `permissions.ts:289` (`EVILION_SHARE_AUDIO_MODE`), `appAudio.ts:26-27` (`EVILION_WINDOW_AUDIO`), `appAudio.ts:179` (`EVILION_TEST_PROGRAM_AUDIO_DEVICE`), `update/index.ts:57` (`EVILION_UPDATE_TEST`), `update/mac.ts:174-175` (`EVILION_UPDATE_NO_RELAUNCH`); contrast `config.ts:8-14`.
- What: `EVILION_TEST_PROGRAM_AUDIO_DEVICE` goes verbatim to Chromium as a share's audio device id (the brief records that a malformed `applicationLoopback:` id CHECK-crashes the audio service); `EVILION_USER_DATA` moves the profile — cookies and session — to any path; `EVILION_UPDATE_NO_RELAUNCH` leaves the app quit after an update.
- Impact: only something already running as the user can set them, so no privilege boundary is crossed; but a shipped app's behaviour depends on variables nothing documents, and an exported test variable in a shell profile (this Mac has had several) changes the installed app. `config.ts` already settled the principle for `EVILION_URL`.
- Fix: one helper `testHook(name)` that returns `undefined` when `app.isPackaged`, used for the test-only ones; keep `EVILION_DEBUG` (and `EVILION_USER_DATA` if wanted for support) and document them in `tools/README.md`.
- Effort: S
- Status: open

### DESK-007 · P3 · code · `lastUpdateSeen` is dead, and `SettingsStore`'s `typeof` loop can never load a field whose default is `null`
- Where: `desktop/src/main/settings.ts:22,37,49-55`
- What: `lastUpdateSeen` is declared and defaulted and used nowhere (`grep -rn lastUpdateSeen desktop/src` → settings.ts only). The load loop keeps a stored value only when `typeof raw[key] === typeof DEFAULTS[key]`; with a `null` default that is `"object"`, so a stored string would be dropped — `bounds`, `movedSocket` and `strings` each needed a line of their own (52-54) to work around it. `bounds` is then accepted with no shape check: a `width: "x"` in a hand-edited file makes `new BrowserWindow` throw at every launch until the file is fixed.
- Fix: drop `lastUpdateSeen`; validate per key (booleans; `hiddenApps` as strings matching `/^\d{1,20}$/`; `bounds` as finite numbers) instead of `typeof` against a default.
- Effort: S
- Status: open

### DESK-008 · P3 · bug · With nobody signed in, RPC programs are told the user is "evilion"
- Where: `desktop/src/main/rpc/service.ts:169-182`
- What: `readyUser()` falls back to `username: "evilion"`, `global_name: "Nexa"`, `id: "0"` when `identity()` is null — before login, on the login page, after logout.
- Impact: a game connected to Nexa while the user is signed out shows the owner's handle as the player's name.
- Fix: `username: "nexa"`; keep `global_name: "Nexa"`.
- Effort: S
- Status: open

### DESK-009 · P3 · design · Windows/Linux spellcheck downloads Hunspell dictionaries from Google's CDN
- Where: `desktop/src/main/window.ts:83` (`spellcheck: true`); no `setSpellCheckerDictionaryDownloadURL` or `setSpellCheckerLanguages` anywhere (`grep -rn spellChecker desktop/src` → none)
- What: Electron's spellchecker on Windows and Linux fetches `.bdic` dictionaries for the session's languages from Google's dictionary CDN on first use; macOS uses the system checker and fetches nothing.
- Impact: a privacy-positioned chat client makes a request to Google on first launch on two platforms, unannounced. Only the language list leaks, but it is the kind of thing this app's users notice.
- Fix: host the needed dictionaries under chat.evilion.xyz and call `ses.setSpellCheckerDictionaryDownloadURL`, or say so on the download page and in Settings → Desktop.
- Effort: S (say so) / M (self-host)
- Status: open

### DESK-010 · P3 · a11y · The picker's selected tile is conveyed only by a border colour
- Where: `desktop/src/picker/ui.ts:49-53,62-64`, `picker.html:72`
- What: selecting sets `data-selected` and a 2 px border; the tiles are `<button>`s without `aria-pressed`, the two groups have no `role="group"`/label, and the Share button becoming enabled is the only programmatic hint.
- Impact: a screen-reader user cannot hear which source is selected; a low-vision user in light mode sees a thin purple border as the only cue.
- Fix: `tile.setAttribute("aria-pressed", String(selected))` in `select`, `role="group" aria-labelledby` around each grid, and a check glyph on the selected tile.
- Effort: S
- Status: open

### DESK-011 · P3 · bug · "Restart Nexa" exits with `app.exit(0)`, skipping `will-quit`
- Where: `desktop/src/main/permissions.ts:142-145`, `desktop/src/main/index.ts:317-323`
- What: `app.exit()` emits neither `before-quit` nor `will-quit`, so `stopRpc()` (which gives Discord its socket name back) and `settings.flush()` do not run. The relaunched app adopts the leftover move in `claimFirst`, so RPC recovers on its own; a debounced settings write from the last 400 ms (window bounds) is lost.
- Fix: `app.relaunch(); app.quit();` — `before-quit` sets `quitting`, so the close-to-tray handler lets the window go.
- Effort: S
- Status: open
