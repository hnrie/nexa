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
