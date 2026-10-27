# Brief — ux-walkthrough (finding prefix `UX`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

This area does not read code for its findings. It **uses the product** the
way a person would, on every platform that can run on this Mac, and writes
down what is confusing, ugly, inconsistent, slow, broken or missing — with
a screenshot for every finding. Code reading is only to work out *why*
something behaves as it does, so the finding can name the file.

Platforms:
1. **Web, desktop viewport** (1366×768 and 1920×1080), Chromium.
2. **Web, phone viewport** (390×844, touch, `is_mobile`), Chromium. This
   stands in for the iPhone home-screen app the owner uses daily; where
   iOS-specific behaviour matters, say what could not be checked.
3. **Web, tablet viewport** (820×1180) — the in-between layout nobody
   designs for.
4. **Android native app** on the emulator (AVD `pixel`, Android 16,
   Chrome 134 also available on it for the mobile web comparison).
5. Each of the above in **dark and light** themes, and the phone viewport
   additionally in **Arabic** (RTL) and one long-word language (German).

Screens: every route and every modal, sheet, picker, menu and settings
page reachable in the app. Flows: register → recovery key → first run →
add a friend → DM → send every kind of message → attachments (image, video,
audio, file) → reactions/replies/edits/pins → create a server → channels,
categories, roles, invites → join from the other account → server settings
→ profile → settings pages → search → quick switcher → notifications →
app lock → logout/login → recovery. Calls: join a voice channel between
two browser contexts (peer to peer on the throwaway server is fine for UI
purposes), screen share with the fake device, the call UI on a phone
viewport, the incoming call screen. On Android: the same flows as far as
the app supports them, signed in as the second account, talking to the
same throwaway server as the web session, so cross-platform message
rendering is compared on identical data.

## Setting up (do this first; write the commands you used into PROGRESS.md
so a successor can restart the same environment)

```
# scratch builds — never web/dist, never bin/chatd
cd web && npx vite build --outDir "$TMPDIR/dist-ux" --emptyOutDir && cd ..
go build -o "$TMPDIR/chatd-ux" ./cmd/chatd

# a throwaway server (keeps running; prints BASE); captchas off, no SFU needed
E2E_CHATD="$TMPDIR/chatd-ux" E2E_WEB_DIST="$TMPDIR/dist-ux" \
  tools/.venv/bin/python -c '
import sys; sys.path.insert(0, "tools")
from e2e import Server; import time
s = Server(keep=True); print("BASE", s.base, "DIR", s.dir, flush=True)
while True: time.sleep(60)' > "$TMPDIR/ux-server.log" 2>&1 &

# seed alice + bob, a server with #general and a General voice channel, and
# one message of every markdown kind (password: correct horse battery staple)
tools/.venv/bin/python tools/device/seed.py http://127.0.0.1:<port>
```

Then drive it with Playwright from `tools/.venv/bin/python` (or
`/tmp/pwvenv/bin/python`): `tools/e2e.py`'s `Session` class knows how to
register, log in, open settings, add friends, open DMs and send; read it and
`tools/screenshot.py` before writing your own script. Write your driver as
`audit/r2/areas/ux-walkthrough/walk.py` so it can be re-run; save every
screenshot under `audit/r2/shots/<platform>/<theme>/<lang>/<screen>.png`
(gitignored) and refer to them by that path in findings. Capture page
errors and console errors per screen; each is a finding.

Android:
```
source ~/.local/toolchain/env.sh
tools/emulator.sh headless                      # one emulator, ever; stop it when done
cd android && gradle :app:assembleRelease -PserverUrl=http://10.0.2.2:<port> -q; gradle --stop; cd ..
adb install -r android/app/build/outputs/apk/release/app-universal-release.apk   # or the arm64/x86_64 one the emulator wants
adb shell am start -n xyz.evilion.chat/.MainActivity
tools/device/ui.py dump | tap text … | tap desc … | type …
adb exec-out screencap -p > audit/r2/shots/android/<theme>/<lang>/<screen>.png
adb shell "settings put system user_rotation 1"  # landscape, etc.
adb shell "cmd uimode night yes"                 # dark theme
adb shell "settings put system system_locales ar-EG"  # may need a restart of the app
tools/emulator.sh stop
```
The release APK pointed at `10.0.2.2` is refused by the publish tool, so it
cannot leak; still, delete `android/app/build/outputs/apk/release/*.apk`
when done. If the signing keystore is not configured for release, use
`assembleDebug` and note that the debug build ANRs on first launch on a busy
machine. **Run a memory watchdog** while the emulator is up: check
`vm_stat` free pages every 30 s and stop the emulator if free memory drops
under 20 %. Do not run the emulator and a web build at the same time.

## What to look for

You are the person who has never seen this app. Note everything that
makes you hesitate, look twice, tap the wrong thing, or wonder what
happened. Specifically:

