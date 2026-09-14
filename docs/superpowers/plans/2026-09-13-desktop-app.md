# Evilion Chat — Desktop App with Discord-compatible Rich Presence Implementation Plan

> **Status:** approved by the owner on 2026-09-13 ("Lets do it, just make sure it works without the discord client open also ofc, do the plan dont ask anything else"). Decisions taken as recommended: unsigned builds with our own Mac updater; move Discord's socket aside on macOS/Linux and launch at login plus "Restart Discord" on Windows; game detection and Join parity later (Tasks 10–11 not in this round); downloads served by chatd; Windows x64, macOS x64+arm64, Linux x64 AppImage+deb; relay tested against the owner's running Discord. Rich Presence must work fully with Discord closed.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Windows, macOS and Linux downloads of an Evilion Chat desktop app that updates itself, stays light, and runs a Discord-compatible local RPC server. Anything that shows Rich Presence on Discord (games, music players, editors) also shows on Evilion Chat, with every Rich Presence field Discord renders, including the playback bar for music and video. Discord keeps getting the same presence when it is running. The website offers the right download for the visitor's computer in a banner that can be closed.

**Architecture:**
- **The app is a thin Electron shell around the live site.** The window loads `https://chat.evilion.xyz`, so the web app keeps updating on its own. A small preload bridge (`window.evilionDesktop`) adds what a browser cannot do: tray, badge, launch at login, a screen picker, updates, and presence.
- **The RPC server lives in Electron's main process.**
  - It speaks Discord's IPC protocol on `discord-ipc-N` (named pipe on Windows, Unix socket on macOS and Linux), plus Discord's local WebSocket transport.
  - For each app that connects, it opens a mirror connection to the real Discord when Discord is running and relays every frame both ways. The app therefore gets Discord's genuine replies and events, and the presence shows on Discord.
  - Meanwhile it reads each app's `SET_ACTIVITY` and hands the activity to the web app. The web app sends it to chatd over its existing gateway socket.
- **chatd treats activities as part of presence.** They are held in memory per connection and cleared when that connection or app goes away. chatd validates them to Discord's limits and fans them out to the same people who see your online status. Image URLs are rewritten to chatd's signed media proxy, so viewers never contact Discord's CDN or third-party image hosts. Discord application names and art assets are looked up by chatd and cached, so users' IP addresses do not reach Discord's API.
- **Releases are served by chatd.** `/desktop/` holds the installers and update manifests (with HTTP range requests). `GET /api/v1/desktop/latest` feeds the banner and the download page.

**Spec:** this document plus the research notes below. It builds on the owner's standing constraints from earlier work: free services only, no IP leaks, keep E2EE, phones first, don't break existing features.

## Research notes (what the implementation must match)

- **IPC transport.**
  - Pipes are tried as `discord-ipc-0` through `discord-ipc-9`. On Windows the path is `\\?\pipe\discord-ipc-N`. On macOS and Linux it is the first set of `$XDG_RUNTIME_DIR`, `$TMPDIR`, `$TMP`, `$TEMP`, falling back to `/tmp`, followed by `/discord-ipc-N`.
  - Clients connect to the first index that accepts. Several Discord builds (Stable, PTB, Canary) each take the first free index. On this Mac, the running Discord holds `$TMPDIR/discord-ipc-0`.
  - Frame layout: `uint32 LE opcode | uint32 LE length | JSON`. Opcodes: 0 HANDSHAKE `{v:1, client_id}`, 1 FRAME, 2 CLOSE, 3 PING, 4 PONG.
  - Close codes: 1000 normal, 4000 invalid client id, 4001 invalid origin, 4002 rate limited, 4004 invalid version. Error codes include 4000 invalid payload and 4002 invalid command.
- **Messages.**
  - Every message is `{cmd, nonce, evt, data, args}`.
  - After the handshake the server sends `{cmd:"DISPATCH", evt:"READY", data:{v:1, config:{cdn_host:"cdn.discordapp.com", api_endpoint:"//discord.com/api", environment:"production"}, user:{id, username, discriminator:"0", global_name, avatar, avatar_decoration_data:null, bot:false, flags:0, premium_type:0}}, nonce:null}`.
  - A reply echoes the command's `nonce` with `evt:null`. An error reply has `evt:"ERROR"` and `data:{code, message}`.
