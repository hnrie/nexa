# Audit round 2 — the protocol

Started 2026-09-18. Round 1 lives one directory up (`audit/*.md`, triaged in
`audit/REVIEW.md`, 720 findings, ~20 commits landed on the 17th). Round 2 is
broader: every file of every platform, for bugs, security, usability, design,
accessibility, performance, parity between web / Android / desktop, and copy.
The goal is not a report. The goal is that everything found gets fixed and the
product ends up materially better on every platform.

This file is the contract between the coordinator and the area agents. Any
agent, on any model, at any later time, must be able to start or resume an
area from this file plus the area's `BRIEF.md` and `PROGRESS.md` alone. Nothing
about the work lives only in a chat transcript.

## Layout

```
audit/r2/
  README.md              this protocol
  STATUS.md              the coordinator's board: phase, per-area state, what is next
  PLAN.md                (fix phase) the ordered work packages and file ownership
  areas/<area>/
    BRIEF.md             the area's scope, checklist, references — written once
    PROGRESS.md          checkpoint: inspected files, state, handoff note — kept current by the agent
    FINDINGS.md          the findings, appended as they are found — never rewritten
  shots/                 screenshots from the walkthrough (gitignored)
```

Areas: `server-api`, `server-core`, `web-core`, `web-chat-ui`, `web-shell-ui`,
`voice`, `android`, `ux-walkthrough`, `desktop-release`, `i18n-copy`.

## Phases

1. **Audit** — one agent per area, read-only. Findings go to `FINDINGS.md`
   as they are found, progress to `PROGRESS.md` every few files. No code is
   changed in this phase, by anyone, for any reason.
2. **Triage** — the coordinator reads every `FINDINGS.md`, marks each finding
   `accepted` or `declined` (with a reason), groups accepted ones into work
   packages with disjoint file ownership, and writes `PLAN.md`.
3. **Fix** — one agent per package. Each fix is tested, the finding's status
   becomes `fixed` with the commit hash, and the package's `PROGRESS.md`
   records it. Rules for this phase are in `PLAN.md`.
4. **Verify and deploy** — the coordinator runs `tools/check.sh`, the e2e
   suite and the device tests, then deploys (`make build` + kickstart,
   `make android` + publish, `make desktop` + publish) keeping rollback copies.

## Hard rules (every phase, every agent)

These come from things that have actually gone wrong on this machine. They
are not negotiable.

- **Building is deploying.** `npm run build` in `web/` writes `web/dist`,
  which is what chat.evilion.xyz serves. `go build -o bin/chatd` writes the
  file launchd starts. Never run either. To check that something compiles:
  `go build ./...` (writes nothing), `cd web && npx tsc --noEmit`,
  `npx vite build --outDir "$TMPDIR/dist-<yourarea>" --emptyOutDir`. To run a
  binary: `go build -o "$TMPDIR/chatd-<yourarea>" ./cmd/chatd`. `tools/check.sh`
  does all of it harmlessly.
- **Never touch `data/`, `backup/`, `bin/`, `logs/`, `chatd.env`,
  `android/release.jks`, `android/keystore.properties`, `desktop/update-key.pem`.**
  `data/` is the live instance's state and is gitignored, so damage there is
  invisible to git. No bulk edit, rename or script may walk into it.
- **Never sign in to the live site with automation** (Turnstile blocks it and
  the owner does not want it worked around). Test against a throwaway chatd:
  `tools/e2e.py`'s `Server` class starts one with `E2E_CHATD` and
  `E2E_WEB_DIST` pointing at scratch builds. Never source `chatd.env` into a
  test's environment; pass only the single key a test needs.
- **The machine has 16 GB and has been crashed by a test before.** No
  multi-GB transfers. At most one Android emulator, started with
  `tools/emulator.sh headless`, stopped with `tools/emulator.sh stop`, and
  only by the `ux-walkthrough` agent (or whoever `STATUS.md` says owns it).
  Stop Gradle's daemon (`gradle --stop`) after every Android build.
