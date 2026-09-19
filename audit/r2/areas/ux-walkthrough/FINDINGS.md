# Findings — ux-walkthrough (prefix `UX`)

Environment: throwaway chatd on http://127.0.0.1:64675 built from `5d80e12` + working tree, scratch web build, Chromium (Playwright 1.62), accounts alice/bob (seed), carol (walkthrough), dave (2FA/passcode). Screenshots under `audit/r2/shots/<platform>/<theme>/<lang>/`. Every screen's console/page errors are in `errors.jsonl` beside its shots.

### UX-001 · P2 · ux · A brand-new server's owner is told she "doesn't hold this server's encryption key yet" the first time she opens Invite
- Where: `web/src/components/modals/InviteModal.tsx:46` (`ring.latest(serverId)`), `web/src/stores/keys.ts:195` (`ensureConvKey` — the server key is only created on the first send)
- What: Create a server, do nothing else, click "Invite People". The modal shows a key icon with "You don't hold this server's encryption key yet, so the link can't carry it. New members will receive a key from a member who is online." and the "Include the encryption key in the link" toggle is disabled. The owner created the server seconds ago; nothing explains why she would not hold its key, or what to do. Sending any message in any channel creates the key, after which the same modal quietly gains `#k=` and the toggle turns on. Shot: `audit/r2/shots/web-desktop/dark/en/invite-modal-after-seed-fail.png` (alice, owner, no messages yet, after a re-login) vs `audit/r2/shots/web-desktop/dark/en/invite-modal-with-key.png`.
- Impact: The most likely first action after creating a server is inviting a friend; that person then gets a keyless link and joins into a state that depends on the owner being online to grant. The sentence reads like an error the owner caused.
- Fix: create the server's key when the server is created (or `await ensureConvKey(serverId)` when the invite modal opens, showing a spinner on the toggle until it resolves). Keep the hint only for members who genuinely have no grant yet.
- Effort: S
- Status: open

### UX-002 · P3 · test · [tools] `tools/device/seed.py` stops at "the invite never got its key" on a fresh server
- Where: `tools/device/seed.py:91-101`
- What: The seed creates the server and opens Invite before any message is sent, so by UX-001 the link never carries a key and the script exits, leaving alice and bob registered but bob outside the server and no formatting messages posted. `tools/e2e.py`'s `server_flow` avoids this by sending "first message in general" first. Log: `$TMPDIR/ux-seed.log`.
- Impact: The documented Android/device test setup fails on the first run; the workaround (send a message, then re-run the rest by hand) is undocumented. The walkthrough's `walk.py seed-rest` step does that.
- Fix: send one message before opening the invite (as e2e does), or fix UX-001, which fixes this too.
- Effort: S
- Status: open
