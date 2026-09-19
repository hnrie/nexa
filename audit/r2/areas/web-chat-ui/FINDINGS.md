# Findings — web-chat-ui

(Summary is written at the top when the audit is done.)

---

### WCHAT-001 · P2 · i18n · RTL: the presence dot moves to the left but the ring cut out of the avatar stays bottom-right (round 1 BROKEN, not fixed)
- Where: `web/src/components/common/Avatar.module.css:6-7` (`.cut` mask at `calc(100% - var(--dot) / 2)`), `:9` (`.status { inset-inline-end: 0 }`)
- What: The dot is positioned logically and flips to the left edge under `dir="rtl"`; the mask that cuts the transparent ring is a physical `circle at calc(100% - …)`. No `[dir="rtl"]` override exists anywhere (`grep -rn 'dir="rtl"' web/src` finds only MemberList, Panes, AppShell, Toggle). Round 1 listed this among the RTL BROKEN set; the 38 RTL fixes did not include it.
- Impact: In Arabic every avatar in the app has a phantom bite out of its bottom-right corner, and the status dot on the left sits flat on the picture with no ring, losing the shape that makes it legible on a photo.
- Fix: set `--dot-x: calc(100% - var(--dot) / 2)` in `.cut` and `--dot-x: calc(var(--dot) / 2)` under `[dir="rtl"] .cut`; use `circle at var(--dot-x) calc(100% - var(--dot) / 2)`.
- Effort: S
- Status: open

### WCHAT-002 · P2 · a11y · A hovered context-menu row is still white on the accent, not `--on-brand` (round 1 BROKEN, half-fixed)
- Where: `web/src/components/common/ContextMenu.module.css:4` (`.item:hover:not(:disabled) { background: var(--brand); color: #fff }`), `web/src/lib/theme.ts:71` (computes `--on-brand`)
- What: Round 1's accent fix made `lib/theme.ts` derive a readable `--on-brand` for any chosen accent, and `Button.module.css:7` uses it. The context menu — the one surface every message, channel and member action goes through — still hardcodes `#fff`. Every other `color: #fff` in scope sits on a black or `--danger` fill and is fine.
- Impact: Pick the shipped `#fdb833` preset: every hovered menu row is white on yellow at 1.8:1. `#1abc9c` 2.3:1, `#3d9e60` 3.0:1. The user cannot connect the unreadable menu to the colour they picked in Appearance.
- Fix: `color: var(--on-brand)`. Give a keyboard-focused row the same fill (`.item:focus-visible`), which today only gets the outline ring.
- Effort: S
- Status: open

### WCHAT-003 · P2 · i18n · English survives in seven strings in scope, three of them on controls a screen reader names by them
- Where: `web/src/components/chat/AudioPlayer.tsx:175-176` ("Unmute"/"Mute", tooltip and `aria-label`); `web/src/components/chat/VideoPlayer.tsx:330` ("Pause"/"Play"), `:334` ("Unmute"/"Mute"); `web/src/components/chat/MemberList.tsx:177` ("You"); `web/src/components/composer/Autocomplete.tsx:27` ("Members"/"Emoji"/"Commands" heading); `web/src/components/common/IconPicker.tsx:62` ("Change"/"Upload" overlay); `web/src/components/common/Spinner.tsx:3` (`label = "Loading"`, the accessible name of every unlabelled spinner)
- What: Literal strings that never reach `t()`, after `a1311ed` ("every word in the app, in all eleven languages"). Round 1 named the icon picker overlay and the spinner label explicitly; both are still there.
- Impact: An Arabic or Finnish user sees "Change" over their avatar, "Members" over the mention popup, and hears "Mute, button" in English on every voice note and video. `tools/i18n_keys_used.py` cannot catch these because no key is asked for.
- Fix: keys under `chat.audio.*`, `chat.video.*`, `chat.memberList.you`, `composer.autocomplete.*`, `common.iconPicker.*`, `common.loading`; the player labels should be one pair shared by both players.
- Effort: S
- Status: open

### WCHAT-004 · P2 · bug · A long status scrolls the wrong way in Arabic: the marquee slides into empty space
- Where: `web/src/components/common/ScrollingText.tsx:70` (`--shift: -${over}px`), `web/src/components/common/ScrollingText.module.css:8-10` (`translateX(var(--shift))`)
- What: The overflow is measured direction-agnostically (`scrollWidth - clientWidth`) but the travel is always negative X. In an RTL box the text starts at the right edge and its hidden part hangs off the *left*, so translating left moves the visible words out of the box and reveals nothing — then they come back. Only the `mask-image` fade (`:6`, `to right`) is roughly symmetric.
- Impact: Every custom status, activity line and anything else that uses `ScrollingText` (activity `StatusLine`, the DM sidebar) is unreadable past its first few words for an Arabic user — the exact case the component exists for.
- Fix: `[dir="rtl"] .inner[data-scrolling] { --dir: -1 }` and `transform: translateX(calc(var(--shift) * var(--dir, 1)))`; or measure with `getComputedStyle(outer).direction` and flip the sign in JS.
- Effort: S
- Status: open