- **Audit phase is read-only.** Reading, grepping, running existing tests,
  building to scratch directories and running a throwaway server are fine.
  Editing any file outside `audit/r2/areas/<your area>/` is not.
- **Fix phase:** commit only files you own, by explicit path
  (`git add path1 path2 && git commit`), never `git add -A`/`-u`/`.`. Never
  `git stash`, `git checkout -- .`, `git reset --hard`, `git clean`, or
  anything that discards another agent's uncommitted work. Use the Edit tool,
  not Write, on shared files (`web/src/i18n/locales/*.json`,
  `web/src/api/types.ts`, `web/src/styles/tokens.css`, `android/.../Models.kt`):
  Write clobbers concurrent edits, Edit refuses them. If a git command fails
  with `index.lock`, wait a second and retry.
- **Ask nobody.** There is no human in the loop while you run. Make the
  sensible call, write it down in your findings or progress file, and carry
  on. The only stop is finishing or running out of context.

## What a finding is

One defect or one improvement, with evidence a person can check. Not a
category, not a vibe. If you cannot point at a line (or a screenshot) and say
what a user or attacker experiences, keep reading until you can, or drop it.

```
### WCHAT-012 · P1 · bug · A reply's quoted line shows the ciphertext when the parent is not loaded
- Where: `web/src/components/chat/MessageItem.tsx:118`, `web/src/stores/messages.ts:302`
- What: `replyTo` falls back to `msg.reply.content` — the envelope — when the parent id is not in `byId`; the fallback path never decrypts.
- Impact: every reply to a message older than the loaded page shows base64 in the quote bar. Seen on both viewports.
- Fix: fetch the parent through `ensureMessage(channelId, id)` and render a "loading" quote until it arrives; there is already such a helper for pins.
- Effort: S
- Status: open
```

- **ID**: `<AREA PREFIX>-<3 digits>`, assigned in order, never reused or
  renumbered. A successor continues from the highest existing number.
- **Priority** (what it costs, times how many people it costs):
  - **P0** — security hole, message/key/data loss, crash, or a core path
    that fails silently (a message that is not sent or shown, a call that is
    silent, a login that cannot complete).
  - **P1** — a feature that is broken or unusable for some people or on some
    platform; a usability failure a normal person would hit and be stopped
    by; an accessibility blocker; performance that makes the app feel broken.
  - **P2** — a noticeable defect or friction; inconsistency between
    platforms; missing feedback; a wrong or confusing word; a minor leak or
    perf cost.
  - **P3** — polish, a design idea, a redesign proposal, code quality, docs.
- **Kind**: `bug`, `security`, `ux`, `a11y`, `i18n`, `perf`, `parity`,
  `design`, `code`, `docs`, `test`.
- **Effort**: `S` (under an hour), `M` (a few hours), `L` (a day or more, or
  cross-cutting).
- **Status**: `open` → `accepted` | `declined (reason)` → `fixed (<commit>)` →
  `verified`. Only the coordinator sets `accepted`/`declined`.

Design and redesign proposals are welcome and wanted — the owner asked for
them. Put them in as `P3 · design` (or `P2` if the current design actively
hurts people), describe what is wrong now, what the better thing looks like
in enough detail to build, and why it is better. Judge them honestly: an idea
that would not clearly improve the product is not a finding.

## Quality bar

