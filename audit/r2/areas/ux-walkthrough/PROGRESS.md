# Progress — ux-walkthrough
State: auditing
Last checkpoint: 2026-09-19T05:35Z
Next finding id: 024

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
- [x] home page (/) — first impression, light/dark, argument
- [x] register form → recovery-key moment → first-run empty state
- [x] login (/login), wrong password, logout → login
- [x] recover (/recover) with the saved recovery key
- [x] friends page: Online / All / Pending / Blocked / Add Friend tabs; add a friend both ways
- [x] DM: send text, every markdown kind (seed messages), 2,000-char message, URL-only message
- [~] attachments: image, file, twenty attachments, lightbox, drop overlay done (UX-006). Video/audio attachments not tried.
- [x] reactions, reply, edit, delete, pin, pins panel, message context menu, selection bar
- [x] create server modal → server page → #general (server made by seed; UX-001)
- [~] create channel text done (UX-007). Voice+private, category, topic modal, channel settings NOT done — walk.py's selector for the private switch is wrong and the channel-row gear was not found; re-run `d5-server` after fixing.
- [x] server settings: every page shot (UX-010); roles editor + create role shot
- [~] invite modal, invite page, bob joined, server notification + profile modals shot. Leave-server flow NOT done.
- [ ] server with fifty channels; channel with no messages; long names everywhere
- [~] profile card + member context menu shot; key verify and custom status NOT confirmed
- [x] user settings: all 12 pages shot (UX-008..013). Note: `full_page=True` does NOT capture the settings overlay (it is a fixed overlay with its own scroller) — scroll inside `[role=dialog]` instead; content below 768 px is still unseen on Account/Privacy/Voice/Security.
- [x] search panel + suggestions, quick switcher, shortcuts help, slash commands, pickers shot
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
- [x] home, login (register/recovery key already covered on desktop; phone home + login shot)
- [x] friends (UX-018), drawer, DM (UX-017), composer + send button (UX-019)
- [x] message actions: long press → contextmenu handler exists and the menu is well sized; the hover bar is 26×24 (UX-019, UX-022)
- [~] server page + channel list in drawer shot; channel/server settings on a phone NOT done
- [x] user settings on a phone: account, appearance, privacy, security, voice (UX-020)
- [x] search + results (UX-023), emoji picker (390×506 of an 844 viewport — fine). Quick switcher on a phone NOT done.
- [ ] voice: call UI on the phone viewport, incoming call, share screen
- [ ] standalone (`localStorage.__standalone = "1"`) — safe area / notch checks noted as "could not check on iOS"
- [x] tap targets measured (UX-019)

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
2026-09-19T05:35Z — successor #2. Server :64675 still up. UX-001..023 written.

Done this session: mined the predecessor's desktop shots (UX-006..013); added `probe`, `viewport_pass` and the
steps `p-dark-en`, `p-light-en`, `p-dark-ar`, `p-dark-de`, `desktop-light`, `tablet`, `wide` to walk.py; ran
`probe` and `p-dark-en`.

Gotchas for a successor driving walk.py:
- the phone keeps the whole sidebar in a drawer — click `button[aria-label='Open navigation']` before anything
  in the sidebar or the user panel (`[data-testid=user-settings]`), or the click times out.
- `Walk.unlabeled()` has false positives: a radio wrapped in `<label>` has a name. Confirm with
  `page.locator(...).aria_snapshot()` before writing an a11y finding.
- `full_page=True` does not capture the settings overlay; scroll its inner scroller instead.
- theme/language live on the account and sync, so `viewport_pass` sets them at the start and resets to dark/en
  at the end. If a pass dies half-way, bob may be left in ar/de — reset by hand before the Android pass.

Next: `p-light-en`, `p-dark-ar`, `p-dark-de`, `desktop-light`, `tablet`, `wide`, then `d7-voice`, then Android
(check `vm_stat` first: needs free+inactive > 1.3 M pages).
