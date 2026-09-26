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

### UX-006 · P2 · ux · Attaching more than ten files silently drops the rest: the warning is a toast at the top of the window, the tray clips at the right edge and never says how many are attached
- Where: `web/src/components/composer/` (the attachment tray), the toast host at the top centre
- What: In a DM, pick twenty images at once. A toast "At most 10 files per message." appears at the **top centre of the window**, over the channel header, ~700 px away from the composer you were looking at, and fades. The tray at the bottom shows `pic00 … pic02` and then a fourth tile cut off mid-width at the right edge of the composer: it is a horizontally scrolling strip with no scrollbar, no arrows and no counter, so there is no way to see what is attached or to know that ten of your twenty files were thrown away. Shots: `audit/r2/shots/web-desktop/dark/en/composer-twenty-attachments.png`.
- Impact: send twenty holiday photos, ten arrive, nobody is told which ten. The user finds out from the other person.
- Fix: (a) put the limit message inside the composer, above the tray, where the eye already is, and keep it until it is dismissed or the files change; (b) show `10/10 files` next to it; (c) wrap the tray to two rows or give the strip visible scroll affordances; (d) say which files were dropped ("pic10.png and 9 more were not added").
- Effort: M
- Status: open

### UX-007 · P2 · ux · The channel name you type is not the channel name you get, and the modal never shows the transformation
- Where: `web/src/components/modals/CreateChannelModal.tsx`, the create-channel name field
- What: Create Channel ▸ type `Plans For The Weekend`. The field shows exactly that, with a `#` glyph in front. Press Create Channel and the sidebar shows `#plans-for-the-weekend` — the server lower-cases it and replaces spaces with hyphens after the fact. Shots: `audit/r2/shots/web-desktop/dark/en/create-channel-filled.png` → `audit/r2/shots/web-desktop/dark/en/fail-channel-settings.png` (sidebar).
- Impact: the name you confirmed is not the name you get, so people create a channel, do not recognise it, and create another. Discord, the stated reference, rewrites the field live as you type so the surprise never happens.
- Fix: normalise in the input's onChange (lower-case, spaces → `-`, strip disallowed characters) so the field always shows the real name, as Discord does. Same rule must apply on Android's create-channel screen.
- Effort: S
- Status: open

### UX-008 · P2 · ux · The Devices list is unreadable: every session is "Chrome on macOS · 127.0.0.1", and the one safe action is buried under all of them
- Where: `web/src/components/settings/DevicesPage.tsx:86-93` (`describe(ua)` and the row), `:93` (the "Log out all other devices" button, placed after the list)
- What: Settings ▸ Devices after one afternoon's use shows nine identical rows: `Chrome on macOS` / `127.0.0.1 · last active 9/18/2026, 4:14:53 PM`, each with a `Log out` button, one marked `· This device`. Every login made a row; nothing is ever pruned and there is no name, no way to rename, and no first-seen date — only a last-active timestamp. The "Log out all other devices" button exists but is rendered *below* the list, so with nine sessions it is off-screen and the person has to scroll past every row they cannot identify to reach it. Shot: `audit/r2/shots/web-desktop/dark/en/settings-devices-full.png` (the button is below the fold).
- Impact: the page exists so a privacy-minded person can answer "is anything signed in that should not be?". With nine indistinguishable rows they cannot, and the answer that does not need identification — log the rest out — is the one control they will not see.
- Fix: (a) move "Log out all other devices" to the top of the page, next to the count, where it is visible before the list; (b) name devices (platform + app + first seen, editable, as Signal and WhatsApp do) and show "added 18 Sep" as well as last active; (c) show the app kind (web / desktop / Android) rather than the browser UA for the native clients; (d) expire or collapse long-idle sessions so the list stays short.
- Effort: M
- Status: open

### UX-009 · P3 · design · The default profile banner is a 660×255 block of raw accent purple
- Where: `web/src/components/settings/AccountSettings.tsx` (the profile card), the profile modal, the member card
- What: Settings ▸ My Account puts a banner above the avatar. With no banner uploaded it is a flat `#8b00ff`-ish rectangle a third of the page tall, at full saturation, next to a yellow avatar. The same block appears in red on Bob's profile panel. Shots: `audit/r2/shots/web-desktop/dark/en/settings-account-full.png`, `audit/r2/shots/web-desktop/dark/en/dm-image-sent.png` (Bob's panel).
- What would be better: derive the empty-banner fill from the person's accent at a much lower chroma (a 12–18 % tint of the accent over the surface colour, or a soft two-stop gradient), the way Discord's default banner is a muted band. The accent is for controls; using it raw over a quarter of the page makes the avatar and the name fight it.
- Effort: S
- Status: open

