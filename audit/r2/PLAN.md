# Fix plan (phase 3)

The rules are fixed; the packages get written at triage, once every area
is `audit-done`. A fix agent reads `README.md`, this file, and its package
section, and nothing else is needed.

## Rules for fix agents

- **Ownership.** Each package lists the files it owns. Edit only those. If
  a fix needs a change in a file another package owns, do not make it:
  write `needs: <file>: <what>` in your `PROGRESS.md` and the coordinator
  routes it. Files in `audit/r2/areas/<your area>/` are yours.
- **Shared files** (`web/src/i18n/locales/*.json`, `web/src/api/types.ts`,
  `web/src/styles/tokens.css`, `web/src/lib/perms.ts`, `internal/api/router.go`,
  `internal/store/models.go`, `android/.../net/Models.kt`, `Endpoints.kt`):
  anyone may edit them with the **Edit** tool (never Write), in small
  targeted edits. Do not commit them; the coordinator commits shared files
  at the end of each wave. Your `git add` lists only owned files.
- **New words.** A new user-facing string goes into `en.json` **and all ten
  other locales** in the same sitting, translated by you in the register the
  `i18n-copy` findings describe for each language (plain, friendly, no
  exclamation marks, informal "du/tu/tú/você/ты", polite-plain Japanese and
  Korean). Then run `python3 tools/i18n_keys_used.py` and
  `python3 tools/i18n_check.py`; both must be clean. Android reads the same
  catalogue, so a key you add for the phone is added the same way.
- **Tests first where a harness exists.** A bug fix in the web client, the
  server or the desktop app comes with a test that failed before and passes
  after (vitest / `go test` / vitest). Android unit tests where the code is
  testable without a device (parser, perms, models). UI polish needs no
  test, but does need a screenshot if it changes layout (put it under
  `audit/r2/shots/fixes/<package>/`).
- **Verify before claiming.** Targeted checks, not the whole suite:
  - web: `cd web && npx tsc --noEmit && npx vitest run <files or dirs you touched>`
  - server: `go build ./... && go vet ./internal/<pkg>/ && go test ./internal/<pkg>/`
  - desktop: `cd desktop && npx tsc --noEmit -p . && npx vitest run`
  - android: `source ~/.local/toolchain/env.sh && cd android && gradle :app:compileDebugKotlin -q; gradle --stop`
    — one Gradle at a time on this machine: create `audit/r2/.gradle-lock`
    (with your package name inside) before, delete it after, wait if it exists.
  The coordinator runs `tools/check.sh` and the e2e suite after each wave.
- **Never deploy, never build into a live path.** No `npm run build` in
  `web/`, no `go build -o bin/chatd`, no `make` target other than
  `test-go`/`test-web`/`test-desktop`/`test-android`. No emulator unless
  your package says so. No e2e runs (they take the machine).
- **Commits.** After each finding or small coherent group:
  `git add <owned paths> && git commit -m "<message>"`. Message style is the
  repo's: lower-case type prefix, then what the failure *was*, in words a
  person would say — `fix: a reply to a message not yet loaded showed its
  ciphertext`, `feat(android): the picker remembers skin tone`. Body: why,
  briefly. End with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01D4Hcod4NgaC5od96EmBMpN
  ```
  Never `git add -A`, `-u`, or `.`; never stash, reset, checkout-discard or
  clean. On `index.lock`, wait a second and retry.
- **Finding status.** As you finish each: in the area's `FINDINGS.md`,
  change `Status: accepted` to `Status: fixed (<short hash>)`; if on closer
  reading the finding is wrong or the fix is worse than the problem, set
  `declined (reason)` and say why in one sentence. Tick it in your package's
  `PROGRESS.md` (`audit/r2/areas/<area>/PROGRESS.md`, under a
  `## Fixing — <package>` heading) with the same checkpoint discipline as the
  audit: every fix, not at the end.
- **Scope.** Fix what the finding says. If you see something adjacent that
  is clearly wrong and inside your owned files, fix it and add a finding for
  it (next id, `Status: fixed`). Do not refactor for its own sake.