- **Evidence over speculation.** Read the callers. Read the tests. If a
  finding depends on a claim about runtime behaviour, check it (run the unit
  test, run the throwaway server, read the browser API's actual contract).
- **Say what the user experiences**, not just what the code does. "The
  effect's dependency array omits `channelId`" is the mechanism; "switching
  channels while a search is open shows the previous channel's results" is
  the finding.
- **Compare across platforms.** The web client is the reference. Where
  Android or desktop differs, say which is better, not just that they differ.
  Where a fix is needed on more than one platform, say so — one finding,
  several `Where:` lines.
- **Check round 1's claims.** Your `BRIEF.md` names the round-1 reports for
  your area. Read `audit/REVIEW.md`'s "Done", "Not doing" and "Still open"
  sections, then skim your report. For anything round 1 marked done, confirm
  it is actually fixed in the code you read; regressions and half-fixes are
  findings. Do not re-report things round 1 declined unless you disagree
  with the reasoning — then say why, briefly.
- **No padding.** Fewer findings that are real and precise beat a long list.
  But do not self-censor usability findings because they feel small; a
  hundred small frictions are what makes an app feel bad.
- **Do not fix anything in the audit phase.** Not even a typo. Write it down.

## Checkpointing (so being cut off costs nothing)

`PROGRESS.md` is the only thing that survives you being killed mid-file.
Keep it current:

```
# Progress — <area>
State: auditing            (auditing | audit-done | fixing | fix-done)
Last checkpoint: 2026-09-18T21:14Z
Next finding id: 013

## Inspected
- [x] web/src/components/chat/MessageList.tsx
- [x] web/src/components/chat/MessageItem.tsx
- [ ] web/src/components/chat/Attachments.tsx     ← in progress
- [ ] ...every file in scope, listed up front...

## Handoff note
Half-way through Attachments.tsx; the video poster path (line ~140) looks like
it fetches through a bare URL — check against mediaLinks.ts before writing it
up. Parity check against Android AttachmentViews.kt not yet done.
```

- **First action on a fresh start**: write `PROGRESS.md` with the complete
  list of files in scope (from `BRIEF.md`, expanded with `git ls-files`),
  all unchecked, `State: auditing`.
- **Tick files as you finish them**, and update the handoff note, **at least
  every 5 files or 1,000 lines read**, whichever comes first. Appending to
  `FINDINGS.md` happens as each finding is found, not at the end.
- **On a resumed start**: read `PROGRESS.md`, skip the ticked files, read the
  handoff note, read the existing `FINDINGS.md` (to keep numbering and avoid
  duplicates), and continue.
- **If the Write tool refuses a file**, write it with a Bash heredoc
  (`cat > path <<'EOF' … EOF`) and read it back; one agent lost thirteen
  findings believing they had been written.
- **Finishing**: when every file is ticked, write a `## Summary` section at
  the **top** of `FINDINGS.md` (counts by priority and kind; the ten findings
  the coordinator should read first, one line each; cross-area items that
  belong to another area, one line each) and set `State: audit-done`.
- **If you notice you are running low on context**, stop reading new files,
  make sure `PROGRESS.md` is current, and return a short summary. A successor
  picks up from your note. This is normal, not failure.

## Cross-area items

If you find something that belongs to another area (a server bug while
auditing the web client, say), still write it in your own `FINDINGS.md`,
prefixed in the title with the other area in brackets, e.g.
`[server-api] …`. The coordinator moves it at triage. Do not go and audit
the other area yourself.

## Tools you can lean on

- `tools/check.sh` — build, vet, Go tests, web typecheck/tests/build, desktop
  typecheck/tests/bundle, i18n key check; all to scratch locations. About two
  minutes; do not run it in parallel with other heavy things.
- `cd web && npx vitest run <pattern>`, `go test ./internal/<pkg>/`,
  `cd desktop && npx vitest run` — targeted tests.
- `tools/e2e.py` (Playwright, `tools/.venv/bin/python` or
  `/tmp/pwvenv/bin/python`) — a throwaway server plus browser sessions; its
  `Server` and `Session` classes are importable. `tools/device/seed.py BASE`
  seeds alice, bob, a server and one message of every markdown kind.
- `tools/screenshot.py BASE OUT --paths … --viewports …` — pages at viewports.
- `tools/i18n_keys_used.py` — every key the web and Android apps ask for,
  against the English catalogue (`web/src/i18n/locales/en.json`, which is the
  catalogue for **both** clients; Android reads the same JSON files).
- `tools/emulator.sh headless|stop`, `tools/device/ui.py` (uiautomator
  dump/tap/type), `adb exec-out screencap -p > file.png` — the Android side.
  `gradle :app:assembleRelease -PserverUrl=http://10.0.2.2:<port>` builds an
  APK aimed at a throwaway server (`source ~/.local/toolchain/env.sh` first;
  `gradle --stop` after). The publish tool refuses such an APK, so it cannot
  leak out.
