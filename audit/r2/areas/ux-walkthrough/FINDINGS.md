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

### UX-003 · P2 · ux · The first screen after registering is an empty "Nobody is online right now." with nothing to do
- Where: `web/src/pages/FriendsPage.tsx` (the Online tab's empty state), `web/src/components/sidebar/` (the DM list's "No conversations yet.")
- What: Register → tick the recovery box → "Continue to Nexa" lands on Friends ▸ Online, which shows a grey people glyph and "Nobody is online right now." A brand-new account has no friends at all, so this sentence is both wrong in spirit and a dead end: there is no button here, no "add your first friend", no "create a server", no hint that the green `+` in the rail makes a server or that `Add Friend` is the pink chip up in the tab row. The only real guidance on the screen is the small grey line in the sidebar ("No conversations yet. Add a friend to start one."). Shot: `audit/r2/shots/web-desktop/dark/en/first-run.png`.
- Impact: every single new user sees this as their first screen, and the product's whole value (talk to your friends privately) needs one of two actions — add a friend, or make a server — neither of which is offered. Discord, the stated reference, puts a large illustrated empty state with an explicit "Add Friend" button here.
- Fix: when the account has no friends and no servers, replace the Online empty state with a first-run card: one line of what to do ("Nexa is empty until you add someone."), a primary "Add Friend" button that opens the Add Friend tab with the field focused, a secondary "Create a server", and your own username shown with a copy button so you can send it to a friend (see UX-006).
- Effort: M
- Status: open

### UX-004 · P2 · bug · `#channel` never becomes a channel link: no `#` autocomplete in the composer, and a typed `#general` stays plain text
- Where: `web/src/components/composer/Autocomplete.tsx:10` (`AcItem` has `user | emoji | customEmoji | command` — no channel), `web/src/lib/markdownCtx.ts:28` (`onChannelClick` exists and navigates, so the renderer already handles channel links)
- What: In `#general`, type "a mention of @bob and a channel #general". `@bo` pops a Members list and picking it writes a real mention, which renders as the purple `@Bob` chip. `#gen` pops nothing at all — no listbox appears (checked: `[role=listbox]` count 0 while `@` gives 1) — and the sent message shows `#general` as plain grey text that does nothing when clicked. Shots: `audit/r2/shots/web-desktop/dark/en/composer-mention-autocomplete.png` (the `@` list), `audit/r2/shots/web-desktop/dark/en/general-seed-mention-after-enter.png` (`@Bob` is a chip, `#general` is not).
- Impact: "go to #general" is how people point each other at a channel; here it is dead text, so the reader has to find the channel by hand. The renderer half of the feature is already written and unreachable from any client UI. Discord, the reference, offers `#` completion and renders a clickable channel chip.
- Fix: add a `channel` kind to the composer autocomplete (channels of the current server the member can see, ordered by category), insert `<#id>`, and render it through the existing `onChannelClick`. Android parity: check whether its composer offers `#` (see the Android section).
- Effort: M
- Status: open

### UX-005 · P2 · ux · The recovery key you get after a password reset is offered with only "Copy" — no file, no "we cannot show it again" warning
- Where: `web/src/pages/RecoverPage.tsx:68-78` vs `web/src/pages/RegisterPage.tsx:73-92`
- What: Registration shows the key with two buttons ("Copy" and "Download .txt"), an amber warning box ("We cannot show this key again. Anyone who has it can read your messages, so store it like a password.") and the tick box. The identical moment at the end of a password reset — "Password reset. Here is your new recovery key. The old one no longer works." — has only "Copy" and the tick box: no .txt download, no warning about what the key is or that it will never be shown again. Shots: `audit/r2/shots/web-desktop/dark/en/recovery-key.png` vs `audit/r2/shots/web-desktop/dark/en/recover-done.png`.
- Impact: the person who just lost a password is exactly the person who will lose the new key too. Someone who copies it to the clipboard and closes the tab (clipboards get overwritten) is locked out for good at the next reset. Inconsistent treatment of the same object in two places also teaches the user that the warning was not serious.
- Fix: extract the register screen's key block into one component (key, Copy, Download .txt, warning, tick) and use it on both pages; give the recover page's key `data-testid=recovery-key` too, which the e2e helpers already look for.
- Effort: S
- Status: open