- **When done:** `State: fix-done` in `PROGRESS.md`, and return a summary:
  fixed / declined / needs-routing counts, the commits, and anything the
  coordinator must check by hand.

## Packages

Ownership is by file. Two packages that run at the same time never own the
same file. `Also touches` files are shared (Edit tool only, committed by the
coordinator). `Findings` are the accepted ids from `TRIAGE.md`; the notes
there are binding. Order inside a package: P0/P1 first, then P2, then P3;
cross-platform pairs are fixed in the same sitting where both halves are in
one package, otherwise the other package is told through `needs:`.

### Concurrency rules the waves depend on

- Go is one module: an agent whose `go build ./...` fails in a file it does
  not own waits 20 s and retries (up to five times) — another agent is
  mid-edit. Keep your own tree compiling across tool calls; `gofmt` before
  every commit.
- The web is one TypeScript project: the same rule for `tsc --noEmit`.
- Never more than **one Gradle** at a time (`audit/r2/.gradle-lock`).
- Never more than **6 fix agents** at once on this machine (each runs a
  typecheck or test suite; 16 GB shared with the owner's browser).
- The coordinator runs `tools/check.sh` between waves and after the last one,
  then the e2e suite, then the device tests if calls changed.

### Waves

| Wave | Packages | Why together |
|---|---|---|
| A | S1 · S4 · W1 · W2 · W4 · A2 | disjoint files; the P0/P1s are here |
| B | S2 · S3 · V1 · W3 · A1 · D1 | S2/S3 share Go packages but not files; W3 after W2 because both touch `common/` consumers |
| C | I1 · leftovers routed by `needs:` · SCORE-031's real fan-out (stretch) | I1 must be alone on the locale files |

### S1 — server: auth, limits, config, ops, docs

- Owns: `internal/auth/**`, `internal/ratelimit/**`, `internal/cache/**`,
  `internal/config/**`, `internal/totp/**`, `cmd/chatd/**`,
  `internal/api/{auth_handlers,mfa_handlers,middleware,static,admin_handlers,crash_handlers,legal_handlers,captcha}.go` and their tests,
  `internal/store/{legal,errors_log,instance,settings,sessions,mfa}.go`,
  `backup.sh`, `run.sh`, `Makefile`, `deploy/**`, `README.md`, `deploy/README.md`, `chatd.env.example`, `docs/STATUS.md`.
- Also touches: `internal/api/router.go`, `internal/api/errors.go`.
- Findings: SAPI-001 003 004 005 006 011 016 028 029 030 031 032 033 035 036 039 040 · SCORE-014 015 016 017 018 019 020 022 024 025 031(docs+warning) 032 · WCORE-019's server side is none.
- Tests: `go test ./internal/auth/ ./internal/ratelimit/ ./internal/cache/ ./internal/config/ ./internal/api/ -run 'Auth|MFA|Admin|Legal|Crash|Limit|Static|Header'` then the whole `./internal/api/` once before returning.

### S2 — server: servers, channels, messages, keys, users, expressions, guests (API handlers)

- Owns: `internal/api/{server_handlers,channel_handlers,group_handlers,groups,subchat_handlers,message_handlers,key_handlers,relationship_handlers,user_handlers,expression_handlers,guest_handlers,access,validate}.go` and their tests, `internal/perms/**`, `internal/textutil/**`.
- Also touches: `internal/api/router.go`, `internal/store/models.go`, `internal/api/errors.go`.
- Findings: SAPI-007 008 009 010 012 013 014 017 018 020(api half) 021 022 023 024 025 026 027 034 041 042 045(debug log) 047(server) 048(server) 049(server) · WCHAT-073 (server half: `mention_here`).
- `needs:` store caps and `PutGrants` replace-by-creator go to S3 as `needs:` lines unless S3 has already landed them (check `git log`).

### S3 — server: store, db, gateway (data integrity and fan-out performance)

- Owns: `internal/store/**` except S1's and S4's files, `internal/db/**`, `internal/gateway/**`, `internal/api/server_glue.go`, `internal/api/activity_glue.go`, `internal/ids/**`, `internal/rpcapps/**`, `cmd/chatmigrate/**`, `tools/gen_pg_schema.sh`, `tools/pg_schema.py`.
- Findings: SCORE-021 023 026 027 028 029 030 039 040 041 042 043 · SAPI-012's and 026's store caps, SAPI-020's `PutGrants` semantics · SSTORE-* (when triaged).
- Tests: `go test ./internal/store/ ./internal/db/ ./internal/gateway/`; the permission cache (SCORE-026) lands with invalidation tests for every write path before it is wired in.

### S4 — server: uploads, media, proxy, unfurl

- Owns: `internal/api/{upload_handlers,media_handlers,proxy_handlers,unfurl_handlers,disk}.go` and tests, `internal/media/**`, `internal/unfurl/**`, `internal/store/{uploads,blobs}.go`.
- Findings: SAPI-015 019 · SCORE-033 034 035 036.
- Tests: `go test ./internal/media/ ./internal/unfurl/ ./internal/api/ -run 'Upload|Media|Proxy|Unfurl|Variant'`.

### V1 — voice: server side and the call tests

- Owns: `internal/api/{sfu_handlers,voice_glue}.go` and tests, `internal/voice/**`, `internal/realtime/**`, `tools/sfu_call.py`, `tools/sfu_guest.py`, `tools/call_quality.py`, `tools/netsim/**`, `tools/device/**`.
- Findings: SAPI-037 038 · VOICE-006(server reuse window) 007(server tag) 008 010 021 022 · SCORE-037 038(server) · SAPI-047's publish refusal.
- Tests: `go test ./internal/voice/ ./internal/realtime/ ./internal/api/ -run 'SFU|Voice|Guest|Meter'`; `tools/sfu_call.py` once against a scratch build with the real SFU (costs allowance; once).

### W1 — web: core

- Owns: `web/src/api/**`, `web/src/crypto/**`, `web/src/gateway/**`, `web/src/stores/**` except `voice*.ts`, `web/src/lib/**` except `callLayout.ts callPanel.ts audioKeeper.ts`, `web/src/hooks/**`, `web/src/i18n/core.ts`, `web/src/i18n/index.tsx`, `web/src/markdown/{ast,parse,index}.ts` and tests, `web/src/{main,App,routes}.tsx`, `web/src/{sw,download-sw}.ts`, `web/index.html`, `web/vite.config.ts`, `web/package.json`, `web/package-lock.json`, `web/src/data/licenses.json`, `tools/licenses.py`, `tools/fixtures/**` (new).
- Also touches: `web/src/api/types.ts`, `web/src/styles/tokens.css`.
- Findings: WCORE-001 002 003 004 005 006 007 008 009(web) 010 011 012 013 014 015 016(web) 017 018 019 020(web) 021 022 023 024 025(web side + fixtures) 028 029 · WCHAT-049 (the helper) 058 (the `markdownCtx` half) 087 (`lib/time` kind) 104 · WCHAT-073's client send side (`mentions.ts`/`send.ts` are `composer/`, so W2 — W1 provides the type).
- Tests: `cd web && npx tsc --noEmit && npx vitest run src/api src/crypto src/gateway src/stores src/lib src/markdown`.

### W2 — web: chat surface

- Owns: `web/src/components/{chat,composer,pickers,search,profile,activity,common}/**`, `web/src/markdown/render.tsx` + test, `web/src/styles/**`, `web/src/pages/{DMPage,ServerPage,StickerPackPage}.tsx`, `web/src/pages/ServerPage.module.css`.
- Also touches: `web/src/i18n/locales/*.json`, `web/src/styles/tokens.css`.
- Findings: WCHAT-001 … 096, 101, 103 (everything not marked `[android]`/`[i18n-copy]`/`[server-api]`), plus SAPI-017's rendering half, SAPI-018's menu items, SAPI-047's camera/share gating is W4's, VOICE-023's web pill colour is W4's.
- Tests: `cd web && npx tsc --noEmit && npx vitest run src/components/chat src/components/composer src/components/pickers src/components/search src/components/common src/markdown/render.test.tsx`.

### W3 — web: shell, settings, modals, pages

- Owns: `web/src/components/{shell,sidebar,rail,modals,settings,server,friends,desktop}/**`, `web/src/pages/**` except W2's and W4's, `web/public/**`.
- Findings: WSHELL-* (when triaged) · VOICE-020 (admin calls card) 027 (VoicePage marker) · WCHAT-088's `VerifyKeyModal` half · SAPI-022's Privacy page · SAPI-048's role editor · SAPI-011's disabled-account sentence · WCORE-009's Security-page copy · WCORE-016's notification setting UI · SCORE-023's server profile modal + role icon editor · SAPI-040's admin TURN line.

### W4 — web: voice client

- Owns: `web/src/voice/**`, `web/src/components/voice/**`, `web/src/stores/voice*.ts`, `web/src/lib/{callLayout,callPanel,audioKeeper}.ts` + tests, `web/src/pages/GuestCallPage*`, `web/src/components/settings/VoicePage.tsx` (device logic; W3 owns its copy), `web/src/components/desktop/DisplayPicker.tsx`.
- Findings: VOICE-001 002 003 004 005 006(client) 007(client toast) 009 014 019 023 025 026 028(+WCORE-027) · SAPI-047's button gating · SCORE-038's camera-off path (the client unpublishes on off) · WCORE-008's hang-up on the passcode page (the button; W3 owns `PasscodePage`, so `needs:`).
- Tests: `cd web && npx tsc --noEmit && npx vitest run src/voice src/components/voice src/stores/voice src/lib/callLayout src/lib/callPanel src/lib/audioKeeper`; report `main-*.js` size before/after for 028.

### A1 — android: app (everything but calls)

- Owns: `android/**` except `voice/**`, `ui/voice/**`, `ui/common/HangUp.kt`, `cpp/**`.
- Also touches: `android/.../net/Models.kt`, `Endpoints.kt` (shared with A2 — Edit only).
- Findings: DROID-* (when triaged) · SAPI-043 044 045 046 050 · WCORE-004 006 009 016 020 023 025 026 · WCHAT-044 055 088 094 097 098 099 100 101 102 · SCORE-033's client half + a cropper · SAPI-047's gating is A2's.
- Tests: `gradle :app:compileDebugKotlin -q && gradle :app:testDebugUnitTest -q; gradle --stop` behind the lock.

### A2 — android: calls

- Owns: `android/app/src/main/java/xyz/evilion/chat/{voice,ui/voice}/**`, `ui/common/HangUp.kt`, `android/app/src/main/cpp/**`, `android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt` (calls channel; A1 `needs:` for anything else there), `tools/check.sh` (the C++ test hook).
- Findings: VOICE-011 012 013 017 018 024 · Android halves of 001 003 004 006 009 · SAPI-047's button gating · SCORE-038's camera-off path.
- Tests: compile + unit tests behind the lock; VOICE-013 and 011 verified on the emulator against the real SFU with `tools/device/call_soak.py` (the coordinator schedules the emulator slot).

### D1 — desktop and release

- Owns: `desktop/**`, `tools/publish_desktop.py`, `tools/publish_android.py`, `tools/i18n_*.py`, `tools/android_i18n.py`, `tools/e2e.py`, `tools/screenshot.py`, `tools/README.md`, `.gitignore`.
- Findings: DESK-* (when triaged) · VOICE-015 016.
- Tests: `cd desktop && npx tsc --noEmit -p . && npx vitest run`.

### I1 — the words (runs alone, last)

- Owns: `web/src/i18n/locales/*.json`, `android/app/src/main/res/values/strings.xml`, `desktop/src/main/strings.ts`.
- Findings: I18N-* (when triaged) · WCHAT-032 · the review of every key other packages added.