### WCHAT-005 · P2 · a11y · The green "positive" button is white on green at 3.4:1 — that is every "Save changes" bar
- Where: `web/src/components/common/Button.module.css:14` (`.positive { background: var(--positive); color: #fff }`), `web/src/styles/tokens.css:37` (`--positive: #3d9e60`), `:126` (light `#269153`); used by `web/src/components/server/SettingsLayer.tsx:65` (every server-settings save bar), `web/src/components/settings/ProfilePage.tsx:181`, `web/src/components/chat/Embeds.tsx:257` (invite "Join")
- What: Computed: white on `#3d9e60` is **3.36:1** (dark), on `#269153` **3.99:1** (light); 14px/500 text needs 4.5:1. Discord's green (`#248046`) is 4.9:1 for exactly this reason. `.danger` on `--danger` dark is 4.42:1 — a hair under, worth fixing in the same pass.
- Impact: The most consequential button in settings ("Save changes", under the SaveBar's "Careful, you have unsaved changes") is the least legible one in the app for anyone with low contrast sensitivity, in both themes.
- Fix: darken `--positive` to about `#248046` (dark) / `#1f7a45` (light) — `--positive-hover` already is `#2f7f4c`/`#1f7a45`, so swapping fill and hover is nearly enough; or give the variant a `color: var(--on-positive)` computed like `--on-brand`. The online dot uses `--status-online` (`tokens.css:42`), so it does not darken with it.
- Effort: S
- Status: open

### WCHAT-006 · P3 · ux · Tapping the lightbox backdrop now waits 350 ms before closing
- Where: `web/src/components/common/ZoomPan.tsx:179-189`, wired at `web/src/components/chat/Attachments.tsx` (`onIdleClick={onClose}`)
- What: Round 1's "double-click never zooms" fix defers the idle click by `DOUBLE_TAP_MS` so a second click can arrive. The deferral applies to every click, including one on the backdrop outside the picture, where a double click has no meaning.
- Impact: Closing a picture by tapping beside it takes a third of a second to respond, which reads as a missed tap; on a phone people tap twice, and the second tap lands on whatever is behind the viewer once it closes.
- Fix: close at once when `e.target` is not inside the zoomed child (`ref.current.firstElementChild.contains(e.target)`), and only defer clicks on the picture itself.
- Effort: S
- Status: open

### WCHAT-007 · P3 · a11y · The cropper's crop position is still drag-only (round 1 BAD, still open)
- Where: `web/src/components/common/ImageCropModal.tsx:86-97`, `:152-161`; hint at `:185`
- What: Zoom is a keyboard-operable `<input type="range">` and Reset is a button, but the offset — which part of the picture ends up in the avatar — can only be moved by pointer drag. The frame has no `tabIndex`, `role` or `onKeyDown`. Pinch is not handled either (`touch-action: none`, one pointer tracked), so on a phone zoom is only the slider.
- Impact: A keyboard or switch user can only ever crop the centre of a picture; a phone user cannot pinch the way every gallery app lets them.
- Fix: `tabIndex={0}` + arrow keys moving `offset` by 8 px (Shift: 32 px), `+`/`-` on zoom; a two-pointer branch in `onPointerMove` reusing `lib/zoomPan.pinchView`. Update the hint text to mention the keys.
- Effort: M
- Status: open

### WCHAT-008 · P3 · perf · FloatingPlane still drifts on touch and installs a window `pointermove` per instance (round 1 BAD, half-fixed)
- Where: `web/src/components/common/FloatingPlane.module.css:11` (`animation: drift 9s … infinite`, `will-change: transform`), `:19` (only the reduced-motion rule stops it); `web/src/components/common/FloatingPlane.tsx:24` (JS bails on touch), `:46` (window listener + `getBoundingClientRect` per instance); used only by `web/src/pages/HomePage.tsx`
- What: Round 1 added the touch bail-out in JS; the CSS animation was never guarded, so the doc comment "Nothing moves on a touch screen" is still untrue. Each of the front page's instances also adds its own window-level move listener that forces a layout read per frame.
- Impact: On a phone the front page's screenshots bob forever behind permanent GPU layers; on a desktop, moving the mouse costs one forced layout per instance per frame.
- Fix: `@media (hover: none) { .plane { animation: none; will-change: auto } }`; one shared `pointermove` subscription (or `pointerenter/leave` on `.stage`).
- Effort: S
- Status: open

### WCHAT-009 · P3 · ux · The icon picker's remove button is 24 px, anchored with physical `right`, and never grows on touch
- Where: `web/src/components/common/IconPicker.module.css:13` (`top: -2px; right: -2px; width: 24px; height: 24px`)
- What: Round 1 flagged both. Still physical (in RTL the X sits on the trailing corner of the circle instead of the leading one — cosmetic) and still 24 px with no `@media (pointer: coarse)` bump, unlike `Modal.module.css:19`.
- Impact: Removing a server icon or group icon on a phone is a 24 px target overlapping an 80 px button that opens the file picker; a miss opens the OS file chooser.
- Fix: `inset-inline-end: -2px`; `@media (pointer: coarse) { .remove { width: 32px; height: 32px } }`.
- Effort: S
- Status: open

### WCHAT-010 · P3 · code · `:focus-visible` still changes the focused element's own `border-radius` (round 1 POLISH, still open)
- Where: `web/src/styles/base.css:23`
- What: `border-radius` in the focus rule reshapes the element, not the outline; modern outlines already follow the element's radius. Whether a circular button (`.lbClose`, the rail, avatars) turns into a rounded square on focus depends on CSS injection order against its own `border-radius: 50%` at equal specificity.
- Impact: Visible corner-shape flicker on focus for anything whose module rule loses the order; harmless otherwise.
- Fix: delete the `border-radius` declaration.
- Effort: S
- Status: open

### WCHAT-011 · P3 · a11y · Focused inputs draw two rings (round 1 POLISH, still open)
- Where: `web/src/components/common/TextInput.module.css:9` (`.input:focus { border-color: var(--brand) }`) with `web/src/styles/base.css:23`
- What: The border turns accent on `:focus` and the global `:focus-visible` outline draws a second ring 2 px outside it (`outline: none` at `:7` loses to the later `:focus-visible` rule).
- Impact: Every text field shows a double ring on keyboard focus and a single border on mouse focus — two focus looks for one control.
- Fix: keep the border change and add `.input:focus-visible { outline: none }`, or drop the border change.
- Effort: S
- Status: open

### WCHAT-012 · P3 · ux · `Toggle`'s text column has no `min-width: 0`, and the description is not linked to the switch (round 1 POLISH, still open)
- Where: `web/src/components/common/Toggle.module.css:3`; `web/src/components/common/Toggle.tsx:19`, `:23`
- What: `.text { display: flex; flex-direction: column }` inside a `space-between` row without `min-width: 0` or `overflow-wrap`; a long compound (German, Finnish) pushes the 40 px switch off the row at 380 px. The `description` span has no `id`, so the switch's `aria-describedby` is never set — a screen reader hears the label only.
- Fix: `min-width: 0; overflow-wrap: anywhere` on `.text`; `useId()` on the description and `aria-describedby` on the input.
- Effort: S
- Status: open

### WCHAT-013 · P3 · design · Text selection is always the default purple, whatever accent the person chose
- Where: `web/src/styles/base.css:24` (`::selection { background: rgba(128, 0, 255, 0.45) }`)
- What: Hardcoded to the default brand hue; `lib/theme.ts` recolours `--brand`, `--mention-bg` and the rest but this rule does not read any of them.
- Impact: With a green or orange accent, selecting text in the composer or a message highlights in purple — the one place the old colour survives.
- Fix: `::selection { background: var(--mention-bg-hover) }` (already derived from the accent with a usable alpha, in both themes).
- Effort: S
- Status: open

### WCHAT-014 · P3 · a11y · Placeholder text is 2.7:1 in the dark theme
- Where: `web/src/styles/tokens.css:20` (`--text-placeholder: #6c6d76`), `:8` (`--bg-input: #242429`); light `:115` on `:103` is 3.1:1
- What: Computed 2.67:1 dark, 3.10:1 light. WCAG 1.4.3 does not exempt placeholders. Discord's own placeholder is about 2.9:1, so this matches the reference, but "Message #general" is the most-seen line of text in the product.
- Fix: `#8a8b94` dark (≈4.5:1 on `--bg-input`), `#6c6d76` light (≈4.4:1 on `#ebeced`).
- Effort: S
- Status: open

### WCHAT-015 · P3 · ux · Toasts still vanish after a fixed 5 s with no pause on hover or focus (round 1 BAD, still open)
- Where: `web/src/stores/ui.ts:176` (`setTimeout(…, 5000)`); `web/src/components/common/Toasts.tsx:20`
- What: Round 1 fixed the live region and the hidden severity prefix; the lifetime is unchanged. The whole toast is a `<button>` that dismisses on click, so an explicit close exists, but nothing extends the time while the pointer or focus is on it, and an error ("Couldn't send: …") gets the same 5 s as "Copied".
- Impact: A long error is gone before it is read, especially on a phone where there is no hover to slow it.
- Fix: clear the timer on `pointerenter`/`focusin` of the stack and restart on leave; 8 s for `error`.
- Effort: S
- Status: open

### WCHAT-016 · P3 · design · Tooltip text is centred (round 1 POLISH, still open)
- Where: `web/src/components/common/Tooltip.module.css:6` (`text-align: center` at `max-width: 260px`)
- What: A wrapped two- or three-line tooltip gets a ragged left edge. Discord's are centred too, but Discord's are one line.
- Fix: `text-align: start` (the arrow still points at the trigger via `--arrow`).
- Effort: S
- Status: open

### WCHAT-017 · P1 · a11y · A keyboard user cannot reply to, react to, edit, pin or delete any message: every action lives in a toolbar that only a hover reveals
- Where: `web/src/components/chat/Chat.module.css:89` (`.toolbar { … display: none … }`), `:96` (`.msg[data-menu="true"] .toolbar { display: flex }`), `:99-100` (`@media (hover: hover) { .msg:hover .toolbar { display: flex } }`); `web/src/components/chat/MessageItem.tsx:237-256` (the toolbar), `:163-189` (the row: no `tabIndex`, no `role`); `web/src/components/shell/Shortcuts.tsx:36-112` (the global shortcut list — nothing for a message)
- What: The row's actions are three-to-eight `ToolButton`s inside `.toolbar`, which is `display: none` unless the row is hovered by a real pointer or its menu is already open. `display: none` also removes them from the tab order, so Tab never reaches them; there is no `:focus-within` rule anywhere in the file. The row itself is a plain `div` with an `onContextMenu` handler but no `tabIndex`, so Shift+F10 / the Menu key has nothing to fire on (the one exception: a message that happens to contain a link, whose focused `<a>` lets the `contextmenu` event bubble to the row — and Chromium then reports `clientX/clientY` of 0, opening the menu in the top corner). Touch is covered — `lib/longPress.ts` is installed globally in `main.tsx` and synthesises `contextmenu` — and the mouse is covered. Only the keyboard is not.
- Impact: With a keyboard alone (or a switch, or a screen reader in focus mode) there is no way to reply, react, edit your own message, copy a link, pin, mark unread, start selection or delete. Tab goes from the message list straight to the composer, past every message. This is the core path of the product, and it is the one thing round 1's a11y pass did not catch because the buttons *exist* in the tree at render time.
- Fix: two parts. (1) Make each row focusable and named: `tabIndex={0}` with `role="article"` (or `listitem` inside a `role="list"`), arrow keys moving between rows, and Shift+F10 / `ContextMenu` key calling `openMenu` at the row's own rect rather than `clientX/clientY`. (2) Reveal the toolbar for the focused row: `.msg:focus-within .toolbar, .msg:has(:focus-visible) .toolbar { display: flex }` and keep it out of the hidden state by using `visibility`/`opacity` rather than `display: none` so the buttons stay tabbable, or render it on focus. A `role="toolbar"` also owes arrow-key navigation between its buttons (`MessageItem.tsx:237` declares the role today without it).
- Effort: M
- Status: open

### WCHAT-018 · P1 · a11y · The font-size setting does not change a single word of a message (round 1 BROKEN, still open), and the viewport forbids pinch-zoom
- Where: `web/src/styles/base.css:8` (`html { font-size: calc(16px * var(--font-scale, 1)) }`), `web/src/lib/theme.ts:87` (sets `--font-scale`), `web/src/components/chat/Chat.module.css:75` (`.content { font-size: 16px }`), `:72` (`.author { font-size: 16px }`), `:74`, `:79`, `:84`, and 342 more `font-size: <n>px` declarations across `web/src/components`; `web/index.html:5` (`maximum-scale=1, user-scalable=no`)
- What: The scale only multiplies the root font size, which only moves type sized in `rem`. `grep -c 'font-size: [0-9]*px'` over `web/src/components` is 342; `rem` font sizes exist in exactly one file (`settings/Settings.module.css:65,67` — the Appearance page's own preview, which therefore *does* grow while the chat behind it does not). Round 1 reported this (`audit/web-ui.md:83`) and it appears in neither the "Done" nor the "Not doing" list of `audit/REVIEW.md`; the code is unchanged.
- Impact: A person who cannot read 16px text moves the slider to 1.5×, watches the preview grow, and finds the app identical. Because `user-scalable=no` is also set and enforced in JS (`lib/noZoom.ts`), there is no fallback: pinch-zoom is gone too. On the iPhone home-screen app — the owner's daily client — that leaves no route to larger text anywhere in the product. The same `html` rule also overrides a browser-level default font size a user set for themselves.
- Fix: make the chat's type scale read the setting. Cheapest correct version: `.content`, `.author`, `.time`, `.replyLine`, `.replyText`, `.edited`, `.gutterTime` and `markdown.css`'s `.md-*` sizes become `rem` (or `calc(<n>px * var(--font-scale))`), and `html { font-size: calc(100% * var(--font-scale, 1)) }` so a browser default is respected. Then audit the rest of the app's 342 px sizes in a follow-up; chat first, because that is what the setting is for.
- Effort: M
- Status: open

### WCHAT-019 · P2 · a11y · Nothing announces an arriving message, and the list is a pile of anonymous divs
- Where: `web/src/components/chat/MessageList.tsx:475-505` (no `role`, no `aria-live` on `.listWrap`/`.scroll`/`.inner`), `web/src/components/chat/MessageItem.tsx:163` (`div.msg`); `grep -rn 'aria-live' web/src` finds toasts, the typing bar, the selection count, a few settings hints — nothing in the message list
- What: There is no live region over the message list, so a screen-reader user in a conversation is told nothing when a message arrives; and because no row carries a role or an accessible name, browsing the list reads as an undifferentiated run of text with names and times inline. Discord marks its list `role="list"` with `role="listitem"` rows and an `aria-live="polite"` region for new messages, and names each row "<author>, <time>, <text>".
- Impact: A blind user has to re-read the bottom of the conversation by hand to discover replies, and cannot tell where one message ends and the next begins.
- Fix: `role="log" aria-live="polite" aria-relevant="additions"` on `.inner` (not `.scroll`, so scrolling does not re-announce), `aria-atomic="false"`; `role="listitem"` (or `article`) with `aria-labelledby` pointing at the author + time + body on each row. Keep the announcement to rows added at the bottom — a page of older messages prepended must not be announced, which is one more reason the region belongs on the list and the prepend path should set `aria-live="off"` while it lands.
- Effort: M
- Status: open

### WCHAT-020 · P2 · i18n · No text in the app is `dir="auto"`, so an Arabic message in an English UI (and every English message in the Arabic UI) is laid out in the wrong direction
- Where: `web/src/components/chat/MessageItem.tsx:219` (`<Markdown source={text} …>`), `:202` (author name), `web/src/components/chat/Chat.module.css:75` (`.content`); the same for `.replyText` (`MessageItem.tsx:60`), `.pinText` (`PinsPanel`), search results, and the composer's `<textarea>`. `grep -rn 'dir=' web/src --include='*.tsx'` returns eight hits, all of them `dir="ltr"` on licence text plus one language-picker row: **no `dir="auto"` anywhere in the product**.
- What: Direction is set once on the document from the UI language. A message body inherits it regardless of what it says. Bidi's implicit rules get the *words* right but not the paragraph: an Arabic sentence in an LTR box is right-aligned nowhere, its leading punctuation and any trailing "?" or "!" jump to the wrong end, and a mixed sentence ("مرحبا, see #general") reorders around the Latin run. In the Arabic UI every English message gets the mirror of that.
- Impact: This is the normal case for this product, not an edge case — eleven languages, one shared conversation. Any bilingual channel shows messages with punctuation on the wrong side, and long Arabic text in an English UI wraps ragged-right with the last line flush to the wrong margin.
- Fix: `dir="auto"` on the element that holds user-authored text: the message body, the reply quote's text, the pin preview, a search result's text, the member/author name (a name can be Arabic in an English UI too), the channel topic, the composer's textarea and the edit textarea. It is one attribute per surface and it is what Discord, Telegram and WhatsApp all do.
- Effort: M
- Status: open

### WCHAT-021 · P2 · perf · Two thirds of every message row's DOM is a toolbar nobody is looking at
- Where: `web/src/components/chat/MessageItem.tsx:236-256` (rendered for every non-pending row), `web/src/components/common/Tooltip.tsx:113-138` (each `ToolButton` adds a wrapper `<span>` with six handlers, `useId`, three `useEffect`s, two `useState`s), `web/src/components/chat/Chat.module.css:89` (hidden with `display: none`)
- What: Every row in the list renders its hover toolbar eagerly and hides it in CSS: a `div`, then four `Tooltip` wrappers (add reaction, edit where allowed, reply, more) each contributing a `span`, a `button` and a lucide `svg` with two to four child nodes — about 24 elements and ~40 hook slots per message, against roughly a dozen elements for the message itself. The list is not virtualised (`@tanstack/react-virtual` is a dependency and is never imported — `audit/REVIEW.md`'s "Still open" item 3), so a channel scrolled back through ten pages holds all of it: 1,000 messages ≈ 24,000 invisible elements, ≈ 40,000 hook slots, and a `Tooltip` `useEffect` per button on every commit.
- Impact: Scrolling and every store update in a long channel pay for controls that are visible on exactly one row at a time; on a phone (where `@media (hover: hover)` means the toolbar can *never* show) the cost is paid for nothing at all.
- Fix: render the toolbar only for the row under the pointer or holding focus — one `hoveredId` in `MessageList` (or `onPointerEnter` on the row setting local state) — and skip it entirely when `matchMedia('(hover: none)')`. That is a much smaller change than virtualisation and removes most of what virtualisation would have been saving. It also pairs with WCHAT-017: the toolbar then renders on focus, which is what makes it keyboard-reachable.
- Effort: M
- Status: open

### WCHAT-022 · P2 · bug · A toast raised from the picture viewer is invisible behind it
- Where: `web/src/components/chat/Chat.module.css:179` (`.lightbox { position: fixed; z-index: 200 }`), `web/src/components/common/Toasts.module.css:1` (`.stack { position: fixed; top: 16px; z-index: 200 }`), `web/src/components/chat/Attachments.tsx:125` (`createPortal(… , document.body)`), `web/src/App.tsx:25` (`<Toasts />` inside the app tree)
- What: Equal `z-index` in the same stacking context is decided by document order, and the lightbox is portalled onto `document.body` after the app root that holds the toast stack. So the lightbox paints over the toasts, and its backdrop is `rgba(0, 0, 0, 0.85)`.
- Impact: The viewer's own actions are the ones that raise toasts — "Copy image", "Copy link", a failed save — and their confirmation or error lands underneath the black overlay. The user sees nothing happen. Same for any toast that arrives while a picture is open (a failed send, a copied message link).
- Fix: give the toast stack a layer of its own above every other floating layer (`--z-toast: 300`) and, better, put the layers in `tokens.css` as named steps (menu 40, modal 100, lightbox 200, toast 300) — `grep -rn 'z-index' web/src` currently has bare numbers from 3 to 200 across 30 files with two 200s that collide.
- Effort: S
- Status: open

### WCHAT-023 · P2 · ux · On a phone a message's exact time is unreachable, and grouped messages show no time at all
- Where: `web/src/components/chat/Chat.module.css:227` (`@media (max-width: 767px) { .gutterTime { display: none } }`), `:70` + `:102` (on desktop the gutter clock only appears on hover); `web/src/components/chat/MessageItem.tsx:203` (`<time title={formatFull(…)}>` — the full date is a `title`), `:207` (same for the gutter clock), `:220` (`edited` marker's `title`)
- What: The only absolute time on a row is a `title` attribute, which a touch browser never shows. On a phone the group header's `formatTimestamp` (relative — "Today at 14:03") is the whole story, and for every message after the first in a group there is no time on screen and no gesture that reveals one. Android shows the same relative header (`ui/chat/MessageRow.kt`) so the two clients agree, but both lose the exact instant.
- Impact: "When exactly did they send this?" has no answer on the client the owner uses daily — a normal question when coordinating a call or referring back to something.
- Fix: put the absolute time in the message's context menu (the long-press menu is already there — one more read-only row, e.g. "Sent 18 Sep 2026, 14:03:11"), or make a tap on the group header's `<time>` swap it for the absolute form for a few seconds. Either also gives a keyboard/screen-reader user the time, which `title` does not.
- Effort: S
- Status: open

### WCHAT-024 · P2 · a11y · The author's name, their avatar and the reply quote bar are clickable `div`s and `span`s
- Where: `web/src/components/chat/MessageItem.tsx:198` (`<div className={s.avatar} onClick={…}>`), `:202` (`<span className={s.author} onClick={…}>`), `:57` (`<div className={s.replyLine} onClick={…}>`), `:59` (`<span className={s.replyName} onClick={…}>`); `web/src/components/chat/Chat.module.css:66`, `:72`, `:79` (`cursor: pointer`, no focus styles); same pattern in `Chat.module.css:118` (`.system b { cursor: pointer }`) and `:120` (`.sysLink`)
- What: Five of the most-used affordances in the chat are non-interactive elements with a click handler: no `tabIndex`, no `role`, no accessible name, no keyboard activation, no focus ring.
- Impact: A keyboard user cannot open a profile from a message, and cannot jump to the message a reply answers — the quote bar is the only affordance for that. A screen reader announces the name as plain text, so the user has no idea it does anything.
- Fix: make them `<button>`s (the CSS reset in `base.css` already strips button chrome, which is how the rest of the app does it — `.hNameBtn` in the same file is the pattern) with `aria-label`s like "Open <name>'s profile" and "Go to the message being replied to".
- Effort: S
- Status: open

### WCHAT-025 · P2 · i18n · Nine more English strings in the chat surface, including the DM header's member count and every sticker's accessible name
- Where: `web/src/components/chat/ChatView.tsx:192` (`in {name}` — the subchat header's parent link), `:207` (`{n} members`, also unpluralised), `web/src/components/chat/MessageItem.tsx:277` (`alt={sticker.name ?? "sticker"}`), `:281` (`aria-label={`Sticker: ${name}`}` / `"Sticker"`), `:266` is translated for contrast
- What: Same class as WCHAT-003 but in files the earlier pass had not reached. `{n} members` is additionally a bare concatenation, so no language can pluralise or reorder it; `en.json` already has plural-aware keys elsewhere (`{count, plural, …}` style is used by `chat.typing.*`).
- Impact: An Arabic or Japanese user reading a group DM header sees "5 members" in English, and every sticker is announced as "Sticker: name" in English.
- Fix: `chat.chat.inParent` with a `{name}` placeholder, `chat.chat.memberCount` with a plural form, `chat.messageItem.stickerNamed`/`chat.messageItem.sticker`.
- Effort: S
- Status: open

### WCHAT-026 · P3 · ux · A tapped message row keeps its hover shade until another one is tapped
- Where: `web/src/components/chat/Chat.module.css:53` (`.msg:hover, .msg[data-menu="true"] { background: var(--bg-message-hover) }`), unguarded, next to `:99-103` where the same file *does* guard the toolbar, the gutter clock and the reaction `+` behind `@media (hover: hover)`
- What: iOS and Android keep `:hover` on the last element touched, so the row a person tapped (to open a link, a picture, or after long-pressing for the menu) stays shaded. The file already knows this — the comment at `:97` says so — but the row background itself was left out.
- Impact: A phone shows a message highlighted as if something were selected or unread, until the next tap moves it. Small, and it is on screen constantly.
- Fix: move `:53`'s hover half inside the existing `@media (hover: hover)` block (keep `[data-menu="true"]` unconditional).
- Effort: S
- Status: open

### WCHAT-027 · P3 · ux · Escape in a chat closes search, the pins panel and the subchat list all at once
- Where: `web/src/components/chat/ChatView.tsx:122-136`
- What: One `keydown` listener sets all three panel states to closed, guarded only by "is a modal open". The protocol the rest of the app follows (and WCAG 2.1.2's spirit) is that Escape dismisses the top-most layer.
- Impact: Open the pins panel, then type in search, then press Escape to get the search box back to normal: the pins panel closes too, and a second Escape is needed to notice. Minor but it makes Escape feel unpredictable.
- Fix: close only the last-opened layer — keep a small stack, or check in order (search, then pins, then subchats) and `return` after the first one closed.
- Effort: S
- Status: open

### WCHAT-028 · P1 · perf · Every picture you scroll past stays decrypted in memory for as long as the channel is open, with nothing able to evict it
- Where: `web/src/components/chat/Attachments.tsx:22` (`EAGER_MAX = 2 MB`), `:156` (`useDecrypted(att, att.size <= EAGER_MAX)` — `wanted` starts true, so the `useInView` gate is bypassed entirely), `:52-60` (`acquire()` for as long as the component is mounted); `web/src/lib/mediaCache.ts:15` (`BUDGET = 200 MB`), `:39-48` (`evict` skips every entry with `refs > 0`); `web/src/stores/messages.ts:392` (`loadOlder` appends a page and nothing ever trims `ids`); `web/src/components/chat/MessageList.tsx:492-497` (every loaded message is in the DOM — the list is not virtualised)
- What: Three things compose badly. (1) Any image attachment ≤ 2 MB is downloaded and decrypted the moment its row renders, on or off screen. (2) A mounted attachment holds a `refs` count on its cache entry. (3) Nothing unmounts and nothing trims the message list, so `refs > 0` is true for every image in every page you have scrolled back through. `evict()` then skips all of them, so the 200 MB budget is not a budget at all — it is only a limit on what has *already* been released. Scroll back ten pages in a photo channel and the tab holds every decrypted blob of all 500 messages at once.
- Impact: Memory grows monotonically while a channel is open and is only reclaimed by leaving it. On the iPhone home-screen app — the client the owner uses daily — a photo-heavy channel scrolled back a few screens will be killed and reloaded by iOS, which is indistinguishable from the app crashing; on the desktop app the same channel costs hundreds of MB of resident memory for pictures nobody can see. The eager path also means opening such a channel on a phone downloads and decrypts megabytes the person never looked at.
- Fix: three small independent steps, in order of value. (a) Release the cache reference when a row is far off screen: keep the existing `IntersectionObserver` (`:86-103`) alive after the first hit and drop `acquire` (and the object URL) on a large negative-margin exit; that alone makes the LRU work. (b) Gate the eager path on `useInView` too — `EAGER_MAX` should mean "load without asking once it is near", not "load now". (c) Trim `state.ids` in the store to, say, the newest 400 loaded around the reading position (this is also most of the benefit virtualisation would have given — `audit/REVIEW.md` "Still open" 3).
- Effort: M
- Status: open

### WCHAT-029 · P2 · a11y · A picture in a message cannot be opened, and a spoiler cannot be uncovered, without a pointer
- Where: `web/src/components/chat/Attachments.tsx:163` (`<div className={s.imgWrap} … onClick={…}>` — no `tabIndex`, no `role`, no key handler), `:187` (the `SPOILER` overlay is a `div`), `:264` (`<span className={s.fileName} onClick={…}>`); the same `div`-with-`onClick` for a linked picture or GIF at `web/src/components/chat/Embeds.tsx:76`
- What: The image frame is a clickable `div`. The only focusable thing inside is the "Load image" button on the over-25 MB path. Compare `MessageItem.tsx:271-292`, where a *sticker* is given `role="button"`, `tabIndex={0}`, an `aria-label` and Enter/Space handling — the pattern is in the same area, applied to the rarer case and not to the common one.
- Impact: A keyboard or screen-reader user can never open a photo at full size (the `ZoomPan` viewer, "Open original" and "Download" all live behind that click), and can never reveal a spoiler image, so a spoiler is a permanent blur for them.
- Fix: copy the sticker's treatment onto `.imgWrap`: `role="button"`, `tabIndex={0}`, `aria-label` = `att.name` (or "Uncover spoiler" while hidden), Enter/Space activating the same handler. The file name span should become a `<button>` (or just be dropped in favour of the download button beside it, which already has a name).
- Effort: S
- Status: open

### WCHAT-030 · P2 · a11y · The picture viewer is a `role="dialog"` that never takes focus, traps nothing and gives nothing back
- Where: `web/src/components/chat/Attachments.tsx:125-150` (`createPortal(<div role="dialog" aria-label={name}> …, document.body)`), `:109-122` (only a `keydown` listener for `+`, `-`, Escape); compare `web/src/components/common/Modal.tsx`, which round 1 fixed to trap focus, restore it on close and set `aria-modal`
- What: Opening a picture mounts a full-screen dialog and leaves focus wherever it was, behind the overlay. There is no `aria-modal="true"`, no initial focus on the close button, no focus trap, and no focus restore on close. Tab therefore walks the message list *under* the viewer, and the close button, zoom buttons, "Open original" and "Download" are reached only after tabbing through everything that happens to precede them in the document.
- Impact: A screen-reader user is told nothing when the viewer opens and is still reading the page behind it; a keyboard user tabs into invisible controls. The app already has the correct machinery one file away.
- Fix: render the viewer through `Modal` (or reuse its `useFocusTrap`): `aria-modal="true"`, focus the close button on mount, trap Tab inside, restore focus to the image on close. The Escape handling already there can then come from `Modal` too.
- Effort: S
- Status: open

### WCHAT-031 · P2 · i18n · Eight English strings in the attachment surface, and one of them is an English noun injected into a translated sentence
- Where: `web/src/components/chat/Attachments.tsx:79` (`Retry`), `:169`/`:209`/`:231` (`what="image"` / `"video"` / `"audio"` passed into `chat.attachments.couldNotBeDecrypted` = `"This {what} could not be decrypted."`), `:171` (`"Decrypting…"`), `:182` (`Load image ({size})`), `:187` (`SPOILER`), `:214` (`Load video ({size})`), `:236` (`Load {name} ({size})`)
- What: The `{what}` placeholder is the worst of these: the sentence is translated in all eleven languages but the noun that fills it never is, so Arabic reads «هذا image لا يمكن فكّ تشفيره» — and no grammatical gender or agreement is possible for the translator either, since one sentence serves three nouns. The rest are plain untranslated literals on the failure and "load me" paths, i.e. exactly the moments a person needs to understand what is going on.
- Impact: Every attachment failure message is part-English in ten languages; the spoiler tag reads `SPOILER` in Arabic and Japanese; the "Load image (14 MB)" buttons that gate large media are English everywhere.
- Fix: three sentences instead of one placeholder (`chat.attachments.imageFailed`, `.videoFailed`, `.audioFailed`, each in a decrypt and a load variant — or keep `{what}` but pass `t("chat.attachments.nounImage")`), plus keys for `retry`, `decrypting`, `spoiler`, `loadImage`, `loadVideo`, `loadFile`. `chat.messageItem.retry` already exists and can be shared.
- Effort: S
- Status: open

### WCHAT-032 · P3 · i18n · [i18n-copy] Arabic counts one member as many: `one` is missing from 20 plural entries
- Where: `web/src/i18n/locales/ar.json` — `chat.groupMemberList.membersOnly` is `{"other": "{count} عضوًا"}` against `en.json`'s `{"one": "{count} Member", "other": "{count} Members"}`; the same 20 keys lack `one` (in this area: `chat.groupMemberList.membersOnly`, `chat.groupMemberList.membersCount`, `activity.statusLine.andMore`, `activity.statusLine.moreCount`, `profile.profileCard.mutualFriendsCount`, `profile.profileCard.mutualServersCount`); `web/src/i18n/core.ts:103` (`forms[category] ?? forms.other`)
- What: Arabic's CLDR rule has a distinct `one`, and where it is absent `pluralForm` falls back to `other`. Most of the 20 are headers whose English `one` and `other` are identical, so `other` alone is a correct and deliberate translation; `chat.groupMemberList.membersOnly` is not — «{count} عضوًا» is the form used after 11–99, so a group with one member reads as "1 members" would in English. (ja/ko/zh-CN legitimately ship `other` only; their 55 "missing" `one` forms are correct, not a gap.)
- Impact: One visible grammar error in Arabic in the group member list header, and a trap for the next plural string added.
- Fix: add `one` to Arabic's `chat.groupMemberList.membersOnly` (and check the other count-varying ones outside this area: `invite.membersCount`, `invite.onlineCount`, `modals.invite.usesCount`, `server.auditLog.itemsCount`, `server.packEditor.upload*Count`, `settings.security.backupCodesLeft`, `voice.voice.inVoiceCount`, `modals.quickSwitcher.filesCount`). `tools/i18n_keys_used.py` compares keys, not forms — teaching it to compare the form sets of a plural entry against each language's `Intl.PluralRules` categories would have caught this.
- Effort: S
- Status: open

### WCHAT-033 · P2 · i18n · In Arabic a link preview loses the site's colour: the accent is set with `border-left-color` on a border drawn on the right
- Where: `web/src/components/chat/Embeds.tsx:159` and `:183` (`style={e.color ? { borderLeftColor: e.color } : undefined}`), `web/src/components/chat/Embeds.module.css:2` (`.card { … border-inline-start: 4px solid var(--brand) }`)
- What: The card's 4 px stripe is declared logically, so under `dir="rtl"` it is the *right* border; the inline style colours the left one, whose width is 0. Nothing is drawn with the site's colour and the stripe stays the app accent.
- Impact: Every link preview in Arabic looks identical whatever it links to — the one piece of per-site identity a card has. In LTR it works, so it will not be noticed without switching languages. This is the same class round 1's 38 RTL fixes were about; it survived because the physical property is in a TSX inline style rather than in CSS.
- Fix: set a custom property instead — `style={{ "--embed-accent": e.color }}` with `.card { border-inline-start: 4px solid var(--embed-accent, var(--brand)) }`. A grep for `style={{` with `Left|Right|marginLeft|paddingRight|left:|right:` across the components is worth doing in the same pass; inline styles are invisible to a CSS-only RTL audit.
- Effort: S
- Status: open

### WCHAT-034 · P2 · i18n · An invite preview counts members in English, and a preview's date is formatted in the browser's language instead of the app's
- Where: `web/src/components/chat/Embeds.tsx:242` (`${e.member_count} member${e.member_count === 1 ? "" : "s"}`), `:243` (`${e.online_count} online`), `:121` (`d.toLocaleDateString(undefined, …)`), `:167` (`title={e.title ?? "Video"}`), `:67` (`"GIF"` / `fileNameOf(e.url, "Image")` as the picture's `alt`)
- What: The invite card translates its heading and its Join button and then hand-builds "5 members · 2 online" in English with an inline English plural rule — while `en.json` already has `invite.membersCount` and `invite.onlineCount` as proper plural entries, used by the invite modal. Separately, `publishedOn` passes `undefined` as the locale, which is the browser's language; `web/src/lib/time.ts:4` exists precisely because that was wrong ("Intl is given the app's tag rather than `undefined`, which would follow the browser").
- Impact: A Japanese user reading an invite to a server sees "5 members · 2 online"; an Arabic user with an English browser sees "3 Feb 2026" in Latin digits and English month names next to Arabic text. Both are the visible half of a card whose other half is translated, which looks like a half-finished translation.
- Fix: `t("invite.membersCount", { count })` and `t("invite.onlineCount", { count })`; `formatDate(e.published_at)` from `lib/time.ts` (add the `{year, month: "short", day}` kind there rather than calling Intl here); keys for the iframe title and the image `alt`.
- Effort: S
- Status: open

### WCHAT-035 · P3 · design · A linked audio file gets the browser's grey native player; an uploaded one gets the app's
- Where: `web/src/components/chat/Embeds.tsx:196` (`<audio className={s.audio} src={media} controls preload="none" />`), against `web/src/components/chat/AudioPlayer.tsx` (used for uploads at `Attachments.tsx:229`) and `VideoPlayer` which *is* reused for the video case one line above (`:194`)
- What: The video branch reuses the app's player; the audio branch drops to `<audio controls>`. That control is unthemeable, is a different size and shape in every browser, ignores the app's accent, and on iOS renders a full-width grey bar that does not match anything around it.
- Impact: A voice note someone links looks nothing like a voice note someone uploads, inside the same message list.
- Fix: `<AudioPlayer src={media} name={fileNameOf(e.url, "Audio")} />` — it already takes an optional size and duration, which a preview does not have.
- Effort: S
- Status: open

### WCHAT-036 · P3 · a11y · A link preview's picture is always `alt=""`, including when the picture is the whole preview
- Where: `web/src/components/chat/Embeds.tsx:198` (`.large`, `alt=""`), `:190` (`.thumb`, `alt=""`), `:136` (the favicon, correctly `alt=""`), `:249` (the invite's server icon, `alt=""`)
- What: `alt=""` is right for the favicon and the 80 px thumbnail, which sit beside a title that says the same thing. It is wrong for `.large`, the 400 px hero image that is shown *instead* of a thumbnail when the preview has no title/description worth showing, and for the invite's server icon when the invite card is the message's whole content.
- Impact: A screen reader reading a message whose only content is a link preview announces the link and then nothing — the picture that a sighted reader sees as the message is silent.
- Fix: `alt={e.title || e.site_name || t("chat.embeds.linkPreviewImage")}` on `.large`; `alt=""` is fine to keep on the thumb and favicon.
- Effort: S
- Status: open

### WCHAT-037 · P2 · a11y · Both media players steal the keyboard from their own controls: Space on any button plays the video, and the volume slider cannot be moved with the arrow keys
- Where: `web/src/components/chat/VideoPlayer.tsx:185-213` (`onKey`) wired at `:288` (`onKeyDown` on the wrapper, which every control is inside); `web/src/components/chat/AudioPlayer.tsx:115-128` wired at `:132`
- What: The handler is on the container, so it runs for keys pressed on any focused descendant, and it calls `e.preventDefault()` on all of them. Focus the mute button and press Space: the video plays/pauses and the button is *not* activated (a `<button>`'s Space activation happens on keyup, which the prevented keydown cancels). The same for full screen, picture-in-picture, speed and "more". Focus the volume `<input type="range">` and press ArrowLeft/ArrowRight: the video seeks five seconds and the volume does not change, so volume is pointer-only.
- Impact: Every control in the player is unusable by keyboard except by Enter (which the handler leaves alone) — and Space is the key people actually press on a focused button. The player looks keyboard-accessible (`tabIndex`, `role="slider"`, `aria-label`s everywhere) and is not.
- Fix: act only when the event is on the player itself or on the seek track: `if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('[role="slider"]')) return;` at the top of `onKey`. Then the shortcuts still work when the player surface has focus, and each control keeps its own keys.
- Effort: S
- Status: open

### WCHAT-038 · P2 · a11y · A spoilered video plays its sound while still blurred, and cannot be uncovered by keyboard
- Where: `web/src/components/chat/VideoPlayer.tsx:293-295` (`<div className={s.spoiler} onClick={…}><span>SPOILER</span></div>` — a `div`, no `role`, no `tabIndex`), `:287-288` (the wrapper is focusable and Space calls `toggle()`), `web/src/components/chat/VideoPlayer.module.css` (`.player[data-spoiler="true"] .video { filter: blur(44px); pointer-events: none }`, `.player[data-spoiler="true"] .bar { display: none }`)
- What: The only way to reveal is a click on the overlay. The wrapper is focusable, and its Space/`k` handler calls `toggle()` unconditionally, so a keyboard user's first Space starts playback: the audio plays at full volume behind a 44 px blur, with the control bar hidden (`display: none`), so there is no way to pause it except Space again — and no way to see what is playing.
- Impact: A spoiler is meant to be a deliberate reveal. Pressing Space on a focused video leaks the thing the sender hid (its sound), and a keyboard user can never watch it at all.
- Fix: make the overlay a `<button>` with an `aria-label` ("Uncover this video"), and make `toggle()` (and the `onKey` path) reveal rather than play while `!revealed` — `onSurface` already does exactly that for a pointer at `:127-131`, so route the keyboard through the same function.
- Effort: S
- Status: open

### WCHAT-039 · P2 · a11y · The audio player's controls are 26 px on a phone; the video player's are 40 px
- Where: `web/src/components/chat/AudioPlayer.module.css` (`.ctl { width: 26px; height: 26px }`, `.speed { height: 26px }`, and the `@media (max-width: 767px)` block, which rearranges the rows but never enlarges a target), against `web/src/components/chat/VideoPlayer.module.css`'s `@media (pointer: coarse) { .ctl { width: 40px; height: 40px } .speed { height: 40px } }`
- What: Speed, mute and download in a voice note are 26 px squares with 2 px gaps on touch. The video player in the same message list got the coarse-pointer treatment; the audio player did not.
- Impact: Below the 44 px floor and packed together, so on a phone "download this voice note" and "mute" are a coin toss; mute in particular is beside a volume slider that is `display: none` on mobile, so a mis-hit has no visible effect and the person tries again.
- Fix: the same `@media (pointer: coarse)` block: `.ctl { width: 40px; height: 40px } .speed { height: 40px } .tools { gap: 4px }`. The 38 px `.play` should go to 44 px in the same rule.
- Effort: S
- Status: open

### WCHAT-040 · P3 · ux · Volume and playback speed are forgotten between clips, and between sessions
- Where: `web/src/components/chat/VideoPlayer.tsx:90-92` (`useState(1)`, `useState(false)`, `useState(1)`), `web/src/components/chat/AudioPlayer.tsx:49-51`
- What: Volume, mute and speed are per-instance component state. Every video in a channel starts at 100 % and 1×, and muting one says nothing about the next; scrolling a video out of view and back resets it too, because the component unmounts.
- Impact: Someone who keeps media quiet (an office, a shared room) re-mutes every single clip. `settings` already persists `imagePreviews`, `messageDisplay` and the rest, and the voice feature persists its own device choices, so the machinery is there.
- Fix: one shared `mediaVolume`/`mediaMuted`/`mediaSpeed` in `stores/settings` (or `lib/storage` if it should not sync between devices), read as the initial state and written on change. Discord and every browser's native player do this.
- Effort: S
- Status: open

### WCHAT-041 · P3 · design · The voice-note "waveform" is invented from a hash of the file name
- Where: `web/src/components/chat/AudioPlayer.tsx:19-34` (`bars(seed)` — an FNV hash of `name`, then xorshift, 48 bars), `:53` (`useState(() => bars(name))`), `:163-165`
- What: It looks exactly like a waveform and carries no information about the audio. Two recordings with the same file name (`audio.m4a`, which is what a phone recording is usually called) draw the identical shape; a silence and a shout look the same; and the pattern implies you can see where the speech is, which you cannot.
- Impact: It is a decoration pretending to be data. In a voice-note-heavy conversation the eye learns to use it for scrubbing and it is lying every time.
- Fix: either compute a real envelope (decode with `AudioContext.decodeAudioData` once after the blob is decrypted, take the RMS of 48 windows, cache it by `blob_id` — the file is already fully in memory, so this is cheap and offline), or drop the pretence and draw a plain progress bar with a knob, which is honest and matches the video player's own track. The first is better if voice notes matter; the second is 20 minutes' work.
- Effort: M
- Status: open

### WCHAT-042 · P3 · ux · Menus anchored to a button assume the menu is 200 px wide, and never flip in Arabic
- Where: `web/src/components/chat/ChatView.tsx:302` (`x: Math.max(8, r.right - 200)`), `web/src/components/chat/VideoPlayer.tsx:255` (`x: r.right - 200`), `web/src/components/chat/MessageItem.tsx:254` (`openMenu(r.left, r.bottom + 4)`); `web/src/components/common/ContextMenu.tsx:78-80` (clamps `x` to the window but treats it as a left edge in every direction)
- What: Three call sites try to right-align a menu under a button by subtracting a guessed width. The menu's real width depends on its longest translated label, so in German or Finnish the menu starts 200 px left of the button and ends far past it (the clamp then pushes it back on screen), and in Arabic — where a menu should open towards the inline-start — nothing flips at all.
- Impact: The phone header's "more" menu, the narrow video player's menu and a message's "more" menu land in a different place in each language, and on the wrong side in Arabic.
- Fix: let `ContextMenu` do the anchoring: accept an anchor rect plus an alignment (`start`/`end`) instead of a point, and align after measuring (it already measures at `:78`). `document.dir === "rtl"` then swaps `start`/`end` in one place rather than three.
- Effort: M
- Status: open

### WCHAT-043 · P2 · i18n · "escape to cancel • enter to save" is English in all eleven languages, and both words are clickable `<b>`s
- Where: `web/src/components/chat/EditMessage.tsx:84-86` (`escape to <b onClick={cancel}>cancel</b> • enter to <b onClick={save}>save</b>`), against `:80-81` where the touch branch uses `t("chat.editMessage.cancel")` and `t("chat.editMessage.save")` properly
- What: The desktop hint line under every edit box is a raw English sentence with two `<b>` elements carrying click handlers — not focusable, no `role`, no keyboard activation, and they are the only visible "Cancel"/"Save" affordance a mouse user gets. The keys the sentence names ("escape", "enter") are also the only place in the app where a key name is baked into a string rather than translated.
- Impact: Every person editing a message in Arabic, Japanese or German reads an English instruction; and a mouse user who wants to click rather than press Enter is clicking a `<b>`. Because the touch branch is translated, the bug is invisible to anyone testing on a phone.
- Fix: `<Tr id="chat.editMessage.hint" values={{ cancel: <button …>, save: <button …> }} />` with the existing `cancel`/`save` keys as the button labels; `Tr` already interpolates nodes (it is used for the channel intro at `MessageList.tsx:403`). Make the two words real `<button>`s while you are there.
- Effort: S
- Status: open

### WCHAT-044 · P2 · ux · Who reacted is a `title` fetched on mouse-enter, so on a phone nobody can ever find out
- Where: `web/src/components/chat/Reactions.tsx:60-69` (`hover()` — the reactor list is fetched in `onMouseEnter` only), `:75` (`title={…}`, `onMouseEnter={() => void hover(r.emoji)}`)
- What: The names behind a reaction live in a native `title` tooltip, and the request that fills it is fired by `onMouseEnter`. A touch screen sends no `mouseenter` and shows no `title`; a keyboard user can focus the pill but `mouseenter` never fires, so the `title` stays the generic "React with 😀". Long-press on a pill does nothing (`lib/longPress` synthesises `contextmenu`, which the pill does not handle).
- Impact: On the client the owner uses daily, "who reacted?" is unanswerable. Discord solves this with a tap-and-hold sheet listing reactors per emoji; Android's `MessageRow.kt` has no reactor list either, so both touch clients are missing it.
- Fix: open a small sheet/popover on long-press (and on Enter when the pill has focus) listing the reactors, reusing the same `messages.reactors` call; keep the hover `title` on desktop. One popover shared by all pills in a message is enough, and it gives the keyboard a route too. Same feature is worth filing against Android.
- Effort: M
- Status: open

### WCHAT-045 · P3 · bug · A custom-emoji reaction's tooltip reads "React with blobcat:1204…"
- Where: `web/src/components/chat/Reactions.tsx:75` (`t("chat.reactions.reactWith", { emoji: r.emoji })` / `reactedWith`), `:76` (`<img … alt={r.emoji}>`), `web/src/i18n/locales/en.json` (`chat.reactions.reactWith = "React with {emoji}"`)
- What: `r.emoji` is the wire form of a reaction key: a Unicode character for a standard emoji, but `name:id` or `a:name:id` for a custom or animated one (`isCustom` at `:26-30` parses exactly that). It is interpolated raw into the tooltip and used as the image's `alt`.
- Impact: Hovering any custom-emoji reaction — the common case on a server with its own emoji — shows "React with partyblob:1204887733226" and a screen reader reads the same snowflake id aloud. Alice and Bob's names come out as "alice, bob reacted with a:partyblob:1204887733226".
- Fix: `:${name}:` for the label (the regex already captures the name), i.e. pass `custom ? `:${m[2]}:` : r.emoji`; `alt=":name:"` on the image.
- Effort: S
- Status: open

### WCHAT-046 · P3 · a11y · The sticker card's "View Sticker Pack" button cannot be reached by keyboard, and its label is English
- Where: `web/src/components/chat/StickerPopout.tsx:109-134` (portalled to `portalRoot()` — the end of `document.body` — with `role="dialog"` and no focus move or trap), `:130` (`View Sticker Pack`, untranslated), `:58` (`"Sticker"` fallback name)
- What: Pressing Enter on a sticker (which `MessageItem.tsx:287-291` supports) opens the card, but focus stays on the sticker and the card is mounted at the end of the document, so Tab goes to the rest of the message list and the composer, never to the card's button. Escape closes it (`:92-96`), which is the only keyboard interaction that works.
- Impact: A keyboard user can open the card and read nothing from it (no focus, no announcement, `role="dialog"` with no `aria-modal`), and can never reach the one action on it. The label is untranslated for everyone.
- Fix: focus the card (or its button) on open and return focus to the sticker on close — the app has `Modal`'s trap to copy, and `FloatingPlane`/`ContextMenu` already do focus management. Translate the label (`chat.stickerPopout.viewPack`) and the fallback name.
- Effort: S
- Status: open

### WCHAT-047 · P3 · a11y · A reaction pill does not say that you are one of the reactors
- Where: `web/src/components/chat/Reactions.tsx:75` (`data-me={r.me}` with no `aria-pressed`), `web/src/components/chat/Chat.module.css:111` (`.pill[data-me="true"]` — the accent border and tint that convey it visually)
- What: "You reacted with this" is carried by colour alone: a `--mention-bg` fill and a `--brand` border. The button is a toggle and has no `aria-pressed`, so a screen reader cannot tell the two states apart, and neither can anyone who cannot distinguish the tint (it is a 1 px border plus a low-contrast background change).
- Fix: `aria-pressed={r.me}` on the pill; and give the pressed state a second visual cue that is not only colour (a filled/heavier border, or the count in `--text-strong`, which `:111` half does already).
- Effort: S
- Status: open

### WCHAT-048 · P2 · i18n · The typing indicator says "and" in English in all eleven languages, and the two clients word it differently
- Where: `web/src/components/chat/TypingBar.tsx:21` (`<b>{who[0]}</b> and <b>{who[1]}</b> {t("chat.typingBar.areTyping")}`), `:22` (`, … , and …`); parity: `android/.../ui/chat/ChatScreen.kt:394-397` joins names with `", "` and never says "and"
- What: The sentence is assembled from a translated verb phrase (`is typing…` / `are typing…`) plus hard-coded English conjunctions. Beyond the literal "and", the design fixes the word order to "names, then verb", which is why the catalogue's Japanese entry has to be the bare suffix `が入力中…`; any language that needs the verb first, or a different list conjunction (Arabic «و» is attached to the following word without a space), cannot be expressed.
- Impact: In Arabic the bar reads «أحمد and سارة يكتبان»; in Japanese «たなか and さとう が入力中…». It is on screen every time two people type — one of the most-seen strings in the app. Android shows «أحمد، سارة يكتبان», so the same conversation reads differently on the two clients.
- Fix: whole-sentence keys with placeholders: `chat.typingBar.oneTyping = "{a} is typing…"`, `twoTyping = "{a} and {b} are typing…"`, `threeTyping = "{a}, {b} and {c} are typing…"`, `manyTyping`, rendered with `<Tr>` so the names stay bold. Fix Android in the same pass so the wording matches.
- Effort: S
- Status: open

### WCHAT-049 · P3 · ux · "Copy Text" and "Copy Message ID" give no sign that anything happened, and a refused clipboard fails silently everywhere
- Where: `web/src/components/chat/messageMenu.ts:72` (`void navigator.clipboard?.writeText(humanizeMentions(…))` — no toast, no catch), `:88` (copy id, same), `web/src/components/chat/MessageItem.tsx:248` (the Shift-toolbar's copy id, same); against `:149` (`copyMessageLink` toasts "Link copied") and `:53` (`copyImage` toasts and reports failure)
- What: Two of the four copy actions in the message menu are fire-and-forget with no feedback path at all. And in all of them `navigator.clipboard?.` swallows the case where the API is missing (any non-secure origin, some embedded webviews) and the `writeText` rejection case (Safari outside a user gesture, a denied permission) — the `.then()` on `copyMessageLink` has no `.catch`, so that one also produces an unhandled rejection in the console instead of a message.
- Impact: The user picks "Copy Text", nothing visible happens, and they cannot tell whether it worked; if it failed, they paste the previous clipboard contents into a different conversation without knowing.
- Fix: one `copyToClipboard(text, successKey)` helper in `lib/` that toasts on success and toasts an error on rejection or a missing API, used by all four call sites (and by the `/channels` id copies elsewhere). `chat.messageMenu.linkCopied` and `imageCopied` already exist as the pattern.
- Effort: S
- Status: open

### WCHAT-050 · P2 · i18n · The last English strings in the chat surface: a pin's placeholder, a delete dialog's title, a spoiler tag, a voice note's buttons
- Where: `web/src/components/chat/PinsPanel.tsx:71` (`"[attachment]"`, `"[encrypted]"` — the body of a pin that has no text), `web/src/components/chat/SubchatPanel.tsx:39` (`title: \`Delete '${ch.name}'\`` — the confirmation dialog's heading), `web/src/components/chat/groupMemberMenu.ts:100` (`title: \`Leave '${group}'\`` — the same slip, same shape), `web/src/components/chat/VideoPlayer.tsx:294` (`SPOILER`), `web/src/components/chat/AudioPlayer.tsx:134` (`aria-label={playing ? \`Pause ${name}\` : \`Play ${name}\`}`), `:180` (`aria-label={\`Download ${name}\`}`), `web/src/components/chat/SystemMessage.tsx:14` (`"someone"` — the name used when a member-add/remove names someone this client has never seen)
- What: Six more literals that never reach `t()`, in files the earlier i18n pass (`a1311ed`) did not finish. The subchat one is the most visible: the whole dialog is translated except its title, so a German user reads «Delete 'Planung'» over translated body text and buttons.
- Impact: Untranslated words in a pinned-message list, a destructive confirmation, a spoiler overlay and two screen-reader labels. Together with WCHAT-003, WCHAT-025, WCHAT-031, WCHAT-034, WCHAT-043 and WCHAT-048 this is the complete English residue in this area — worth one sweep with `grep -n '"[A-Z][a-z]' web/src/components/{chat,composer,pickers,search,profile,activity}/*.tsx` afterwards to keep it at zero.
- Fix: `chat.pins.attachmentOnly`, `chat.pins.encrypted`, `chat.subchat.deleteNamed` (with `{name}`), `chat.spoiler` (shared with `Attachments.tsx:187`), `chat.audioPlayer.playNamed`/`pauseNamed`/`downloadNamed`, `names.someone`.
- Effort: S
- Status: open

### WCHAT-051 · P2 · a11y · A pinned message cannot be opened from the keyboard, and the panel is not announced as a dialog
- Where: `web/src/components/chat/PinsPanel.tsx:66` (`<div className={s.pinItem} onClick={…}>` — the whole row is the jump-to affordance), `:53` (the panel: no `role`, no `aria-label`, no focus move, closed only by an outside `mousedown` or the chat's global Escape), `:55` (the title is a `<span>`, not a heading)
- What: The pins popup is the one place a person goes to find what was pinned, and every row in it is a `div` with a click handler. The only focusable things inside are the close button and the per-row unpin button (which is correctly revealed on `:focus-visible`), so a keyboard user can unpin a message they cannot read or jump to. `SubchatPanel` two files over does this properly — `role="dialog"`, `aria-label`, rows that are `<button>`s — so the pattern is already in the area.
- Impact: Pinned messages are unreachable without a pointer, and a screen reader is not told that a layer opened.
- Fix: rows become `<button class={s.pinItem}>`; the panel gets `role="dialog"` + `aria-label={t("chat.chat.pinnedMessages")}`, its title an `<h2>`, and focus moved to it on open (matching `SubchatPanel`). Worth also refetching on a pin/unpin event so the list does not go stale while open.
- Effort: S
- Status: open

### WCHAT-052 · P2 · a11y · In a group DM on a phone, the closed member drawer keeps every member's button in the tab order, off screen, behind `aria-hidden`
- Where: `web/src/components/chat/ChatView.tsx:335` (`{convo.type === "group_dm" && (drawer || membersOpen) ? <GroupMemberList … /> : null}` — mounted whenever the layout is narrow, open or not), `web/src/components/chat/GroupMemberList.tsx:45` (`aria-hidden={drawer && !open}`), `web/src/components/chat/MemberList.module.css:19` (`@media (max-width: 1099px) { .list { position: fixed; transform: translateX(100%) } }`)
- What: The drawer is translated off screen rather than removed, and `aria-hidden` is put on a container full of `<button>`s. `aria-hidden` does not remove anything from the tab order, so Tab walks through every member of the group while the drawer is shut, focus lands on controls that are 100 % off screen (and the browser tries to scroll to them), and AT is told the focused element does not exist — the combination axe reports as "aria-hidden element must not be focusable". The server member list avoids this by accident: `ChatView.tsx:333` unmounts it 250 ms after closing (`membersMounted`).
- Impact: On any narrow window or phone in a group DM, tabbing from the composer goes nowhere visible for as many presses as there are members. With a screen reader it is worse: focus exists on something that has been declared hidden.
- Fix: add `inert` to the aside while closed (one attribute, supported everywhere the app runs, and it implies `aria-hidden`), or mount it the way the server list is mounted (`open || justClosed`). `inert` is the better fix and should go on the server list too, since its 250 ms window has the same hole.
- Effort: S
- Status: open

### WCHAT-053 · P3 · i18n · The member list sorts names by the browser's language, and builds its group headers by concatenation
- Where: `web/src/components/chat/MemberList.tsx:20` (`new Intl.Collator(undefined, { sensitivity: "base" })`), `web/src/components/chat/GroupMemberList.tsx:17` (same), `web/src/components/chat/MemberList.tsx:173` (`{row.label} — {row.count}`); compare `web/src/lib/time.ts:33` (`const locale = translator().locale` — written because `undefined` was wrong) and `GroupMemberList.tsx:46`, which does use a key (`chat.groupMemberList.membersCount`)
- What: Two small slips of the same kind as WCHAT-034. `Intl.Collator(undefined)` collates by the browser's locale, so a member list in the Arabic UI on an English system orders names by English rules (and vice versa) — visible with Swedish å/ä, German ä/ö, and any CJK reading order. The role-group header is assembled in JSX as `label — count`, so no language can put the count first or use its own punctuation; the group list next door does it with a proper key.
- Fix: `new Intl.Collator(translator().locale, …)` built lazily (it is module-level today, so it would need to follow a language change — `lib/time.ts` caches per locale and is the pattern); a `chat.memberList.roleGroupCount = "{label} — {count}"` key for the header.
- Effort: S
- Status: open

### WCHAT-054 · P2 · a11y · A screen reader reads every spoiler out loud before it is revealed, and calls the secret the name of the button
- Where: `web/src/styles/markdown.css:11` (`.md-spoiler { color: transparent }`), `:13-14` (`.md-spoiler[data-revealed="false"] * { visibility: hidden }` — element children only), `web/src/markdown/render.tsx:235-252` (`role="button" tabIndex={0}` with no name of its own, no `aria-expanded`)
- What: A spoiler's plain text is a bare text node, not an element, so the `*` rule never touches it — only `color: transparent` hides it, and transparent text is fully present in the accessibility tree. The span is also `role="button"`, whose accessible name is computed from its contents, so the spoiler is announced as "«the thing that was hidden», button". Nothing says the word "spoiler" anywhere in the markup, and the role and `tabIndex` stay on after the reveal, so the revealed text is still announced as a button that does nothing.
- Impact: The one feature whose entire purpose is to withhold text withholds it from sighted users only. A screen-reader user is told the ending of the film they asked not to be told. (A spoilered image or custom emoji *is* hidden, because those are elements — so the bug only bites the common case.)
- Fix: wrap the children in a `<span className="md-spoiler-inner">` and hide that (`visibility: hidden` covers text and elements alike), give the button an explicit `aria-label` while hidden (`render.spoilerHidden` = "Spoiler, activate to show"), add `aria-expanded={open}`, and drop `role`/`tabIndex`/the key handler once `open` so the text becomes ordinary selectable prose.
- Effort: S
- Status: open

### WCHAT-055 · P2 · security · A masked link can say anything: the real destination is only in a `title`, which a phone never shows
- Where: `web/src/markdown/render.tsx:183-194` (`title={node.masked ? node.url : undefined}` is the only disclosure), `web/src/markdown/parse.ts:415-436` (`[text](url)` from any message, any sender, as long as the url is http(s)), `web/src/styles/markdown.css:21-23` (a masked link is styled exactly like a bare one)
- What: Anyone can send `[https://accounts.google.com/signin](https://evil.example/signin)` and it renders as the first URL, coloured and underlined like a real link, pointing at the second. On a touch screen there is no hover, so `title` is unreachable; the same for a keyboard or screen-reader user, who gets the link text as the accessible name and nothing else. `javascript:`/`data:` are correctly refused by `RE_HTTP`, so this is not XSS — it is plain phishing, and the product's users are exactly the people who expect a private channel to be safe. Discord ships a "You are leaving Discord" dialog naming the host for this reason, and Slack shows the host inline.
- Impact: The most effective attack available to a stranger in a group DM or a public server on this platform, with no defence a careful user could exercise on a phone.
- Fix: when `masked`, either (a) append the destination's host after the link text (`… (evil.example)`), which is cheap and visible everywhere, or (b) intercept the click and show a confirm modal with the full href when `new URL(url).host` does not match a host named in the link text. (a) plus a `title` is enough; do (b) only for the "link text looks like a URL" case. Android's `ui/markdown/Render.kt` renders the same masked links and needs the same treatment in the same pass.
- Effort: M
- Status: open

### WCHAT-056 · P3 · ux · `@everyone`, `@here` and every role mention look clickable and are not
- Where: `web/src/styles/markdown.css:24` (`.md-mention { cursor: pointer }`), `:25` (`.md-mention:hover` repaints), `web/src/markdown/render.tsx:197-200` (`everyone`/`here` are plain spans), `:291-301` (`RoleMention` has no handler), against `:265-289` where the user and channel mentions are `role="button"` with handlers
- What: One class carries both the interactive and the decorative mention. Three of the five kinds have no behaviour, but they still get the hand cursor and a hover colour change.
- Impact: People click a role mention expecting the role's members (Discord shows nothing either, but Discord's role mention has `cursor: default`), and nothing happens; the hover feedback makes it look like a failed click rather than an inert label.
- Fix: `cursor: pointer`/`:hover` only on `.md-mention[role="button"]`. If a role mention should do something, "show who has this role" is a reasonable card — but inert and honest is better than what is there now.
- Effort: S
- Status: open

### WCHAT-057 · P3 · design · A code block is capped at 90 % of the message width, never wraps, and has no copy button
- Where: `web/src/styles/markdown.css:9` (`max-width: 90%; white-space: pre; overflow-x: auto`), `web/src/markdown/render.tsx:443-449` (the `<pre>`; nothing else is rendered)
- What: Three things, all visible on a phone. The 90 % cap leaves a permanent ragged strip to the right of every block for no reason (the column is already padded). `white-space: pre` plus `overflow-x: auto` puts a nested horizontal scroller inside the vertical message list, with no `overscroll-behavior: contain`, so dragging a long log line sideways on iOS regularly scrolls the conversation instead. And there is no copy button: the only way to get a snippet out is "Copy Text" on the whole message, which hands you the ``` fences and everything else the message said.
- Impact: Sharing code — a thing this product's users plainly do, since there is a highlighter — is awkward on every client, and worst on the phone.
- Fix: `max-width: 100%`, `overscroll-behavior-x: contain`, and a copy button in the block's top-inline-end corner revealed on hover and always visible on touch (`@media (hover: none)`), with the `copyToClipboard` helper WCHAT-049 asks for. A "wrap lines" toggle is what Discord lacks and people ask for; optional.
- Effort: S
- Status: open

### WCHAT-058 · P2 · perf · Every message on screen rebuilds the role table of every server you are in, whenever anyone's profile arrives
- Where: `web/src/lib/markdownCtx.ts:11-34` (`useRenderCtx`: subscribes to `users.byId`, `channels.byId` and `servers.byId` whole, and rebuilds `roles` from `Object.values(servers)` × `Object.values(st.roles)` inside the memo), `web/src/components/chat/MessageItem.tsx:85` and `:50` (the row and its `ReplyPreview` each call it — two per message), `web/src/components/chat/MessageItem.tsx:46` (`ReplyPreview` also subscribes to the whole `users.byId`), `web/src/components/chat/MessageList.tsx:492-497` (every loaded message is mounted; the list is not virtualised)
- What: The context is built per row rather than per chat, and its memo depends on three entire store maps. `useUsers((u) => u.byId)` fires on every upsert — and `stores/messages.ts:25` upserts the author of any arriving message the client has not seen, `gateway/dispatch.ts:147/275/295/304` upsert on member chunks and profile updates, `voice/session.ts:153/159` on anyone joining a call. Each such event re-renders *every* mounted row (the `memo()` at `MessageItem.tsx:76` cannot help: the re-render comes from the row's own subscription), and each row then rebuilds a fresh `roles` dictionary over all servers and re-creates every React element of its markdown body.
- Impact: In a channel scrolled back a few pages — say 600 rows — one stranger's message means 1,200 rebuilds of the roles table plus 600 full markdown re-renders, for a change that affects one author's name. This is the mechanism behind "the app hitches when a busy channel is open", and it is worse the longer you have been reading. On the phone it is worse again.
- Fix: build the context once per conversation and pass it down — `ChatView` creates it and provides it through a React context (it is already a `useMemo`, it just lives in the wrong place) — and keep the roles map in `stores/servers` as a derived selector rather than recomputing it. Rows should subscribe to the one author they render (`useUsers((u) => u.byId[id])`), as `MessageItem.tsx:78` already does for the author; `ReplyPreview` should do the same for the parent's author. `lib/markdownCtx.ts` is `web-core`'s file, so this one is shared.
- Effort: M
- Status: open

### WCHAT-059 · P3 · bug · A relative `<t:…:R>` timestamp is rendered once and then never ticks
- Where: `web/src/markdown/render.tsx:323-333` (`Timestamp` computes `formatStamp(date, props.style)` at render time), `web/src/lib/time.ts:125-133` (`R` is computed from `Date.now()`), `web/src/markdown/render.tsx:24` (`parse` is memoised on the source, so nothing re-renders the node on its own)
- What: `R` is the countdown style ("in 2 hours", "5 minutes ago"), and it is a pure render-time read of the clock with no interval. The row only re-renders when something else disturbs it, so the number shown is however old the last render was — a message posted with `<t:…:R>` reads "in 2 hours" for the rest of the day if the channel stays quiet, and can show a future time long after it has passed.
- Impact: The one timestamp style whose whole point is to be live is the one that is stale. Anyone using it to announce when something starts is telling people the wrong time.
- Fix: in `Timestamp`, when `style === "R"`, set an interval whose period follows the distance (10 s under a minute, 30 s under an hour, then a minute) and re-render; clear it on unmount. About fifteen lines, and it is the only styling of the seven that needs it.
- Effort: S
- Status: open

### WCHAT-060 · P1 · bug · In a split view the caret is pulled into the pane you are not looking at, so typing goes to the wrong conversation
- Where: `web/src/components/composer/Composer.tsx:153` (`useKeepFocused(taRef)` — called with no pane guard), `:565-596` (the hook installs a document-level `pointerup` and `keydown` handler per instance and focuses *its own* textarea), against `:169` where the channel-switch focus does check the pane (`if (paneFocused && …)`); `web/src/components/shell/AppShell.tsx:224-225` (`split={panes.length > 1}`, one `PaneView` — hence one `ChatView` and one `Composer` — per pane)
- What: Every mounted composer adds its own `document` listener. With two panes open, a click anywhere that is not a text field (a message, the member list, a channel row) runs both handlers in mount order: the first focuses the left box, then the second sees that it is not the active element and focuses the right box. The guard at `:579` only bails when the active element is a field *inside a dialog*, so a sibling composer never stops it. The same for the `keydown` branch: the first printable character typed with nothing focused is delivered to the last-mounted pane's textarea.
- Impact: In a split, clicking into the left conversation and typing puts the words in the right conversation's box — and the placeholder, which is the only label, is off to the side where nobody is looking. Press Enter and the message goes to the wrong channel. This is the one class of bug that cannot be taken back in a chat app; a private message ends up in a server channel.
- Fix: pass `paneFocused` into `useKeepFocused` and return early when the pane is not the focused one (the hook is already a no-op on touch, so this is the same shape of guard); better still, install the listeners once for the app and have them focus `document.querySelector('[data-pane-focused] textarea')`. Worth a Playwright check in a two-pane tab afterwards.
- Effort: S
- Status: open

### WCHAT-061 · P1 · a11y · Pressing Space on any focused button outside a dialog types a space into the message box instead of pressing the button
- Where: `web/src/components/composer/Composer.tsx:582-588` (`onKeyDown`: `if (e.key.length !== 1 && e.key !== "Backspace") return;` then `focus()` on the textarea), `:548-557` (`wantsKeyboard` only knows `INPUT`/`TEXTAREA`/`SELECT`/contenteditable; `inOwnLayer` only exempts `[role=dialog]`, `[data-modal-layer]`, `[role=menu]`, `[role=listbox]`)
- What: `" "` has length 1, so Space counts as a printable character. A focused `<button>` is not "wantsKeyboard" and the chat surface is not a dialog, so the handler moves focus to the composer mid-keydown. A native button's Space activation happens on *keyup*, which is now delivered to the textarea — so the button never fires and a space character is inserted into the draft instead. `Backspace` is explicitly included too, so pressing Backspace while a button has focus deletes a character from the draft. (The app relies on exactly this focus-steal to make a typed letter land in the box, so the redirection is the intended, working mechanism — it was just never excluded for keys that belong to a control.)
- Impact: With the keyboard alone, Space does not work on the rail, the channel list, the header buttons, the member list, reaction pills, the attach/emoji/send buttons or anything else outside a modal — and each attempt silently edits the draft. Buttons in modals and menus work, which is why this survived: every a11y pass that tested a dialog passed. Together with WCHAT-017 (no keyboard route to a message action at all) this is most of what makes the app unusable without a mouse.
- Fix: in the `keydown` branch, bail when the key is not a text-producing key (`if (e.key === " " || e.key === "Enter" || e.key === "Backspace") return;` — Backspace-to-edit is not worth this) and when the active element is interactive: `document.activeElement?.closest('button, a[href], [role=button], [role=option], [role=tab], [tabindex]:not([tabindex="-1"]), input, textarea, select')`. Same list for the `pointerup` branch, which today also yanks focus off a button a person just clicked.
- Effort: S
- Status: open

### WCHAT-062 · P2 · bug · Enter does nothing visible for up to 1.5 seconds when the message has a link, and whatever you type in that gap stays in the box after the message is sent
- Where: `web/src/components/composer/Composer.tsx:361` (`const embeds = linkPreviews ? previews.embedsFor(…, PREVIEW_WAIT) : null`), `:380` (`const got = embeds ? await embeds : []`), `:384` (`if (channelRef.current === channelId && textRef.current === sentText) { setText("") … }`), `:403` (`await sendMessage(…)` — which is where the optimistic row is created, `composer/send.ts:52`), `:41` (`PREVIEW_WAIT = 1500`)
- What: The box is cleared and the pending row is created only *after* the uploads and the link-preview wait. So: paste a URL, press Enter, and for up to 1.5 s the text sits in the box with no pending message anywhere — the app looks like it ignored the Enter. Worse, the clear is conditional on the box still holding exactly what was sent; type one more character while waiting (or while an attachment uploads, which can be minutes) and the condition fails, so the text that was already sent stays in the box. The `else if` at `:394` only covers the case where you switched channels.
- Impact: Two failures from one cause. People press Enter twice when nothing happens, which sends the message twice. And after a send with an attachment, the message body is still sitting in the box, which the next Enter sends again — a duplicate message that looks like the user's mistake.
- Fix: clear the box (and the reply state) as soon as the send is accepted, before awaiting anything, and restore the text into the box if the send throws — which is what `send.ts` already does for the message row (`addPending` then `failPending`). If the text must stay for the upload case, remove the sent prefix instead of requiring equality (`if (textRef.current.startsWith(sentText)) setText(textRef.current.slice(sentText.length))`). Separately, create the pending row before the embed wait so Enter always has an immediate effect: the embeds can be attached to the pending payload when they land, or dropped.
- Effort: M
- Status: open

### WCHAT-063 · P2 · security · Link previews are fetched as you type, not when you send — the privacy setting that governs them says the opposite in every language
- Where: `web/src/components/composer/Composer.tsx:120-126` (a 600 ms debounce after each keystroke calls `previews.start(url)` for every URL in the box), `web/src/components/composer/linkPreviews.ts:33` (`fetchPreview` → `api/unfurl`), `web/src/i18n/locales/en.json:1820` (`"Fetch link previews when I send links"`), `:1832` (`"Your device asks the server to look up the page you linked … Turn this off if you do not want the server to see the links you send."`), `web/src/stores/settings.ts:96` (`linkPreviews: true` by default)
- What: The unfurl request leaves the device 600 ms after you stop typing a URL — before you send, and whether or not you ever send. A link pasted into the wrong channel and deleted, a URL in a draft that is abandoned, a link someone pastes to check what it is: all of them are handed to the server (which then fetches the third-party page from its own address) in plaintext, with a timestamp. The setting's label and its explanation both promise this happens on send. The fragment is correctly stripped (`linkPreviews.ts:21-32`, so invite keys never leave), which shows the privacy story was thought about — just not this half of it.
- Impact: In a product whose whole proposition is that the server cannot read your messages, the server gets a live feed of the links you type. It is also the one place where the app's own privacy copy is untrue, which is worse than the leak: a user who read the setting and left it on was misled.
- Fix: either move the fetch to the send path (`embedsFor` already starts anything not yet started, and it waits for it — the 600 ms pre-warm only buys latency), or make the copy true and say the lookup happens while typing. The first is right: the pre-warm's only benefit is that a card is ready 600 ms sooner, against disclosing every abandoned draft. If the latency matters, start the fetch on Enter and let `PREVIEW_WAIT` cover it.
- Effort: S
- Status: open

### WCHAT-064 · P2 · ux · Pasting a long text silently throws away everything past 4,500 characters, and on a phone there is no counter to warn you
- Where: `web/src/components/composer/Composer.tsx:529` (`maxLength={MAX_LEN + 500}`), `:36` (`MAX_LEN = 4000`), `:343` (over the limit, Send toasts and refuses), `:452` (`counterOn = text.length > MAX_LEN - 200`), `web/src/components/composer/Composer.module.css:48` (`@media (max-width: 767px) { .counter { display: none } }`)
- What: The textarea's `maxLength` is 4,500 and the browser enforces it by truncating a paste without a word. So pasting a 9,000-character log leaves 4,500 characters in the box — the second half is gone, not "not yet sent" — and Send then refuses because 4,500 > 4,000. The counter that would explain any of this is hidden on phones, and there is no "too long, upload as a file?" offer anywhere (Discord's answer to the same case).
- Impact: A person pastes something long, sees a box that looks full and a red toast about a limit, trims it to fit — and sends text whose end was destroyed by the paste. There is no undo: the clipboard may well have been overwritten by then.
- Fix: drop `maxLength` (or set it far above the limit) and enforce the limit yourself so nothing is destroyed; show the counter on mobile too (it is 12 px, there is room beside the slowmode label); and when a paste would exceed the limit, offer to attach it as a `.txt` file, which is the behaviour people expect and the upload path already exists.
- Effort: M
- Status: open

### WCHAT-065 · P2 · a11y · The `@`/`:`/`/` autocomplete is invisible to a screen reader: nothing tells the textarea it exists
- Where: `web/src/components/composer/Autocomplete.tsx:29` (`role="listbox"` with a `.acHead` `div` as its first child), `:32` (`role="option"` rows with no `id`), `web/src/components/composer/Composer.tsx:512-531` (the textarea has no `role="combobox"`, no `aria-expanded`, no `aria-controls`, no `aria-activedescendant`, no `aria-autocomplete`)
- What: The popup is a detached listbox. A screen-reader user typing `@ali` is told nothing: not that a list appeared, not how many entries, not which one Enter will pick — and Enter then inserts something they were never told about. The listbox also has a non-option element as a child, which is invalid ARIA (and the keep-in-view code has to compensate with `list.children[index + 1]` at `:19`).
- Impact: Mentions, custom emoji and slash commands are unusable with a screen reader, and surprising: pressing Enter to send inserts a completion instead.
- Fix: the standard editable-combobox wiring — `role="combobox" aria-expanded={!!ac} aria-controls="composer-ac" aria-autocomplete="list" aria-activedescendant={ac ? `ac-${ac.index}` : undefined}` on the textarea, `id` on each option, and the header moved out of the listbox (wrap the popup in a `div` and keep `role="listbox"` on the rows' container, or give the header `role="presentation"`). Add a live-region count ("8 members") if you want it to be genuinely pleasant.
- Effort: M
- Status: open

### WCHAT-066 · P2 · i18n · The reply bar is English in all eleven languages, and the translation for it already exists and is unused
- Where: `web/src/components/composer/Composer.tsx:481` (`<span>Replying to <b>{users[…]?.display_name ?? "Unknown"}</b></span>`), `:484` (`@ {replyTo?.ping ? "ON" : "OFF"}`), `:495` (`{f.file.type.split("/")[0] || "file"}` — the tray's fallback tile), `:540` (`${remaining}s` — the slowmode countdown's unit), `web/src/components/composer/commands.ts:11` (`desc: "Appends ¯\\_(ツ)_/¯ to your message."` — the only one of the six commands left untranslated); the key `composer.replyingTo` = `"Replying to {name}"` exists at `web/src/i18n/locales/en.json:358` **and is translated in all ten other catalogues, and used by nobody**
- What: The reply bar sits above the message box every time anyone replies — the most-used state the composer has — and it is hardcoded English, including the fallback name "Unknown" and the "ON"/"OFF" of the mention toggle. Somebody clearly did the translation work (`composer.replyingTo` is in de/es/fr/hi/ja/ko/pt-BR/ru/zh-CN) and the call site was never switched over. The same line also uses `display_name` raw, where the rest of the chat shows a friend nickname or server nickname via `displayName()`/`memberColor` — so the reply bar can name someone differently from the message list right below it.
- Impact: An Arabic or Japanese user replying to a message reads «Replying to …» and a bare `@ ON`. `tools/i18n_keys_used.py` cannot see it, because no key is asked for.
- Fix: `t("composer.replyingTo", { name })` with `<Tr>` for the bold name, keys for `on`/`off` (or replace the words with an icon plus `aria-pressed`, see WCHAT-067), `time.seconds` for the countdown, `composer.commands.appendsShrug` for `/shrug`, and `displayName(user)` for the name.
- Effort: S
- Status: open

### WCHAT-067 · P3 · a11y · The reply bar's "mention the author" toggle has no name and no pressed state
- Where: `web/src/components/composer/Composer.tsx:484` (`<button className={s.pingBtn} data-on={replyTo?.ping} …>@ {…? "ON" : "OFF"}</button>`), `web/src/components/composer/Composer.module.css:6-7` (`.pingBtn[data-on="true"] { color: var(--text-brand) }`)
- What: A toggle button whose whole label is `@ ON`, with no `aria-pressed`, no `aria-label` and no tooltip explaining what the `@` does. Its state is carried by the word plus an accent colour.
- Impact: A screen reader announces "at ON, button"; nobody is told that this decides whether the person you are replying to gets a notification. It is the only control in the composer that changes what the recipient's phone does.
- Fix: `aria-pressed={!!replyTo?.ping}` and `aria-label={t("composer.mentionAuthor")}`, plus the existing `Tooltip` component with a sentence ("Notify the author of the message you are replying to").
- Effort: S
- Status: open

### WCHAT-068 · P2 · i18n · `@` autocomplete matches ASCII only, so a person whose name is written in Arabic, Japanese or Russian cannot be mentioned by name
- Where: `web/src/components/composer/Composer.tsx:54` (`/(?:^|\s)(@[a-z0-9_.]*|:[\w+-]{2,}|^\/\w*)$/i` — the token that opens the popup), `:219` (the filter does search `display_name` and `nickname`, so the data is there), `web/src/components/composer/mentions.ts:23` (`@([a-z0-9_.]{2,32}|everyone|here)` — the token that is turned into a real mention on send)
- What: The popup only opens while the text after `@` is ASCII letters, digits, `_` and `.`. Type `@أح` or `@たな` and the first non-ASCII character ends the token, so the list closes and no mention is possible; the same regex on the send path means such a token would never become a `<@id>` anyway. The filter behind it already matches display names and nicknames case-insensitively, so this is purely the token pattern.
- Impact: In an eleven-language product, mentioning a person by the name you see requires knowing their Latin username. Everyone in a Japanese or Arabic-speaking channel has to type names in a script they are not writing in.
- Fix: widen the token to `@[^\s@]*` for the popup (it is only used to decide what to search for) and keep the strict pattern for the wire form — the completion inserts `@username`, which `mentions.ts` then resolves, so nothing downstream needs to change. Matching should use `String.prototype.localeCompare`-style folding or a simple `toLocaleLowerCase()`; Android's composer needs the same check.
- Effort: S
- Status: open

### WCHAT-069 · P2 · ux · `@` only finds members the client happens to have loaded, and does not rank the matches
- Where: `web/src/components/composer/Composer.tsx:210-221` (`for (const id of Object.keys(serverState.members)) if (users[id]) pool.set(…)`, then `.filter(u => u.username.includes(query) || …).slice(0, 8)`), `web/src/api/servers.ts:133-138` (`members(id, { q })` — a server-side member search already exists and is not used here)
- What: Two things. The pool is whatever members this client has fetched, so in a server whose member list has not been opened (or is larger than a page) typing `@alice` finds nobody — with no hint that the list is incomplete. And the filter is a plain `includes` over an unordered map, so what you get is in hash order with no preference for a prefix match: typing `@al` can offer "michal" above "alice", and there is no tie-break on nickname, display name or who spoke recently.
- Impact: The mention you want is often absent or fourth. People give up and type the name by hand, which produces a plain-text `@alice` that notifies nobody (`mentions.ts` only rewrites names it can resolve from the loaded users) — so the message looks like a mention and pings no one.
- Fix: rank before slicing — exact username, then prefix on username/nickname/display name, then substring, then recent speakers in the channel; and when fewer than 8 local matches and the channel is in a server, call `servers.members(serverId, { q })` (debounced) and merge. `GroupMemberList`/`MemberList` already upsert what they fetch, so the results warm the same store.
- Effort: M
- Status: open

### WCHAT-070 · P2 · a11y · The send button is 36 px on a phone, and an attachment's spoiler and remove buttons are 32 px
- Where: `web/src/components/composer/Composer.module.css:34` (`.iconBtn { width: 36px; height: 36px }` — the emoji toggle and, on mobile, `.sendMobile`), `:19` (`.cardBtn { width: 32px; height: 32px }`), `:47-48` (`.sendMobile { display: none }` … shown under 768 px), `:56` (the `@media (pointer: coarse)` block exists and enlarges only `.closeBtn` and `.pingBtn`)
- What: The file already knows about coarse pointers and bumps the reply bar's two small controls to 40×36. The send button — the single most-tapped control in the product, and the *only* way to send on a phone, since Enter is a newline there (`Composer.tsx:423-429`) — stays 36 px, sits 2 px from the emoji toggle, and is 6 px from the screen edge (`.wrap` padding 8 px). The attachment tray's spoiler and delete buttons are 32 px and overlap the card's corner.
- Impact: Under the 44 px floor on the controls that matter most, and the two neighbours are "send this now" and "open the emoji picker". Mis-sends and accidental picker openings are the cheap consequence; deleting the wrong attachment is the expensive one.
- Fix: extend the existing `@media (pointer: coarse)` block: `.iconBtn { width: 44px; height: 44px }`, `.btns { gap: 4px }`, `.cardBtn { width: 40px; height: 40px }`. The box's `min-height: 44px` already leaves room.
- Effort: S
- Status: open

### WCHAT-071 · P3 · a11y · An upload's progress is a bare `div`, and a failed upload has no way to try again
- Where: `web/src/components/composer/Composer.tsx:499` (`<div className={s.bar}><i style={{ width: … }} /></div>` — no `role="progressbar"`, no `aria-valuenow`, no text), `:500` (`f.error` as text), `:502-503` (the card's two buttons carry `title` but no `aria-label`), `:404-407` (a failure marks the card and toasts; nothing offers a retry), `web/src/components/composer/Composer.module.css:25` (`.err` covers the whole thumbnail)
- What: There is no accessible signal that an upload is in progress or how far along it is, and the only way out of a failure is to delete the file and add it again — pressing Send again re-uploads every file in the tray from zero, including the ones that already succeeded.
- Impact: A blind user gets silence between "Send" and either a message or a toast, on the operation most likely to take a minute. Everyone else loses their completed uploads when one file in a batch fails.
- Fix: `role="progressbar" aria-valuenow={Math.round(f.progress*100)} aria-valuemin={0} aria-valuemax={100} aria-label={f.name}` on `.bar`; `aria-label` beside the `title` on both card buttons; keep the `blob_id` of a file that finished (the shape `retryPending` in `send.ts:144-147` already uses) so a retry only re-sends what failed, and put a "Try again" button in the `.err` overlay.
- Effort: M
- Status: open

### WCHAT-072 · P3 · bug · In a split view a dragged file shows two "Drag to Upload" cards and can land in the pane you are not looking at
- Where: `web/src/components/composer/DropOverlay.tsx:43-90` (window-level `dragenter`/`drop` handlers, one set per mounted instance, each with its own `over` state and portal), `:67` (`e.defaultPrevented` is what stops the second handler taking the file), `web/src/components/composer/Composer.tsx:465` (one `DropOverlay` per composer), `web/src/components/shell/AppShell.tsx:224-225` (one composer per pane)
- What: With two panes, a file dragged over the window turns on both overlays: two full-screen scrims, each naming its own channel, the later-mounted one painted on top. On drop, the handlers run in mount order and the *first* one wins (the second sees `defaultPrevented`), which is not necessarily the pane whose name the user just read, nor the focused one.
- Impact: The overlay says the file is going to `#random` and it goes to `#general`. Dropping a file into the wrong conversation is not recoverable — the upload is already on the server, visible to everyone in that channel, before the person can react.
- Fix: one overlay for the app, rendered by the shell, targeting the focused pane (`usePanes` already knows which that is); or, minimally, `if (!paneFocused) return` in the composer's `DropOverlay` and one scrim.
- Effort: M
- Status: open

### WCHAT-073 · P3 · bug · `@here` and `@everyone` are the same thing on the wire, so `@here` notifies people who are not here
- Where: `web/src/components/composer/mentions.ts:23-27` (`@everyone` and `@here` both set `everyone = true`), `web/src/components/composer/send.ts:69` (`if (everyone) body.mention_everyone = true` — the only field there is), `web/src/markdown/render.tsx:197-200` (the renderer draws them as two different things), `web/src/components/composer/Composer.tsx:223` (the autocomplete offers `here` as its own entry with its own description, "Notify everyone online in this channel")
- What: The client offers `@here`, describes it as online-only, and renders it distinctly — and then sends it as `mention_everyone`. Nothing in the payload distinguishes the two, so the server cannot scope the notification and no recipient client can either.
- Impact: Someone uses `@here` precisely to avoid waking the whole server, and wakes the whole server. The description in the autocomplete is a promise the product does not keep.
- Fix: either carry the distinction (`mention_here` beside `mention_everyone`, with the server notifying only members whose presence is online — a `[server-api]` change) or drop `@here` from the autocomplete and the renderer until it means something. The first is what the copy already promises.
- Effort: M
- Status: open

### WCHAT-074 · P2 · i18n · Emoji search only understands English, in all eleven languages
- Where: `web/src/components/pickers/emojiIndex.ts:86-89` (`import("emojibase-data/en/compact.json")`, `en/shortcodes/iamcal.json`, `en/shortcodes/emojibase.json`), `:171-191` (`searchEmoji` scores against `e.shortcodes`, `e.label` and `e.tags` — all English), `web/src/components/pickers/EmojiPicker.tsx:464` (the search box, whose placeholder *is* translated: "Find the perfect emoji")
- What: The dataset is pinned to `en`, so labels and tags are English words. A Spanish user typing "corazón", a German typing "herz", an Arabic user typing «قلب» or a Japanese user typing「ねこ」gets "No emoji match" — for emoji that are right there. emojibase ships the same compact data per locale (`emojibase-data/<lang>/compact.json` exists for ar, de, es, fr, hi, it, ja, ko, pt, ru, zh and more), and the app already loads this chunk lazily, so the machinery for it is in place.
- Impact: The emoji picker's search box — the only practical way to find one emoji among 1,800 — works for English speakers only. Every other language has to scroll nine categories. The same index backs `:shortcode:` autocomplete in the composer, where English-only is defensible (a shortcode is a token, and iamcal names are what Slack and Discord use); the *search* is not.
- Fix: load `emojibase-data/${lang}/compact.json` when the app language is not English, falling back to `en` when the locale is missing, and keep the iamcal/emojibase shortcodes as they are (they stay searchable). Merge the localised `label`/`tags` into the entries; `searchEmoji` needs no change beyond lower-casing with `toLocaleLowerCase()`. One extra lazy chunk for non-English users.
- Effort: M
- Status: open

### WCHAT-075 · P2 · ux · On a phone the keyboard covers the picker you opened, the moment you use its search box
- Where: `web/src/components/pickers/EmojiPicker.tsx:19-21` (`focusSearchOnOpen()` returns false on a coarse pointer, with the comment "that raises the keyboard, which covers the picker's sheet"), `web/src/components/pickers/ExpressionPicker.tsx:66-70` (the composer is deliberately blurred on open for the same reason), `web/src/components/pickers/Picker.module.css:37` (`@media (max-width: 767px) { .pop { position: fixed; bottom: 0; height: 60vh } }`), `:10-11` (the search row is the first thing in the sheet); `grep -rn visualViewport web/src` → **no hits anywhere in the app**
- What: The code knows the keyboard covers the sheet — that is why it will not focus the search field for you — and then the field is still the first thing in the sheet, so the first thing anyone does is tap it. Nothing in the product listens to `window.visualViewport`, so the sheet stays pinned to the bottom of the layout viewport, behind the keyboard: on iOS a `position: fixed` bottom sheet is not moved for the keyboard, and 60 vh of sheet minus ~45 vh of keyboard leaves the search row and perhaps one row of emoji.
- Impact: Searching for an emoji, a sticker or a GIF on a phone means typing into a box you cannot see above a grid you cannot see. The same applies to the GIF and sticker tabs, which are search-first surfaces. This is the client the owner uses daily.
- Fix: track the keyboard once, app-wide: on `visualViewport` `resize`/`scroll` set `--kb: calc(<layout height> - <visual height> - <offsetTop>)px` on `:root`, and give the sheet `bottom: var(--kb, 0px); max-height: calc(100dvh - var(--kb, 0px) - 48px)`. The composer's autocomplete popup (`Composer.module.css:40`) wants the same variable. Alternatively move the search row to the *bottom* of the sheet on mobile, which is what iOS apps do, so the keyboard sits under it and the grid stays visible.
- Effort: M
- Status: open

### WCHAT-076 · P2 · bug · A sticker or a GIF sent while you are replying is not a reply, and it ignores slow mode
- Where: `web/src/components/composer/Composer.tsx:475` (`onPick={(g) => { setPicker(false); void sendMessage(channel.id, g.url, { embeds: [...] }) }}`), `:476` (the sticker path, `sendMessage(channel.id, "", { sticker })`), against `:339-403` (`send()`, which assembles `opts.replyTo`/`opts.ping`, checks `remaining > 0` for slow mode, and clears the reply state afterwards)
- What: The two picker paths call `sendMessage` directly and pass neither the reply nor the ping choice, so the message is an ordinary one. The reply bar stays on screen afterwards, so the *next* message becomes the reply instead — and the slow-mode guard is skipped entirely, so in a slow-mode channel the sticker is sent, refused by the server and reported as an error toast.
- Impact: "Reply to this with a sticker" — the single most common way stickers are used — silently produces a loose message, and then mis-attaches the reply to whatever is typed next. In a slow-mode channel the failure is a red toast with no explanation of why the send button was greyed out but the sticker was not.
- Fix: factor the option assembly out of `send()` (reply, ping, slow-mode check, `setReplyTo(null)` after) and use it for all three paths. The GIF path should also respect `MAX_LEN` and the pending text: today it sends the URL as its own message even when the box is full of something else.
- Effort: S
- Status: open

### WCHAT-077 · P3 · ux · "Frequently used" is neither frequency-based nor able to hold a custom emoji
- Where: `web/src/components/pickers/EmojiPicker.tsx:298` (the section title `pickers.emojiPicker.frequentlyUsed`), `:351-354` (`pick` records `recentEmoji` — a plain most-recent-first list, capped at 40 — but only after the two `return`s at `:343` and `:347`, which are the custom-emoji and pack-emoji cases), `web/src/stores/settings.ts` (`recentEmoji`)
- What: The row is recency, labelled frequency, and the two kinds of emoji a community actually reuses — the server's own custom emoji and installed pack emoji — never enter it. Ten uses of `:blobcat:` leave no trace; one use of 🥔 puts the potato at the front.
- Impact: The one shortcut row in the picker is useless exactly where the product is differentiated (custom emoji), and its title promises something it does not do. On a phone, where the categories are a 32 px rail, that row is most of how people pick anything.
- Fix: record custom and pack picks too (key them as `c:<id>` / `p:<id>` and resolve them back through `useExpressions`), and either rank by a small frequency count with recency as the tie-break — which makes the existing title true — or rename the section "Recently used" (`pickers.emojiPicker.recentlyUsed`). Frequency is what Discord does and what the title already claims.
- Effort: M
- Status: open

### WCHAT-078 · P3 · i18n · Two English literals left in the pickers, one of them the accessible name of every GIF
- Where: `web/src/components/pickers/EmojiPicker.tsx:279` (`name: servers[id]?.server.name ?? "Server"` — the section title for a server whose name has not arrived), `web/src/components/pickers/GifPicker.tsx:121` (`label: g.title || "GIF"` — used as `aria-label` on the tile, `GifGrid.tsx:145`)
- What: The rest of both files is fully translated, so these are the residue. The GIF one is the accessible name a screen-reader user hears for every untitled result — most of them.
- Impact: Small, but it is the label of the most numerous control in the picker.
- Fix: `t("pickers.emojiPicker.serverFallback")` and `t("pickers.gifPicker.aGif")` (the catalogue already has `pickers.gifPicker.favoriteGif` in the same shape, used for favourites at `:130`).
- Effort: S
- Status: open

### WCHAT-079 · P3 · code · The emoji grid recomputes each cell's position with a fresh array scan per row
- Where: `web/src/components/pickers/EmojiPicker.tsx:510` (`pos={`${first + rows.slice(first, last).indexOf(r)}:${ci}`}`)
- What: Inside the `map` over `rows.slice(first, last)`, each row slices that window again and searches it for itself — an O(n) scan plus an array allocation per row, so O(n²) over a window that is 40 rows deep, on every scroll frame. The index it is looking for is the `map` callback's own second argument.
- Impact: Wasted work on the only surface in the app that re-renders at 60 fps while scrolling, and a line nobody can read. No user-visible bug today.
- Fix: `rows.slice(first, last).map((r, ri) => …)` and `pos={`${first + ri}:${ci}`}`.
- Effort: S
- Status: open

### WCHAT-080 · P2 · a11y · Every control in the picker except the emoji themselves is 32 px or less on a phone
- Where: `web/src/components/pickers/Picker.module.css:4` (`.tab { padding: 4px 8px; font-size: 16px }` — about 28 px tall: these are the Emoji / GIFs / Stickers tabs), `:7` (`.close { 32px }`), `:14` (`.tone { 32px }`), `:18` (`.toneOption { 32px }`), `:24` (`.cat { 32px }` — the category rail), `:45` (`.gifRemove { 24px }`), `:11` (`.search { height: 32px }`), `:37` (on a phone all of this is a bottom sheet); against `Modal.module.css:19` and `VideoPlayer.module.css`, which both have `@media (pointer: coarse)` bumps
- What: The picker has no coarse-pointer rules at all. On the phone sheet, switching between emoji, GIFs and stickers means hitting a 28 px-tall word; picking a category means a 32 px circle in a 48 px rail; removing a favourite GIF is a 24 px cross in the corner of a tile.
- Impact: The most-opened popover in the app is the least tappable surface in it. Missing the tab strip taps an emoji and inserts it; missing the GIF cross sends the GIF.
- Fix: one block — `@media (pointer: coarse) { .tab { min-height: 40px; padding: 8px 12px } .close, .cat, .tone, .toneOption { width: 40px; height: 40px } .gifRemove { width: 32px; height: 32px } .search { height: 40px } }`. The 48 px rail already has room for 40 px buttons.
- Effort: S
- Status: open

### WCHAT-081 · P2 · a11y · On a phone the search panel covers the whole conversation but is not a dialog: focus stays behind it and the results are never announced
- Where: `web/src/components/search/Search.module.css:39` (`@media (max-width: 767px) { .panel { position: absolute; inset: 0; z-index: 5 } }`), `:38` (a 420 px overlay from 768–1099 px), `web/src/components/search/SearchPanel.tsx:111` (`<aside className={s.panel}>` — no `role`, no `aria-label`), `:113` (the result count lives in a plain `<span>`), `:169` (the progress line, a `<span>`), `web/src/components/chat/ChatView.tsx:335` (the message list and composer stay mounted behind it)
- What: The panel is presentationally a full-screen sheet on a phone and an overlay on a tablet, and structurally a bare `<aside>` beside the chat. Nothing moves focus into it (except the mobile input's `autoFocus`), nothing keeps focus inside it, and the chat it covers keeps every one of its focusable controls — so Tab from the search box goes into the invisible conversation underneath. The two pieces of information the panel exists to give — "12 results" and "searched 4,200 messages in 12 conversations" — are in inert spans, so a screen-reader user who types a query is told nothing at all, ever: there is no live region and the panel is not even named.
- Impact: Search is unusable with a screen reader and confusing with a keyboard. Worse on the phone, where the thing you tab into cannot be seen.
- Fix: `role="dialog" aria-modal="true" aria-label={t("chat.chat.searchMessages")}` (plus `inert` on the chat behind it, see WCHAT-052) when the panel is an overlay — the breakpoint is already a media query, so a `useIsMobile`-style flag decides; move focus to the input on open and back to the search button on close; and make the count a live region: `<span role="status">{t("search.search.results", { count })}</span>`, with the progress line `aria-live="off"` so the running count does not chatter.
- Effort: M
- Status: open

### WCHAT-082 · P2 · i18n · A search result whose message was a sticker or a file reads `[sticker]` / `[3 files]` in every language, and the help panel says "exclude" in English
- Where: `web/src/components/search/SearchPanel.tsx:152` (`m.payload?.sticker ? "[sticker]" : m.payload?.att?.length ? `[${n} file${n === 1 ? "" : "s"}]` : ""`), `:133` (`<dt>-word</dt><dd>exclude</dd>`)
- What: The same shape as the pins panel's `[attachment]` (WCHAT-050): a bracketed English placeholder standing in for a message with no text, with an inline English plural rule. The help list translates every other row and leaves the last description as the bare word "exclude".
- Impact: Any search that turns up a sticker or an image-only message shows English brackets in the middle of a translated panel, and the help that teaches people the query syntax is half-translated.
- Fix: `chat.search.stickerResult`, `chat.search.fileResults` (a proper plural entry — `en.json` already has `{count, plural}` entries), `search.search.excludeHint`. Worth sharing one key set with the pins panel and the sidebar's last-message preview, which have the same problem.
- Effort: S
- Status: open

### WCHAT-083 · P3 · a11y · The search filter suggestions cannot be reached from the keyboard without leaving the query
- Where: `web/src/components/search/SearchSuggestions.tsx:98`/`:111`/`:124` (rows are `<button>`s with `onMouseDown` prevented), `web/src/components/search/SearchPanel.tsx:119-123` (the input and the suggestion list are siblings with no ARIA relationship), `web/src/components/chat/ChatView.tsx:238-247` (on desktop the input is in the header and the suggestions render inside the panel, further down the document)
- What: Typing `from:` opens a list of people, and the only way to choose one is a mouse click or Tab (which on desktop means tabbing out of the header, past the close button, into the panel). There are no arrow keys, no Enter-to-take-the-first, and no `role="combobox"`/`aria-activedescendant` wiring, so a screen reader is not told the list exists — the same gap as the composer's autocomplete (WCHAT-065), in a second surface.
- Impact: The filter syntax the panel spends a paragraph teaching is only completable with a pointer.
- Fix: the same combobox wiring as WCHAT-065, plus ArrowDown/ArrowUp/Enter handled on the input (the rows already come from one array — an `index` in state is all that is missing). Doing both surfaces with one small `useListbox` hook is the cheaper route.
- Effort: M
- Status: open

### WCHAT-084 · P3 · a11y · The clear button in the mobile search box is a 20 px circle
- Where: `web/src/components/search/Search.module.css:52` (`.clear { width: 20px; height: 20px }`), used by `SearchPanel.tsx:120` (the phone's own search box) and `ChatView.tsx:248-252` (the desktop header box), with `:40` bumping only `.close` for coarse pointers
- What: The one control that empties a search is 20 px square, inside a 32 px-tall box, on the surface that is full-screen on a phone.
- Impact: Missing it puts the caret back in the box, which on a phone reopens the keyboard over the results.
- Fix: `@media (pointer: coarse) { .clear { width: 32px; height: 32px; margin-inline-end: -6px } }`.
- Effort: S
- Status: open

### WCHAT-085 · P3 · design · Five search boxes, five different controls
- Where: `web/src/components/chat/ChatView.tsx:236-253` with `Chat.module.css`'s `.searchBox` (28 px tall, magnifier icon, clear button, grows from 180 px to 260 px on focus), `web/src/components/search/SearchPanel.tsx:117-121` with `Search.module.css:6` (32 px, icon, clear), `web/src/components/pickers/EmojiPicker.tsx:464`, `GifPicker.tsx:154` and `StickerPicker.tsx:53` with `Picker.module.css:11` (32 px, no icon, no clear button) — and `web/src/components/common/TextInput.tsx:65`, the shared input, used by none of them
- What: Five places let a person filter a list, and each is a hand-rolled `<input>`: three heights, two with a clear affordance and three without, two with a leading icon and three without, none with `type="search"` (so no platform clear on iOS, no search keyboard hint), none with `enterKeyHint="search"`, and no shared placeholder or `aria-label` convention. `common/TextInput` is a bordered form field and genuinely does not fit an inline filter box — which is the point: the missing component is a `SearchBox`, not a use of `TextInput`.
- Impact: The pickers' boxes cannot be cleared without selecting the text and deleting it, which on a phone is the worst interaction in the app; and the app looks assembled rather than designed when two search boxes are visible at once (the header's and the picker's).
- Fix: one `common/SearchBox` — 32 px (40 px on coarse pointers), leading magnifier, trailing clear button that appears when there is text, `type="search"`, `enterKeyHint="search"`, `aria-label` required by the props type — and replace all five. The header's grow-on-focus can stay as a prop.
- Effort: M
- Status: open

### WCHAT-086 · P2 · i18n · A Rich Presence card is glued together from English words: "by", "on", "of", "left", "elapsed"
- Where: `web/src/components/activity/ActivityCard.tsx:37` (`text: a.type === 2 ? `by ${a.state}` : …`), `:38` (`` `on ${a.assets.large_text}` ``), `:41` (`` ` (${a.party.size[0]} of ${a.party.size[1]})` ``), `:67` (`{formatClock(clock.remaining)} left`), `:68` (`{formatClock(clock.elapsed)} elapsed`); `web/src/lib/activity.ts`'s `activityHeading` *is* translated, which is why the rest looks deliberate
- What: Five hardcoded English words in the card that is shown for everybody who is listening to something or playing something — "by Rick Astley", "on Whenever You Need Somebody", "(2 of 4)", "1:12 left", "43:20 elapsed". The card's heading ("Listening to Spotify") goes through `t()`; these do not.
- Impact: Every profile of anyone playing music reads half-English in ten languages, and in Arabic the English fragment also flips the line's direction around the artist's name. Rich Presence is a shipped, visible feature (there is a banner component for it), so this is on screen daily.
- Fix: `activity.card.byArtist` (`"by {name}"`), `activity.card.onAlbum`, `activity.card.partySize` (`"({current} of {max})"`), `activity.card.timeLeft`, `activity.card.timeElapsed`. All five want to be whole sentences with placeholders, not concatenations, so a language can reorder them.
- Effort: S
- Status: open

### WCHAT-087 · P3 · i18n · "Member since" and "Friends since" are formatted in the browser's language, not the app's
- Where: `web/src/components/profile/ProfileCard.tsx:30` (`const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })`), used at `:358` and `:363`; `web/src/lib/time.ts:32-44` exists to prevent exactly this and caches a formatter per language
- What: The third instance of the same slip in this area (`Embeds.tsx:121` is WCHAT-034, `MemberList.tsx:20`'s collator is WCHAT-053). `undefined` means "the browser's locale", so an Arabic or Japanese user on an English system reads "Sep 18, 2026" in Latin script and English month names inside an otherwise translated card.
- Impact: Small on its own; together with the other two it is a pattern, and the pattern is what should be fixed.
- Fix: add a `shortDate` kind to `lib/time.ts` and call `formatShortDate(ms)`. Then make it impossible to regress: an ESLint `no-restricted-syntax` rule banning `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString`/`new Intl.*` outside `lib/time.ts` would have caught all three (`grep -rn "toLocale\|new Intl" web/src --include='*.tsx' --include='*.ts' | grep -v lib/time` is the check).
- Effort: S
- Status: open

### WCHAT-088 · P2 · design · Two people can compare their safety numbers and the app remembers nothing: there is no "verified" state
- Where: `web/src/components/profile/KeyVerify.tsx:37-43` (`verdictFor` has exactly three outcomes: `first`, `same`, `changed`), `:71-98` (`KeyStatusChip` — "New to this device" / "Same key as before" / "Key changed"), `web/src/lib/keyPins.ts:31-39` (the `PinVerdict` union; there is no verified concept anywhere in the file), `web/src/components/modals/VerifyKeyModal.tsx:18` (the dialog's only action is "Done" — a `web-shell-ui` file)
- What: The whole dialog exists so that two people can read thirty digits to each other and establish that no server sat in the middle. When they have done it, there is nothing to press. The chip goes on saying "New to this device", and the next time the app is restarted it says "Same key as before" — which is what it would say for a key the server substituted before this device ever saw the person. The honest copy (`noteWhatThisProves`) is right to be careful, and that is exactly why the missing piece hurts: the product tells you the check proves nothing *and* gives you no way to make it prove something.
- Impact: The one defence against a malicious server is a ritual with no result. A user cannot tell, a week later, which of their contacts they have checked; a key change after a verification gets the same warning as any other; and the effort of comparing digits is never rewarded, so nobody does it twice. Signal, Element and WhatsApp all store the verification and escalate a later change for verified contacts — that escalation is the actual value.
- Fix: a `verified` flag beside the pin in `lib/keyPins.ts` (key + timestamp), a "I've compared these" / "Mark as verified" button in `VerifyKeyModal` (and an "unverify"), a fourth chip state `encryption.chipVerified` with the `ShieldCheck` icon reserved for it (`same` moves to a neutral icon), and a louder, blocking `KeyChangeModal` when a *verified* key changes — "you verified this person's key in person on 12 March; it is now different" is a sentence that means something. Android's `KeyVerify.kt` needs the same states, and the flag belongs in the encrypted settings blob so it follows the account to a new device.
- Effort: M
- Status: open

### WCHAT-089 · P3 · security · An activity card's title, lines and buttons are attacker-chosen labels over attacker-chosen links, with the destination shown nowhere
- Where: `web/src/components/activity/ActivityCard.tsx:9-15` (`Linked` sets `title={title}` — the *text*, never the href), `:63` (the title links to `a.details_url`), `:65` (each line to `l.href`), `:83` (`<a href={b.url}>{b.label}</a>` for up to two Rich Presence buttons)
- What: Everything in the card comes from another user's presence payload, which their local app (or a modified client) fills in freely. A button labelled "Verify your Nexa account" pointing at `https://evil.example` renders as a full-width button in a profile, and there is no `title`, no host, and no confirmation on the way out. The server does validate the *scheme* and drops non-https and malformed urls (`internal/gateway/activity.go`, covered by `activity_test.go:99-119`), and it proxies the images — so this is not an IP leak or an XSS, it is the same phishing surface as WCHAT-055 with a button instead of a link.
- Impact: A stranger in a shared server can put a convincing button in their own profile and wait. Lower reach than a masked link in a message, hence P3, but the same fix.
- Fix: show the host: `title={b.url}` on the buttons and lines, and the host in small text under a button's label (Discord shows the domain on hover); or route every activity link through the same "you are leaving" confirmation WCHAT-055 asks for, which would cover both surfaces at once.
- Effort: S
- Status: open

### WCHAT-090 · P3 · a11y · The profile card's own controls are 22–32 px on a phone, where the card is full-screen
- Where: `web/src/components/profile/Profile.module.css:123` (`.noteBtn { padding: 2px }` around an 18 px icon — a 22 px target), `:65` (`.bannerBtn { 32px }` — "Add friend", "Accept", "More", "Close"), `:129` (`.chip { height: 22px }`), `:132`/`:135` (`.primary`/`.square` 36 px); the file has no `@media (pointer: coarse)` rule at all, while `Activity.module.css:22` next door does have one
- What: On a phone the profile opens as a near-full-screen modal, and its actions are a 32 px circle on the banner (including the only close button) and a 22 px notebook icon beside the name. The sibling activity card already bumps its buttons to 40 px on coarse pointers, so the convention exists.
- Impact: Accepting a friend request or closing the profile is a 32 px target in the corner of the screen; the note button is the smallest control in the product.
- Fix: `@media (pointer: coarse) { .bannerBtn { width: 40px; height: 40px } .noteBtn { padding: 10px; margin: -10px } .primary, .square, .fullBtn { height: 44px } }`. This is the fourth surface in this area with the same gap (WCHAT-070 composer, WCHAT-080 pickers, WCHAT-084 search) — worth one pass over every `width: <n>px; height: <n>px` on a `button` in the area, with a checklist rather than four separate fixes.
- Effort: S
- Status: open

### WCHAT-091 · P2 · bug · A DM that will not load throws you back to the conversation list with no explanation, whatever went wrong
- Where: `web/src/pages/DMPage.tsx:28-35` (`channelsApi.get(channelId).catch(() => setMissing(true))` — every failure is "missing"), `:41-43` (`if (missing) nav("/channels/@me", { replace: true })` — no toast, no page), against `web/src/pages/ServerPage.tsx:29-34` and `:66-74`, where the same situation is handled properly: 403/404 toast and go home, anything else shows a page with a "Try again" button, with a comment explaining exactly why ("a network blip indistinguishable from being removed")
- What: The lesson was learned for servers and not applied to DMs. Any error from `GET /channels/:id` — offline, a 500, a timeout, an expired token being refreshed — sends the reader to `/channels/@me` with `replace: true`, so Back does not even return them, and nothing is said.
- Impact: Tapping a DM notification on a flaky connection closes the conversation you were trying to open, silently. It reads as the app losing the conversation, and the natural response — tap it again — does the same thing. This is the most common deep link in the product (a notification, a link to a message, restoring a tab).
- Fix: mirror `ServerPage`: distinguish 403/404 (toast + home) from anything else (stay, show "That conversation could not be opened / The request did not get through" with Try again). The strings exist as `server.thatServerCouldNotBeOpened`/`server.theRequestDidNotGetThrough` and want DM-shaped siblings.
- Effort: S
- Status: open

### WCHAT-092 · P3 · i18n · A private sticker pack's page says "private" in English
- Where: `web/src/pages/StickerPackPage.tsx:90` (`{packCount(pack)}{pack.public ? "" : " · private"}`)
- What: The one untranslated string on an otherwise fully translated share page — and it is the word that tells the owner why nobody else can open the link.
- Fix: `t("stickerPack.privateSuffix")`, or better `t("stickerPack.countAndPrivate", { count, })` so the separator is the language's.
- Effort: S
- Status: open

### WCHAT-093 · P3 · a11y · Zooming a picture from the keyboard always zooms the middle, and nothing can move the picture afterwards
- Where: `web/src/components/common/ZoomPan.tsx` (the whole component: `onPointerDown`/`onPointerMove`/`onDoubleClick`/`onClick` and a `wheel` listener — there is no `onKeyDown` anywhere in the file, and no `tabIndex`), `web/src/components/chat/Attachments.tsx:109-122` (the lightbox's only key handling: `+`/`=`, `-`, Escape), `:87` (`zoomBy: (f) => zoomAt({ x: 0, y: 0 }, f)`)
- What: `zoomBy` — the entry point both the `+`/`-` keys and the toolbar's zoom buttons use — always zooms about `{x: 0, y: 0}`, the centre of the stage, and panning exists only as a pointer gesture (drag once `scale > 1`, or two fingers). So a person without a pointer can magnify a picture to 300 % and then only ever see its middle third; the corners of a screenshot, which is what people zoom into, are unreachable. A mouse user has the same problem if they use the `+`/`-` buttons in the bar instead of the wheel, but they can drag afterwards.
- Impact: The one control the viewer offers a keyboard user (zoom) is useless without the pan that only a pointer has. Low-vision users are exactly the ones who use the zoom.
- Fix: give `ZoomPan` `tabIndex={0}` and an `onKeyDown`: arrows pan by ~10 % of the box (Shift for a larger step), `+`/`-` zoom about the centre, `0` resets — the maths is already in `clampView`, so each arrow is one `clampView({...view, x: x ± step}, box())`. Then move the lightbox's `+`/`-`/Escape handling onto that element instead of `document` (today it is a document-level listener with no check on `e.target`, so with the composer still focused behind the viewer — see WCHAT-030 — typing a `+` into the message box zooms the picture as well).
- Effort: S
- Status: open

### WCHAT-094 · P3 · a11y · Reaction pills are 24 px tall and 4 px apart on a phone — on both clients
- Where: `web/src/components/chat/Chat.module.css:113` (`.pill { … height: 24px; padding: 0 6px; }`), `:114` (`.addReact { width: 28px; height: 24px; }`), `:106` (`.reactions { … gap: 4px }`), and no override in the `@media (max-width: 767px)` block at `:220-237`; the same numbers on the phone at `android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt:446` (`.height(24.dp).padding(horizontal = 6.dp)`) and `:473`
- What: A reaction pill is a 24 px-high button holding a 16 px emoji, and a row of them is packed at a 4 px gap. Both platforms are well under the 44 px / 48 dp both platform guidelines ask for, and neither grows the target on touch (the pill has no extra padding and no `::before` hit area).
- Impact: Tapping a reaction is a toggle that everyone in the channel sees, so a mis-tap is not a silent miss — it adds your name to a reaction you did not mean, or removes the one you did. Three or four pills in a row on a 360 px screen means the misses are frequent, and the `+` beside them (28×24) is the smallest target of the set.
- Fix: on `(hover: none)` give `.pill`/`.addReact` `min-height: 32px` and `padding: 0 10px`, and raise the row gap to 6 px; a transparent hit area (`position: relative` + a `::after { inset: -8px }`) buys the rest without changing the look. Android wants the same `Modifier.heightIn(min = 32.dp)` with `minimumInteractiveComponentSize()` on the clickable.
- Effort: S
- Status: open

### WCHAT-095 · P3 · parity · The phone can swipe a message to reply; the web app — which is the phone app on iOS — makes you hold it for half a second and pick from a menu
- Where: `android/app/src/main/java/xyz/evilion/chat/ui/chat/SwipeToReply.kt` (a 64 dp drag toward the start edge, an arrow that fills in, a haptic buzz at the trigger, RTL-aware, and it refuses the gesture when a scroller or a slider has claimed it) wrapped around every row at `MessageRow.kt:133`; against `web/src/components/chat/MessageItem.tsx:177` (`onContextMenu` → `buildMessageMenu`) and `web/src/lib/longPress.ts:12` (`HOLD_MS = 450`), which is the only way to reply on a touch screen in the browser — the hover toolbar is behind `@media (hover: hover)` (`Chat.module.css:99-101`)
- What: Replying is the most-used action on a message, and on the web phone client it costs a 450 ms hold, a menu that covers the conversation, and a second tap on the fourth item. The Android app (and Discord, WhatsApp, Signal, Telegram) does it with one gesture. The owner's daily driver is the iOS home-screen app, which is this web client.
- Impact: The platform the owner uses most has the slowest reply in the family, and the gesture people arrive expecting does nothing.
- Fix: a `useSwipeAction` on `.msg` mirroring `SwipeToReply.kt`'s rules — claim only a horizontal drag toward the inline-start edge past the touch slop, ignore it when `data-no-swipe` or a scroller is under the finger, translate the row, reveal a reply arrow that fills in, `navigator.vibrate?.(8)` at the trigger (the long-press helper already does this), fire on release past 64 px and spring back otherwise. The shell's drawer takes the other direction, exactly as on Android, so the two do not collide. Note `MessageItem` already disables the gesture for system rows on Android (`enabled = type == "default" || "reply"`) — keep that.
- Effort: M
- Status: open

### WCHAT-096 · P3 · ux · In a channel where you may not add reactions, the web still offers "Add Reaction" and a `+` pill, and only the server says no
- Where: `web/src/components/chat/messageMenu.ts:65` (`items.push({ id: "react", … })` — unconditional, while `canEdit`/`canPin`/`canDelete` two lines below each gate their item), `web/src/components/chat/Reactions.tsx` (the `.addReact` `+` is rendered whenever `msg.reactions.length > 0`, and is always visible on touch via `Chat.module.css:105`); the phone gets this right at `android/.../ui/chat/MessageActions.kt:79` (`canReact = isDm || perms.has(P.ADD_REACTIONS)`, and the quick-reaction row and the picker entry are inside `if (canReact)`); the server refuses with 403 (`internal/api/message_handlers.go:516`, tested in `internal/api/message_handlers_test.go:185`)
- What: With Add Reactions denied — a common setting in an announcements channel, which is the example the server's own test uses — the web shows the full reaction affordance. Opening the picker, hunting for an emoji and tapping it produces an error toast and the optimistic pill disappearing again.
- Impact: The one channel type where this permission is actually used is the one where everybody hits it, and the app's answer arrives after the work rather than before it. Reacting to your *own* reaction row still works (removing is allowed), so the state looks arbitrary.
- Fix: compute the same `canReact` the phone does (`useChannels` + `canI(server, P.ADD_REACTIONS, channelId)`), hide the menu item and the `+`, and leave existing pills tappable only to take your own reaction back (`r.me`) — which is what the server allows.
- Effort: S
- Status: open

### WCHAT-097 · P2 · parity · [android] The phone's composer knows `@` and nothing else: no `/` commands, no `#` channel links, no `:emoji:` list, no roles or `@everyone`
- Where: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:456-503` (`MentionSuggestions` — the only popup there is, and its pool is `users` filtered by `username`/`displayName`), `:179` (`EmojiIndex.expandShortcodes(value.text.trim())` at send, with no suggestion list while typing); against `web/src/components/composer/Autocomplete.tsx` and `web/src/components/composer/commands.ts:9-17` (`/shrug`, `/tableflip`, `/unflip`, `/lenny`, `/me`, `/spoiler`) and `web/src/components/composer/mentions.ts` (`@` over members **and roles and `@everyone`**, `#` over channels, `:` over unicode and custom emoji)
- What: Four of the composer's five completions exist only in the browser. On the phone: typing `/me` sends the literal text `/me …`; there is no way to write `||spoiler||` or an italic action line without knowing the markdown; a channel cannot be linked at all, because `#general` is plain text unless the exact `<#id>` token is typed; `:sm` offers nothing, though `:smile:` typed in full does expand at send; and `@` never offers a role or `@everyone`, so a moderator cannot ping a role from their phone.
- Impact: The phone is the client people write from, and it is the one that cannot use half of what the app understands. A `/spoiler` typed there is published verbatim — the failure is silent and public.
- Fix: the completion rules are pure functions in the web (`commands.ts`, `mentions.ts`) and have direct Kotlin analogues already sitting beside this file (`EmojiIndex`, `AppState.servers[serverId].roles`, `AppState.channels`). Extend the existing regex to `[@#:/]`, switch the candidate list on the sigil, and run `applyCommand`'s equivalent in `doSend()` before `expandShortcodes`. The popup, its position provider and its row are all already here.
- Effort: M
- Status: open

### WCHAT-098 · P3 · parity · [android] A picture cannot be sent as a spoiler from the phone, and the button that takes one off the tray is 18 dp
- Where: `android/.../ui/chat/Composer.kt:300-336` (the staged tray: a 72 dp thumbnail, and one `Icon(Lucide.X, … .size(18.dp))` in its corner — no other control), `:92-97` (`Staged` has no `spoiler` field and `Uploads.send` is never told about one); against `web/src/components/composer/Composer.tsx:502` (an eye / eye-off button per file, which stays usable during the upload — `:373-376`)
- What: The web composer gives every staged file a spoiler toggle; the phone has no such thing, and `AttachmentMeta.spoiler` is only ever read on the phone, never written. So a spoilered picture can be received on Android but not sent from it. The single control the tray does have — remove — is an 18 dp target inside a 72 dp thumbnail, well under the 48 dp minimum, and it sits at the very corner where a thumb naturally rests.
- Impact: Whoever uses the phone as their main client cannot warn people about a picture, and takes the wrong file off the tray often enough to notice.
- Fix: add `spoiler: Boolean` to `Staged`, an eye button beside the X (both at `minimumInteractiveComponentSize()`), and pass it into the `AttachmentMeta` the upload builds. The receiving side already honours the flag.
- Effort: S
- Status: open

### WCHAT-099 · P3 · bug · [android] A sticker or GIF sent from the phone is not a reply either, and it skips the slow-mode wait — the same defect as WCHAT-076, in the other client
- Where: `android/.../ui/chat/Composer.kt:428-450` (`onGif` and `onSticker` both call `MessageService.send(channelId, …)` straight from the picker sheet, with no `replyTo = replyId`, no `ping`, and outside the `doSend()` path that sets `slowModeUntil`), against `:209-215` where a typed message passes all three
- What: While a reply is staged — the reply bar is on screen, the person's name in it — picking a GIF or a sticker sends a plain message and leaves the reply bar up, so the next thing typed answers a conversation that has already moved on. The slow-mode countdown is likewise only armed by `doSend`, so stickers are an unlimited channel in a slow-moded room until the server refuses one, and the refusal is a bare toast.
- Impact: Replying with a sticker is the ordinary way people use stickers, and on both clients it quietly is not a reply. Sending it from a slow-moded channel produces an error that looks arbitrary.
- Fix: route both through `doSend()`'s tail — pass `replyTo`/`ping`, clear the reply on success, and arm `slowModeUntil` — or lift that tail into one `afterSend()` the three call sites share. Fixing WCHAT-076 and this together keeps the two clients honest.
- Effort: S
- Status: open

### WCHAT-100 · P3 · parity · [android] Every picture in a message is stretched to 320 dp and centre-cropped, so a tall screenshot loses its top and bottom and a tiny PNG is blown up
- Where: `android/.../ui/chat/AttachmentViews.kt:80-97` (`ratio = (w / h).coerceIn(0.4f, 2.5f)`, `Modifier.widthIn(max = 320.dp).fillMaxWidth().aspectRatio(ratio)`, `AsyncImage(… contentScale = ContentScale.Crop)`), and the same clamp for video at `:124-131` (`0.5f..2.2f`); against `web/src/components/chat/fitMedia.ts:12-17`, which scales the real dimensions down into 550×350, keeps the shape exactly, and only ever scales *up* a picture smaller than 100 px
- What: The phone ignores the picture's real size. Everything is one fixed width, and anything outside the clamped aspect range is cropped to it: a long screenshot (a chat log, a receipt, a web page — ratio well below 0.4) shows only its middle band, and a panorama loses its ends. In the other direction a 48×48 sticker-ish PNG or a small diagram is upscaled 6× into a blurry 320 dp block. The web shows exactly what was sent, at its own size, in both cases.
- Impact: Screenshots are the most-sent kind of picture and the phone is where they are read. Nothing says the picture is cropped, so a reader can miss the part that mattered and not know it — they have to tap through to the viewer to find out.
- Fix: keep the declared `width`/`height` (`AttachmentMeta` carries both) and compute the box the way `fitMedia` does — `min(1, maxW/w, maxH/h)` in dp, with a floor for tiny pictures — then `ContentScale.Fit`. Only when the dimensions are missing does a default box make sense, and there `Fit` still beats `Crop`.
- Effort: S
- Status: open

### WCHAT-101 · P3 · i18n · A mention of someone the client has not met reads "@unknown-user" — in English, on both clients, inside the message text
- Where: `web/src/markdown/render.tsx:267` (`user ? user.display_name || user.username || "unknown-user" : "unknown-user"`), `:283` (`"deleted-channel"`), `:293` (`"unknown-role"`); copied deliberately on the phone at `android/.../ui/markdown/Render.kt:495-501`, whose comment says so ("the three fallbacks are the web renderer's own literals … which it does not translate"). Two lines above, `@everyone`/`@here` *are* translated (`t("render.everyone")`), so the file is inconsistent with itself.
- What: These are not developer strings; they are rendered into the sentence a person is reading, styled as a mention chip. They show whenever a mention points at someone who has left, a channel that was deleted, a role that was removed, or simply a user the client has not loaded yet — which, since the member list is lazy, happens on a fresh load of an old conversation.
- Impact: An Arabic or Japanese reader gets `@unknown-user` in a hyphenated English slug in the middle of their own language, and it reads like a bug rather than "someone who is gone". Both clients, so translating it once in the catalogue fixes both.
- Fix: three keys (`render.unknownUser`, `render.deletedChannel`, `render.unknownRole`) beside the two that already exist, worded as text rather than as ids ("someone", "a deleted channel", "a role"). Android reads the same catalogue, so it only needs the call swapped. `web/src/markdown/render.test.tsx:70` and `:87` pin the current literals and want updating with it.
- Effort: S
- Status: open

### WCHAT-102 · P3 · parity · [android] What someone is listening to or playing is delivered to the phone and shown nowhere
- Where: `android/.../net/Models.kt:441` (`data class Presence(… val activities: List<Activity> = emptyList())` — parsed, and the only other use of the word "activities" anywhere under `android/app/src/main/java` is an emoji category name), `android/.../ui/sheets/ProfileSheet.kt:116-122` (the profile sheet shows `statusText` and the status emoji, and stops there); against the web, which draws it in five places: `web/src/components/profile/ProfileCard.tsx:335` (`<ActivityList>` — artwork, title, two lines, elapsed time, buttons), `web/src/components/chat/MemberList.tsx:194`, `web/src/components/chat/GroupMemberList.tsx:68`, `web/src/components/chat/ChatView.tsx:199` (the DM header) and `web/src/components/sidebar/DMSidebar.tsx:81`, all via `activity/StatusLine.tsx` with a per-kind icon
- What: Rich presence is a whole feature that exists on the wire and in the Android data model, and has no Android UI. On the phone a friend playing a game or listening to something looks exactly like a friend doing nothing; the member list and the DM list have no second line at all, and the profile sheet does not mention it.
- Impact: The social signal the feature exists for is invisible on the client people carry. It also makes the two clients disagree about the same person at the same moment, which reads as the phone being out of date.
- Fix: port `StatusLine` first — one row, the kind icon plus `activityParts()`'s line, under the name in the member sheet, the friends list and the DM list — then the card in the profile sheet. `lib/activity.ts` is the whole of the formatting logic and is about forty lines. Note WCHAT-086 (the card's English glue words) and WCHAT-089 (its attacker-chosen labels and links) should be fixed *before* this is ported, so the phone does not inherit them.
- Effort: M
- Status: open

### WCHAT-103 · P3 · ux · A slash command the app does not know is published to the channel as ordinary text, including `/me` with nothing after it
- Where: `web/src/components/composer/commands.ts:22-31` (`applyCommand` returns `null` for an unknown command, for `/me` with no argument and for `/spoiler` with no argument), `web/src/components/composer/Composer.tsx:344-345` (`const expanded = applyCommand(body); if (expanded !== null) body = expanded;` — a `null` silently leaves the raw text to be sent)
- What: The composer advertises six commands in its `/` autocomplete, and anything else typed after a slash is sent verbatim. `/ban alice`, `/kick bob`, `/timeout 10m`, `/giphy cats`, `/nick x` — every command a person arrives from another chat app expecting — appear in the conversation as messages. So does a bare `/me`, because the no-argument branch returns `null` rather than doing nothing.
- Impact: The failure is public: the message goes to everyone in the channel, and whoever typed it learns the command does not exist only by seeing their own attempt published. In a moderated server "/ban someone" landing in the channel as text is a small humiliation with a real audience.
- Fix: `applyCommand` should distinguish "not a command" (no leading slash → send as typed) from "a command this app does not have" and "a command that needs an argument". For the latter two, refuse the send and toast — `composer.composer.*` already has the toast pattern two lines above — or, better, keep the `/` autocomplete open and show "No such command" while the text still looks like one. `commands.test.ts` covers only `/shrug`; the same test should pin `/me`, `/spoiler`, and the refusal.
- Effort: S
- Status: open
