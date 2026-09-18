# Audit round 2 — status board

Coordinator's board. Updated by the coordinator only. If you are a fresh
session picking this up: read `README.md`, then this file, then act on
"What is next". Nothing else is needed.

**Phase: 1 — audit** (started 2026-09-18 ~20:30 local)

Baseline before anything: `tools/check.sh` all green (Go vet+tests, 993 web
tests, 41 desktop tests, i18n 0 missing, 2 min). Live: web+server `d9c7b43`,
Android 1.0.3, desktop 1.0.5. Working tree was clean at `5d80e12`.

## Areas

| Area | Prefix | State | Runs | Notes |
|---|---|---|---|---|
| server-api | SAPI | dispatched (fable) | 1 | |
| server-core | SCORE | dispatched (fable) | 1 | |
| web-core | WCORE | dispatched (fable) | 1 | |
| web-chat-ui | WCHAT | dispatched (fable) | 1 | |
| web-shell-ui | WSHELL | dispatched (fable) | 1 | |
| voice | VOICE | dispatched (fable) | 1 | |
| android | DROID | dispatched (fable) | 1 | |
| ux-walkthrough | UX | dispatched (fable) | 1 | owns the emulator |
| desktop-release | DESK | queued | 0 | starts when a slot frees |
| i18n-copy | I18N | queued | 0 | starts when a slot frees |

"State" is one of: queued · dispatched · audit-done · needs-successor ·
triaged · fixing · fix-done. The agent's own `PROGRESS.md` is the truth
about how far it got; this table is the coordinator's view.

## Limits the owner set

- At most **8 agents at once**, models `fable` or `opus` (either can pick
  up any area; the briefs and progress files carry everything).
- Agents may be cut off by session limits and resumed hours later, possibly
  on a different model. That is why every area is file-driven.

## The dispatch prompt (verbatim — reuse it to start or resume any area)

```
You are the auditor for the area "<AREA>" of the Nexa chat codebase at
/path/to/nexa (a Go server, a React web client, an
Android app, an Electron desktop app).

1. Read audit/r2/README.md — the protocol. Its hard rules are not optional:
   this phase is read-only; `npm run build` in web/ and `go build -o bin/chatd`
   deploy to the live site and must never be run; data/ is live state.
2. Read audit/r2/areas/<AREA>/BRIEF.md — your scope and checklist.
3. If audit/r2/areas/<AREA>/PROGRESS.md already exists with ticked files, you
   are resuming a predecessor: read it and the existing FINDINGS.md, skip what
   is done, continue from the handoff note, keep the finding numbering.
   Otherwise start fresh: your first action is writing PROGRESS.md with every
   file in scope listed.

Then audit. Findings go to FINDINGS.md as you find them (format in the
README); PROGRESS.md is updated at least every 5 files. When every file is
inspected, write the Summary at the top of FINDINGS.md and set
State: audit-done.

Do not stop to ask anything; nobody is watching. If you run low on context,
checkpoint and return. Return a short summary: counts by priority, the five
findings the coordinator should read first, and anything the coordinator
must know (for example "PROGRESS.md is at 60 %, a successor is needed").
```

Agent type `general-purpose`, model `fable` (or `opus`).

## What is next

1. When any wave-1 agent returns: read its summary; open its `PROGRESS.md`.
   If `State: audit-done`, mark it here. If not, mark `needs-successor` and
   dispatch the same prompt again (it resumes). Then start the next queued
   area in the freed slot (`desktop-release` first, then `i18n-copy`).
2. When all ten are `audit-done`: phase 2. Read every `FINDINGS.md` summary,
   then the findings; write `PLAN.md` (accepted/declined per finding with
   reasons, work packages with disjoint file ownership, order, test
   commands per package, shared-file rules). Mark `triaged`.
3. Phase 3: dispatch fix agents per package (≤ 8 at once; fewer if the
   machine is under load — each runs typecheck/tests). Fix agents commit
   only their own files by explicit path. Coordinator runs `tools/check.sh`
   after each wave and fixes integration breakage.
4. Phase 4: full `tools/check.sh`, `tools/e2e.py`, Android compile + unit
   tests, the device tests if calls changed, then deploy web+server (`make
   build` + `sudo launchctl kickstart -k system/xyz.evilion.chat`, backups
   first: `sqlite3 data/chat.db ".backup backup/chat-predeploy-<ts>.db"`,
   copy `web/dist/index.html sw.js download-sw.js manifest.webmanifest` to
   `backup/web-shell-predeploy-<ts>/`), then Android (`make android`,
   `make publish-android`, versionCode bump) and desktop (`make desktop`,
   `make publish-desktop`, version bump) if they changed. Record in memory.

## Log

- 2026-09-18 20:30 — workspace written (README, 10 briefs), baseline green,
  wave 1 dispatched: 8 agents.
