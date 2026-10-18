# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Nexa is the end-to-end encrypted chat app served at https://nexa.fish (also https://mathtest.lol;
https://chat.evilion.xyz is its old address, which moves browsers on). This repository is all of it:
the Go server (`cmd/`, `internal/`), the React + TypeScript web app (`web/`), the Electron desktop
app that runs the web app (`desktop/`) and the native Android app (`android/`, Kotlin + Jetpack
Compose). README.md describes the features and how the encryption works; the original design spec is
`docs/superpowers/specs/2026-09-11-chat-design.md` (section 6 is the cryptography).

The rules come first, then commands and testing, then how each part is built.

## Rules that always apply

### Keep this file current

This file is how every future session learns the codebase, so it has to stay true and complete.
Whenever a change makes anything here wrong or incomplete, the same change updates CLAUDE.md: a new,
renamed or removed package, module, route group, gateway event, table, setting, command, tool,
test helper, build or release step, workflow or convention, and every standing rule the owner
gives. When you notice something here that is already wrong, fix it then. Write what you checked in
the code, in the style of the rest of the file (plain sentences, no em dashes), and commit it with
the change it describes.

### Building is deploying

`web/dist` and `bin/chatd` are what the live instance serves, so `npm run build`, `make web`,
`make server` and `make build` publish immediately. Never run them to check a change; use the
commands under Commands, which write nothing live. Never test against port 8090, `data/` or the
repo's `chatd.env`. On this server, never start chatd from the repository root either (`make run`,
`go run ./cmd/chatd`): it reads the live `chatd.env` and `./data`, and chatd migrates its database
before it listens, so an unreleased build would migrate the live database. Deploy only when the
owner says "deploy" (see Deploying).

### All UI design goes through the frontend-design skill

Before any UI design work on this project, invoke the `frontend-design:frontend-design` skill and
follow it, however small the change: a new screen or component, a redesign, or a change to layout,
spacing, colour, type or motion, on the web, the desktop app or Android. No exceptions.
`android/DESIGN.md` is that process applied to the Android app; read it too before Android UI work.

### Web and mobile: both implemented, both tested

Every feature and change is implemented properly on both the web app and the Android app, and the
web at phone width and the Android app look and behave as alike as possible (same layout, sizes,
colours, words and order of things). A phone improvement made on one side is brought to the other
(`android/DESIGN.md` section 7 keeps the list). Nothing is done until it has been seen working:

