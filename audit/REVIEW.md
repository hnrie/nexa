# Review of the audit

The audit is eleven reports and 720 findings. This is the pass over them: what
was worth doing, what was done, what was deliberately not, and why. It is
written to be argued with — every "not worth it" below is a judgement, and the
finding it refers to is still in its report with the evidence for the other
view.

The counts, for scale:

| Report | Findings | The headline |
|---|---:|---|
| `crypto.md` | 24 | 1 CRITICAL: no client verifies any public key |
| `server-security.md` | 23 | 2 HIGH: media proxy, no cap on gateway connections |
| `server-correctness.md` | 86 | 4 DATA-LOSS, 3 RACE |
| `web-bugs.md` | 123 | 3 DATA-LOSS, 9 RACE, 11 LEAK |
| `web-ui.md` | 153 | 30 BROKEN, most of them RTL and contrast |
| `android-correctness.md` | 71 | 4 CRASH, 4 DATA-LOSS |
| `android-calls.md` | 51 | 9 CRASH |
| `android-ui.md` | 74 | 15 BROKEN |
| `android-expression-picker.md` | — | one design, replacing three sheets |
| `desktop-and-release.md` | 25 | 4 HIGH, all in the release path |
| `performance.md` | 90 | 26 SEVERE, three of them structural |
| `product-gaps.md` | — | a parity matrix; Android is a read-and-chat client |

## What the audit got right that I did not expect

Three things are worth saying before the list of problems, because a list of
problems is not an assessment.

**The three platforms genuinely agree on the cryptography, and the reviewer
checked rather than assumed.** The Android test vectors reproduce from the web
client's own primitives; the hand-written AES-256-GCM passes all six NIST
vectors including the awkward IV lengths; a sealed call frame from the C++ is
byte-identical to one from the web client. For a three-platform
re-implementation that is unusual.

**The problem is never the primitive.** Every serious finding in `crypto.md` is
about the trust model around the primitives — who supplies a key, who decides
who gets a grant — which is exactly where these things go wrong in practice and
exactly where they are hardest to see.

**Most of the UI findings are a last mile, not a rewrite.** `min-width: 0` is on
nearly every truncating flex child; `overscroll-behavior: contain` is on every
nested scroller; `@media (hover: hover)` guards every reveal-on-hover control
because iOS turns a reveal tap into a hover. The correct pattern almost always
exists somewhere in the codebase already. What is missing is uniformity, which
is a much better position than missing judgement.

## The order I worked in, and why

Not severity order. Severity is what a finding could cost; the order below is
what it *does* cost, multiplied by how many people it costs it to.

1. **Anything that loses a message or a key.** Unrecoverable, and the product's
   one job.
2. **Anything shipped.** A published APK signed with the wrong key cannot be
   un-published. A release path with a hole in it puts the next mistake beyond
   reach.
3. **The CRITICAL.** The product's entire claim is that the server never sees
   plaintext, and as built the server can help itself to any conversation key it
   wants.
4. **Crashes, in the order people meet them.** Calls on Android first — the
   owner's own words were that they "crashed the client, and it was basically
   unusable".
5. **What everyone sees every day.** The main message surface being unreadable
   in Arabic; a fling that throws you to the top of the chunk.
6. **Everything else.**

## Done

Each of these is a commit; the commit message says what the failure actually
was.

### Shipped and cannot be taken back

- **The Android release was one command from going out pointed at a test
  server.** `gradle assembleRelease -PserverUrl=…` leaves an ordinary,
  release-signed APK in the usual place. Publishing now reads the server out of
  the dex and refuses a build aimed at this desk.
- **A release with no keystore was silently signed with the debug key.** Both
  `make android` and `make publish-android` would have succeeded, the manifest
  would have advertised the debug certificate to `assetlinks.json`, and every
  installed app would have refused the update — a one-way door, found only by
  the people it had already locked out. It fails now, and only when a release is
  what was asked for, so a fresh clone can still build debug. The expected
  certificate is also pinned at publish time.
- **`npm run build` deployed the working tree.** There is no deploy step:
  `vite build` writes into `web/dist`, and `web/dist` is what the site serves.
  The most ordinary command in a JavaScript project published whatever was in
  the tree, to everyone, at once. It now refuses unless `DEPLOY=1`, which
  `make web` sets.
- **Releases run their tests.** `desktop:` was `npm run build &&
  electron-builder`; the typechecker and the suite both existed, wired into
  targets nothing depended on.