- **WebSocket transport.** `ws://127.0.0.1:6463-6472/?v=1&client_id=…&encoding=json`. Discord checks `Origin` against the application's `rpc_origins`. The public app lookup does not return `rpc_origins`, so browser origins can only be allowed when Discord itself accepts them through the relay (or not at all).
- **Game-facing commands.**
  - `SET_ACTIVITY {pid, activity | null}`. The activity `type` must be 0 Playing, 2 Listening, 3 Watching or 5 Competing (types are allowed over RPC since July 2024).
  - `SUBSCRIBE`/`UNSUBSCRIBE` with the event name in `evt`: `ACTIVITY_JOIN`, `ACTIVITY_SPECTATE`, `ACTIVITY_JOIN_REQUEST`, `ACTIVITY_INVITE`.
  - `SEND_ACTIVITY_JOIN_INVITE {user_id}` and `CLOSE_ACTIVITY_REQUEST {user_id}`.
  - Everything else (`AUTHORIZE`, `AUTHENTICATE`, guild, channel and voice commands) controls Discord itself and only makes sense relayed to Discord.
- **Activity fields.** Limits are in characters.
  - Text: `name` 1–128; `details` and `state` ≤128; `details_url` and `state_url` ≤256.
  - `status_display_type`: 0 name, 1 state, 2 details. It picks which field shows in member lists, e.g. "Listening to Never Gonna Give You Up".
  - `timestamps {start, end}` in ms (many libraries send seconds). Start alone gives an elapsed timer; start and end on Listening or Watching give the progress bar.
  - `assets {large_image, large_text, large_url, small_image, small_text, small_url}`. Images ≤313; texts ≤128; urls ≤256.
  - `party {id ≤128, size [current, max]}`, `secrets {join, spectate, match}` (≤128), `instance` and `flags`.
  - `buttons`: up to 2 `{label ≤32, url ≤512}`. Other people see the labels; the URLs go in `metadata.button_urls`.
  - Image values are one of: an application asset *name* (looked up to an id through the assets list below, then `https://cdn.discordapp.com/app-assets/{app}/{asset}.png`), an `https://` URL (Discord proxies it as `mp:external/…`), `mp:…`, `spotify:{id}`, `youtube:{id}` or `twitch:{name}`.
- **Public Discord API lookups** (no auth; verified 2026-09-13):
  - `GET https://discord.com/api/v10/applications/{id}/rpc` returns `{id, name, icon, description, …}`. The app icon is `cdn.discordapp.com/app-icons/{id}/{icon}.png`.
  - `GET https://discord.com/api/v10/oauth2/applications/{id}/assets` returns `[{id, type, name}]`.
  - `GET /applications/detectable` is the game detection list, only needed for the optional Task 10.
  - Send a real `User-Agent`.
- **Reference implementation:** arRPC (OpenAsar/arrpc, MIT). It does IPC, WebSocket and process-scan transports and mocks READY. It turns `buttons` into `metadata.button_urls` plus labels, multiplies seconds by 1000 when timestamps look like seconds, and clears the activity on socket close. Its IPC discovery pings existing sockets and **unlinks ones that don't answer**. We must not do that to a live Discord: only unlink on `ECONNREFUSED`.
- **Electron (current stable 43.x).**
  - Supports Windows 10+ (x64, arm64) and macOS 13 Ventura+ (x64, arm64). This build Mac is Intel on macOS 13.7.
  - `session.setDisplayMediaRequestHandler(handler, {useSystemPicker})` answers `getDisplayMedia`. The system picker exists only on macOS 15+, so older systems need our own picker from `desktopCapturer.getSources`. Loopback audio works on Windows.
  - Linux Wayland needs PipeWire (`WebRTCPipeWireCapturer`) and the xdg portal, which shows its own picker.
- **Updates.** electron-updater works with a generic HTTPS server for Windows NSIS and Linux AppImage. On macOS, Squirrel.Mac refuses unsigned updates, so a Mac without an Apple Developer ID ($99/year) needs our own updater. Unsigned Windows installers show a SmartScreen warning; unsigned or ad-hoc-signed Mac apps need right-click → Open the first time.

## Decisions for the owner (recommendation first)

