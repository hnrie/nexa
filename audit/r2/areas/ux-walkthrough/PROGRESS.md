# Progress — ux-walkthrough
State: auditing
Last checkpoint: 2026-09-18T20:40Z
Next finding id: 001

## Environment (re-create with exactly these; never web/dist, never bin/chatd)

```
# scratch builds
cd web && npx vite build --outDir "$TMPDIR/dist-ux" --emptyOutDir && cd ..
go build -o "$TMPDIR/chatd-ux" ./cmd/chatd

# throwaway server (BASE printed into $TMPDIR/ux-server.log)
E2E_CHATD="$TMPDIR/chatd-ux" E2E_WEB_DIST="$TMPDIR/dist-ux" \
  tools/.venv/bin/python -c '
import sys; sys.path.insert(0, "tools")
from e2e import Server; import time
s = Server(keep=True); print("BASE", s.base, "DIR", s.dir, flush=True)
while True: time.sleep(60)' > "$TMPDIR/ux-server.log" 2>&1 &

# seed alice + bob + "Alice's server" (#general, General voice) + formatting messages
tools/.venv/bin/python tools/device/seed.py http://127.0.0.1:<port>
```

Port: 64675 → BASE http://127.0.0.1:64675 (started 2026-09-18T20:19Z; data dir $TMPDIR/chat-e2e-2okppafk; launcher pid in $TMPDIR/ux-server.log)
Accounts: alice / bob (seed), carol (desktop walkthrough), dave (2FA + passcode), all with password "correct horse battery staple"
Driver: audit/r2/areas/ux-walkthrough/walk.py (re-runnable; `walk.py <BASE> <platform-step>`)
Shots: audit/r2/shots/<platform>/<theme>/<lang>/<screen>.png

## Checklist

Legend: [ ] not done · [x] done · [~] in progress. One line per platform × theme × language × screen group.

### 1. Web desktop 1366×768 · dark · en  (the bulk)
- [ ] home page (/) — first impression, light/dark, argument
- [ ] register form → recovery-key moment → first-run empty state
- [ ] login (/login), wrong password, logout → login
- [ ] recover (/recover) with the saved recovery key
- [ ] friends page: Online / All / Pending / Blocked / Add Friend tabs; add a friend both ways
- [ ] DM: send text, every markdown kind (seed messages), 2,000-char message, URL-only message
- [ ] attachments: image, video, audio, file; twenty attachments; drop overlay
- [ ] reactions, reply, edit, delete, pin, pins panel, message context menu, selection bar
- [ ] create server modal → server page → #general
- [ ] create channel (text, voice, private), create category, channel topic modal, channel settings (overview, permissions, delete)
- [ ] server settings: overview, roles, emoji, stickers, encryption, members, invites, bans, audit log, delete
- [ ] invite modal → join from bob (invite page) → server notifications modal → server profile modal → leave server
- [ ] server with fifty channels; channel with no messages; long names everywhere
- [ ] profile modal / profile card / key verify / custom status modal
- [ ] user settings: account, profiles, privacy, security (2FA + passcode), devices, appearance, voice, notifications, stickers, licenses, admin, get-app
- [ ] search panel + suggestions; quick switcher; shortcuts help
- [ ] notifications (toasts, banners), app lock (passcode page), lock now
- [ ] group DM: create DM modal, edit group modal, group invite modal, group member list
- [ ] voice: join General between alice and bob, voice view, mute/deafen, participants, screen share modal (fake device), leave; DM call + incoming call screen; guest link modal + guest call page
- [ ] download page (/download), sticker pack page, offline page, 404 route
- [ ] keyboard pass: tab order + focus ring on 5 screens; a11y snapshot for unlabeled controls
- [ ] performance: first paint, login→usable chat, typing lag with a long message, channel switch, picker open
- [ ] console/page errors per screen

### 2. Web desktop 1920×1080 · dark · en
- [ ] home, friends, DM, server channel, settings, voice — line length, dead space, scaling

### 3. Web phone 390×844 (touch, is_mobile) · dark · en
- [ ] home, register, recovery key, login
- [ ] friends, drawer ("Open navigation"), DM, composer + keyboard, send button
- [ ] message actions without hover (long-press / menu), reactions, reply, edit, pin
- [ ] server page, channel list in drawer, channel settings, server settings (tabs scroll sideways)
- [ ] user settings pages on a phone
- [ ] search, quick switcher, pickers (emoji/gif/sticker) sized with vh
- [ ] voice: call UI on the phone viewport, incoming call, share screen
- [ ] standalone (`localStorage.__standalone = "1"`) — safe area / notch checks noted as "could not check on iOS"
- [ ] tap targets < 44 px measured

### 4. Web phone · light · en
- [ ] the same screens in light (contrast, call UI in light, home page in light)

### 5. Web phone · dark · ar (RTL)
- [ ] home, auth, friends, drawer side, DM, composer, message actions, settings, search, voice, mixed-direction messages, numbers/dates

### 6. Web phone · dark · de (long words)
- [ ] auth, friends, DM, settings, server settings, modals — button labels, truncation, overflow

### 7. Web desktop 1366 · light · en
- [ ] home, friends, DM (code blocks, mentions), server, settings, voice, pickers, context menus

### 8. Tablet 820×1180 · dark · en
- [ ] home, friends, DM, server, settings, voice, search — the in-between layout

### 9. Android (emulator `pixel`, headless, watchdog)
- [ ] build: `gradle :app:assembleRelease -PserverUrl=http://10.0.2.2:<port>`; install; `gradle --stop`
- [ ] dark · en: auth (login as bob), recovery, main screen, drawer/sidebar, friends, DM, chat with the seed messages, composer, attachments, message actions, reactions, pickers, server settings, user settings, profile sheet, invite screen, key verify, search, call screen + incoming call
- [ ] light · en: the same screens
- [ ] dark · ar: the same screens (swipe direction, drawer side)
- [ ] TalkBack names via ui.py dump (controls with empty text and desc)
- [ ] landscape once
- [ ] emulator stopped, APKs deleted

### 10. Side-by-side rendering comparison
- [ ] the seed's 21 formatting messages: web desktop vs web phone vs Android — each difference a finding

### 11. The "what is missing" pass
- [ ] judged list of real gaps for small privacy-minded friend groups

### 12. Summary at the top of FINDINGS.md; State: audit-done; emulator + server stopped

## Handoff note
Fresh start 2026-09-18 ~20:40Z. Read README, BRIEF, tools/e2e.py, seed.py, ui.py, emulator.sh, routes.tsx,
settings nav ids (user: account profiles privacy security devices appearance voice notifications stickers
licenses admin get-app [desktop in app]; server: overview roles emoji stickers encryption members invites bans
audit delete; channel: overview permissions delete). Round-1 REVIEW.md Done/Not doing/Still open read.
Next: scratch builds, start the server, seed, write walk.py, begin section 1.