- **`data/desktop` had reached 3.0 GB** across four releases with nothing to
  remove any of them, on the same volume as the database and the media.
  Publishing keeps the newest two and refuses to publish over a version that is
  already out.

### The desktop app

- **The screen-share consent was drawn by the page it protected.** The handler
  sent every screen and window to the renderer and waited for it to send back an
  id, so anything with script execution there could ask for the screen, catch
  its own event, answer `"screen:0"`, and have a full-screen track with system
  audio without a pixel being drawn. It is a window of its own now, on a local
  page with its own sandboxed preload, and only that window may answer, and only
  with a source that was offered. Driven end to end against the real app.
- `clipboard-read` was auto-granted and never used — on a machine where this app
  puts the recovery key and the two-factor backup codes on the clipboard.
- `will-navigate` allowed any `data:text/html` URL for an exemption the offline
  page never used; subframes had no navigation guard at all, leaving the
  *server's* `frame-src` as the only thing constraining the *client*.
- `openExternal` handed out `mailto:`, which nothing in the app produces.
- `tasklist`/`taskkill` were resolved by bare name, through a search order that
  includes the launch directory.
- The activity sanitiser rejected `https://user@host` and accepted
  `https://:password@host`; the server's copy of the same rule did not.
- The signed-in identity — the one thing that crosses outward, into every local
  RPC program — was uncapped, and a truthy non-object arrived as the literal id
  `"undefined"`.

### Android

- **Every action in a bottom sheet was racing its own cancellation.** The
  pattern was `scope.launch { … }` then `onDismiss()`, and `onDismiss` destroys
  the composition the scope belongs to. Deleting a message printed
  "rememberCoroutineScope left the composition" and deleted it anyway; on a
  slower connection it simply would not have. The composer was worse: leaving
  the channel mid-send cancelled the upload, and a message carrying an
  attachment is both the slowest kind and the one you would least like to lose.
- Settings had never once saved — the version sent was the one being written
  rather than the one being replaced, so every write lost the compare-and-swap.
- The gateway compared against a socket that is only assigned after
  `newWebSocket` returns, so the first frames of a new connection were thrown
  away; events raced each other through a coroutine per frame; a full queue
  dropped silently.
- Messages missed while the connection was gone are now caught up rather than
  left as a hole in the history.
- A `+` on the reaction row. Adding a reaction nobody had used yet meant
  long-pressing the message.
- One picker for emoji, GIFs and stickers, which is the thing the owner asked
  for in those words.

### Web

- **A fling no longer throws you to the top of the loaded chunk.** Two causes: a
  message arriving from the other person rebuilt `byId`, which the anchoring
  effect watched, so it ran mid-load, saw no growth and cleared the anchor; and
  a height delta cannot tell a prepend from a picture finishing. Now it holds
  the first visible row's id and offset, and keeps holding it until the page has
  settled. Measured: two jumps of nearly two thousand pixels before, none after.
- **The mobile controls stopped vanishing.** The drawer's grid had no row
  spelled out, so its implicit `auto` row grew to the height of the conversation
  list and pushed the voice bar and the panel with mute, deafen, settings and
  your status off the bottom, with nothing to scroll them back.
- The web client's own audit pass: an abort signal shared across uploads keeping
  a finished XMLHttpRequest per upload it ever saw; a bare network failure that
  never became an `ApiError`, so every caller fell through to the browser's
  untranslated "Failed to fetch"; a captive portal answering 200 with HTML
  leaving an upload spinning for the life of the page; a 401 signing you out for
  a password typed wrong while changing it; a failed page of pins rendering
  exactly like a channel with no pins, and saying so confidently.
- Dates followed the browser rather than the app, so Arabic words arrived with
  an English date in the middle of them.

### Server

- A failed read of a group's participants looked exactly like an empty group,
  and the next line deleted the conversation and every message in it.
- Enabling TOTP twice replaced the backup codes someone had already written
  down.
- The media proxy's signature had no expiry.

## Landed since

All five of the agent passes finished, and the results are deployed.

