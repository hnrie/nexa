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
| server-api | SAPI | audit-done | 3 | 50 findings: P1 3 · P2 11 · P3 36 |
| server-core | SCORE | audit-done | 4 | 30 findings (014–043): P0 1 · P1 5 · P2 16 · P3 8; 001–013 lost → `server-store` supplement |
| web-core | WCORE | audit-done | 3 | 29 findings: P2 9 · P3 20 |
| web-chat-ui | WCHAT | audit-done | 4 | 104 findings: P1 5 · P2 47 · P3 52 |
| web-shell-ui | WSHELL | dispatched (opus) | 3 | |
| voice | VOICE | audit-done | 3 | 28 findings: P1 4 · P2 11 · P3 13 |
| android | DROID | dispatched (fable) | 3 | |
| ux-walkthrough | UX | dispatched (opus) | 3 | owns the emulator |
| desktop-release | DESK | dispatched (fable) | 2 | |
| i18n-copy | I18N | dispatched (fable) | 2 | |
| server-store | SSTORE | dispatched (fable) | 1 | supplement: re-reads internal/store + migrations because SCORE-001..013 were lost |

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

## Lessons so far

- **Checkpoint after every file, not every five.** The first wave was cut
  off by the Fable session limit after ~3.5 h; four of eight agents had
  written findings but ticked nothing, so their successors re-read
  everything. The dispatch prompt now says every file.
- Use `date -u +%Y-%m-%dT%H:%MZ` for the checkpoint time; agents guessed
  and were hours off.
- The machine sits at 100–400 MB free with the owner's browser and Discord
  open; the emulator (~4 GB) is only safe when `vm_stat` shows free +
  inactive above ~5 GB. The walkthrough agent does the Android part last
  and checks first.

## Log

- 2026-09-18 20:30 — workspace written (README, 10 briefs), baseline green,
  wave 1 dispatched: 8 agents. A memory backstop runs as
  `~/.claude/jobs/ba92b842/tmp/watchdog.sh` (pid in `watchdog.pid`, log in
  `watchdog.log`); it only ever kills the emulator and Playwright's Chromium.
  Kill it when the round ends. (Times above are local AKDT; the wave
  actually started 12:18.)
- 2026-09-18 15:50 — all eight agents terminated: Fable session limit
  (resets 16:00). Checkpoints: server-api 26/90 files, 14 findings;
  server-core 46/106, 13 findings; web-core 76/202, 3; web-chat-ui 48/134,
  16; web-shell-ui 0/140, 0; voice 0/98, 0; android 0/106, 10; ux 0/47, 2
  (its throwaway server is still up; see its PROGRESS.md).
- 2026-09-18 16:00 — wave 1 resumed, same prompts: fable for server-api,
  web-core, voice, android; opus for server-core, web-chat-ui,
  web-shell-ui, ux-walkthrough.
- 2026-09-18 16:18 — all eight terminated again: the limit is account-wide
  and rolling (5 h), so wave 1's usage still counted; reset 21:00. Only 18
  minutes of work, but per-file ticking made it count: server-api 78/90
  (34 findings), server-core 63/106 (17), web-core 107/202 (18),
  web-chat-ui 76/134 (53), web-shell-ui 86/140 (32), voice 70/98 (14),
  android 62/106 (21), ux 7/47 (5).
- 2026-09-18 21:02 — wave 1 resumed a second time, same model split.
  Expect ~3.5 h of work per 5 h window from here; when the limit hits,
  wait for the reset and send the same prompts again.
- 2026-09-18 21:22 — voice, server-api, web-core audit-done (~17 min each
  this run). desktop-release and i18n-copy dispatched (fable) in the freed
  slots; 7 agents running.
- 2026-09-18 21:24 — wave 3 terminated after ~20 min (limit, reset 02:00).
  Checkpoints: server-core 103/106 (26 findings), web-chat-ui 112/134 (92),
  web-shell-ui 131/140 (65), android 77/106 (61), ux 17/42 (26),
  desktop-release 0/122 (list written), i18n-copy 7/33 (0).
- 2026-09-19 02:32 — the seven unfinished areas resumed (same models).
  `TRIAGE.md` now holds the decisions for server-api, web-core and voice
  (106 of 107 accepted; SAPI-002 declined).
- 2026-09-19 03:05 — server-core audit-done (30 findings incl. P0 backup gap).
  Its first agent's 13 findings never reached disk (it believed the Write
  tool refused .md files; successors used heredocs). A `server-store`
  supplement agent re-reads internal/store + migrations (prefix SSTORE).
- 2026-09-19 03:40 — web-chat-ui audit-done (104 findings, all accepted; message-list
  virtualisation declined on its evidence). 6 agents running.
