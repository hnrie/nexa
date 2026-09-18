# Brief — web-core (finding prefix `WCORE`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

The non-visual half of the web client:

```
web/src/api/           all 26 files (client.ts, types.ts, every resource module, tests)
web/src/crypto/        all 22 files
web/src/gateway/       client.ts dispatch.ts events.ts session.ts (+ tests)
web/src/stores/        all 33 files
web/src/lib/           all 88 files  (except callLayout.ts, callPanel.ts, audioKeeper.ts — `voice`)
web/src/hooks/         all 8
web/src/i18n/          core.ts index.tsx (+ tests); the locale JSON contents are `i18n-copy`'s
web/src/markdown/      ast.ts parse.ts index.ts (+ tests); render.tsx is `web-chat-ui`'s
web/src/               main.tsx App.tsx routes.tsx sw.ts download-sw.ts vite-env.d.ts smoke.test.ts
web/src/test/          setup.ts fakeAudio.ts
web/                   index.html vite.config.ts vitest.config.ts tsconfig.json package.json
                       scripts/deploy-guard.mjs public/manifest.webmanifest
```

Out of scope: every `components/` and `pages/` file (`web-chat-ui`,
`web-shell-ui`, `voice`), `web/src/voice/*` and `stores/voice*.ts` (`voice`),
`styles/*.css` (`web-chat-ui`).

## What this area is