**The CRITICAL is fixed.** Identity keys are pinned on first sight and a
changed one is never sealed to without a blocking confirmation that shows both
safety numbers side by side. The grant recipient list the server hands over is
cross-checked against the membership the client already draws, and an outsider
is dropped, logged and toasted — it fails open and says so only when membership
genuinely cannot be settled, because refusing there would strand real members.
The safety number is six groups of five digits over 5200 rounds of SHA-256,
identical on web and Android, pinned by the same test vector in both suites, and
shown with a QR code and an honest note that matching digits prove you hold the
same key but not that it belongs to the right person. I checked that one on
screen myself rather than from the report.

**The argon2id HIGH** is floored client-side at exactly the server's own
`validKDF`, in `deriveMaster` on both platforms — the one place every derivation
passes through — with a ceiling too, since a hostile server could otherwise wedge
a phone with 1 GiB and twenty passes. Every real account on this instance was
registered at 65536/3/1, comfortably inside, verified against the live database
and all eight backups.

**The gateway cap** is 32 per account, 256 per address, 4096 in total, with a
connect rate limiter beside it, refusing at the door rather than evicting — the
cost being bounded is the thirty-to-a-hundred queries that build a `ready`, and
an evicted client just reconnects and builds another.

**Android calls were crashing on every release build**, which the audit did not
catch and neither did I before publishing 1.0.2. R8 removed `org.jni_zero`,
which WebRTC's native library looks up by name, so the first thing a call does
aborted the process. Debug builds are clean, which is exactly why it shipped.

The rest: RTL fixed in 38 places with the accent colour now computing its own
readable foreground for any colour a person picks; reduced motion that removes
motion rather than information; a keyboard and screen-reader pass that ends at
zero axe violations; and thirteen surfaces that used to draw a failed request as
a cheerful empty state.

## Not doing, and why

- **`make build` writing `index.html` into the live directory non-atomically.**
  Real, and the window is milliseconds. Two deliberate mitigations already exist
  — `emptyOutDir: false` with seven-day retention of replaced chunks, so an open
  tab survives, and missing assets 404 with `no-store` rather than being served
  as HTML. Fixing it properly means changing where the daemon serves from, which
  is a deployment change to a live instance, and the guard on `npm run build`
  closes the way this was actually likely to bite. Worth doing on a day when the
  instance can be restarted deliberately.

- **The Rich Presence WebSocket being reachable by every local user.** The IPC
  transport is protected (`umask(0o177)`, so the socket is `0600`); the
  WebSocket has no equivalent, because loopback TCP carries no user identity.
  Discord has exactly the same hole, and the compatibility that makes this
  feature worth having is what makes it unfixable without breaking every client
  that speaks the protocol. The honest options are a token file that only
  cooperating clients would use, or defaulting the transport off. Both are
  product decisions, not bugs, and the settings page should say what it does
  either way — which is the smaller thing worth doing.

- **Nexa interposing on the real Discord RPC socket.** The app renames Discord's
  own socket and takes the name, so every program speaking Discord RPC reaches
  Discord through Nexa — including `AUTHORIZE` and `AUTHENTICATE` frames
  carrying OAuth tokens. Nothing reads or logs them today. The finding is about
  position rather than behaviour, and it is correct: this belongs in the
  settings page in plain words, so people know, and in a deny-list so no future
  logging can capture those frames. Not a fix; a decision to document.

- **Most of `performance.md`'s 42 NOTABLE and 16 MINOR.** The three structural
  ones are worth their own pass — no permission caching on the server, the
  message list not virtualised despite `@tanstack/react-virtual` being a
  dependency that is never imported, and the voice engine in the entry bundle
  for a visitor reading the marketing page. The rest are the sort of thing that
  is cheaper to fix once a profiler says which of them matters on a real
  instance than to fix all of by reading.

- **The 15 IDEA findings in `web-ui.md` and the 8 in `android-ui.md`.** Good
  ideas. Not audit findings, and mixing them into a bug list is how a bug list
  stops being finished.

## Still open, in the order I would take them

1. The Android app has **no in-app updater at all**, despite
   `REQUEST_INSTALL_PACKAGES` in the manifest and an endpoint that already
   serves everything one needs. Nobody on 1.0.2 will hear about 1.0.3.
2. The per-processor APKs are published and nothing downloads them: the web
   client's `AndroidRelease` type does not declare the `files` array at all, so
   every Android user takes the 39 MB universal build instead of the 16 MB one.
3. The three structural performance findings.
4. `android-ui.md`'s 15 BROKEN, beyond the calls work.
5. The signing key is on one machine and in no backup. Not code, and not mine to
   do — but it is the single highest-consequence item in this document.