1. **Code signing.**
   - *Recommended (free):* ship unsigned. The download page explains the one-time SmartScreen and Gatekeeper steps. Mac updates use our own updater, which downloads the new zip, checks its sha512 against the manifest from chatd, swaps the app bundle and relaunches.
   - *Paid:* an Apple Developer ID ($99/year) plus a Windows certificate or Azure Trusted Signing (~$10/month) gives warning-free installs and standard updates.
2. **When Discord started first and holds `discord-ipc-0`.**
   - *Recommended:* on macOS and Linux, move Discord's socket file to a free index (a rename keeps Discord's listener working), take index 0, relay to Discord at the new path, and put its name back on quit.
   - On Windows, pipes can't be renamed. The app launches at login (on by default) to get there first. If Discord still wins, the RPC settings show "Discord started first: activity shows only on Discord" with a one-click "Restart Discord", which asks first.
   - *Minimal:* only relay when we start first.
3. **Game detection without RPC** (Discord's "Playing X" from running processes). *Recommended:* later, off by default (Task 10). Scanning costs CPU and it isn't RPC.
4. **"Ask to Join" and "Join" parity.** *Recommended:* later (Task 11). In v1 these commands are relayed to Discord, so they keep working there, and Evilion Chat shows party size but no Join button.
5. **Hosting downloads.** *Recommended:* chatd serves `/desktop/` from a folder, with no new service; the downloads go through the Cloudflare tunnel like attachments already do. *Alternative:* Cloudflare R2 (10 GB free, no egress fees).
6. **Targets.** *Recommended:* Windows x64 NSIS; macOS x64 and arm64 dmg (plus zip for updates); Linux x64 AppImage (updates itself) and .deb (update notice only). arm64 builds for Windows and Linux can come later.
7. **Testing against your real Discord.** This Mac runs Discord with a logged-in account. The relay test briefly shows a test activity ("Playing Evilion RPC test") on that profile, then clears it. OK to run?

## Global constraints

- **Existing tests stay green.** No change to existing web or server behaviour for browsers. Every task ends green on `go vet ./... && go test -race ./...`, `cd web && npx tsc --noEmit && npx vitest run`, and `cd desktop && npm test`. The full `tools/e2e.py` passes before deploying. Commits use the repository's attribution lines.
- **Desktop security.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
  - Navigation is limited to the configured origin; other links open in the default browser.
  - Permissions are granted only to that origin: media, display-capture, notifications, clipboard-sanitized-write.
  - Every IPC handler checks `event.senderFrame.url` against the origin.
  - The preload exposes named functions only, never `ipcRenderer`.
  - The RPC servers listen only on the local pipe or socket and `127.0.0.1`. Socket files are created user-only, mode 0600.
- **Presence data.**
  - It is metadata on chatd, like custom status (not end-to-end encrypted, because it fans out to many people with different keys). Nobody sees activities of someone invisible.
  - A user can turn off "Share my activity" (a desktop setting, honoured before anything is sent).
  - chatd holds activities in memory only and never writes them to the database.
- **Limits.**
  - Per connection: at most 5 activities (one per application).
  - Updates: 5 per 20 s per application, with the last one kept and applied when the window opens.
  - Size: 8 KB per activity; text cut by characters to Discord's limits.
  - URLs: `https:` only.
  - Timestamps: in ms, within ±10 years of now.
  - Types: 0, 2, 3 or 5 (anything else becomes 0).
- **Performance budget, measured on this Mac and reported.**
  - Cold start to first paint ≤2 s.
  - Idle memory of the main process plus the shell ≤60 MB on top of the page.
  - The RPC server is event-driven, with zero timers while idle.
  - One renderer, and no background throttling except during calls.
  - The main bundle is built with esbuild; the updater and relay load lazily.
- **Build and publish.** Artifacts are built on this Mac with electron-builder. Windows and Linux cross-builds are proven in Task 0 before anything depends on them. Releases are copied into `DESKTOP_DIR` (default `data/desktop`) by `tools/publish_desktop.sh`. Nothing is published or deployed without the owner's go-ahead.

## Tasks

### Task 0: spikes that decide the risky parts (throwaway code)
- [ ] **Cross-build.** Build a hello-world Electron 43 app with electron-builder on this Mac for `win nsis x64`, `mac dmg+zip x64,arm64` and `linux AppImage+deb x64`. Record which targets need Wine or Linux tools that are missing (none installed now). If Windows or Linux fail, the fallbacks are a GitHub repository with Actions, or Docker. Stop and ask before installing anything.
- [ ] **Relay.** With the owner's OK (decision 7), in a scratch Node script:
  - connect to the running Discord as a client with a throwaway application id, set a Listening activity with start and end, confirm the reply, and clear it;
  - rename `$TMPDIR/discord-ipc-0` to a free index, bind our own index 0, relay one app connection through, and restore the name.
  - Record whether Discord keeps working and whether it notices.
- [ ] **Baseline.** Measure Electron 43's empty-window memory and start time on this Mac.

### Task 1: chatd — activities in presence
- [ ] **Data model.** In `internal/gateway/protocol.go`: `Presence` gains `Activities []Activity \`json:"activities,omitempty"\``. `Activity` holds:
  - basics: `ApplicationID`, `Name`, `Type`, `CreatedAt`, `StatusDisplayType *int`;
  - text: `Details`, `DetailsURL`, `State`, `StateURL`;
  - nested: `Timestamps {Start, End *int64}`, `Assets {LargeImage, LargeText, LargeURL, SmallImage, SmallText, SmallURL}`, `Party {ID, Size [2]int}`;
  - buttons: `ButtonLabels []string` (the viewer's copy) and `ButtonURLs []string`;
  - `Instance bool`, `Flags int`.
  All are optional and omitted when empty.
- [ ] **Setting activities.** New op `activities` with `{activities: [...]}` replaces this connection's set (an empty list clears it).
  - Validation and normalization follow the global limits: seconds become ms, unknown types become 0, disallowed URLs are dropped, oversized payloads are refused.
  - It has its own rate limiter: 10 updates per 20 s per connection, with the last value applied when the limiter allows.
  - The hub keeps `activities map[connID][]Activity`. `PresenceOf` returns the activities of the most recently updated connection of that user, and none when invisible. A connection closing clears its activities and rebroadcasts.
- [ ] **Resolution and proxying.** Assets are resolved when broadcast.
  - An application asset name becomes its CDN URL through the app cache below. `https://`, `mp:external/…`, `spotify:`, `youtube:` and `twitch:` values become their source URLs.
  - Every image URL is rewritten with `ProxyURL` (the signed media proxy).
  - The app icon is added as `icon_url` (proxied).
- [ ] **App cache.** `internal/activityapps`: `Lookup(ctx, appID) (App{Name, IconURL, Assets map[name]id}, error)` over the two public Discord endpoints.
  - It caches in memory for 24 h and negatively for 10 min, allows one request per app at a time, uses a 5 s timeout, and sends a real User-Agent.
  - If the lookup fails, the activity still shows with the name the app sent, or "Unknown app".
- [ ] **Tests** (with a stand-in Discord API):
  - valid activities fan out to friends and co-members only;
  - invisible users show none;
  - closing the connection clears activities;
  - seconds become ms;
  - bad URLs are dropped and bad types become 0;
  - the rate limit keeps the last value;
  - an asset name resolves to a proxied CDN URL;
  - lookup failure still shows the activity;
  - the payload size limit applies.

### Task 2: web — showing activities
- [ ] **Types and helpers.** `web/src/api/types.ts` gets `Activity` and `Presence.activities`. `web/src/stores/presence.ts` gets:
  - `activitiesOf(p)`;
  - `activityLine(a)`, the one-line summary honouring `status_display_type` and the type's verb ("Playing", "Listening to", "Watching", "Competing in");
  - `activityProgress(a, now)`, which returns `{elapsed, total, fraction}` or null.
- [ ] **Profile card.** `ActivityCard` goes in the profile popout and the DM header and member list hover card. It shows:
  - the large image with the small image as a badge (hover texts, click URLs);
  - name, details and state (with their URLs);
  - an elapsed timer, or the progress bar with `m:ss / m:ss` for Listening and Watching with both timestamps, ticking once a second from one shared ticker and only while visible;
  - "(2 of 4)" for party size;
  - up to 2 buttons, which open with the existing leaving-the-site confirmation.
- [ ] **Compact rows.** Member list, DM list and friends list rows show `activityLine` under the name, the way Discord does, in the same place custom status goes today (custom status wins when both are set, as on Discord).
- [ ] **Tests and checks.** vitest for the line and progress helpers (including seconds, end before start, and beyond end). A Playwright scratch check injects presence and screenshots the card on desktop and phone.

### Task 3: web and chatd — the download banner and page
- [ ] **Serving releases.**
  - chatd serves `DESKTOP_DIR` at `/desktop/`, with `Cache-Control: no-cache` for `latest*.yml` and immutable caching for versioned files; ranges work through `http.ServeContent`.
  - `GET /api/v1/desktop/latest` (public) returns `{version, released_at, files:[{platform, arch, kind, name, size, sha256}]}` read from the published manifests, or 404 when nothing is published.
  - Tests.
- [ ] **Platform detection.** `web/src/lib/platform.ts` exports `detectDesktop(ua, uaData)`, returning `{os: "windows"|"mac"|"linux"|null, arch: "x64"|"arm64"|null}`.
  - It uses `navigator.userAgentData.getHighEntropyValues(["architecture","platform"])` where available.
  - On macOS Safari, where Intel and Apple Silicon look the same, it falls back to the WebGL renderer string, or else offers both builds.
  - Phones and tablets get null.
- [ ] **Banner.** `DownloadBanner` is a slim brand-coloured bar at the top of the main column, like the connection banner.
  - It reads "Get Evilion Chat for {Windows}. Rich presence from your games and music, and a better call experience." with a primary "Download" button (the detected installer), a "Other platforms" link, and a close button.
  - It is shown only in desktop browsers (not in the app, not on phones or tablets) and only when a release exists. Closing it is remembered on this device (`ec:desktopBanner`, with the version it was closed for).
- [ ] **Download page.** `/download` is a public page that works signed out. It lists every platform with version, size and sha256, plus short first-run notes (SmartScreen "More info → Run anyway"; macOS right-click → Open; AppImage `chmod +x`). The User Settings sidebar gets an "Apps" link.
- [ ] **Tests.** vitest for `detectDesktop` across user agents. Playwright checks the banner per user agent, the close button persisting, and the page on a phone.

### Task 4: the desktop shell (`desktop/`)
- [ ] **Project.** `desktop/package.json` (electron 43, electron-builder, electron-updater, typescript, esbuild, vitest), `tsconfig`, and `desktop/src/{main,preload,shared}`. `npm run build` bundles main and preload with esbuild; `npm test` runs vitest.
- [ ] **Window.**
  - One `BrowserWindow` with the security settings from Global constraints.
  - `show:false` until `ready-to-show`, with a background colour that matches the theme.
  - Window size and position remembered.
  - Base URL from the `EVILION_URL` environment variable (tests) or `https://chat.evilion.xyz`.
  - Single-instance lock; a second launch focuses the window.
- [ ] **Tray and system integration.**
  - Tray icon with Open, Mute, Deafen and Quit; closing the window hides it to the tray (setting).
  - Launch at login, with start minimized.
  - `app.setBadgeCount` and taskbar overlay from the web app's unread total.
  - Hardware acceleration toggle (takes effect on restart).
- [ ] **Links and permissions.** `setWindowOpenHandler` and `will-navigate` open anything off-origin in the default browser. Permission request and check handlers apply the origin-scoped allow-list.
- [ ] **Screen sharing.**
  - `setDisplayMediaRequestHandler`: on Windows, macOS and X11 it sends `desktopCapturer.getSources({types:["screen","window"], thumbnailSize})` to the page. The web app shows a picker in the style of its existing Share Your Screen dialog (screens and windows with thumbnails). The chosen id comes back and is answered with `{video: source, audio: "loopback"}` on Windows.
  - On Wayland it passes straight through to the portal's own picker.
  - Linux gets `--enable-features=WebRTCPipeWireCapturer`.
- [ ] **Calls.** `setCallActive(bool)` from the web app switches `backgroundThrottling` off only during calls.
- [ ] **Preload bridge.** `window.evilionDesktop = {version, platform, onActivities(cb), rpc:{getState, setEnabled, setRelay, setHidden(appId, hidden), onState(cb)}, updates:{getState, check, restart, onState(cb)}, setBadge(n), setCallActive(b), settings:{get, set, onChange}, pickDisplaySource(...)}`. Every channel checks the sender origin.
- [ ] **Web app changes.** The web app detects `window.evilionDesktop`:
  - it hides the download banner;
  - adds a "Desktop" page to User Settings (Task 7);
  - forwards unread totals and call state;
  - forwards RPC activities to the gateway op from Task 1, honouring "Share my activity".
- [ ] **Tests.** vitest for the origin checks and settings store. A Playwright `_electron` smoke test against a local chatd: the window loads, external links leave the app, and permissions are refused for other origins.

### Task 5: the RPC server
- [ ] **IPC framing.** `desktop/src/main/rpc/ipc.ts`:
  - Path per platform as in the research notes. Discovery connects to indices 0–9: a successful connection means taken; `ENOENT` means free; `ECONNREFUSED` means stale, so unlink it (Unix only).
  - Listen on the lowest free index, with socket mode 0600.
  - Frame encoder and decoder handle partial and coalesced chunks, cap payloads at 64 KB, and close with 1003 on garbage.
  - HANDSHAKE validates `v==1` and a numeric `client_id` (4004/4000 otherwise).
  - PING gets PONG; CLOSE ends the connection.
- [ ] **WebSocket.** `desktop/src/main/rpc/ws.ts` on the lowest free port in 6463–6472, with `v=1`, `encoding=json` and `client_id` required.
  - With no `Origin` header, accept.
  - With a browser origin, accept only if the relay to Discord accepts the same handshake; otherwise close with 4001.
- [ ] **Commands.** `desktop/src/main/rpc/server.ts`:
  - It answers READY: from Discord's own READY when relaying, otherwise a local one naming the signed-in Evilion user (id, username, avatar hash left out).
  - `SET_ACTIVITY` normalizes like chatd (ms, types, buttons into labels plus URLs, `instance` into flags), keeps the activity per `client_id` and connection, replies with the normalized activity (`application_id` and `name` filled in) and the command's nonce, and clears on `activity:null` or disconnect.
  - `SUBSCRIBE`/`UNSUBSCRIBE` for the activity events are acknowledged `{evt}`. `SEND_ACTIVITY_JOIN_INVITE` and `CLOSE_ACTIVITY_REQUEST` are acknowledged locally (and relayed).
  - Any other command gets `ERROR {code: 4002, message: "Evilion Chat handles Rich Presence; this command needs Discord"}` when not relaying.
  - Per-app rate limit of 5 updates per 20 s, keeping the last one.
- [ ] **Activity hub.** `desktop/src/main/rpc/activities.ts` merges the current activities of all connected apps, newest first. Hidden apps and the RPC off-switch are applied here. It calls `onActivities` over the bridge.
- [ ] **Tests.**
  - vitest: framing (split, coalesced, oversized), handshake errors, SET_ACTIVITY normalization (the Discord example payloads, and seconds versus ms), nonce echo, clear on close, rate limit, unsupported commands.
  - Integration with the maintained Node client `@xhayper/discord-rpc` (MIT) against our server: set a Listening activity with start and end, then a Playing one with buttons and a party, then clear; assert what the hub emits.

### Task 6: relaying to Discord
- [ ] **Finding Discord.** `desktop/src/main/rpc/relay.ts` finds Discord's pipe by connecting to the other indices (skipping our own) and looking for a READY with a real user.
  - For every incoming app connection, it opens a mirror connection with the same handshake.
  - Frames from the app go to Discord unchanged (after our own read of `SET_ACTIVITY`). Frames from Discord go to the app unchanged, so nonces, events and errors are Discord's own.
  - If Discord goes away mid-session, we become the local answerer. If Discord appears later, the next app connection relays.
- [ ] **Order.** Per decision 2: on macOS and Linux, move Discord's socket aside and restore it on quit or crash (with a startup check for a leftover moved socket). On Windows, detect that Discord holds a lower pipe and surface it in RPC state with the "Restart Discord" action (`taskkill /IM Discord.exe`, then `Update.exe --processStart Discord.exe`, after confirming).
- [ ] **Settings.** "Relay to Discord" (default on) and "Rich Presence server" (default on).
- [ ] **Tests.** A fake Discord (our IPC server on a test path with a fixed READY) checks transparent passthrough both ways, the local answer when Discord is absent, recovery when Discord appears later, and the socket move and restore. The live check against the real Discord happens only with the owner's OK.

### Task 7: desktop settings and activity controls (web app)
- [ ] **Settings page.** "Desktop" in User Settings (only inside the app), in the same style as the other settings pages, with:
  - Rich Presence on/off;
  - Relay to Discord on/off, with the status line "Discord connected on pipe 1", "Discord not running" or "Discord started first (Windows): Restart Discord";
  - Share my activity on/off;
  - the list of connected apps with a live `ActivityCard` preview and a per-app "Hide" toggle;
  - Launch at login, Start minimized, Close to tray, Hardware acceleration;
  - Updates: current version, last check, "Check now" and "Restart to update".
- [ ] **Update notice.** A small "Update ready" pill beside the user panel, which restarts and updates.
- [ ] **Tests.** vitest for settings mapping. Playwright with a mocked bridge for page states and phone layout.

### Task 8: updates
- [ ] **Windows and Linux.** electron-updater with the generic provider `${base}/desktop/`: check 10 s after start and every 6 h, download in the background, install on quit or "Restart to update". AppImage updates itself; .deb shows "Update available: download" linking to the download page.
- [ ] **macOS** (unsigned, decision 1). `desktop/src/main/update/mac.ts` reads `latest-mac.yml`:
  - It downloads the zip for this arch with Node `https` into the user's temp folder, so no quarantine flag is set, and verifies sha512.
  - It extracts with `ditto -x -k`, checks the ad-hoc code signature (`codesign --verify`), swaps the bundle next to the running one (`/Applications/Evilion Chat.app`, or wherever it runs from; asks for admin rights only if that folder isn't writable) and relaunches.
  - A failure leaves the old app in place and reports it.
- [ ] **Tests.** vitest for version comparison, manifest parsing, sha512 mismatch and swap steps (with a fake file system). A manual update from 1.0.0 to 1.0.1 on this Mac against a local chatd.

### Task 9: packaging and publishing
- [ ] **Build config.** `desktop/electron-builder.yml`:
  - `appId: xyz.evilion.chat`, product "Evilion Chat", icons from `web/public/icons`;
  - targets per decision 6, `artifactName` with version, OS and arch, and the `publish` generic URL;
  - `asar: true`, `compression: maximum`, only production dependencies, strip debug symbols;
  - mac `hardenedRuntime: false`, ad-hoc identity `-`;
  - Linux `category: Network;Chat`;
  - protocol handler reserved for later.
- [ ] **Build scripts.** `make desktop` builds every target into `desktop/dist/`. `tools/publish_desktop.sh <dir>` copies the installers, blockmaps and `latest*.yml` into `DESKTOP_DIR` and writes `manifest.json` (sha256 and sizes) for `/api/v1/desktop/latest`.
- [ ] **Docs.** A Desktop section in `deploy/README.md` (build, publish, version bumps, first-run notes).

### Task 10 (optional, decision 3): game detection
- [ ] chatd caches Discord's detectable list (daily). The desktop app scans processes every 15 s, only while RPC is on and the setting is enabled, using a cheap process list (no shell). A match shows "Playing {name}" with the app icon, the way Discord's detection does. Games already reporting over RPC win.

### Task 11 (optional, decision 4): Join parity
- [ ] chatd keeps `secrets.join` server-side (never broadcast). A viewer in an allowed relationship (friends, or the flags' party privacy) gets a "Join" button on the card; their app receives `ACTIVITY_JOIN {secret}` when the same application is connected there. Ask-to-Join requests become `ACTIVITY_JOIN_REQUEST` on the host with accept and decline, which map to `SEND_ACTIVITY_JOIN_INVITE` and `CLOSE_ACTIVITY_REQUEST`.

### Task 12: verification and release
- [ ] **Full suites.** Go race, web vitest, desktop vitest, `tools/e2e.py`.
- [ ] **End-to-end on this Mac** (local chatd, x64 build): the app starts; a Node RPC client sets a Listening activity with a progress bar; a second browser sees it with the bar moving; the Discord relay works (with the owner's OK); tray, badge and screen picker work; update 1.0.0 → 1.0.1.
- [ ] **Measure and report** start time and memory against the budget.
- [ ] **Owner checks** the Windows and Linux builds, and the arm64 Mac build, on their machines (nothing here can run them).
- [ ] **Release.** Deploy chatd and the web app, then publish 1.0.0 to `/desktop/`. Both happen only when the owner says so.