- **First impressions**: the home page's argument, the register form,
  the recovery-key moment (do you understand what it is and what to do?),
  the empty state after registering (what do you do now?).
- **Discoverability**: can you find how to add a friend, start a call,
  react, reply, edit, pin, search, change the theme, set a status, create
  a server, invite someone, leave a server — without a tooltip hunt? On
  a phone, without hover? Where is the affordance hidden?
- **Feedback**: after every action, does the app say what happened —
  sent, saved, failed, copied, joined? Are errors human sentences with a
  next step?
- **Consistency**: same thing looks and behaves the same everywhere (the
  three platforms; modals vs. sheets; button placement; icon meanings;
  wording — "Server" vs "server", "Sign in" vs "Log in").
- **Layout**: overflow, clipping, truncation, overlap, misalignment,
  scrollbars where there should be none, content under the keyboard,
  content under the safe area, elements too small to tap (measure: under
  44 CSS px / 48 dp is a finding), text too small, lines too long on
  desktop, dead space on tablet, the phone drawer's gesture vs. content.
- **Themes and accent**: contrast (measure with a script if unsure),
  elements that do not follow the theme, the accent used on text that
  becomes unreadable, light theme on the call UI, the home page in light.
- **RTL**: mirrored things that should not be and vice versa, text
  alignment, the composer, the drawer's side, the swipe directions,
  numbers and dates, mixed-direction messages.
- **Long content**: the German build's button labels, long names in every
  place a name appears, a 2,000-character message, a message that is only
  a URL, twenty attachments, a channel with no messages, a server with
  fifty channels.
- **Performance felt**: time to first paint, time to a usable chat after
  login (measure with Playwright's timings), typing lag with a long
  message, scrolling a long channel, opening the picker, switching
  channels, the emulator's frame stutters (note the renderer line
  `tools/emulator.sh` prints so the number is fair).
- **Accessibility on the surface**: tab through a screen — is the focus
  ring visible and the order sane; screen-reader names (use Playwright's
  accessibility snapshot: unlabeled buttons are findings); Android's
  TalkBack-visible names via `ui.py dump` (a control with empty text and
  empty desc is a finding).
- **Cross-platform rendering**: the seed's formatting messages, side by
  side: web desktop, web phone, Android. Every difference is a finding
  (say which is right).
- **What is missing**: things a person expects from a chat app in 2026
  and does not find (read receipts? message forwarding? threads? polls?
  a "jump to unread"? typing "…" in the DM list? muting a DM? message
  reminders?). Judge each: is its absence a real gap for this product's
  audience (small friend groups, privacy-minded)? Only real gaps.

Each finding is a `P1`/`P2`/`P3` with `ux`, `a11y`, `parity`, `design` or
`bug` as kind, a screenshot path, the exact steps to see it, and — if you
could tell from a quick look at the code — the component file. Do not
spend long in the code; the other seven areas are reading it.

## Round 1

Skim `audit/web-ui.md`, `audit/android-ui.md` and `audit/product-gaps.md`
so you know what was already found from the code, and mark any of it you
can *see* still broken with the round-1 id in the title. Round 1 was
code-reading only; nobody has done this walkthrough before.

## Facts you would otherwise rediscover

- Registration on a throwaway server rate-limits after ~10 sign-ups; if
  you need more accounts, restart the server (`Server(keep=True)` again,
  new port, re-seed).
- Playwright here is Chromium only; the cached browsers are `chromium-1234`
  and `-1243`. If Playwright asks for another build number, copy one of
  those directories to the name it wants.
- Sync Playwright only sees network/console events while a Playwright
  call runs; use `page.wait_for_timeout`, not `time.sleep`.
- The phone layout hides the sidebar behind "Open navigation"; settings
  tabs scroll sideways; the composer is `textarea[aria-label='Message
  #general']`; invite link in `[data-testid=invite-link]` (wait for `#k=`).
- `localStorage.__standalone = "1"` makes the web app behave as the iOS
  home-screen app for the audio rules.
- The emulator: `tools/emulator.sh headless` prints the renderer; "Intel
  Iris Pro OpenGL Engine" is right, "SwiftShader" is wrong (8× slower).
  Stop Gradle's daemon before starting it (the script does). Stop the
  emulator with `tools/emulator.sh stop`, not by killing processes.
- `adb reverse` is not needed for `10.0.2.2`.
- Numeric design measurements are retained under docs/design/reference/; personal reference captures are excluded.
  has a few reference captures.

## Order

Web desktop, dark, English, every screen and flow (this is the bulk) →
web phone, dark, English → web phone, light → web phone, Arabic → web
phone, German → web desktop, light → tablet, dark → Android (dark, light,
Arabic) → the side-by-side rendering comparison → the "what is missing"
pass → the summary.