A React 18 + Zustand + React Router SPA built by Vite. `api/client.ts` wraps
fetch with the session token, error mapping (`ApiError`) and retries;
`api/types.ts` is the contract with the server. `crypto/` implements the
E2EE: Argon2id (`kdf.ts`, floored to the server's `validKDF`), X25519
identity and sealed boxes (`keys.ts`), per-conversation root keys in epochs
(`conv.ts`), AES-256-GCM message envelopes (`message.ts`), chunked file
encryption (`file.ts`, `fileChunks.ts`, `streamDecrypt.ts`), the keystore
(`keystore.ts`, IndexedDB) and safety numbers (`fingerprint.ts`).
`gateway/` holds the WebSocket, resume, heartbeats (from a worker, because
hidden tabs throttle timers), and `dispatch.ts` routes events into stores.
`stores/` are Zustand stores: auth, keys, messages (pages, anchoring),
channels, servers, users, relationships, presence, typing, readStates,
settings (encrypted server-side), ui, panes/tabs, selection, expressions,
slowmode, keyAlerts, desktop. `lib/` is everything else: attachments and
uploads (through a worker, one request per piece), search over decrypted
history, notifications, sounds, app lock, export, key pins, media links and
the proxy refresh, theme, time, i18n helpers, platform detection.

## Checklist

Correctness and state:
- Every store: what happens on logout (is everything cleared, including
  IndexedDB and the keystore?), on account switch, on `ready` after a
  resume (is stale state reconciled or merged?), on a gateway gap (messages
  missed while disconnected — caught up or a hole?), on a 401 mid-session.
- `messages.ts`: page loading, prepend/append, anchoring, dedupe of the
  optimistic message vs. the gateway echo, edits and deletes to messages not
  loaded, reactions counts, read position, pins, subchats, the "jump to
  message" path. Race: send while switching channel; edit while an edit
  saves; delete while loading.
- `dispatch.ts`: every event type handled? Order-dependence (a
  `channel_delete` before its `message_create` arrives)? Events for
  channels the client has not loaded? Exceptions in one handler killing the
  rest?
- `gateway/client.ts`: reconnect backoff, jitter, resume window, heartbeat
  timing vs. the server's 60 s timeout, behaviour when the tab is hidden
  (Electron sets `backgroundThrottling` off; browsers do not — is the worker
  timer enough on iOS Safari, which suspends workers?), online/offline
  events, the "nudge on online" path, duplicated sockets after a fast
  reconnect.
- `api/client.ts`: retries (which methods; idempotency — retrying a
  POST /messages after a timeout could double-send), timeouts, abort
  signals, the captive-portal 200-HTML case (round 1 fixed one — check all),
  concurrent 401 handling (one sign-out, not N), error translation.
- Uploads (`lib/attachments.ts`, `upload.worker.ts`, `api/uploads.ts`):
  memory (the 15 GB crash — pieces must never be held on the page), abort
  and cleanup, resume after a network blip, progress accuracy, the
  service-worker rule (no fetch handler in `sw.ts`; downloads via
  `download-sw.ts` under `/__download/`), failure states surfaced to the UI.
- `download.ts` / `streamDecrypt.ts`: streamed decryption of large files,
  memory, Safari fallback, cancelled downloads.

Crypto and trust (the primitives were verified in round 1; the model is what
to audit):
- Key pinning on first sight and the change confirmation (round 1's fix):
  every path that seals to a key goes through it? Grants: the recipient
  cross-check against membership; the fail-open case and its logging.
- Keystore: what is stored, encrypted under what, when it is unlocked, app
  lock (`appLock.ts`) — does locking actually drop keys from memory?
  `storage.ts`: what lands in `localStorage` in plaintext (tokens? settings?
  names? draft messages?).
- Recovery key handling, the registration flow's key derivation, password
  change (re-wrap), the identity export in `export.ts`.
- Epoch rotation on kick/ban/leave: does the client rotate, and do old
  members stop receiving? Subchat locks (`subchatLock.ts`). Voice frame key
  derivation is `voice`'s, but `keyring.ts` is yours.
- `fingerprint.ts`: matches Android's (5200 rounds SHA-256, six groups of
  five) — the test vector should be in both suites; confirm.
- `serverKdf.ts` / `settingsCrypto.ts`: what the server learns from
  settings; nonce reuse anywhere; AAD binding of messages to channel and
  author (a message replayed into another channel must fail).

Performance:
- Bundle composition: `vite.config.ts` chunking, what is in the entry chunk
  (round 1: the voice engine loads for the marketing page — verify with a
  scratch build and `--outDir $TMPDIR/dist-wcore`; report sizes), lazy
  routes (`lazyChunk.ts`), emojibase data loading (`9f2344e` said the cold
  start no longer parses two catalogues — confirm), fonts.
- Store subscriptions that re-render the world on every event (selectors,
  `shallow`), `byId` rebuilt on every message, search index cost
  (`fullSearch.ts`), `mediaCache.ts` growth, `useNow` ticking, the
  notification path per message.
- Memory: listeners never removed (`useReveal`, `longPress`, window
  events), object URLs never revoked, workers never terminated, the
  `readPosition` map growth.

PWA and platform:
- `sw.ts`: registration, update flow (does a new build reach an open tab —
  the `UpdateBanner` is `web-shell-ui`'s, the mechanism is yours), the rule
  that it has no fetch handler, scope. `manifest.webmanifest`: icons,
  `display`, `start_url`, theme colours in both themes, iOS home-screen
  behaviour. `index.html`: meta tags, `viewport-fit`, preloads, the CSP the
  server sets (`static.go`) vs. what the app needs.
- `platform.ts` detection (iPadOS reporting as Mac; Android WebView; the
  desktop app; Firefox — no `RTCRtpScriptTransform`?), and what each branch
  changes.
- `notify.ts`: permission prompting timing (never on load), badge counts,
  the desktop bridge path, sounds (`sounds.ts`), the iOS home-screen
  AudioContext rules (`audioKeeper.ts` is `voice`'s, but the callers here).
- `i18n/core.ts`: plural rules, interpolation escaping, RTL detection,
  date/number formatting through the app locale (round 1 fixed dates), the
  fallback chain, missing-key behaviour in production.
- `markdown/parse.ts`: correctness against Discord's grammar (nesting,
  escapes, code fences with tildes, spoilers inside links, mentions inside
  code, `<t:…>` timestamps, headings only at line start, `-#` subtext,
  URLs with trailing punctuation, autolink of `www.`), pathological input
  (a 4,000-character line of `*` — quadratic?), and parity with
  `android/.../ui/markdown/Parser.kt` — the two must produce the same
  structure for the same input; list every divergence.

Tests: what is untested in stores and lib — especially `dispatch.ts`
ordering, reconnect, uploads, key pinning.

## Compare with

`android/app/src/main/java/xyz/evilion/chat/data/AppState.kt`,
`MessageService.kt`, `KeyService.kt`, `KeyPins.kt`, `net/Gateway.kt`,
`crypto/*.kt`, `ui/markdown/Parser.kt` — same responsibilities, different
platform. Divergence in behaviour (not style) is a `parity` finding.

## Round 1

`audit/REVIEW.md`, `audit/crypto.md` (24), `audit/web-bugs.md` (123, the
non-component parts are yours), `audit/performance.md` (web section).
Verify the "Done" claims that touch your files: shared abort signal, bare
network failure → `ApiError`, captive portal, 401 on password change, key
pinning, the argon2 floor, message-list anchoring (`stores/messages.ts`
side), date formatting.

## Facts you would otherwise rediscover

- `sw.js` must never get a fetch handler: Chrome then retains every upload
  body until the worker's GC runs (measured: a 6 GB upload ate half the RAM).
- Uploads go through a worker per request for the same reason.
- Playwright here has Chromium only (no WebKit/Firefox on macOS 13). For
  Safari-specific claims, read the WebKit source or documented behaviour and
  say that is what you did.
- The web client "may share Android's continual-gathering silent-call
  problem on phones" — that is `voice`'s to check; if you see it, note it as
  `[voice]`.
- 993 web tests pass at the start of this round (`npx vitest run`).

## Reading order

`main.tsx`, `App.tsx`, `routes.tsx`, `index.html`, `vite.config.ts` →
`api/client.ts`, `api/types.ts`, then each `api/*.ts` → `crypto/index.ts`,
`keys.ts`, `conv.ts`, `message.ts`, `kdf.ts`, `keystore.ts`, `file.ts`,
`fileChunks.ts`, `streamDecrypt.ts`, `fingerprint.ts` → `stores/auth.ts`,
`keys.ts`, `messages.ts`, `channels.ts`, `servers.ts`, `users.ts`,
`relationships.ts`, `readStates.ts`, `settings.ts`, `ui.ts`, `panes.ts`, the
rest → `gateway/*` → `lib/attachments.ts`, `upload.worker.ts`,
`download.ts`, `mediaLinks.ts`, `mediaCache.ts`, `keyPins.ts`, `keyring.ts`,
`appLock.ts`, `storage.ts`, `notify.ts`, `sounds.ts`, `search.ts`,
`fullSearch.ts`, `export.ts`, then every remaining `lib/*.ts` → `hooks/*` →
`i18n/core.ts` → `markdown/parse.ts` (+ `Parser.kt`) → `sw.ts`,
`download-sw.ts`, the manifest → the tests.