1. Web: on a throwaway server, drive it in a headless browser (Playwright) at a desktop size
   (1366x768) and a phone size (411x914, the emulator's screen in CSS pixels). Look at the
   screenshots.
2. Android: build the debug app against the same throwaway server and use it in the Android
   emulator: every screen touched, in Dark, Light and one preset.
3. Put the phone-size web screenshots next to the emulator's and fix whichever side is off.

Passing unit tests do not replace looking at the screens. How to do each step is under Testing.

### Build what was asked

Build the literal request. "Custom" packs or themes mean letting people make their own, not adding
new built-in ones. If an extra seems worth having, suggest it instead of shipping it.

### When the work is done

1. Run the checks (`tools/check.sh` covers most of them) and the web and Android testing above,
   and update this file if the change touched anything it describes.
2. Commit on `main`, and push to GitHub (`git push origin main`) only when the owner says to push.
   The owner also works on another machine and pulls from GitHub, so say what is committed and not
   yet pushed. Never commit `chatd.env`, `android/keystore.properties` or any token.
3. After a round of app changes, leave a throwaway server with the new build running and give the
   owner its address so they can try it. WebCrypto needs https or localhost, so from another machine
   it is reached through an SSH tunnel to localhost, not the plain LAN address. Do not deploy until
   they say "deploy".

## Every major feature gets a What's New entry

When a change adds a major feature, redesigns something, or changes behaviour people will notice,
the same change adds an entry to the What's New popup. People see the popup once, the first time
they open the app after an update, and it is how they find out what changed.

- The list is `RELEASES` in `web/src/lib/whatsNew.ts`, newest first. Add a release at the top whose
  `id` is the deploy date (`"2026-09-26"`, then `"2026-09-26.2"` for a second one that day), or add
  items to the newest release if that one has not been deployed yet.
- Each item is a lucide-react icon, a title and one or two plain sentences. Title and body are i18n
  keys named after the release id without its dashes and dots (`whatsNew.r20260926.<name>Title`
  and `...Body` for release `2026-09-26`), translated into all twelve locales.
- Keep every item in the shape `{ icon: Name, title: "...", body: "..." }` (that order, double
  quotes): the Android app reads this same file with a regex (`fish.nexa.ui.WhatsNew`) and silently
  skips anything shaped differently.
- Say what people can do now and where to find it. Small fixes and polish do not need an entry.
- The popup is `web/src/components/shell/WhatsNewDialog.tsx`. It shows the releases an account has
  not seen yet (tracked in its synced settings) and skips releases older than the account.

## Writing UI text

- Labels use Title Case: buttons, menu items, tabs, navigation, dialog and page titles, headings
  and column headers ("Add Friends", "Create Group", "Mark as Read", "Add to Group"). Short
  articles, conjunctions and prepositions stay lowercase unless first or last. English only; the
  other locales follow their own language's capitalization.
- Checkbox and toggle labels use sentence case ("Hide their messages completely").
- Descriptions, hints, toasts and errors are short, plain sentences that sound like a person.
- Avoid em dashes; use a comma, a full stop or parentheses.
- Never describe the owner in the third person or sell Nexa as run by one person, in the app, the
  home page or the Terms. Contact details read "Contact the owner (nora) here: ...".
- Describe Nexa on its own terms. Do not compare it to Discord. Naming Discord is fine only where a
  feature really talks to Discord (the desktop app's Rich Presence relay, Discord activity sync, and
  importing a Discord server template).
- Never hardcode user-visible English. The web uses `t("key")` / `<Tr>` from `@/i18n`; Android uses
  `t("key")` on the same catalogues (its own keys start with `android.`). Add every new key to all
  twelve files in `web/src/i18n/locales/` with real translations
  (`python3 android/tools/add_strings.py strings.json` writes a batch into all twelve, in order).
  `python3 tools/i18n_check.py` must pass.
- Text about what Nexa stores or sends (the Terms, the privacy policy, settings) is checked against
  the code that runs (handlers, the SQL in `internal/store`, the client crypto), not comments. Say
  "not end-to-end encrypted" rather than "not encrypted" when the server seals something itself.

## Commands

Each line on its own, from the repository root. None of these write anything live.

```
tools/check.sh                    # the whole pre-publish check: Go build/vet/tests, web typecheck, tests
                                  # and a scratch build, app size, desktop typecheck/tests, i18n keys
go build ./... && go vet ./...
go test ./...                     # `make test-go` adds -race; the api package then takes minutes
go test ./internal/api -run TestEditKeepsTheKeyThatOpensIt -count=1
CHAT_TEST_POSTGRES=postgres://... go test ./internal/store ./internal/api    # the same suites on Postgres
cd web && npm run typecheck
cd web && npx vitest run          # one file: npx vitest run src/lib/perms.test.ts -t "test name"
cd desktop && npm run typecheck && npm test
python3 tools/i18n_check.py       # every locale has every key, placeholder and plural form
python3 tools/i18n_keys_used.py   # must say "web: ... 0 missing"; Android's keys built at runtime are listed, as expected
```

`make test` runs the Go suite with `-race` plus the web and desktop suites. `internal/db`'s Postgres
tests start an embedded Postgres, downloaded the first time (`SKIP_PG_TESTS=1` skips them). For hot
reload, `cd web && VITE_API_TARGET=http://127.0.0.1:$PORT npm run dev` serves the web app on :5173;
without `VITE_API_TARGET` it proxies to :8090, the live server.

Building without deploying, into a scratch directory `$S`:

```
(cd web && npx vite build --outDir $S/dist --emptyOutDir)
go build -o $S/chatd ./cmd/chatd
```

Android (publishes nothing). On this server the JDK and SDK live in `~/android` and are not on the
PATH, and the Bash tool keeps no variables between calls, so set them in every command:

```
export JAVA_HOME=$HOME/android/jdk ANDROID_HOME=$HOME/android/sdk
(cd android && ./gradlew :app:assembleDebug)   # -PserverUrl=http://127.0.0.1:$PORT points it at a local chatd
(cd android && ./gradlew :app:testDebugUnitTest)
```

Work that goes with certain changes:

- Dependencies added or upgraded in any build: `make licenses` rewrites `web/src/data/licenses.json`
  (Settings, Licenses); `android/tools/android_licenses.py` does the same for the Android app
  (its header has the steps).
- The web app's first load grew: `tools/app_size.py` (in `check.sh`) fails once the gzipped first
  load passes `LOAD_KB_LIMIT` in `web/src/pages/HomePage.tsx`, the number the front page prints.
  Keep that claim true.
- The web's markdown, search, themes, formatting editor or webhook messages changed: regenerate the
  Android test vectors (`android/tools/*_vectors.ts`) and make the Kotlin port pass them.
- lucide-react upgraded: `python3 android/tools/lucide_assets.py`. emojibase-data or `@twemoji/svg`
  upgraded: `node android/tools/emoji_assets.mjs`, `tools/twemoji_sprites.py`, `tools/twemoji_font.py`
  and then `tools/twemoji_font_check.py`.

## Testing

### A throwaway server

chatd reads `chatd.env` from its working directory, and the repo's copy is the live configuration
(live keys and bot tokens, and `./data` is the live database). So run the scratch build from its own
directory with its settings in the environment (`$S` an absolute path, `$PORT` anything but 8090):

```
(cd web && npx vite build --outDir $S/dist --emptyOutDir) && go build -o $S/chatd ./cmd/chatd
(cd $S && LISTEN=127.0.0.1:$PORT PUBLIC_URL=http://127.0.0.1:$PORT DATA_DIR=$S/data \
  WEB_DIST=$S/dist EGRESS_PROXY=off ./chatd)        # in the background
tools/.venv/bin/python tools/seed.py http://127.0.0.1:$PORT
```

`seed.py` registers alice and bob (password `correct horse battery staple`), makes a server whose
#general bob joins, posts one message of every kind of formatting and prints the ids. Registration
is open by default, the first account becomes the Nexa admin, and captchas, calls through the SFU,
GIF search and the other keyed services stay off without their keys.

### Web in a headless browser

Playwright runs from `tools/.venv` (setup in `tools/README.md`). Screenshots at both sizes:

```
tools/.venv/bin/python tools/screenshot.py http://127.0.0.1:$PORT $S/shots \
  --login "alice:correct horse battery staple" \
  --paths /channels/@me /channels/<server id>/<channel id> --viewports 1366x768 411x914
```

Widths under 768 get a mobile, touch context, and the app switches to its phone layout below 768 px.
For flows (clicking, typing, two people at once) script Playwright with `tools/e2e.py`'s `Session`
(`register`, `login`, `send`, `open_dm_with`, `shot`, ...) or run `tools/e2e.py` itself (`--flows`,
`--serve`). Set `E2E_WEB_DIST` and `E2E_CHATD` to the scratch build; otherwise e2e.py tests the
deployed `web/dist` and `bin/chatd`, not your changes. A new account in a new browser gets the Terms
sheet first; `Session` and `screenshot.py --login` agree to it. Stable selectors are the
`data-testid` attributes and aria labels the scripts already use. iPhone keyboard and viewport
behaviour needs `tools/ios_sim.py` on a Mac (`tools/README.md`).

### Android in the emulator

The AVD is `nexa_test`: a Pixel 7, 1080x2400 at 420 dpi, which is 411x914 for the web comparison.
It boots headless in about 30 seconds.

```
ADB=$HOME/android/sdk/platform-tools/adb
(cd android && ./gradlew :app:assembleDebug -PserverUrl=http://127.0.0.1:$PORT)   # JAVA_HOME, ANDROID_HOME as above
$HOME/android/sdk/emulator/emulator -avd nexa_test -no-window -no-audio -no-boot-anim \
  -no-snapshot-save -gpu swiftshader_indirect       # in the background
$ADB wait-for-device                                # then poll until `$ADB shell getprop sys.boot_completed` is 1
$ADB install -r android/app/build/outputs/apk/debug/app-x86_64-debug.apk
$ADB reverse tcp:$PORT tcp:$PORT
$ADB shell am start -n fish.nexa.debug/fish.nexa.MainActivity
$ADB exec-out screencap -p > $S/android.png
$ADB emu kill                                       # when finished
```

- `-no-snapshot-save` throws away everything from the session, the installed app included, so
  install after every boot.
- Debug builds allow plain http only to 127.0.0.1, localhost and 10.0.2.2, hence the `serverUrl`
  on 127.0.0.1 plus `adb reverse`.
- Driving it: `$ADB shell uiautomator dump /sdcard/ui.xml && $ADB exec-out cat /sdcard/ui.xml` lists
  every element with its bounds; then `$ADB shell input tap X Y`, `input text` (`%s` for a space)
  and `input keyevent 4` (Back, which also closes the keyboard).
- Before trusting a screenshot, check `$ADB shell dumpsys window | grep mCurrentFocus` names
  `fish.nexa.debug`. After a cold boot, Play Services' "Sign in with ease" screen or a launcher
  "isn't responding" dialog can sit on top; dismiss it and start the app again.

### Other end-to-end runs

All start their own throwaway chatd: `tools/webhook_e2e.py` (every kind of webhook message, both
sizes), `tools/discord_e2e.py` (Discord activity sync against the fake Discord in
`internal/discordsync/fakediscord/cmd/fakediscord`), `tools/sfu_call.py` and `tools/sfu_guest.py`
(real calls and a guest through Cloudflare Realtime, keys from `chatd.env`), `tools/call_quality.py`
(calls over bad networks made by `tools/netsim`), `tools/share_quality.py` (a screen share of hard
motion through Cloudflare, timed frame by frame as the viewer sees it; the sharer is Chromium,
Firefox or the desktop app's Electron in a hidden window, `--up-kbps`, `--loss` and `--down-loss`
shape the links through netsim, results in `tools/out/share-quality`). Whatever a test starts must
make no sound: Playwright's headless Chromium is muted, Electron and Firefox are muted by the
scripts, and the emulator runs with `-no-audio`.

## Repository layout

```
cmd/chatd/          the server's main: wiring, the log file, the maintenance loop
cmd/chatmigrate/    copies a SQLite database into Postgres in one transaction, all or nothing
internal/           the server's packages (below)
web/                the web app: src/, public/ (manifest, icons, sounds, front-page media), scripts/deploy-guard.mjs
desktop/            the Electron app
android/            the Android app; android/ydoc is the notes CRDT in Rust, android/tools its generators
downloads/android/  the published APKs and manifest.json (committed), served at /android/
deploy/             systemd and launchd templates, install.sh, route-dns.sh, warp-proxy.sh
tools/              test drivers, release scripts, i18n and asset generators (below)
docs/               design spec and plans, STATUS.md, legal/ (the Terms and Privacy Policy the apps
                    show word for word), plugins.md (the plugin API), design/reference captures
audit/              two rounds of code audits: findings, triage and progress per area
prompt.txt          the 2026-10-01 handoff to another machine, with the owner's messages word for word
run.sh, backup.sh   what the service starts (bin/chatd -env chatd.env); the backup of data/
```

Not in git: `data/` (database, media, server secret), `logs/`, `bin/` (chatd and chatd.prev),
`backup/`, `chatd.env`, `web/dist`, `web/node_modules`, `tools/.venv`, `tools/out`, `.claude/`.

## Server (Go)

### Startup

`cmd/chatd/main.go` reads `-env` (default `chatd.env`; the process environment wins over the file),
loads `internal/config`, sets the snowflake node id, opens the database (`DATA_DIR/chat.db`, or
`DATABASE_URL`), runs the migrations, makes the store, the media store (`DATA_DIR/media`), the
server secret (`DATA_DIR/server.secret`) and the optional Redis cache, then builds `api.Server` and
attaches the egress proxy, link previews, Rich Presence apps, games and music. It makes the gateway
hub (`srv.Bcast`), calls `WireServers`, `WireVoice`, `WireActivities`, `WireDiscord` and last
`WireModeration`, mounts `/gateway`, starts the background loops (`StartLimiters`, `StartGuests`,
`StartModeration`, `StartPolls`, `StartThreads`, `StartDiscord`, `StartAccountSweep`, the WARP
keeper, the Realtime usage meter, `maintenance`) and serves until SIGINT or SIGTERM.

### Packages (`internal/`)

| Package | What it is |
|---|---|
| `api` | REST handlers, middleware, rate limits, static pages; one file per area (below) |
| `auth` | Argon2id of the client's auth key, bearer tokens (only SHA-256 hashes stored), the middleware that turns a token into a user or a guest, client IP behind the tunnel |
| `automod` | AutoMod matching (text read past disguises, words with wildcards, patterns, presets); `testdata/vectors.json` binds every implementation |
| `cache` | optional Redis: shared rate limits, presence and events between processes |
| `config` | settings from the environment with defaults and validation |
| `db` | SQLite or Postgres pools (`W` single writer, `R` readers), `Tx`, the dialect helpers, embedded forward-only migrations |
| `discordsync` | Discord activity sync: OAuth link, a bot in a small Discord server reads linked members' presence; `fakediscord` stands in for tests |
| `egress` | the SOCKS5 proxy (WARP) for every request a person can point the server at; fails closed |
| `games`, `music` | IGDB games and Deezer music for profile widgets; art kept here, previews streamed through |
| `gateway` | the WebSocket hub: connections, presence, typing, voice signalling, fan-out |
| `ids` | snowflakes: 41 bits of milliseconds, 10 of node, 12 of sequence; decimal strings in JSON |
| `media` | blob storage, upload validation, sized variants, metadata scrub, private and plain files |
| `perms` | Discord's permission model and bit values: roles, @everyone, overwrites, timeouts, hierarchy |
| `ratelimit` | keyed token buckets, optionally shared through Redis |
| `realtime` | Cloudflare Realtime SFU client and the monthly usage meter |
| `rpcapps` | names and art of Discord Rich Presence applications, looked up once and kept |
| `store` | every SQL query, grouped by domain; models; the permission cache |
| `telegram` | the Bot API calls a sticker set import needs |
| `textutil` | cleaning user text, shared by REST and gateway |
| `totp` | RFC 6238 codes for two-factor sign-in |
| `unfurl` | link previews with SSRF protection (public addresses only, redirects checked, bodies capped) |
| `voice` | the in-memory registry of who is in which call and what each device publishes |

### HTTP API (`internal/api`)

- Everything is JSON under `/api/v1` with `Authorization: Bearer <token>`. Errors are
  `{"error": {"code", "message"}}`, built with `E(status, code, message)` and `WriteError`;
  `WriteJSON` and `ReadJSON(w, r, dst, maxBytes)` do the rest. `Handler()` chains `RequestID`,
  `Recover`, `SecurityHeaders` and `Logging`; `GET /api/health` answers `{ok, version}`.
- Route groups are listed in `groups.go` (`routeGroups`); each file registers its own with
  `mux.Handle("METHOD /path", ...)`. A new group goes in that list.
- Wrappers: `authed` (token, the generic per-user limit, and the mute/ban gate), `callAuthed`
  (accounts and guests, for call routes), `guestAuthed`, `userLimited(limiter, h)` and
  `ipLimited(limiter, h)`. Every limiter is made in `NewServer` and named in `limiters()`; one
  missing from that map is never swept or shared.
- `moderation_gate.go` lists what a muted or banned account may still do. A new signed-in route is
  closed to them until it is added there.
- Areas, by file: `auth_handlers` and `mfa_handlers` (register, KDF parameters, login, recovery,
  password, sessions, TOTP and backup codes), `user_handlers` (me, encrypted settings, keys, search,
  profiles, deletion), `relationship_handlers`, `channel_handlers` (DMs, groups, icons, recipients,
  typing, attachments, pins), `group_handlers`, `subchat_handlers` (sub-conversations of a DM, with an
  optional password), `message_handlers` (history, send, edit, delete, bulk delete, ack, reactions),
  `poll_handlers`, `key_handlers` (grants, needs, epochs, asking again), `server_handlers` and `discord_templates` (servers, Discord server template preview and import, channels,
  overwrites, roles, members, bans, invites, audit log), `member_admin` (member search, prune, bulk
  ban, server profiles, role icons), `threads` (threads and forum posts), `follows` (announcement
  follows and crossposts), `automod`, `discovery`, `server_tags`, `expression_handlers` (server
  emoji, sticker packs, recents, Telegram import, Klipy GIF search), `voice_glue` and `sfu_handlers`
  (ICE servers, voice states, ringing, the SFU), `guest_handlers` (guest links), `webhook_*`,
  `note_handlers`, `sound_handlers`, `widgets` (profile widgets, game and music search),
  `typing_style`, `profile_links`, `discord_handlers`, `activity_glue`, `nexa` (a member's side of
  Nexa) and `moderation*` (the staff's side), `bugs`, `crash_handlers` (client errors),
  `admin_handlers` (instance stats, users, runtime settings), `legal_handlers` (the admin's legal
  report), `desktop_handlers` and `android_handlers` (downloads and update manifests),
  `media_handlers`, `upload_handlers` (resumable uploads), `proxy_handlers` (the signed media proxy),
  `youtube_proxy`, `unfurl_handlers`,
  `static` (the SPA).
- Captchas (`captcha.go`, Cloudflare Turnstile, off until both keys are set): `requireCaptcha(w, r,
  action)` guards what a script would abuse (sign-up, sign-in, recovery, friend requests, a first DM
  to a stranger, creating and joining servers, joining notes and guest calls, bug reports, Discovery
  and public sticker packs, Telegram imports) and every password check and username change. A
  refusal names the action in `X-Captcha-Action`; the web's `api.captchaSolver` (`lib/captcha.ts`)
  and Android's `Api.captchaSolver` (set by `Auth.solveCaptcha`) solve it and send the request
  again, so a guarded call needs nothing of its own.
- Webhooks are used with their token at `/api/webhooks/{wid}/{token}` and at the versioned paths
  Discord's libraries build (`/api/v1`, `/api/v6` to `/api/v10`), with `/slack` and `/github`
  variants, taking Discord's JSON.
- `static.go` serves `web/dist`: hashed assets immutable, `index.html` for any other path, and its
  own page heads (for link previews elsewhere) at `/invite/{code}`, `/call/{code}`, `/note/{token}`,
  `/@{username}` and `/`. The Content-Security-Policy is there too (plugins load from `blob:`,
  Turnstile from Cloudflare).
- `ChannelAccess`, `ConvForChannel`, `ServerChannelPatch` and `CanRotate` on `Server` are hooks the
  server-channel code (`server_glue.go`) installs; DM access is built in.

### Gateway (`internal/gateway`, `web/src/gateway`)

- One WebSocket at `GET /gateway`. The client sends `{op, d}`, the server `{t, s, d}`. The first
  frame is `identify` with the token, answered by `ready`: `session_id`, `user`, `users`,
  `channels`, `relationships`, `read_states`, `presences`, `key_grants`, `settings`, `servers`,
  `emojis`, `sticker_packs`, `voice_states`, `group_add_notices`, `guest`, `nexa`, and `now` (the
  server's clock as it went out; web `lib/serverClock.ts` and Android `data/ServerClock` keep how
  far the device's clock is off, for running clocks of server times).
- Client ops: `identify`, `heartbeat` (every 25 s, answered by `heartbeat_ack`), `presence`,
  `typing`, `voice_state`, `voice_signal`, `subscribe_members`, `activities` (the desktop app's
  Rich Presence), `away`, `note_cursor`. The server also pings every 12 s at the protocol level.
- Close codes: 4001 session revoked (the client signs out), 4003 banned, 4008 rate limited,
  4009 too many connections. A connection may send 20 ops a second, in bursts of 100.
- Events are the `Ev*` constants in `protocol.go`: messages, reactions, typing, channels and their
  positions, servers, members, roles, presence, users, relationships, read states, voice and calls,
  keys (`key_grant`, `keys_needed`, `key_rotation_needed`), emoji and stickers, pins, bans, invites,
  webhooks, polls, settings, threads, follows, AutoMod, the audit log, notes (`note_*`), Nexa and
  moderation (`nexa_*`, `mod_*`), guests and sessions.
- Handlers emit through the `Broadcaster` interface in `api/router.go` (`EmitUsers`, `EmitChannel`,
  ...); the hub sends an event only to members allowed to see it (`store/permcache.go` answers that)
  and encodes it once for all of them.
- A new event touches: the constant in `protocol.go`, the emit in the handler, its type in
  `web/src/gateway/events.ts`, its handling in `web/src/gateway/dispatch.ts` (which updates the
  stores), and the same on Android (`fish.nexa.data.Session`).
- What follows the app without being part of it (plugins, the search index, notifications) listens
  through `dispatchHooks` in `dispatch.ts`, each hook called inside a try/catch (`each`), so a
  listener that throws stops nothing. `dispatchHooks.onEvent` takes the `AppEvent`s of
  `gateway/appEvents.ts`, each fired once the stores have the change, with what was there when
  something goes: reactions, typing started and stopped, members joined, updated and left, servers
  joined and left, channels and threads created, updated and deleted, user and presence updates,
  relationship changes and the language changing (`onLocaleChange` in `i18n`, once the new
  language's words have loaded). Servers, relationships and typing are told by watching their
  stores, since they also change without an event or arrive twice (a REST answer and its event);
  `ready` and sign-out fill and empty the stores inside `quietly`, and after a reconnect's `ready`
  `reportMissed` tells what changed while the connection was down. A deleted message cannot be
  kept on screen by a listener (left for a later update).

### Database (`internal/db`, `internal/store`)

- Every query lives in `internal/store`; handlers never touch `database/sql`. Queries are written
  once with `?` placeholders; `internal/db` rebinds them for Postgres, and `db.Dialect` covers the
  few places the two differ (JSON arrays, greatest/max, case folding with the `ulower()` the store
  registers on SQLite, unique violations).
- Ids are snowflakes, times Unix milliseconds, booleans 0 and 1, JSON kept as text.
- SQLite is live and Postgres must keep working: a new migration goes in both
  `internal/db/migrations` and `internal/db/migrations-postgres` with the same number (Postgres
  starts at `0013_init.sql`). Migrations are embedded, forward only, one transaction each.
  `tools/gen_pg_schema.sh` prints the Postgres schema the SQLite migrations add up to, to diff
  against. chatd refuses to start on a database a newer build has migrated, so a release with a
  migration cannot roll back to `bin/chatd.prev`.
- The tables, by area: accounts (`users`, `sessions`, `user_settings`, `user_mfa`,
  `mfa_backup_codes`, `user_sounds`, `username_holds`), people (`relationships`), conversations
  (`channels` for every kind, `dm_participants`, `channel_overwrites`, `channel_unlocks`,
  `thread_members`, `channel_follows`, `crossposts`), messages (`messages` with `ciphertext`, and
  `plain` for webhook and system text; `attachments`, `reactions`, `pins`, `read_states`, `polls`,
  `poll_votes`), keys (`key_epochs`, `key_grants`, `key_flags`), servers (`servers`,
  `server_members`, `roles`, `member_roles`, `invites`, `bans`, `audit_log`, `automod_rules`,
  `automod_events`), expressions (`emojis`, `sticker_packs`, `stickers`, `sticker_installs`,
  `recent_stickers`, `blocked_images`), files (`blobs`, `uploads`), calls (`guest_links`, `guests`,
  `realtime_usage`), integrations (`webhooks`, `discord_links`), notes (`notes`, `note_members`,
  `note_invites`, `note_links`, `note_files`, `note_versions`, `note_version_files`, `note_keys`,
  `note_updates`, `note_uploads`), Nexa and moderation (`mod_cases`, `mod_messages`,
  `mod_message_files`, `mod_restrictions`, `mod_announcements`, `mod_log`, `mod_reads`, `nexa_reads`,
  `bug_reports`, `bug_attachments`, `bug_messages`, `bug_message_files`, `client_errors`), the
  instance (`instance_settings`).
- Channel types: `dm`, `group_dm`, `subchat`, `text`, `voice`, `category`, `announcement`, `forum`,
  `thread`, `private_thread`. A channel's `key_conv_id` names the conversation whose keys encrypt
  it: itself for DMs and private channels, the server otherwise.
- `cmd/chatmigrate` copies a SQLite database into Postgres (`DATABASE_URL`).

### Permissions

`internal/perms` is Discord's algorithm with Discord's bit values. `web/src/lib/perms.ts` mirrors it
(BigInt, decimal strings on the wire), and so does Android's `fish.nexa.data.Perms`. Server channel
access goes through the hooks `server_glue.go` installs, answered from `store/permcache.go`.

### Media and uploads (`internal/media`)

- Files are content-addressed on disk under `DATA_DIR/media`, described by the `blobs` table.
- Public kinds (`avatar`, `banner`, `icon`, `emoji`, `sticker`, `tag`, `widget`, `typing`) are
  served at `/media/{kind}/{id}`, immutable, and at a requested size as a variant made once (the next
  power of two). An animation keeps moving at any size: one of 512 px or less is served as it is, a
  larger GIF gets every frame composed and shrunk (`animated.go`), and a WebP or APNG is served as
  uploaded; `?still=1` asks for the first frame. Sized avatar, banner and icon addresses carry
  `&v=2` (web `api/users.ts`, Android `Media.kt`) so caches drop the stills that large GIFs used to be. The kind in the address must match the stored one, and a picture the staff blocked
  is served to nobody.
- Attachments are opaque encrypted blobs, served only to people in the conversation
  (`/media/attachments/{id}`). Files of bug reports and case threads are private to their people
  and the staff. Webhook files are plain.
- The server strips hidden metadata from the pictures and videos it keeps readable (`scrub.go`);
  the apps do the same before encrypting (web `lib/scrubMetadata.ts`, Android `MetadataScrub`), all
  checked against `internal/media/testdata/scrub`.
- Small files go up in one request (`POST /channels/{id}/attachments`); big ones through
  `/api/v1/uploads` in pieces (Cloudflare caps a request at 100 MB), with disk headroom and
  per-account caps (`roomForUpload`).

### Outbound requests

Everything a person can make the server fetch goes through `internal/egress` (WARP's SOCKS5 proxy,
`EGRESS_PROXY=warp|off|socks5://...`): link previews (`unfurl`, asked for by the sender's app,
which puts the preview inside the encrypted message), the media proxy (only addresses the server
signed; `POST /proxy/refresh` re-signs old ones), the YouTube player (`/yt/...`), IGDB, Deezer,
Discord's Rich Presence apps and Discord server templates (`GET /servers/templates/discord/{code}`
and `POST /servers/import/discord`). Discord's gateway, Cloudflare Realtime and the tunnel go out directly.

### Calls

`internal/voice` tracks who is in each call. Without Realtime keys calls are peer to peer (a mesh,
signalled over the gateway's `voice_signal`); with `REALTIME_APP_ID`/`REALTIME_APP_SECRET` every call
goes through Cloudflare's SFU, with chatd as its signalling proxy (`/api/v1/voice/sfu/*`) deciding
who may pull which track. The usage meter pauses video near `REALTIME_MONTHLY_GB` and stops calls
just short of it. A call through the SFU outlives a dropped socket for `voiceGrace`. Guest links let
someone without an account into one call. Frames are encrypted in the apps.

Call timers: the registry keeps when each channel went from empty to occupied and stamps it on
every voice state as `call_since` (the same for everyone in the call, kept when the person who
started it leaves, gone once the channel empties). The apps count from it, through the server
clock offset, falling back to the earliest `joined_at` on a server without it (web
`lib/callTimer.ts` and `components/voice/CallTimer.tsx`, Android `data/CallTimer` and
`ui/voice/CallTimer.kt`, both ticking once a second). The time shows after "Voice Connected", in
the call view (beside the quality on a wide call, centred above the controls on a narrow one and
on Android), as a tag on an occupied voice channel in the sidebar (making way on the web for the
row's hover buttons) and on the banner of a call this device is not in. Nothing counts while a
call rings, and the time holds still while this device's call is reconnecting. Android's call
notification's chronometer runs from the same start.

Moderators act on people in a server's voice channels with `PATCH /servers/{id}/members/{uid}/voice`
(`mute`, `deaf`, `channel_id`, null to disconnect), checked against the permissions in the channel
the person is in (Mute Members, Deafen Members, Move Members; a move also needs View Channel on the
destination) and the role hierarchy; a guest can be muted or disconnected but not moved. A server
mute or deafen is kept in the member's `server_members.flags` (2 muted, 4 deafened; 1 is AutoMod's
quarantine) and applied again whenever they join a voice channel of that server. A voice state's
`suppress` says the channel denies Speak (`server_mute` is set too, for older apps), and the leave
of someone a moderator put out carries `reason: "disconnected"` ("moved" is another device of theirs
taking the call). On the web the moderator's buttons are `components/voice/voiceModeration.ts`, in the
call's menus in `components/voice/callMenus.ts`; dragging people between channels is
`stores/voiceDrag.ts`. On Android it is `ui/voice/VoiceModeration.kt`.

How a screen share is sent was measured through the SFU with `tools/share_quality.py`, and the
findings decide it (web `voice/media.ts`, `shareQuality.ts`, `shareAdapt.ts`; Android `VideoCap`,
`ShareAdapt`). A share has a mode, picked in the share dialog (web `ShareScreenModal.tsx`, Android
`openShareScreen` in `ui/voice/CallMenus.kt`) and kept in the account's voice settings
(`shareMode`; Custom's `shareResolution`, `shareFps`, `shareBitrate` in bits a second or null for
automatic, and `shareKeep`). `sharePlan` (web `shareQuality.ts`, Android `VideoCap.sharePlan`)
turns it into a `SharePlan`: Performance is 1080p at 60 fps within 6 Mbit/s, smooth; Quality is the
screen's own size at up to 60 fps within 12 Mbit/s, sharp; Custom is as chosen. Settings from before
modes read as Performance when they held the usual 1080p at 30 fps, otherwise as Custom (60 fps
smooth, slower sharp), without being rewritten (`shareModeOf`). A smooth share gets no content hint
and is steered by `ShareAdapter`; a sharp one gets `detail` (`text` at 15 fps), keeps its size and
gives up frames. Chromium's `motion` hint shrinks a share while the bandwidth estimate is still low at
the start and never grows it back (1080p60 stayed 480x270, 320x180 in Electron), and asking for
`maintain-framerate` does the same, so a smooth share is sized by `ShareAdapter` instead: every few
seconds it reads the encoder's `targetBitrate` and scales the picture just far enough for about 0.06
bits a pixel a frame, growing back when there is room. A share's sender has high priority and the bitrate
`shareBitrate` gives (9.9 Mbit/s at 1080p60). A watched share whose picture is stuck behind a lost
frame asks its sender for a keyframe within about half a second (`stallWatch.ts`, read by `sfu.ts`
`watchStalls`, through `FrameCrypto.requestKeyFrame` and the transform's `sendKeyFrameRequest`)
where the browser waits about 3 s; Android's WebRTC has no way to ask. A video receiver whose first
frame is not a keyframe asks for one at once from the frame worker (`frameCrypto.worker.ts`
`keyAwaited`), rather than after Chromium's own wait of about 200 ms, so a share or camera just
pulled shows sooner.

Through the SFU, a share goes out in H.264 rather than VP8 when the sender's hardware encoder makes
it and everyone else in the call said they can watch it (`codecs: ["h264"]` on their voice state);
otherwise VP8. Android does this whenever its WebRTC can send H.264 (`VideoCap.sendsH264`,
`SfuTransport` `wantsH264`). The web does it only in a Chromium on a Mac (the desktop app, Chrome, Edge) whose
H.264 encoder the browser calls power efficient (`videoCap.ts` `sharesInH264`, which reads
`navigator.mediaCapabilities.encodingInfo`): VideoToolbox there, where VP8 is software and a busy
share dropped frames. Windows stays on VP8 (hardware H.264 in WebRTC varies by graphics driver), as
does Safari. Someone joining who cannot watch H.264, or the last of them leaving, makes the sender
publish the share again in the other codec (`republishScreen` in `sfu.ts`, closing its own track
with `sfuClose`), and everyone pulls it afresh. The peer-to-peer mesh always sends VP8.

Through the SFU, cameras and watched shares are pulled only while the call's pictures are on
screen: a call view of that call is open on a visible page, or a call video floats in picture in
picture (web `voice/videoShown.ts`, which `VoiceView` registers with and the engine watches;
Android `voice/VideoShown`, from the call view, whether the app is in front, and `Pip.active`).
When they leave the screen the transport keeps pulling them for `VIDEO_HIDDEN_GRACE_MS` (15 s),
then drops them (`setVideoShown`), and pulls them again the moment they are back. Voices and a
share's sound always come in. The mesh pulls nothing selectively and ignores it.

A share's sound is Opus in stereo at 128 kbit/s without DTX (`opus.ts` `STREAM_AUDIO_BITRATE`),
where voices are 48 kbit/s with DTX. `sfu.ts` passes the mids of every share-sound track, its own
and those it pulls, to `tunedRemote` (which sets what the sender's encoder makes) and `tunedLocal`
(this device's own descriptions, where a decoder learns to play stereo) at every exchange. The SFU
meter charges a pulled share sound at `StreamAudioBps` (128 kbit/s). The mesh keeps the voice tuning.

### Nexa, moderation and safety

- Nexa is the account the service speaks as: notices, announcements, and case threads where a
  member can appeal (not end-to-end encrypted, and the app says so). The staff are Nexa admins (user
  flag bit 1: the first account, or `ADMIN_USERNAME` while nobody has been admin yet). Their panel is
  `/channels/@admin` (`/api/v1/moderation/*`); the member's side is `/api/v1/nexa/*`.
- Staff can act on accounts (mutes, bans, purges, removing pictures, resetting fields), servers
  (including Discovery holds), sticker packs, emoji and uploads (`moderation_actions.go` and the
  other `moderation_*` files). Actions are recorded in `mod_log`; one on an account comes with a case
  (`mod_cases`) whose thread the member sees.
- Bug reports (`/api/v1/bugs`), client crash reports (`/api/v1/client-errors`) and the admin's
  instance settings (registration mode and key, which override `chatd.env` until cleared).
- Case threads and bug reports are conversations: either side writes and sends pictures and
  recordings (private blobs of kind `case` and `bug`, `/media/cases/{id}` and `/media/bugs/{id}`).
  A closed case, and a bug report staff set to resolved, won't fix or closed, takes nothing more
  from anyone, staff included, until staff open it again. What each member of staff has read of
  them is kept in `mod_reads` (`moderation_reads.go`): the panel's badges count the threads waiting
  on the staff that hold something new to that person, `mod_unread` keeps their devices in step,
  and `POST /moderation/read` is Mark as Read.
- AutoMod: the server applies a server's rules to what it can read (names, profiles, thread and
  post titles); the members' apps apply the same rules to encrypted messages and report what they
  held (`POST /servers/{id}/automod/report`).

### Configuration

Every setting is documented in `chatd.env.example`; `internal/config` loads them. Groups:
addresses (`LISTEN`, `PUBLIC_URL`, `ALT_URLS`, `MOVED_FROM`), storage (`DATA_DIR`, `DATABASE_URL`,
`REDIS_URL`, `WEB_DIST`, `DESKTOP_DIR`, `ANDROID_DIR`, `NODE_ID`), limits (`MAX_UPLOAD_BYTES`,
`MAX_AVATAR_BYTES`, `MAX_EMOJI_BYTES`, `MAX_STICKER_BYTES`, `SESSION_TTL_DAYS`), sign-up
(`REGISTRATION` open/invite/closed, `REGISTRATION_KEY`, `ADMIN_USERNAME`, `TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`), calls (`REALTIME_APP_ID`, `REALTIME_APP_SECRET`, `REALTIME_MONTHLY_GB`,
`GUEST_LINKS_P2P`, `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `TURN_KEY_ID`,
`TURN_API_TOKEN`), outbound (`EGRESS_PROXY`, `WARP_PROXY_PORT`), integrations (`KLIPY_API_KEY`,
`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_ACTIVITY_GUILD_ID`, `DISCORD_REDIRECT_URL`
left empty, `DISCORD_API_URL` for the fake), logging (`LOG_LEVEL`, `LOG_FILE`). A new setting goes
in `config.go`, `chatd.env.example` and this list.

### Go tests

- `internal/api`: `newTestServer(t)` (`testutil_test.go`) is a real `httptest` server with the
  gateway wired in, on a fresh database (SQLite, or a Postgres schema with `CHAT_TEST_POSTGRES`).
  `register(t, ts, username)` (`auth_handlers_test.go`) returns a token and id;
  `do(t, ts, method, path, token, body)` makes a JSON request; `errCode` reads an error;
  `connectGWReady` / `connectGW` open a gateway socket and `gw.next(event, timeout)` waits for an event.
- `internal/store`: `newStore(t)`, `mkUser(t, s, name)`.
- Tests against live services run only with their variables set (`UNFURL_LIVE`, `REALTIME_LIVE`,
  `TELEGRAM_LIVE_TOKEN`, `DISCORD_BOT_TOKEN`); the Discord tests otherwise use `fakediscord`.

## End-to-end encryption

The client does all of it (`web/src/crypto`; Android ports it in `fish.nexa.crypto`, checked
against `web-crypto-vectors.json`). The server stores ciphertext plus the metadata it needs to
deliver: author, channel, mentions, reactions, sizes.

- Accounts: Argon2id stretches the password on the device; HKDF splits it into an auth key (the
  only thing sent, hashed again on the server) and an encryption key that wraps the account's X25519
  identity. The client checks the KDF parameters the server hands out (`lib/serverKdf.ts`) so a
  server cannot weaken them. A recovery key shown once at registration can restore the identity.
- Conversations have a root key per epoch, handed to each member as a sealed box to their identity
  key (`key_grants`). Channel keys derive from the root, so one grant covers every channel of a
  server. When someone needs keys the server sends `keys_needed` and an online holder wraps them,
  for every epoch they lack, so someone who joins reads what was said before they came; a device
  still waiting asks again with `POST /keys/request`. When membership shrinks it sends
  `key_rotation_needed` and an online holder makes a new epoch.
  Invite links can carry the root key in the URL fragment (`#k=<epoch>.<key>`), which never reaches
  the server.
- Messages are AES-256-GCM envelopes with the channel and author bound in. Attachments are chunked
  (`crypto/fileChunks.ts`: "ECF1", a base IV, then length-prefixed chunks), each file with its own
  key inside the message; pictures also send a small copy of their own. Downloads and video play
  decrypt as they stream, in `download-sw.ts`.
- Call frames are sealed again with a key derived from the conversation's (`voice/frameCrypto.ts`;
  Android in native code, `cpp/frame`), because the SFU ends the transport encryption. Guest links
  carry the call key in their fragment.
- Notes have a key of their own, sealed to each member; a share link carries a second key in its
  fragment. Announcement follows are sealed to the follow's key. The settings blob, sound packs and
  the search index on the device are sealed too.
- Keys on the device: IndexedDB (`crypto/keystore.ts`), cleared on sign-out; with a passcode lock
  the device keeps neither the identity nor any roots in the clear. Identity keys are pinned the
  first time they are seen (`lib/keyPins.ts`) and safety numbers (`crypto/fingerprint.ts`) let two
  people compare them.
- Not end-to-end encrypted: webhook messages (`messages.plain`; the app marks them), Nexa's case
  threads, poll and AutoMod notices the server writes, and everything public (profiles, avatars,
  server names, emoji and stickers).

## Web app (`web/src`)

React 18, TypeScript, Vite, zustand and react-router; `@/` is `web/src`. `main.tsx` mounts `App` and
registers the two service workers: `sw.ts` (no fetch handler; a new copy taking over means a
deploy, which `lib/appUpdate.ts` offers, using `version.json`) and `download-sw.ts` (scoped to
`/__download/`, streams and decrypts large downloads and videos). Pages load lazily
(`lib/lazyChunk.ts`).

### Routes (`routes.tsx`)

`/` (home), `/login`, `/register`, `/recover`, `/invite/:code`, `/note/:token`, `/download`,
`/terms`, `/privacy`, `/about`, `/call/:code` (guest call), `/stickers/pack/:packId`,
`/connected/discord`, and inside the signed-in shell `/channels/@me` (friends), `@me/nexa` (with
`cases/:caseId`, `bugs/:reportId`), `@me/notes[/:noteId]`, `@admin/*` (the staff panel),
`@discover`, `@me/:channelId[/:messageId]` (DMs), `:serverId[/:channelId[/:messageId]]`, then
`/:handle` (a profile link, `/@name`).

### State and data flow

- `api/` is the typed REST client (`api/client.ts` adds the token, a timeout and the error
  envelope); `api/types.ts` holds the wire types.
- `gateway/client.ts` keeps the socket (backoff, heartbeat), `gateway/session.ts` starts it after
  sign-in, and `gateway/dispatch.ts` applies every event to the stores.
- Stores (`stores/`, zustand): `auth` (sign-in status: idle, loading, offline, anonymous, locked,
  pinlocked, ready), `keys`, `settings` (the account's settings, sealed and synced with an optimistic
  version), `messages`, `channels`, `servers`, `users`, `presence`, `relationships`, `readStates`,
  `typing`, `threads`, `voice`, `voiceLocal`, `expressions`, `notes`, `nexa`, `moderation`,
  `discord`, `desktop`, `ui` (modals), `tabs`, `selection`, `pick`, `uploads`, `unsaved`,
  `replyTargets`, `serverNav`, `slowmode`, `profilePopout`, `automodNotices`, `groupAddNotices`,
  `keyAlerts`, `threadLast` (each thread's newest message, for the card under the message it hangs
  from), `voiceDrag` (someone being dragged to another voice channel). `typing` keeps who is typing
  where, for the status dot's typing pill (the dot stretched sideways, never taller) and the dots
  just after a server channel's name, both of which the account's settings can turn off
  (`typingAvatars`, `typingChannels`).
- `lib/decrypt.ts` turns a message into what the stores keep (webhook messages pass through
  `lib/webhookMessage.ts` instead). `lib/keyring.ts` holds the roots in memory and caches channel keys.

### Main folders

- `crypto/`: KDF, identity and sealed boxes, conversation keys, message envelopes, files, notes,
  safety numbers, the IndexedDB keystore, streaming decryption.
- `markdown/`: the message parser (`parse.ts`: the chat syntax people know plus GitHub's blocks,
  coloured text `[words]{red}`, timestamps, mentions) and renderer.
- `search/`: a full-text index of what this device has decrypted, in a worker, sealed on disk;
  `lib/search.ts` reads the query and its filters.
- `voice/`: calls (`session.ts` for the app, `engine.ts`, `transport.ts` with `mesh.ts` and
  `sfu.ts`, `frameCrypto` and its worker, `playback.ts` per-person volume, `denoise.ts` RNNoise,
  `opus.ts`, `redundancy.ts`, `videoCap.ts`, `shareQuality.ts`, `shareAdapt.ts` (sizing a 60 fps
  share to the link), `stallWatch.ts` (a watched share stuck behind a lost frame), `callRecord.ts`
  for DM call lines).
- `lib/`: everything else, one concern per file. Notable groups: `look/` (themes, presets, the theme
  builder's maths, custom CSS and plugins with their API in `look/plugins`), `notes/` (the Yjs
  document, sessions, sharing, history, mentions), `automod/` (the client side of AutoMod), `spell/` (Hunspell
  in a worker for Nexa's own text menu), and single files for attachments, uploads, notifications,
  sounds, keybinds, the app lock, away detection, moving domains, invites, export, time, links,
  server tags, widgets and the rest.
- `components/` by area: `shell` (app frame, tabs, banners, What's New, update dialog), `sidebar`,
  `rail`, `chat` (message list, message item, embeds, attachments, players, pins, member list),
  `composer` (the box, autocomplete, commands, and `format/`, the formatting editor), `modals`,
  `settings` (every Settings page), `server` (Server Settings pages), `voice`, `profile`, `pickers`
  (emoji, GIFs, stickers), `notes`, `threads`, `forum`, `search`, `moderation` (staff panel), `nexa`
  (the member's Nexa pages, and `ThreadChat`, which draws a case thread or a bug report as a
  conversation with the chat's own rows, attachments and box, for both sides), `bugs`, `legal`
  (Terms gate), `invite`, `discovery`, `follows`, `friends`, `stickers`,
  `servertag`, `activity`, `desktop`, `common` (shared controls: Modal, Popout, ContextMenu, Button,
  Toggle, Select, Avatar, Twemoji and more).
- Context menus: every menu the app opens is registered in `lib/contextMenus/registry.ts`, and none
  is built inline. A menu is `defineMenu<Ctx>(kind, groups)`, defined once at module level beside
  what it acts on (`chat/messageMenu.ts`, `sidebar/serverMenu.ts`, `sidebar/dmMenu.ts`, ...): groups
  of buttons, each `button(id, (ctx) => item | items | null)`, with a line drawn between two groups
  that both show something. Button ids are camelCase and unique across every menu
  (`deleteMessage`), since the plugin API will name buttons by id alone; a set of buttons that two
  menus share is a factory taking the ids (`imageButtons`, `dmArrangeButtons`, `threadButtons`,
  `relationshipButtons`). Components open a menu with `menu.open(ctx, placement)`, passing what only
  they have (callbacks, the moves a reorder hook offers) in the context. `registry.test.ts` fails
  when any file but the registry calls `openContextMenu`, and loads every menu module together to
  catch a button id used twice. A menu about something says what with `about(menu, subjects, (ctx) => ({
  message, userId, channelId, serverId }))`, which is what plugins' menu callbacks are told
  (`subjects` names which of message, user, channel and server that gives, for the docs). The
  table of menus in `docs/plugins.md` is made from the registry by `lib/contextMenus/menuDocs.test.ts`,
  which fails when it is out of date (`UPDATE_DOCS=1` writes it again) or a menu has no line in its
  `WHERE` list; a new or changed menu updates both. Plugins
  change menus through the registry's layer of changes (`addButton`, `removeButton`, `editButton`,
  each recorded against the plugin and taken back by `dropChanges` when it stops); every menu
  module is listed in `lib/contextMenus/all.ts` so the plugin API can load them all before a plugin
  that may change menus starts, and a test fails when one is missing there.
- Plugins (`lib/look/plugins`): `runtime.ts` pins, loads, starts and stops them. A plugin without
  `apiVersion`, or with 1, gets the v1 API (`api.ts`, kept as it was); `apiVersion: 2` gets v2
  (`api2.ts` for its types, `runtimeV2.ts` for the API, `objects.ts` turning the app's objects into
  the API's, `permissions.ts` for what a plugin can ask for). A v2 plugin's grants are
  `PluginEntry.permissions` in the account's settings; every v2 method checks its permission when
  it is called (`PermissionError`; a method that returns a promise rejects with it), events are
  delivered only with the permission for what they carry, and context objects leave out what a
  plugin may not see. Before anyone has agreed to a plugin its code never runs: the Add Plugin
  dialog's review stage and a link plugin's update read its API version, its plainly written
  `permissions` list and who it is from the text (`declaration.ts`), and what is granted is exactly
  that list (installing is all or nothing; new code keeps what it still asks for, asks again for
  anything new, drops the rest). `components/settings/look/PermissionLedger.tsx` draws a list of
  permissions, grouped by what they touch, everywhere one is shown: the add dialog, the update
  dialog and each v2 plugin's Permissions panel on the Plugins page, with a switch for each. v2 events are built on `dispatchHooks` (above); v2 stylesheets go when the
  plugin stops unless added with `persist`. Plugins never run on Android. `docs/plugins.md` is
  the reference for plugin authors (VitePress markdown: v2 first, v1 under its own heading), with
  examples in `docs/examples/` for both versions; a change to the API changes it in the same commit.
- Plugin commands sit beside the app's own in `components/composer/commands.ts`: a v1 plugin's is
  refused a taken name and its return value is sent; a v2 plugin's (`takePluginCommand`) takes the
  name from any plugin, can never take one of the app's, and sends nothing. Plugin keybinds:
  `lib/pluginKeybinds.ts` holds what running plugins registered, `components/shell/Shortcuts.tsx`
  runs them after the app's own keybinds (in the window only, never system-wide), and the keys
  people chose are the account's `pluginKeybinds` setting (by plugin id, then keybind id, checked
  by `sanitizePluginKeybinds`, which also forgets a deleted plugin's). Toasts have a fourth kind,
  `warning`, and `toast(text, kind, duration)` takes a duration from 1 to 15 seconds, which only
  plugins' toasts use. Settings, Keybinds has a Plugins section (`components/settings/PluginKeybinds.tsx`)
  for every running plugin's keybinds, recorded by the same rules as the app's own, pointing out
  keys the app or another plugin already has. A plugin's menu button may name a lucide icon, drawn
  by `components/common/MenuIcon.tsx`, which loads (with lucide's list of every icon) only when a
  menu shows one; the app's own buttons have no icons.
- Mentions in notes: a note writes `<@id>` as a message does. Typing @ in the note editor offers
  the people who have the note (`GET /notes/{id}/sharing`, so viewers too, never yourself),
  ranked by `lib/notes/mentions.ts`, in the message box's `Autocomplete` (its `style` prop places
  it) hung from the caret by `components/notes/NoteMentions.tsx`. The format surface finds the
  "@name" before the caret (`mentionAt`), puts the person in (the `mention` command) and redraws
  mentions with names that arrive later (`setNames`, called from `useFormatBench`), without a save
  or an undo step. Clicking a mention in the editor selects it whole, as a chip in a document
  (Backspace or typing takes it out as one), and opens the profile popout beside it with
  `keepFocus` (`openProfilePopout`'s fourth argument, `Popout`'s prop): the keyboard stays in the
  note and the first key typed there closes the card. Only a surface given `onMention` does this.
  The notes list shows mentions by name. Nobody is notified of a mention. Android:
  `notes/NoteMentions` ranks the same, `ui/notes/NoteMentions.kt` draws the list, and
  `FormatSurface` has `mentionAt`, `Cmd.Mention`, `relabelPeople`, and `onMention` with
  `tappedAt` (a tap on a mention, seen by `mentionTaps` in `FormatPage.kt` without taking it
  from the field, selects it and opens the profile sheet).
- Files in notes: a file sits on a line of its own, `![name](nexa-file:id)`, with how much of
  the line a picture takes and the side a narrower one keeps to as `?w=60`, `?w=60&a=left`,
  `?a=right` (`RE_FILE`, `fileLine` and `fileAlign` in `markdown/parse.ts`; the middle and the
  full width are left unsaid). In the editor `components/notes/NoteFile.tsx` draws the picture
  with grips on its sides for its width and a bar along its top: Move first (dragged up or down
  to the gap between two lines nearest the pointer, across to the left, middle or right third of
  the line, with the landing drawn over the page; the arrow keys do the same), then the sizes and
  Remove. Both go through the surface's `fileWidth` and `placeFile` commands, one undo step each;
  a moved file takes away the empty line that followed it when text is left on both sides.
  Android: `ui/notes/NoteFile.kt` (`FileMove`, TalkBack actions in place of the arrow keys),
  `FormatSurface` `Cmd.PlaceFile`, and `BlockPlaces` in `ui/format/FormatPage.kt`, where the
  page keeps each block's place on the screen and draws the landing.
- `pages/`: one per route. `styles/`: `tokens.css` (every theme token: colour, radius, shadow,
  motion), `base.css`, `markdown.css`, `fonts.css` (Wix Madefor) and `fonts-classic.css` (Onest,
  Mona Sans). `lib/theme.ts` applies a theme; `lib/look/` derives presets and custom themes.
- The gallery (`components/settings/look/ThemeGallery.tsx`): Seasonal while one is in season, then
  Classic, Colours (the presets' dark and light groups together) and Greyscale and High Contrast.
  A theme with a light version (`forest` and `forest-light`, `presetCards`) is one card with two
  swatches in its corner (`ModeCard`, each that version's own background) that switch between
  them. Such a card shows and puts on the version in the mode being worn now (the resolved look's
  scheme), so going from one theme to another keeps light or dark; Midnight, Sky and the classic themes are cards of their own. Android does the same
  (`Presets.cards`, `ThemeModes` in `ui/settings/AppearancePage.kt`).
- Seasonal themes (`lib/look/seasonal.ts`, `SEASONS`): Halloween, Fall, Winter, Holidays,
  Valentine's Day, Spring and Summer, with Winter, Spring and Summer also in a dark Night version
  (same days, the light one's picture through `art`), each a background and an accent run through `deriveTheme`
  and a span of days in the device's calendar (one may run past the new year). The gallery offers
  only those in season, in a Seasonal group above the rest, never putting one on by itself; a
  season and its Night version are one card (`seasonCards`) with two swatches in its corner,
  light and dark, that switch between them. Out
  of season one draws as Dark (`resolveLook`), and `ThemeEffect` sets the account's theme back to
  `dark` once the settings have loaded. While one is worn, `components/common/SeasonalPerch.tsx`
  sits its picture (`assets/seasonal/<id>.svg`, which the Android app copies and draws too) on
  the top edge of the message box, and the gallery's card shows it on the miniature. A season with
  `snow` (Winter Night) has `components/chat/SnowFall.tsx` falling behind the messages: a canvas at
  z-index -1 in the chat column, drawn over the app shell's main panel (its stacking context), and
  nothing at all when motion is reduced or the account's `seasonalSnow` setting is off (Show
  Falling Snow, in the Seasonal group while such a theme is in season). Nothing in it is a set path:
  the wind and each flake's drift, fall and spin are random walks pulled back towards calm
  (Ornstein-Uhlenbeck), fresh noise every frame. Flakes are dots, the near ones bigger and soft at
  the edge. A frame's time step is never below zero (the frame time can come before the moment
  the loop restarted, after a hidden tab, and a negative step made every flake NaN for good)
  (Android `ui/chat/SnowFall.kt`, same model and numbers in dp). Android
  keeps the same list in `ui/theme/look/Seasonal.kt`; a change to one changes the other, and
  `look_vectors.ts` checks the palettes.
  To try them all on any day, build the web with `VITE_ALL_SEASONS=1` (`npx vite build` into a
  scratch directory) or Android with `-PallSeasons=true`: every season is then running every day.
  Never set either for a deploy or a release.
- `i18n/`: `useT()`, `t()` (usable outside components), `<Tr>`; English is bundled and the other
  eleven catalogues (ar, de, es, fr, hi, ja, ko, pt-BR, ru, sv, zh-CN) load when chosen. Keys are flat and
  dotted by area (`settings.*`, `server.*`, `chat.*`, `whatsNew.*`, `android.*`, ...).
- Tests sit beside the code (`*.test.ts[x]`). Vitest runs in node with `fake-indexeddb`; component
  tests start with `// @vitest-environment jsdom`.

## Desktop app (`desktop/`)

Electron (version in `desktop/package.json`, bumped for every release). `src/main/index.ts` opens one
window on the live site (`config.ts`: https://nexa.fish, or `EVILION_URL` in an unpackaged app
while developing; `npm start` builds and runs it), with a tray, system-wide keybinds (`shortcuts.ts`), the screen picker
(`displayPicker.ts`, `src/picker/`), window sound sharing (`appAudio.ts`), permissions limited to
Nexa's origin, takeover from an older Mac copy (`succession.ts`) and updates from Nexa's own server
(`update/`, with a Mac updater of its own since the app is signed ad hoc). `src/main/rpc/` is a Rich
Presence server speaking Discord's IPC and local WebSocket protocols, passing programs through to the
real Discord when it runs, and handing activities to the page, which sends them to chatd.
`src/preload/index.ts` puts `window.evilionDesktop` on Nexa's pages; `src/shared/bridge.ts` and
`web/src/lib/desktopBridge.ts` describe it and must stay in step, compatible with the apps people
already have installed (anything new is optional and checked before use). `build.mjs` bundles with
esbuild, `electron-builder.yml` packs (`sign-mac.cjs` signs Mac builds ad hoc), and
`tools/mac_package.py` and `tools/publish_desktop.py` finish a release.

## Android app (`android/`)

Native Kotlin and Jetpack Compose (package `fish.nexa`, minSdk 26, targetSdk 36; debug builds are
`fish.nexa.debug`). It talks to the server as deployed, so it never depends on unreleased server
changes. Libraries: OkHttp, kotlinx.serialization, Coil 3, Media3 ExoPlayer, Lottie, BouncyCastle,
argon2kt, ZXing and webrtc-sdk. Native code: `app/src/main/cpp` (call frame crypto and H.264 in
`frame/`, RNNoise) through CMake, and `android/ydoc` (yrs, the Rust Yjs, built with cargo-ndk) for
notes.

- `Nexa.kt` is the object graph; `data/State.kt` keeps each store as an immutable snapshot in a
  StateFlow, mirroring the web's zustand stores; `data/Session.kt` handles the gateway's events.
- Packages: `crypto` (the web's crypto), `net` (`Api`, `Gateway`, `Models` as the wire types),
  `data` (stores and logic ported from `web/src/lib` and `stores`), `media` (pictures through Coil,
  encrypted downloads and streaming, Twemoji, sounds), `notes` (CRDT documents, sessions, sharing),
  `search` (the web's index, ported), `voice` (calls: transports, audio routing, the call service,
  picture in picture, notifications), `notify` (alerts over the live connection), `ui/...` (screens
  by area, `ui/theme` with tokens from `tokens.css`, `ui/markdown` with the ported parser).
- Nexa and moderation: `data/NexaInbox` is a member's side (standing, the Nexa conversation, case
  and bug report threads) and `data/Moderation` the staff's (what waits on them, `mod_unread`, the
  panel's requests, and `events` its open views follow). `ui/nexa/ThreadChat` draws a case thread or
  a bug report as a conversation for both sides, as the web's does. The staff panel is native
  (`ui/moderation`: `Panel` with its tabs, `Users`, `Person`, `Moderate` and the other takedown
  sheets, `Cases`, `Bugs`, `Servers`, `Expressions`, `Logs`, `Parts`, `Words`), at
  `Route.Admin(path)`, whose path is the web's below `/channels/@admin`.
- `data/ThreadLast` keeps each thread's newest message for the card under the message it hangs from
  (the web's `threadLast`), and `KeyManager` asks the holders again (`/keys/request`) while it waits.
- There is no push service: `notify/ConnectionService` keeps the connection open in the background
  (on unless turned off) and `Notifier` raises alerts on the device.
- Updates (`ui/AppUpdate`) work the way the desktop app's do: a look at `/api/v1/android/latest` ten
  seconds after the app opens and every minute while it is in front (failures back off to fifteen
  minutes), then the build for the phone's processor downloads in the background, resuming a broken
  download with a Range request (If-Range on the SHA-256 the server sends as its ETag), and is
  checked against its SHA-256 before it is offered. Install hands it to a `PackageInstaller` session
  whose result comes back to `UpdateInstallReceiver`; while Android's screens for it are open,
  `voice/Pip.held` keeps a call from floating over their buttons, which Android would then refuse to
  press. Settings, About shows where it stands and the user panel a green button while a build
  waits. Debug builds (`fish.nexa.debug`) never update themselves. To try it end to end, build two
  releases with `tools/android_release.py --server http://10.0.2.2:$PORT --to <scratch dir>` (the
  second with a higher versionCode, both with the debug network config copied into
  `src/release/res/xml/` for that build only) and serve the newer folder with `ANDROID_DIR`.
- Calls (`voice/`): `ShareAdapt` sizes a 60 fps share as the web's `shareAdapt.ts` does, and
  `ui/voice/VoiceModeration.kt` is the moderators' voice menu (see Calls).
- Compose redraws a composable only for state it collected: `Nexa.settings`' getters and the stores'
  `get(...)` are plain reads, and a row that reads them can keep an old answer when its own
  arguments did not change. Read what a composable shows through `collectAsState()` (or
  `ui.shell.settingOn(key)` for a yes or no setting), in the composable that shows it.
- The build's `copyWebAssets` task copies the web's locale files, sounds, emoji sprites,
  `whatsNew.ts`, the seasonal themes' pictures and the legal documents into the app; `assets/lucide.json`, `assets/emoji/` and
  `assets/licenses.json` come from `android/tools`.
- Logic ported from the web (markdown, search, themes, the formatting editor, webhook messages,
  crypto, metadata scrubbing, the notes CRDT) is tested against vectors produced by the web's own
  code (`app/src/test/resources/web-*-vectors.json*`; most are regenerated by
  `android/tools/*_vectors.ts`, and each file's header says how).
- Releases: raise `versionCode` and `versionName` in `app/build.gradle.kts`, then
  `make publish-android` (needs `android/keystore.properties`), commit `downloads/android`, push,
  and pull on the server; chatd offers it at once (`downloads/android/README.md`).

## Tools (`tools/`)

- Testing: `check.sh`, `e2e.py`, `screenshot.py`, `seed.py`, `webhook_e2e.py`, `discord_e2e.py`,
  `sfu_call.py`, `sfu_guest.py`, `call_quality.py` and `share_quality.py` with `netsim/`, `ios_sim.py`
  with `ios/`, `app_size.py`.
- i18n: `i18n_check.py`, `i18n_keys_used.py`, `i18n_apply.py` (write or merge a language's
  values), `i18n_extract.py` (pull hardcoded English into keys); `android/tools/add_strings.py`.
- Releases: `android_release.py`, `mac_package.py`, `publish_desktop.py`, `licenses.py`.
- Assets: `twemoji_font.py`, `twemoji_font_check.py`, `twemoji_sprites.py`, `trace_wordmark.py`,
  `home_shots.py` and `home_gifs.py` (the front page's pictures and loops), `trailer.py`.
- Schema: `gen_pg_schema.sh`, `pg_schema.py`.

## Deploying (only when the owner says "deploy")

- A web-only change: `make web`. chatd reads `web/dist` from disk on every request, so it is live at
  once, with no restart.
- A server change: `make server` (it keeps the binary it replaces as `bin/chatd.prev`), then
  `sudo systemctl restart xyz.evilion.chat` (the unit runs `run.sh`). `make build` builds both. Say
  so when the deploy runs a database migration.
- Back up first (`bash backup.sh`, which keeps only the newest set) only when the request asks for it.
- To roll back: `cp bin/chatd.prev bin/chatd` and restart (not across a migration, see Database).
- Desktop and Android releases are published separately (see their sections).