### UX-010 · P3 · design · Every settings page is a 660 px column pinned to the left of a 974 px panel, leaving a dead band on the right
- Where: `web/src/components/settings/SettingsLayout.tsx` (or equivalent shell), all user- and server-settings pages
- What: at 1366×768 the settings overlay's nav ends at x=386 and the content runs 432→1092, leaving 274 px of empty panel on the right, with the ESC button floating alone in it. At 1920 the band will be ~830 px. Shots: any `audit/r2/shots/web-desktop/dark/en/settings-*.png`, `server-settings-*.png`.
- What would be better: centre the content column in the panel (Discord centres and caps at ~740 px), or widen the column on wide viewports and use the space for the two-column layouts the content already wants (Devices, Members and Roles all have a list plus a detail).
- Effort: S
- Status: open

### UX-011 · P2 · i18n · "Everyone — Anyone on this server can message you" is the account-wide DM setting, but "server" in this app means a guild
- Where: `web/src/components/settings/PrivacySettings.tsx`, `web/src/i18n/locales/en.json` (the DM-privacy option strings)
- What: Settings ▸ Privacy & Safety ▸ Direct Messages offers Everyone / Friends only / Nobody. "Everyone" is explained as "Anyone on this server can message you." Everywhere else in the product "server" is a Discord-style guild (the rail, "Create a server", "Server Settings", "Alice's server"). Read that way the sentence says the setting is per-guild, which it is not — it is one account-wide setting. Shot: `audit/r2/shots/web-desktop/dark/en/settings-privacy-full.png`.
- Impact: the one privacy control most likely to be read carefully is the one whose wording is ambiguous; a person who wants "only my friends can DM me" cannot tell whether this applies to the guild they are in or to everything.
- Fix: say "Anyone with an account here can message you" (or use the instance's name). Check the sibling strings for the same word and the other twelve locales, which will have copied the ambiguity.
- Effort: S
- Status: open

### UX-012 · P3 · design · The Arabic tile in the language grid is right-aligned while the other eleven are left-aligned, so the grid looks broken
- Where: `web/src/components/settings/AppearanceSettings.tsx` (the language grid)
- What: Settings ▸ Appearance ▸ Language is a 3-column grid of tiles, each "native name" over "English name". The Arabic tile renders both lines flush right because the tile inherits the direction of its Arabic content; the English gloss "Arabic" goes right with it. Shot: `audit/r2/shots/web-desktop/dark/en/settings-appearance.png`.
- What would be better: keep the tile's own layout in the UI's direction (so every tile's text starts at the same edge) and mark only the native-name span `dir="auto"`, or give the whole grid `text-align: start` with `unicode-bidi: plaintext` on the native name alone. The gloss line should always follow the UI's direction.
- Effort: S
- Status: open

### UX-013 · P3 · ux · Instance Admin: the sentence about the config-file override sits on top of the next section, and the way to "clear it" is not offered
- Where: `web/src/components/settings/AdminSettings.tsx`
- What: under the Registration radio group, "The config file says "open"; what you pick here overrides it until you clear it." is 18 px above the next label, `REGISTRATION KEY (NOT SET)`, so it reads as that field's help text. And nothing on the page clears the override — there is no "Use the config file again" control. Straight quotes are used inside the sentence, where the rest of the product uses curly quotes. Shot: `audit/r2/shots/web-desktop/dark/en/settings-admin.png`.
- Fix: move the sentence directly under the radios with the section's own spacing, add a "Follow the config file" reset next to it, and use typographic quotes.
- Effort: S
- Status: open

### UX-014 · P2 · a11y · The composer's placeholder is 2.2:1 against the box it sits in
- Where: `web/src/components/composer/Composer.module.css` (the textarea's `::placeholder`), dark theme
- What: measured live in `#general`: the placeholder "Message #general" renders `rgb(108,109,118)` on `rgb(57,58,65)` at 16 px — a contrast ratio of **2.17:1**. WCAG AA wants 4.5:1 for text this size; 3:1 is the floor even for large text. The typed text in the same box is 10.2:1, so the placeholder is the outlier, not the theme. Shot: `audit/r2/shots/web-desktop/dark/en/probe-lightbox.png` (composer at the bottom), any DM shot.
- Impact: the placeholder is the only thing that says which channel or person you are about to message. On a phone in daylight, and for anyone with reduced contrast sensitivity, it is not readable — and it is the label for the app's single most-used control.
- Fix: raise the placeholder to at least `--text-muted` (the timestamp colour measures 5.6:1 and still reads as secondary). Check the same token in light, ash and onyx.
- Effort: S
- Status: open

### UX-015 · P2 · ux · The image lightbox's toolbar is a 19 px-tall strip lying on top of the composer, and it never says which file you are looking at
- Where: `web/src/components/chat/` (the image lightbox / viewer), measured live
- What: open any image in a DM. The viewer's controls — `Zoom out`, `100%`, `Zoom in`, `Open original`, `Download` — are laid out at y=733 in a 768 px window, each **19 px tall**, i.e. in the bottom 35 px of the screen, directly over the composer (whose top edge is y=711) and level with the Mute / Deafen / User Settings buttons of the user panel. They are plain text with no button chrome, no background plate and nothing separating them from the page behind. The file name (`screenshot.png`) is not shown anywhere in the viewer, and there is no next/previous when a message has several images. Shots: `audit/r2/shots/web-desktop/dark/en/image-lightbox.png`, `audit/r2/shots/web-desktop/dark/en/probe-lightbox.png`.
- Impact: the controls are hard to hit (19 px), hard to read (text on whatever the message list happens to be showing) and ambiguous — "Download" over the composer looks like part of the composer. Anyone who overshoots by 25 px lands in the message box instead.
- Fix: put the controls in a toolbar with its own surface at the top of the overlay (the file name and sender on the left, zoom/original/download on the right, close at the far right), make each control a 36–44 px button, and keep at least 24 px between the overlay's chrome and the window edge. Add the file name and left/right navigation between a message's images.
- Effort: M
- Status: open

### UX-016 · P2 · ux · Adding a role to a member is a 19×22 px "+", and the moderation icons are 30×30
- Where: `web/src/components/settings/` server-settings Members page (role chips and the moderation row)
- What: measured live on Server Settings ▸ Members: the "+" that adds a role to a member is **19×22 px**; `Edit roles`, `Timeout`, `Kick` and `Ban` are **30×30 px** each. The four moderation actions are icon-only, sit in a row at the right edge of the member row with 4 px between them, and the destructive one (Ban) is the last of four identical-sized grey circles. Shot: `audit/r2/shots/web-desktop/dark/en/probe-server-members.png`, `server-settings-members.png`.
- Impact: 19 px is below any pointer-target guidance (the WCAG 2.2 minimum is 24×24 even for a mouse) and nowhere near the 44 px a phone needs; the same page is reachable on the phone viewport. Ban sitting 4 px from Kick, both unlabeled, is how people ban the wrong member.
- Fix: 32 px minimum with 8 px gaps for the icon actions and 24 px for the role "+" (all of them at least 44 px in the phone layout); separate Ban from the others or move it into an overflow menu; label the icons with text on wide viewports.
- Effort: S
- Status: open

### UX-017 · P1 · bug · On a phone, a DM's header shows no name at all — the encryption badge squeezes it out
- Where: `web/src/components/chat/ChatView.tsx` (the DM header), `web/src/components/shell/Panes.module.css` (`_main_…`)
- What: open a DM at 390×844. The header reads: ☰ · `@` · `Same key as before` · 📞 · 📹 · 🔍. **The other person's name is not there.** Measured: the header's inner row wants 435 px in a 390 px viewport and is `overflow: hidden`, so the name — the one element that is allowed to shrink — is clipped to nothing while the "Same key as before" pill keeps its full width. The only place the name survives is the composer placeholder, which is itself truncated ("Message @Alic…"). Shot: `audit/r2/shots/web-phone/dark/en/dm.png`.
- Impact: the owner's daily client is the iPhone home-screen app. In a DM there, the header does not say who you are talking to; with two conversations open you cannot tell them apart without scrolling the messages. Sending a message to the wrong person is one tap away.
- Fix: the name is the header's most important element and must be the last thing to shrink: give it `flex: 1; min-width: 0` with an ellipsis, and let the key badge collapse to its icon (it is already a button — "Show the safety number") below ~420 px. The same header on the server side shows `# general` correctly, so only the DM variant is affected.
- Effort: S
- Status: open

### UX-018 · P1 · ux · On a phone the Friends tab row scrolls sideways with no cue, so "Add Friend" — the only way to get started — is off-screen
- Where: `web/src/pages/FriendsPage.tsx` header, `web/src/pages/Friends.module.css` (`_header_…`, `overflow-x: auto`)
- What: at 390 px the Friends header is `☰ Friends | Online All Pending B…` — measured 564 px of content in a 390 px strip, `overflow-x: auto`, no fade, no arrow, no scrollbar (macOS/iOS hide it). "Blocked" is cut mid-word and **"Add Friend" is entirely past the right edge**. A brand-new account lands on this screen (UX-003), where the page body says "Nobody is online right now." and the one action that fixes that is invisible. Shot: `audit/r2/shots/web-phone/dark/en/friends.png`.
- Impact: a new user on a phone has no visible way to add their first friend. They can find it only by guessing that the tab row scrolls.
- Fix: make "Add Friend" a fixed element of the header (or a FAB) that never scrolls, and give the tab strip a gradient fade at the edge so it is visibly scrollable — or drop to icons-plus-count under 430 px. Pair with UX-003's first-run card.
- Effort: S
- Status: open

### UX-019 · P1 · a11y · Nearly every control in the phone layout is under the 44 px touch minimum, including the four message actions at 26×24
- Where: measured live at 390×844 with `walk.py`'s `small_targets()`; `web/src/components/chat/MessageItem.module.css` (the action bar), `web/src/components/composer/Composer.module.css`, `web/src/components/chat/ChatView.module.css` (header), `web/src/components/sidebar/*.module.css`, `web/src/pages/Friends.module.css`, `web/src/pages/Auth.module.css`
- What: with `is_mobile` and touch on, the measured sizes are
  - message action bar: `Add Reaction` **26×24**, `Edit Message` 26×24, `Reply` 26×24, `More` 26×24
  - DM header: `Start Voice Call` **32×32**, `Start Video Call` 32×32, `Search messages` 32×32, `Show the safety number` 147×**22**
  - composer: `Select emoji` **36×36**, `Send message` 36×36, the textarea itself 250×**22**
  - attachment card: `Download` **20×20**
  - drawer: `Create DM` **20×20**, `Mute`/`Deafen`/`User Settings` 32×32, a DM row 126×40
  - Friends tabs: `Online` 66×**28**, `All` 35×28, `Pending` 79×28
  - login: both inputs 294×**40**, `Forgot your password?` 294×**19**, `Register` 54×19
  - channel rows in the drawer: 242×**34**
  Apple's HIG and the WCAG 2.5.8 minimum are both 44 px (Android's is 48 dp); nothing in this list reaches it, and the four most-used actions in the product are the smallest.
- Impact: this is the layout the owner uses every day on an iPhone. Reacting to a message means hitting a 26×24 target 4 px from "Edit" and 4 px from "More"; the 20×20 `Download` on an attachment is smaller than a fingertip's contact patch. Mis-taps that edit or delete instead of reacting are inevitable.
- Fix: a touch pass over the phone breakpoints: 44 px minimum box for every interactive element (pad rather than grow the icon), 8 px between adjacent actions, and the message action bar replaced by a bottom sheet on touch (the long-press menu already exists and is well sized — see `message-actions.png`). Add a lint/test: the walkthrough's `small_targets()` can run in CI against the phone viewport.
- Effort: L
- Status: open

### UX-020 · P2 · ux · The settings close button sits on top of the settings tab strip on a phone, and the strip scrolls under it
- Where: `web/src/components/settings/SettingsModal.tsx`, `Settings.module.css` (`_navWrap_…`)
- What: at 390 px the settings nav becomes a horizontal strip **1,214 px wide** inside a 390 px window (14 destinations), and the round ✕ is positioned over its right end. "Privacy & Safety" runs underneath the ✕ and the next label is clipped to "u…". Scrolling the strip moves labels under the button; there is no fade or divider marking the button's area as reserved. Shot: `audit/r2/shots/web-phone/dark/en/settings.png`.
- Impact: the tab you want is often the one under the close button, so you tap Close instead of the tab. Fourteen destinations in a blind horizontal strip is also a poor phone pattern in itself.
- Fix: reserve the ✕'s width (give the strip `padding-inline-end` equal to the button plus a gap, and a fade under it), or — better on a phone — make settings a list page that pushes a detail view, with a back arrow, as the Android app does.
- Effort: M
- Status: open

### UX-021 · P2 · a11y · A screen reader announces the login password box as "Password * Forgot your password?"
- Where: `web/src/pages/LoginPage.tsx:146-149`, `web/src/components/common/TextInput.tsx:16-40` (`Field`)
- What: the "Forgot your password?" link is rendered inside the password `Field`, which is a `<label>`. `Field` only moves the caption onto the input (`aria-labelledby`) when the field has exactly one child, so with two children the implicit `<label>` wrapping applies instead and the link's text becomes part of the input's name. Playwright's accessibility snapshot of `/login`: `textbox "Password * Forgot your password?"` (the username box next to it is correctly `textbox "Username *"`).
- Impact: a screen-reader user hears a question in the middle of the field name; the link is also announced twice (once as part of the name, once as the link).
- Fix: move the link out of the `Field` (below it, as a sibling), or have `Field` always set `aria-labelledby` from the caption when any nameable input is among its children.
- Effort: S
- Status: open

### UX-022 · P2 · ux · The message toolbar's overflow button tells a phone user to "hold Shift"
- Where: `web/src/components/chat/MessageItem.tsx` (the action bar's More button), `web/src/i18n/locales/en.json`
- What: the message action bar's fourth button has the accessible name **"More (hold Shift for all actions)"**, measured on the 390×844 touch viewport. There is no Shift key on a phone, and the toolbar is reachable there.
- Impact: the one label meant to explain the hidden actions explains a keyboard the reader does not have; a screen-reader user on a phone hears an instruction they cannot follow.
- Fix: keep the hint only when a fine pointer and a keyboard are present (`matchMedia("(hover: hover) and (pointer: fine)")`), and on touch call it "More actions".
- Effort: S
- Status: open

### UX-023 · P3 · ux · Search results print the raw markdown of the message
- Where: `web/src/components/chat/SearchPanel.tsx` (the result row)
- What: searching `heading` in `#general` returns two rows rendered as literal source: `## A smaller heading` and `# A heading`, with only the query token highlighted. The same messages render as headings in the channel. Shot: `audit/r2/shots/web-phone/dark/en/search-results.png`.
- Impact: results look like a different message than the one you will jump to, and `#`, `*`, `>` and link syntax eat the width of the preview on a phone.
- Fix: render the result through the normal markdown renderer in a one-line "inline" mode (no block spacing, no headings' font size), keeping the highlight — Discord and Slack both do this. Alternatively strip the markup for the preview; showing it raw is the one option that is wrong either way.
- Effort: M
- Status: open

### UX-024 · P1 · i18n · In Arabic every Latin message is laid out right-to-left: `dir="auto"` appears nowhere in the web client
- Where: `web/src/components/chat/MessageItem.tsx` (the message body), `web/src/styles/markdown.css` — `grep -rn 'dir="auto"' web/src` returns **0 hits**; only `.md-inline-code`, `.md-codeblock` (`direction: ltr; unicode-bidi: isolate`) and `.md-mention` (`unicode-bidi: plaintext`) are protected.
- What: with the UI in Arabic (`ar-EG`), open `#general` and read the seeded English messages. They inherit the page's `rtl`, so:
  - every English paragraph is flush right and wraps from the right — "Smaller still", "small subtext under everything", "a link to https://example.com and one that is named";
  - a sentence with an Arabic-rendered date inside it comes out reordered: the seed's `<t:…> is a timestamp and <t:…:R> is a relative one` renders as `is a الخميس، 17 سبتمبر 2026 في 6:53 م timestamp and` / `is a relative one أمس` — the date has moved into the middle of the clause;
  - a spoiler followed by text renders with the spoiler bar on the left and "and text after it" on the right, i.e. in the opposite order to the one it was written in.
  Shot: `audit/r2/shots/web-phone/dark/ar/server-channel.png`, `audit/r2/shots/web-phone/dark/ar/dm.png`.
- Impact: an Arabic-speaking user's English messages (links, code fragments, names, anything pasted) are unreadable in the order they were written, and an English speaker who switches the UI to Arabic sees their whole history reflow. The reverse case — an Arabic message in an English UI — has the same defect with the sides swapped.
- Fix: put `dir="auto"` on the element that holds a message's text (and on channel topics, profile "about" text, status text, embed titles and descriptions, and search-result previews). `dir="auto"` uses the first strong character, which is exactly the rule wanted here. Android has the same question — check `TextView`'s `textDirection="firstStrong"` in the Android pass.
- Effort: M
- Status: open

### UX-025 · P2 · i18n · In Arabic the composer's placeholder shows `general#` and `Alice@` — the sigil lands on the wrong side of the name
- Where: `web/src/components/composer/Composer.tsx` (the placeholder built from `t(...)` plus the channel or user name), `web/src/i18n/locales/ar.json`
- What: in `#general` the placeholder renders as `ارسل رسالة الى general#`, and in a DM as `ارسل رسالة الى Alice@`. The `#`/`@` is a bidi-neutral character sitting between the Arabic sentence and the Latin name, so it resolves to the surrounding right-to-left run and is drawn after the name instead of before it. Shots: `audit/r2/shots/web-phone/dark/ar/server-channel.png`, `audit/r2/shots/web-phone/dark/ar/dm.png` (composer).
- Impact: `#general` and `@Alice` are identifiers; printed as `general#` and `Alice@` they are wrong, and a user copying the handle out of the hint copies it wrongly.
- Fix: wrap the interpolated `#name` / `@name` in a span with `unicode-bidi: isolate` (or `dir="auto"`), the way `.md-mention` already does with `unicode-bidi: plaintext`. Check every other place a name is interpolated into a sentence — the invite modal, "X added Y", toasts.
- Effort: S
- Status: open

### UX-026 · P2 · ux · The phone Friends header and the settings tab strip overflow in Arabic too, cutting off "Add Friend" and hiding a tab under the close button
- Where: same code as UX-018 and UX-020
- What: recorded here because the mirrored layout does not save them. At 390 px in `ar-EG` the Friends header wants 515 px (`المحظورون` clipped at the left edge, `إضافة صديق` past it) and the settings strip wants 985 px with the ✕ over its left end, covering the tab there. Shots: `audit/r2/shots/web-phone/dark/ar/friends.png`, `audit/r2/shots/web-phone/dark/ar/settings.png`.
- Impact: as UX-018/UX-020, and the Arabic labels are longer, so more is lost.
- Fix: as UX-018/UX-020; verify in `ar` and `de` after fixing.
- Effort: S
- Status: open

### UX-027 · P2 · i18n · In German the phone Friends header loses "Ausstehend" and "Freund hinzufügen", and the DM header loses the call, video and search buttons
- Where: same code as UX-017 / UX-018 / UX-020 — `web/src/pages/Friends.module.css` (`_header_…`), `web/src/components/chat/ChatView.tsx` (DM header), `web/src/components/settings/Settings.module.css` (`_navWrap_…`)
- What: the walkthrough's German phone pass (390×844, `de-DE`). Friends: `☰ Freunde │ Online  Alle  Ausstehen…` — the third tab is cut mid-word at the right edge and "Freund hinzufügen" is entirely off-screen (English already loses it — UX-018 — but German loses a tab as well). DM: the header is `☰ · @ · Derselbe Schlüssel wie bisher · 📞` and stops there — the name is gone (UX-017) **and so are the video-call and search buttons**, because the German key badge is 26 % wider than the English one. Settings: `Mein Konto │ Profile │ Privatsphäre & Sich…` with the ✕ sitting on the third label. Shots: `audit/r2/shots/web-phone/dark/de/friends.png`, `dm.png`, `settings.png`, `settings-privacy.png`.
- Impact: German is one of the twelve shipped locales. On a phone a German user cannot start a call from a DM at all — the button is not merely small, it is not rendered on screen — and cannot see pending friend requests.
- Fix: the fixes in UX-017 (name takes the space, key badge collapses to its icon under ~420 px), UX-018 (Add Friend pinned out of the scrolling strip) and UX-020 (reserve the ✕'s width). Verify each in `de` and `ar`, which are the longest and the mirrored cases.
- Effort: S
- Status: open

### UX-028 · P1 · ux · Calling someone looks identical to being in a call, and a declined call leaves the caller sitting in an empty one for ever
- Where: `web/src/components/voice/VoiceStatus.tsx` (the "Voice Connected" panel), `web/src/components/voice/VoiceView.tsx` (the stage), `web/src/voice/session.ts:425` (`startCallingTone`), `:106` (`stopCallingTone`, also called from the `call_end` handler at `:939` — it stops the tone and nothing else)
- What: alice opens the DM with bob and presses the phone icon.
  - **Ringing looks like connected.** The left panel immediately reads **"Voice Connected / Bob"** and the stage shows one tile with alice's own avatar and the full control bar. There is no "Calling Bob…", no ringing animation, no "waiting for Bob to answer". The only difference from a real call is that the other tile is absent and the quality chip reads `● …` instead of `● 1 ms`. Shots: `audit/r2/shots/web-desktop/dark/en/dm-call-ringing-2.png` vs `dm-call-connected-2.png`.
  - **A decline is invisible.** Bob presses the red Decline button; the server sends `call_end`, the client calls `stopCallingTone()` — and that is all. Alice's screen does not change: still "Voice Connected", still her own tile, still the hang-up button she has to find and press herself. No toast, no "Bob declined", no auto-leave. Shot: `audit/r2/shots/web-desktop/dark/en/dm-call-declined-caller.png` (taken after bob declined).
  - The ringback tone stops itself after 60 s (`callingTimer`), so after a minute a caller who walked away is in a silent, empty, permanent "call".
- Impact: the single most important piece of feedback in a phone call — "is it ringing, did they pick up, did they say no" — is missing on the caller's side. People will talk into an empty call believing they are connected (the panel says so), and a declined call leaves a live microphone open until someone notices.
- Fix: (a) a distinct ringing state — "Calling Bob…" in the panel and on the stage, the callee's avatar pulsing, the control bar reduced to Cancel; (b) on `call_end` with a decline, show "Bob declined the call" and leave the call automatically; (c) when the tone's 60 s are up with nobody there, leave and show "No answer". Android has the same states to check.
- Effort: M
- Status: open

### UX-029 · P2 · ux · A DM's history says "Alice started a call." and never says whether it was answered, declined, missed or how long it lasted
- Where: the `system_call` message (`internal/api/voice_glue.go:353` inserts it; `web/src/components/chat/MessageItem.tsx` renders it), `web/src/i18n/locales/en.json` ("started a call")
- What: two calls between alice and bob — one answered and hung up after a minute, one declined outright — leave exactly two identical lines in the DM: `📞 Alice started a call. Today at 2:35 AM` and `📞 Alice started a call. Today at 2:40 AM`. Nothing marks the declined one, nothing says the first one ended, nothing gives a duration, and a call that was never answered is indistinguishable from one that lasted an hour. Shot: `audit/r2/shots/web-desktop/dark/en/dm-after-call-2.png`.
- Impact: the call log is the DM timeline, and it cannot answer "did I miss a call from you?" — the question it exists to answer. Someone who was away sees "Alice started a call" and cannot tell whether Alice is still waiting in it right now.
- Fix: update the system message when the call ends (as the server already knows: it emits `call_end` with a reason) — "Call ended · 4 min", "Missed call from Alice", "Alice declined the call" — and make a missed call a row the recipient can press to call back. Android and desktop render the same message type, so this is one server-side change plus three renderers.
- Effort: M
- Status: open

### UX-030 · P3 · design · In "Invite guests to this call" the destructive "Revoke All Guest Links" is the biggest, brightest control in the dialog
- Where: `web/src/components/voice/GuestLinkModal.tsx`
- What: the modal's controls are, by visual weight: a full-width red **Revoke All Guest Links** (448×38) at the bottom, then the purple **Copy** (88×38) next to the link, then a plain **New Link** (94×38). The thing a person opened the dialog to do — copy the link — is a third of the width of the one that breaks every link already handed out. There is also no confirmation step on the revoke. Shot: `audit/r2/shots/web-desktop/dark/en/guest-link-modal.png`.
- What would be better: make Copy the primary full-width action (or put the link and Copy in one prominent row), and demote Revoke to a small text button — "Revoke all links" — in the dialog's footer, with a confirm ("Everyone you sent a link to will be locked out. Continue?"). The rest of this modal is the best-written screen in the product: the sentence about the key after `#` is exactly right.
- Effort: S
- Status: open

### UX-031 · P2 · bug · Typing two different passcodes says "Something went wrong." — the sentence that explains it is written, translated, and thrown away
- Where: `web/src/components/settings/SecurityPage.tsx:143` (`throw new Error(t("settings.security.thoseTwoPasscodesAreDifferent"))`), `:88-98` (`run()` → `describeError(err, t("modals.confirm.somethingWentWrong"))`), `web/src/lib/errors.ts:73-81`
- What: Settings ▸ Security ▸ App lock ▸ Set a passcode; type `1234` and `1235`; press "Turn it on". The dialog shows a red box reading **"Something went wrong."** The correct sentence — "Those two passcodes are different." — exists in the catalogue and is thrown, but `describeError` deliberately drops the message of a plain `Error` ("its message is written for a developer") and uses the caller's fallback instead. The same happens to `passcodeProblem()`'s three messages ("Use at least 4 characters.", "That is too long.", "Pick something less guessable than one repeated character."), so a 2-character passcode also reports "Something went wrong." Shot: `audit/r2/shots/web-desktop/dark/en/passcode-mismatch-after-save.png`.
- Impact: a form that refuses what you typed and will not say why. A person retyping the same mismatched pair repeatedly has no way to work out what is wrong — and this is the dialog that sets up the app's lock screen.
- Impact is wider than this one screen: `grep -rn 'throw new Error(t(' web/src` finds 17 call sites (`auth.ts:205,234,264`, `AccountPage.tsx:59`, `attachments.ts:189,302,310,331`, `download.ts:188,207`, `guestLink.ts:34`, `imageActions.ts:87,125`, `appLock.ts:166,236`, `InvitePage.tsx:103`) — every one is a sentence written for a reader that `describeError` will replace wherever a fallback is passed.
- Fix: mark reader-facing errors so they survive — a small `UserError extends Error` that `describeError` returns verbatim (the file already does exactly this for `WeakKdfError`) — and change these 17 throws to use it. Cheapest partial fix: validate the passcode pair inline in the dialog instead of throwing. **[web-core]** owns `lib/errors.ts`.
- Effort: M
- Status: open

### UX-032 · P2 · i18n · Four explanatory paragraphs are hard-coded English and stay English in all twelve languages — one of them is the App lock explanation, and it contradicts the row beneath it
- Where: `web/src/components/settings/SecurityPage.tsx:232-234`, `web/src/components/settings/AdminPage.tsx:293`, `web/src/components/server/pages/EncryptionPage.tsx:80`, `web/src/pages/GuestCallPage.tsx:293`
- What: these four `<p>`s carry literal English instead of `t(...)`. Visible proof: Settings ▸ Sicherheit in German shows every heading, row and button translated and then, under **App-Sperre**, the whole paragraph in English — *"A passcode for this device. While it is on, your keys are stored wrapped by the passcode… Ten wrong tries wipe the wrapped copy, and your account password gets you back in."* Shot: `audit/r2/shots/web-phone/dark/de/settings-security.png`.
- And that paragraph disagrees with the row directly under it. The paragraph says the passcode is "for **this device**" and the Set-a-passcode dialog repeats "It never leaves **this device**, so nobody, including this server, can reset it for you"; but once it is on, the row reads **"Passcode is on for this account"** / "**Every device you sign in on** asks for it, on each reload and whenever the app locks." A person cannot tell from this page whether turning it on locks one browser or every client they own. Shots: `audit/r2/shots/web-desktop/dark/en/settings-security-top.png`, `passcode-set.png`.
- Impact: a security control whose blurb is untranslated for everyone outside English and whose two sentences describe two different features. (The truth appears to be: the policy is stored on the account, the wrapped key is per device — say exactly that.)
- Fix: move the four paragraphs into `en.json` (and run `tools/i18n_keys_used.py`), and rewrite the App lock copy as one consistent statement. **[i18n-copy]** may want the catalogue half.
- Effort: S
- Status: open

### UX-033 · P2 · ux · Your own safety number is shown as six unlabeled groups of digits with no caption, no copy button and nothing saying what to do with it
- Where: `web/src/components/settings/EncryptionSection.tsx:58-60` (`<SafetyNumber publicKey={myKey} qr={false} />` with no heading of its own), `web/src/components/profile/KeyVerify.tsx`
- What: Settings ▸ Security ▸ Encryption keys. The paragraph explains *other people's* keys ("Every message is sealed to the other person's key… This device remembers the key it first saw for each person and refuses to seal anything to a different one until you say it is really them."). Directly under it, a grey box contains `11271 97738 07940 / 27518 47132 23626` — nothing labels it, nothing says it is **your** number, there is no Copy, no QR (the component is called with `qr={false}`), and no sentence about comparing it with a friend. Shot: `audit/r2/shots/web-desktop/dark/en/settings-security-top.png`.
- Impact: this is the one screen where a privacy-minded person checks their own identity, and the number is an orphan. Read in sequence with the paragraph above it, it looks like it might be somebody else's key. Signal, the obvious comparison, titles it, explains the comparison in one line, offers a QR and a "mark as verified".
- Fix: give it a caption ("Your safety number") and one sentence ("Read these digits to a friend over a call, or show them the QR; if they match, nobody is in between."), a Copy button and the QR that `SafetyNumber` can already draw.
- Effort: S
- Status: open

### UX-034 · P1 · bug · Losing the network leaves the app looking perfectly healthy for about half a minute: the "Disconnected" banner waits for a 25-second heartbeat, and `navigator.onLine` is never used
- Where: `web/src/gateway/client.ts:305` (`const interval = this.opts.heartbeatMs ?? 25_000` — the only thing that notices a silently dead socket), `web/src/components/shell/AppShell.tsx:205` (the banner)
- What: measured live with Playwright's `context.set_offline(True)` while `#general` was open. Screenshots at 3 s, 10 s and 25 s: at **3 s and at 10 s the app is indistinguishable from a working one** — full channel list, composer ready, no banner, everything looks live; the only change anywhere on screen is that the other person slid into the member list's OFFLINE group. The banner "Disconnected — reconnecting…" appears only between 10 s and 25 s, when the unanswered heartbeat drops the socket. Shots: `audit/r2/shots/web-desktop/dark/en/offline-after-3s.png`, `offline-after-10s.png`, `offline-after-25s.png`.
- `grep -rn "navigator.onLine" web/src` returns nothing, and no `online`/`offline` window listener exists, so the browser's own instant signal that the network has gone is ignored.
- Impact: on a phone that loses signal — a lift, a tunnel, the Tube, the owner's daily use — the app claims for up to half a minute that everything is fine. Messages arriving in that window never show, and the person has no reason to doubt what they are looking at. (Sending is handled well: a failed message goes red with Retry/Delete — `offline-message-sent.png` — so only *receiving* fails silently.)
- Fix: (a) listen for `window.offline`/`online` and flip the banner immediately (and force a reconnect attempt on `online`); (b) drop the heartbeat to ~10 s, or send one immediately when the tab becomes visible; (c) while disconnected, say so on the composer too ("you are offline — this will send when you are back") rather than only at the top of the page. Android and desktop should be checked for the same latency.
- Effort: M
- Status: open

### UX-035 · P2 · i18n · A group DM's header says "3 members" in English in every language, never pluralises, and disagrees with the sidebar's "3 Members" one inch away
- Where: `web/src/components/chat/ChatView.tsx:207` — `<span className={s.hSub}>{channel.recipient_ids.length} members</span>`, a literal; the sidebar uses the catalogue's `chat.groupMemberList.membersOnly` ("{count} Member" / "{count} Members"), and the member panel uses `chat.groupMemberList.membersCount` ("Members — {count}")
- What: open the group DM "Weekend plans". The sidebar row reads `Weekend plans / 3 Members`; six inches to the right the header reads `Weekend plans   3 members`. The header string is not in the catalogue at all, so it stays English in German, Arabic and the other nine locales, and a group that drops to one other person reads "1 members". Shot: `audit/r2/shots/web-desktop/dark/en/group-dm-sent.png`.
- Impact: small on its own, but it is the title of the conversation, it is wrong in eleven languages, and the same number is capitalised two different ways in one screen.
- Fix: use `chat.groupMemberList.membersOnly` in the header (one word change), and settle on one capitalisation for the count across the sidebar, header and member panel. The same file's `AppShell.tsx:205` has the same problem: "Connecting…" and "Disconnected — reconnecting…" are also literals (see UX-032).
- Effort: S
- Status: open
