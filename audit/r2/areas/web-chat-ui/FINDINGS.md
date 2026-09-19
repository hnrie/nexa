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
