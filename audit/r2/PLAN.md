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

_Written at triage._
