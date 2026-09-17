# Web UI and UX

## Summary

`web/` is a genuinely careful piece of front-end work. The token file is real (`web/src/styles/tokens.css`), the CSS is compact and commented with the *reason* for a rule rather than the rule, and a surprising amount of hard stuff is already right: `min-width: 0` appears on nearly every truncating flex child, `overscroll-behavior: contain` is on every nested scroller, `@media (hover: hover)` guards every reveal-on-hover control because iOS turns a reveal tap into a hover, `dvh` is used alongside `vh`, and `alt=""` versus `alt={name}` is decided per image rather than by habit. Modal focus *restoration* works, the message list has a real retry-with-backoff that listens for `online`, and `Avatar.module.css` draws presence as four distinct *shapes* rather than four colours. That is better than most Discord clones and better than a lot of shipping products.

The problems cluster in five places.

**RTL is about 85% done and the missing 15% is load-bearing.** Arabic ships (`web/src/i18n/core.ts:59`), `dir` is set on `<html>` (`web/src/i18n/index.tsx:129`), and most of the CSS is logical. But a handful of four-value physical `padding` shorthands were never converted, and in each case the element positioned against them *was*. The result is not a cosmetic drift — in Arabic the avatar sits on top of the message text, the search icon sits on top of what you typed, and the profile card's avatar sits on top of the name.

**The themes were tested in dark.** Syntax highlighting is a One Dark palette painted onto a near-white `--code-bg` in the light theme. The mention hover is white text on a light lavender. The date-picker input is pinned to `color-scheme: dark`. And the user-chosen accent — ten presets plus a free colour input — recolours `--brand` without ever recomputing `--on-brand`, so four of the ten shipped presets produce white text on a light fill for every primary button and every hovered context-menu item.

**Reduced motion removes information rather than motion.** One global rule clamps every animation and transition to 0.001ms. That is the right instinct applied one step too bluntly: the spinner stops spinning (three dead dots), the loading state on every button becomes a blank button, the jump-to-message flash becomes invisible, and the voice speaking-ring — explicitly written with a slow fade so the pauses between words don't flicker — becomes a strobe.

**Keyboard and screen-reader support stops at the custom controls.** Modals don't trap Tab, dialogs have no accessible name, the context menu can't be driven with arrows, the quick switcher's selection is CSS-only, drag-reorder (roles, stickers, servers) has no keyboard or touch path at all, and toasts mount their live region at the same moment as their content so nothing is ever announced.

**Failure is often drawn as success.** Eight surfaces render a fetch rejection as a cheerful empty state — "No one is banned, keep it that way", "No GIFs match", and, on the download page, the flat assertion that "The Android app is being worked on and is not available to download at the moment." The admin page spins forever on a failed request, the security page reports 2FA as *off* when it merely failed to check, search claims "All history loaded" when channels were skipped, and joining a call with a blocked microphone renders a completely normal, live-looking call. Where an error *is* shown, thirteen call sites fall back to `err.message`, which for anything unmapped is the literal string `Request failed with status 500.`

The front page reads well and the argument is clear — twelve feature cards is more than the argument needs, but the hero, the three strips and the comparison table do the work. Its problems are mechanical: the safe-area insets in the header and footer are swapped left-for-right, no screenshot or video carries an intrinsic size so the page reflows as it loads, the two autoplaying loops ignore `prefers-reduced-motion` entirely, and at phone width the header hides "Log in", leaving a returning visitor nothing to press but "Get started".

One thing a list of problems flattens: very little of this is architectural. Most of what follows is the last mile on work that is already ninety percent right — a `padding` shorthand that was never converted to logical, a `.catch` that sets `[]` instead of an error state, an `aria-` attribute on the wrong element, a `vh` where the file three doors down correctly used `dvh`. In almost every case the correct pattern already exists somewhere in the codebase; it just wasn't applied uniformly. That is a good position to be in, and it is why so many of the fixes below are two lines.

The project builds clean (`tsc --noEmit && vite build`, 9.2s). Nothing in `web/src` was modified.

Counts: **30 BROKEN, 59 BAD, 49 POLISH, 15 IDEA** — 153 findings.

---

## Findings

### [BROKEN] RTL: the avatar is drawn on top of the message text in Arabic

- **Where**: `web/src/components/chat/Chat.module.css:47`, `:56`, `:105`, `:107`, `:207`
- **What**: `.msg { padding: 2px 48px 2px 72px; }` is the physical four-value shorthand — 72px of gutter is reserved on the *left*, always. The avatar that fills the gutter is positioned logically: `.avatar { inset-inline-start: 16px; }`. In `dir="rtl"` the avatar moves to the right edge while the 72px reservation stays on the left, so the 40px avatar lands over text that is allowed to run to within 48px of the right edge. `.system` / `.sysIcon` (`:105`, `:107`) have exactly the same split, and the phone override at `:207` repeats it.
- **Why it matters**: This is the main surface of the product. Every message in the app is unreadable in Arabic, and every other rule in the file is meticulously logical, so it reads as an oversight rather than a decision.
- **Fix**: `padding-block: 2px; padding-inline: 72px 48px;` (and `16px 64px` in the phone block, `72px 16px` for `.system`). The `[data-selecting]` overrides at `:181`–`:185` are already logical and will then compose correctly.

### [BROKEN] RTL: the Friends search icon sits on top of what you type

- **Where**: `web/src/components/friends/Friends.module.css:12`, `:14`
- **What**: `.search input { padding: 0 40px 0 12px; }` reserves the 40px for the icon on the physical right; `.search svg { inset-inline-end: 12px; }` moves the icon to the *left* in RTL. Text then starts 12px from the left edge, directly under the magnifier.
- **Why it matters**: The Add Friend flow is where a new Arabic-speaking user starts.
- **Fix**: `padding-inline: 12px 40px;`.

### [BROKEN] RTL: the account card's avatar overlaps the display name

- **Where**: `web/src/components/settings/Settings.module.css:24`–`:25`
- **What**: `.cardHead { padding: 0 16px 16px 120px; }` against `.cardAvatar { inset-inline-start: 16px; }`. Same shape as the message-row bug: the 120px reservation is pinned left, the 92px avatar flips right, and it lands on `.cardText`.
- **Why it matters**: Settings → My Account is the first screen an Arabic user visits after signing up.
- **Fix**: `padding-block: 0 16px; padding-inline: 120px 16px;`. `.nav` at `:4` (`padding: 60px 6px 60px 20px`) has the same shorthand and is cosmetic, but worth the same treatment.

### [BROKEN] RTL: the presence dot moves but the hole cut for it does not

- **Where**: `web/src/components/common/Avatar.module.css:6`–`:9`
- **What**: `.status { inset-inline-end: 0; bottom: 0; }` is logical, so the dot flips to the left in RTL. The mask that cuts a transparent ring out of the picture behind it is hard-anchored to the bottom-right: `radial-gradient(circle at calc(100% - var(--dot) / 2) calc(100% - var(--dot) / 2), …)`.
- **Why it matters**: In Arabic every avatar in the app has a phantom bite taken out of its bottom-right corner, and the status dot on the left sits flat on an uncut picture, losing the ring that makes it legible against any background. The comment above the rule explains precisely why the ring is cut rather than painted — the mechanism is good, it just isn't mirrored.
- **Fix**: swap the `100% -` for a direction-aware position, e.g. set `--dot-x: calc(100% - var(--dot) / 2)` on `:root` and `--dot-x: calc(var(--dot) / 2)` under `[dir="rtl"]`, and use `circle at var(--dot-x) …`.

### [BROKEN] RTL: the mic sensitivity marker detaches from its own meter

- **Where**: `web/src/components/settings/VoicePage.tsx:167`
- **What**: `style={{ left: `${pct}%` }}` — the only physical inline offset in the settings tree. The level bar fills with `width`, which grows from the inline-start (the right, in RTL), while the threshold marker is pinned from the physical left.
- **Why it matters**: The meter reads backwards; you cannot set a sensitivity threshold you can't see.
- **Fix**: `style={{ insetInlineStart: `${pct}%` }}`.

### [BROKEN] RTL: the subchat panel and the skin-tone menu open on the wrong side

- **Where**: `web/src/components/chat/Chat.module.css:236`; `web/src/components/pickers/Picker.module.css:17`
- **What**: `.subPanel { position: absolute; top: 52px; right: 12px; }` and `.toneMenu { top: -4px; right: -4px; }`. Both are anchored to a button that mirrors; neither mirrors with it.
- **Why it matters**: The subchat panel flies to the opposite corner from the button that opened it. The tone menu opens *over the emoji grid* instead of over the tone button that spawned it.
- **Fix**: `inset-inline-end` in both. (`.subPanel`'s `top: 52px` is also a magic number where `--header-h` is `49px` — see the tokens finding below.)

### [BROKEN] A chosen accent colour never recomputes its foreground: four of ten presets give white-on-pale buttons

- **Where**: `web/src/lib/theme.ts:42`–`:47`; presets at `web/src/components/settings/AppearancePage.tsx:19`; free picker at `:73`
- **What**: `applyTheme` overrides `--brand`, `--brand-hover`, `--brand-active`, `--mention-bg` and `--text-brand` from the chosen hue, but `--on-brand` stays `#ffffff` (`tokens.css:25`) and every hardcoded `color: #fff` beside a `background: var(--brand)` stays white. Pick `#fdb833` (a shipped preset): `Button.module.css:7` gives white on yellow at **1.8:1**; `ContextMenu.module.css:4` (`.item:hover { background: var(--brand); color: #fff }`) makes every hovered menu row unreadable; the same happens to `.newPill`, `.subNew button`, `Rail.module.css:10`, `Home.module.css:14`/`:22` and `DropOverlay.module.css:4`. `#1abc9c` is 2.3:1, `#3d9e60` 3.0:1, `#3498db` 3.2:1. The free `<input type="color">` at `:73` accepts `#ffffff`, which additionally makes the global focus ring (`base.css:23`, `outline: 2px solid var(--brand)`) invisible.
- **Why it matters**: A feature that is presented as pure decoration silently breaks the legibility of every primary action in the app, and there is no way for the user to connect cause and effect.
- **Fix**: compute the relative luminance of the accent and set `--on-brand` to `#fff` or `#111` accordingly; clamp the accent's lightness per theme before assigning `--brand`; replace the literal `#fff` next to `var(--brand)` with `var(--on-brand)` (25 sites). Also derive `--mention-fg` from the accent — right now `--mention-bg` is recoloured and `--mention-fg` is not, so a green accent gives green mention pills with lavender text.

### [BROKEN] The "Chat font scaling" slider does nothing, and the preview beside it pretends otherwise

- **Where**: `web/src/styles/base.css:8`; `web/src/lib/theme.ts:40`; `web/src/components/settings/AppearancePage.tsx:25`, `:29`, `:87`
- **What**: `--font-scale` is applied to `html { font-size: calc(16px * var(--font-scale, 1)) }`, which only moves anything sized in `rem`. Across all of `web/src` there are **3 `rem` font sizes and 374 `px` ones** — message content is `Chat.module.css:65 .content { font-size: 16px }`, the author name is `:62 16px`, and `.md-*` sizes are `em` relative to that fixed 16px. The Settings preview at `AppearancePage.tsx:29` applies `style={{ fontSize: `${px}px` }}` inline, so it *does* grow — the control looks like it works and then the chat is unchanged.
- **Why it matters**: This is the app's only text-size accommodation, and it is combined with `user-scalable=no` (see below), so a low-vision user has no working route to larger text at all.
- **Fix**: convert the chat's type scale to `rem` (or add a `--chat-font` custom property that `.content`, `.author`, `.time`, `.replyLine` and `.md-*` read). Separately, `html { font-size: 16px × scale }` overrides the browser's own default-font-size setting — use `calc(100% * var(--font-scale))` so a user who set 20px in their browser keeps it.

### [BROKEN] Syntax-highlighted code is unreadable in the light theme

- **Where**: `web/src/styles/markdown.css:29`–`:36`
- **What**: The highlight.js palette is hardcoded One Dark (`#c678dd`, `#98c379`, `#61afef`, `#7f848e`, `#e5c07b`) with no `[data-theme="light"]` override, while `--code-bg` flips to `#f3f3f4` in light (`tokens.css:116`). Green strings land at ≈1.9:1, orange numbers ≈2.2:1, blue function names ≈2.4:1, grey comments ≈3.0:1.
- **Why it matters**: Every code block in a light-theme conversation is washed out to the point of illegibility. For a developer-facing chat app that is the content people care most about.
- **Fix**: add a `[data-theme="light"]` block with an equivalent light palette (One Light / GitHub Light values), or express the eight token colours as custom properties and redefine them per theme.

### [BROKEN] Reduced motion turns every spinner into three dead dots and every loading button into a blank one

- **Where**: `web/src/styles/base.css:54`–`:55`; `web/src/components/common/Spinner.module.css:2`, `:5`; `web/src/components/common/Button.module.css:20`–`:25`
- **What**: The global `animation-duration: 0.001ms !important` clamps *purposeful* animation as well as decorative. `@keyframes bounce` rests at its `0%/100%` frame (`translateY(0); opacity: 0.4`), so the spinner is three static faded dots. `Button.module.css:20` sets `.loading .label { visibility: hidden }` — so with reduced motion on, pressing Create/Save/Confirm produces a **completely empty button** with three motionless dots and no other signal that anything is happening. Every slow action in the app runs through that path.
- **Why it matters**: Reduced motion should remove movement, not meaning. As written it makes the app look broken to precisely the users who asked for calm.
- **Fix**: scope the global clamp to `animation-name: none` only for decorative classes, and give `Spinner` and `Button`'s dots a `@media (prefers-reduced-motion: reduce)` rule that keeps a slow opacity pulse (or swaps to a determinate/textual state). At minimum, don't hide the button label when motion is reduced.

### [BROKEN] Modals do not trap Tab: focus walks straight into the app behind the scrim

- **Where**: `web/src/components/common/Modal.tsx:35`–`:52`; portal at `web/src/hooks/usePortalRoot.ts:7`
- **What**: The effect handles Escape and initial focus. There is no Tab containment anywhere in the codebase. The portal mounts on `document.body` as a sibling *after* `#root`, so Shift+Tab from the first field lands in the app behind the dialog and Tab off the last footer button exits to browser chrome. Focus *restoration* on close is correct (`:44`, `:50`) — it is only containment that is missing.
- **Why it matters**: A keyboard or screen-reader user can start typing into the channel composer underneath an open dialog without any indication the dialog is still there.
- **Fix**: add a `keydown` handler on the card cycling `ref.current.querySelectorAll(focusable)`, and set `inert` on `#root` while any `[data-modal-layer]` exists.

### [BROKEN] Every dialog is announced as an unnamed "dialog"

- **Where**: `web/src/components/common/Modal.tsx:56`, `:59`
- **What**: `role="dialog" aria-modal="true"` is present, but the `<h2 className={s.title}>` has no `id` and nothing references it. `bare` mode renders no header at all, so QuickSwitcher (`web/src/components/modals/QuickSwitcher.tsx:136`) and every other bare caller produce a nameless dialog.
- **Why it matters**: VoiceOver and NVDA say "dialog" and stop. The user has no idea what opened.
- **Fix**: `const id = useId()`, `id={id}` on the `h2`, `aria-labelledby={id}` on the card, and require an `ariaLabel` prop when `bare`.

### [BROKEN] The context menu cannot be operated from the keyboard

- **Where**: `web/src/components/common/ContextMenu.tsx:88`–`:102`, open at `:55`, close at `:63`/`:96`
- **What**: `role="menu"` is applied but focus is never moved into the menu, there is no Arrow/Home/End handling, and closing never restores focus to the opener. Because the menu portals to `document.body`, its items sit at the very end of the tab order.
- **Why it matters**: Every per-message action, every channel action, every member action lives behind this menu. A keyboard user must Tab through the entire application to reach an item, and after choosing one their focus is at the end of the document.
- **Fix**: focus the first enabled item on open; roving `tabIndex` with Arrow/Home/End; capture `document.activeElement` at open and restore in the effect cleanup.

### [BROKEN] Escape over an open menu closes the dialog underneath it as well

- **Where**: `web/src/components/common/ContextMenu.tsx:62`–`:64` versus `web/src/components/common/Modal.tsx:37`–`:41`; the same pattern in `web/src/components/chat/ChatView.tsx:119`–`:132`
- **What**: The menu's container carries `data-context-menu`, not `data-modal-layer`, so `isTopLayer()` still reports the dialog as topmost. Both listeners are on `document`, and `e.stopPropagation()` does not suppress a sibling listener on the same node — that needs `stopImmediatePropagation`. `ChatView` guards on the same attribute, so Escape over a message context menu also closes the search panel behind it.
- **Why it matters**: Right-click inside settings, press Escape to dismiss the menu, and the entire settings dialog disappears with any unsaved edits.
- **Fix**: give the menu a `data-modal-layer` attribute (or register its listener in the capture phase and call `stopImmediatePropagation`).

### [BROKEN] Toasts are never announced, because the live region is created at the same moment as its content

- **Where**: `web/src/components/common/Toasts.tsx:10`, `:13`
- **What**: `if (toasts.length === 0) return null;` means the `aria-live="polite"` element does not exist until the first toast arrives. Screen readers only announce mutations to a region that was already in the accessibility tree.
- **Why it matters**: Every failure path in the app routes here — failed sends, failed uploads, slow-mode rejections, over-length messages, failed server creation. All of it is silent to assistive tech.
- **Fix**: always render the stack container (empty when there are none) and add `role="status"`, plus `role="alert"` on error toasts.

### [BROKEN] Tooltips are not attached to what they describe

- **Where**: `web/src/components/common/Tooltip.tsx:102`–`:110`, wrapper at `:89`
- **What**: The bubble gets `role="tooltip"` but no `id`, and the wrapper never sets `aria-describedby`. The text is an orphan in the portal. (The rest of the component is right: it shows on keyboard focus, it flips when it would go off-screen at `:36`–`:42`, and it is `pointer-events: none` so it cannot cover its own trigger.)
- **Why it matters**: Every icon-only header button relies on a tooltip for its explanation; none of it reaches a screen reader.
- **Fix**: `useId()` on the bubble, clone the child with `aria-describedby`, or render a `.visually-hidden` copy inside the wrapper (`base.css:51` already has the utility).

### [BROKEN] Quick switcher: arrow-key selection is invisible to assistive tech, and Tab is stolen

- **Where**: `web/src/components/modals/QuickSwitcher.tsx:143`–`:160`, `:169`, `:153`, tabs at `:138`–`:141`
- **What**: Arrow keys move a `sel` index whose only manifestation is `data-selected` → a background colour. The input has no `role="combobox"`, no `aria-activedescendant`; the list has no `role="listbox"` and the rows no `role="option"`. Separately, `:153` repurposes **Tab** as a mode switch (`e.preventDefault(); setMode(...)`), so combined with the missing focus trap a keyboard user can never reach the two tab buttons, the clear button, or the result rows — Tab only toggles the mode, forever. The `role="tablist"` at `:138` also has no `aria-controls` and the list has no `role="tabpanel"`.
- **Why it matters**: Ctrl+K is the power-user path through the whole app, and it is the least keyboard-accessible surface in it.
- **Fix**: combobox/listbox/option roles with `aria-activedescendant`; move mode-switching to Left/Right or Ctrl+Tab and let Tab do its job.

### [BROKEN] A failed request is drawn as a cheerful empty state on eight surfaces

- **Where**: `web/src/components/server/pages/BansPage.tsx:36`; `InvitesPage.tsx:31`; `AuditLogPage.tsx:66`–`:68`; `EncryptionPage.tsx:29`; `web/src/components/settings/DevicesPage.tsx:20`; `web/src/components/pickers/GifPicker.tsx:76`–`:84` (rendered at `:177`); `web/src/pages/DownloadPage.tsx:48` (rendered at `:67`–`:71`); `web/src/components/pickers/EmojiPicker.tsx:272`, `:360` (rendered at `:389`)
- **What**: `.catch(() => alive && setBans([]))` — a 500 or a dropped connection produces "No one is banned, keep it that way." Invites becomes "There are no active invites", the audit log becomes "Nothing has happened yet", encryption renders no rows and no message, and Devices renders a blank area with no text at all. `GifPicker`'s first-page `catch` deliberately does **not** set `failed` (that only happens for `pos` pagination), so a dead provider or a rate-limit renders "No GIFs match." even though the component already has a perfectly good failure block at `:178`–`:183`. `DownloadPage` collapses offline/500/CORS into `apk === null` and tells the user, as a fact about the product, "The Android app is being worked on and is not available to download at the moment." And while the emoji index is still loading, unicode emoji are excluded from search, so typing "smile" during load reports "No emoji match."
- **Why it matters**: A moderator concludes a server has no bans when the request simply failed; a visitor concludes the Android app doesn't exist. This is the one place where showing nothing is actively worse than showing an error.
- **Fix**: a third state (`T[] | null | "error"`) rendering "Couldn't load bans" and a Retry that re-runs `load()`. `MessageList.tsx:348`–`:352` already does exactly this well — reuse the shape. For `GifPicker`, set `failed` on the non-`pos` branch too. For `EmojiPicker`, gate `noResults` on `ready`.

### [BROKEN] A failed emoji index leaves the picker on "Loading emoji…" forever

- **Where**: `web/src/components/pickers/EmojiPicker.tsx:242`, rendered at `:388`, rail at `:381`–`:385`
- **What**: `void loadEmoji().then(() => setReady(true))` has no `.catch`. If the emoji data chunk 404s (a stale service worker after a deploy) or the network drops, `ready` never flips: the grid shows "Loading emoji…" indefinitely, the category rail stays empty, and there is no retry short of reloading the app.
- **Why it matters**: The emoji picker is one of the three most-used controls in the product, and its failure mode is a permanent lie.
- **Fix**: `.catch(() => setFailed(true))` with an error state and a Try again that re-calls `loadEmoji()`.

### [BROKEN] The emoji, GIF and sticker grids have no arrow-key navigation, and most of the emoji grid is unreachable by Tab

- **Where**: `web/src/components/pickers/EmojiPicker.tsx:392`–`:401` (with `OVERSCAN = 600` at `:58`); `web/src/components/pickers/StickerPicker.tsx:43`–`:47`; `web/src/components/pickers/GifGrid.tsx:130`
- **What**: No `onKeyDown` exists on any grid — only the tone menu has one. Every cell is a plain `<button>` with default tab order, so the emoji grid presents roughly 30 overscan rows × ~11 columns of tab stops, and because rows outside the overscan window are not in the DOM at all, Tab cannot reach anything below them. Focus simply exits the picker.
- **Why it matters**: A keyboard user cannot pick an emoji below the first screenful, and the ones they *can* reach cost hundreds of keystrokes.
- **Fix**: roving `tabIndex` (one cell 0, the rest -1) with Arrow/Home/End/PageUp/PageDown on the scroll container, scrolling the target row into the render window before focusing it.

### [BROKEN] Search suggestions cannot be used from the keyboard

- **Where**: `web/src/components/search/SearchSuggestions.tsx:96`–`:129`; mounted at `web/src/components/search/SearchPanel.tsx:111`
- **What**: Rows are buttons with `onMouseDown={(e) => e.preventDefault()}` so focus deliberately stays in the input — a good decision — but nothing then listens for ArrowDown/Enter/Escape. There is no `role="listbox"`/`role="option"`, no `aria-expanded`/`aria-controls`/`aria-activedescendant` on the input, and no `aria-live`.
- **Why it matters**: Someone typing `from:` sees a list of names they can never select from, and a screen-reader user is never told the list appeared.
- **Fix**: the combobox pattern — keep focus in the input, track an active index, wire Arrow/Enter/Escape from the input's `onKeyDown`, and add the listbox/option roles with `aria-activedescendant`.

### [BROKEN] The admin page spins forever when a request fails

- **Where**: `web/src/components/settings/AdminPage.tsx:29`–`:30`, rendered at `:110`, `:133`, `:138`, `:205`
- **What**: `.catch(() => setStats(null))` sets the value back to its initial `null`, and `null` is exactly the condition that renders `<Spinner />`. Four unlabelled spinners animate indefinitely with no timeout and no retry.
- **Why it matters**: The instance operator has no way to tell "still loading" from "the API is down".
- **Fix**: distinguish error from pending, and pass a label to every `Spinner` — it already takes one (`Spinner.tsx:3`) and none of the ~20 call sites uses it.

### [BROKEN] Security reports "two-factor is off" when it only failed to check

- **Where**: `web/src/components/settings/SecurityPage.tsx:57`, `:175`
- **What**: `const on = status?.enabled ?? false` with no pending state. The row renders "off" on first paint and stays "off" if `mfaStatus()` rejects, offering a "Set up" button that will then fail.
- **Why it matters**: Telling someone their 2FA is off when it is on is the worst possible lie on the one page where certainty matters.
- **Fix**: a skeleton row while `status === undefined`, and an explicit "Couldn't check your 2FA status" on rejection.

### [BROKEN] Two Security headings render as raw browser defaults

- **Where**: `web/src/components/settings/SecurityPage.tsx:182`, `:204`
- **What**: `className={s.h}` — there is no `.h` in `Settings.module.css` (it defines `.h5`, `.hint`, `.hex`). The class resolves to `undefined`, so "Two-Factor Authentication" and "App Lock" render at browser-default `1.17em` bold with default margins, next to twelve other sections that are 12px uppercase `--text-subtle`.
- **Why it matters**: Security is the one page whose headings look like they belong to a different product.
- **Fix**: `className={s.h5}`.

### [BROKEN] Drag-reorder has no keyboard or touch path: roles, stickers and servers cannot be reordered on a phone

- **Where**: `web/src/components/server/pages/RolesPage.tsx:95`–`:106`; `web/src/components/server/PackEditor.tsx:306`–`:316`; `web/src/components/rail/Rail.module.css:19`–`:22` (the rail's drop indicators)
- **What**: All three use HTML5 `draggable` with `onDragStart/onDragOver/onDrop` only. Touch devices never fire those events. Each row is a `<button>` whose only handler is `onClick` (select), so there is no keyboard path either.
- **Why it matters**: Role hierarchy decides who can moderate whom. On a 380px phone it simply cannot be changed.
- **Fix**: `onKeyDown` for `Alt+ArrowUp/Down` calling the existing `rolePositionsAfterDrop`, a live region announcing the move, and pointer-event dragging (or explicit Move up/down items in the row's context menu) for touch.

### [BROKEN] The sticker dropzone is unreachable without a mouse

- **Where**: `web/src/components/server/PackEditor.tsx:281`–`:292`, upload button at `:301`
- **What**: The dropzone is a `<div onClick>` with no `role`, `tabIndex` or key handler, and the `<input type="file">` inside it is `hidden`, so that isn't focusable either. Unlike `EmojiPage.tsx:144`, PackEditor has no fallback button — the "Upload N stickers" button only renders once files are already staged.
- **Why it matters**: A keyboard-only user cannot add a sticker at all.
- **Fix**: make the dropzone a real `<button type="button">`.

### [BROKEN] Joining with a blocked microphone produces a call that looks completely normal

- **Where**: `web/src/voice/session.ts:376`–`:381`; `web/src/components/voice/VoiceView.tsx:611`, `:703`
- **What**: If `getMic` throws (permission denied, device in use) the join continues with `s.mic = null`. A toast flashes and disappears. The mute button then renders `<Mic>` and reads "Mute", and your own tile shows no `MicOff` because `:611` keys off `vs.self_mute`, not off having a track.
- **Why it matters**: You sit in a call talking to nobody, with every visual signal telling you that you are live.
- **Fix**: hold "no mic track" in the voice store, put the mute button into a distinct blocked state labelled "Microphone blocked", and pin a dismissible bar in the stage pointing at browser site settings.

### [BROKEN] The call resizer's grab band hangs over the message list and eats taps

- **Where**: `web/src/components/voice/Voice.module.css:9`, `:111`
- **What**: `bottom: -7px; height: 14px; z-index: 6; touch-action: none` — and `bottom: -14px` under `pointer: coarse`, making a 28px invisible strip. It sits over the top of the message list below an embedded call.
- **Why it matters**: On a phone the first message row under the call cannot be tapped, and a scroll started there does nothing.
- **Fix**: keep the band inside the panel (`bottom: 0; height: 16px`), or put `pointer-events` on a small padded child of the visible handle only.

### [BROKEN] The guest call page can spin on "Joining the call" forever

- **Where**: `web/src/pages/GuestCallPage.tsx:113`–`:150`, `:237`–`:241`; status sink at `web/src/gateway/session.ts:70`
- **What**: `begin()` only leaves the `joining` phase on a `ready` event — no timeout, no retry. `startGuestSession` pipes connection status into `useUI.setConnection`, but the banner that renders it lives in `AppShell.tsx:161`, which the guest page never mounts.
- **Why it matters**: A guest clicking a shared call link on a flaky connection sees a spinner and nothing else, indefinitely, with no idea whether to wait or reload.
- **Fix**: render the connection state on the guest page, and a ~10s timeout that moves to an error phase with a Try again button.

### [BROKEN] The installed app draws under the notch: the chat header sits behind the status bar

- **Where**: `web/index.html:5` (`viewport-fit=cover`); `web/src/components/shell/AppShell.module.css:2`
- **What**: `.app` applies `padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right)` and nothing for the top. `env(safe-area-inset-top)` appears in exactly five places in the whole codebase, none of them the shell. In a browser tab this is invisible (the browser chrome fills the top), but in the installed PWA / home-screen app the 49px channel header renders beneath the clock and battery.
- **Why it matters**: The iOS home-screen app is a supported target for this product.
- **Fix**: `padding-top: env(safe-area-inset-top)` on `.app`, and the same for the fixed overlays that ignore it: `Toasts.module.css:1` (`top: 16px`), `Settings.module.css:91` (`.closeCol { top: 8px }`) and `Chat.module.css:172` (`.lbClose { top: 12px }`).

---

### [BAD] The front page's safe-area insets are swapped left for right

- **Where**: `web/src/pages/Home.module.css:9`, `:57`
- **What**: `padding: 14px max(16px, env(safe-area-inset-left)) 14px max(16px, env(safe-area-inset-right));` — the four-value shorthand is top/**right**/bottom/**left**, so the *left* inset is applied to the right side and vice versa. The footer at `:57` repeats it.
- **Why it matters**: On a landscape iPhone the header and footer clear the wrong edge — content tucks under the notch on one side and floats away from it on the other.
- **Fix**: `padding-inline: max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right));`.

### [BAD] Front page: "Log in" disappears at phone width

- **Where**: `web/src/pages/Home.module.css:66`–`:69`; `web/src/pages/HomePage.tsx:103`, `:108`, `:227`
- **What**: `@media (max-width: 430px) { .nav .quiet { display: none } }` hides *both* `.quiet` links — Download and **Log in** — leaving only the "Get started" CTA. Log in survives only in the page footer (`:227`), below twelve feature cards, three strips and a ten-row comparison table.
- **Why it matters**: The single most common phone visitor to a marketing page is an existing user trying to get back in. They have nothing to press but "Get started".
- **Fix**: keep Log in and drop Download (which is repeated twice below the fold), or collapse the two `.quiet` links into one overflow button.

### [BAD] Front page: no screenshot or video carries an intrinsic size, so the page reflows as it loads

- **Where**: `web/src/pages/HomePage.tsx:40`, `:55`; `web/src/pages/Home.module.css:41`
- **What**: `<img loading="lazy">` with no `width`/`height`, and `<video preload="none">` with none either, under `.shot img, .shot video { width: 100%; height: auto }`. A `<video>` with no known size defaults to 300×150 (a 2:1 box) until metadata arrives, then snaps to its real aspect ratio.
- **Why it matters**: Four large media elements each jump the page height as they arrive. Because the reveal effect is driven by an IntersectionObserver over the same scroller, the thresholds move underneath the reader.
- **Fix**: put `width`/`height` attributes on each, or `aspect-ratio` on `.shot img, .shot video`. The chat's own `Attachments.tsx:165` already does this correctly (`width={dims.width} height={dims.height}`).

### [BAD] Front page: two videos autoplay in a loop and ignore `prefers-reduced-motion`

- **Where**: `web/src/pages/HomePage.tsx:55`, `:141`, `:157`; guard at `web/src/pages/Home.module.css:76`–`:79`
- **What**: `<video autoPlay muted loop playsInline>`. The reduced-motion block only disables `.reveal` and the two hover transforms; the loops keep playing. There is no pause control, and they run for longer than 5 seconds.
- **Why it matters**: WCAG 2.2.2 — moving content longer than five seconds needs a pause. Someone with a vestibular condition gets two perpetually looping videos on the page that is supposed to convince them.
- **Fix**: read `matchMedia("(prefers-reduced-motion: reduce)")` and render the `poster` still instead of the video; or add a visible pause button.

### [BAD] Every floating picture keeps a `will-change` layer and drifts forever, including on touch

- **Where**: `web/src/components/common/FloatingPlane.module.css:11`–`:12`; `web/src/components/common/FloatingPlane.tsx:8`–`:9`, `:24`, `:46`
- **What**: `.plane { animation: drift 9s ease-in-out infinite; will-change: transform; }`. The JS bails out on touch (`:24`) and for reduced motion (`:23`), but the CSS `drift` animation is only stopped by the reduced-motion rule at `:19` — not by touch. The component's own doc comment says "Nothing moves on a touch screen", which is not what the code does. Separately, `:46` attaches a **window-level** `pointermove` listener per instance (four on the front page), each doing a `getBoundingClientRect()` — a forced layout read — inside its own rAF.
- **Why it matters**: On a phone, four full-width screenshots bob up and down forever behind four permanent GPU layers. On a desktop, moving the mouse anywhere on a page whose headline claim is "50 ms" costs four layout reads per frame.
- **Fix**: `@media (hover: none) { .plane { animation: none } }`; share one `pointermove` listener across instances, or move it to `pointerenter`/`pointerleave` on `.stage`.

### [BAD] Offline members render at 1.9:1 contrast

- **Where**: `web/src/components/chat/MemberList.module.css:5`
- **What**: `.row[data-offline="true"] { opacity: 0.4 }` over `--text-channel: #999aa1` on `--bg-raised: #323339` composites to ≈`#5b5c63`, which is **1.9:1** against the panel.
- **Why it matters**: Half the member list of any real server is offline, and it is below even the 3:1 floor for non-text UI. The hover rule at `:6` restores it, which is not a fix for reading.
- **Fix**: raise to `opacity: 0.55` (≈3.3:1) or drop the opacity and use `--text-muted` directly; keep the shape signal from the avatar's offline ring, which is already good.

### [BAD] Mention hover is white text on pale lavender in the light theme

- **Where**: `web/src/styles/markdown.css:20`; tokens at `web/src/styles/tokens.css:28`–`:29`, `:81`–`:126`
- **What**: `.md-mention:hover { background: var(--mention-bg-hover); color: #fff }`. The `[data-theme="light"]` block overrides `--mention-fg` but **not** `--mention-bg` or `--mention-bg-hover`, so both keep the dark theme's `rgba(128, 0, 255, 0.42)`. Over white that composites to ≈`#b366ff`; white text on it is **3.3:1**.
- **Why it matters**: Every @-mention in a light-theme conversation becomes hard to read the moment you point at it.
- **Fix**: define `--mention-bg` / `--mention-bg-hover` in the light block, and use `var(--mention-fg)` rather than `#fff` on hover.

### [BAD] The search-suggestion date input is pinned to a dark colour scheme

- **Where**: `web/src/components/search/Search.module.css:44`
- **What**: `.suggestDate input { … color-scheme: dark light; }` — listing `dark` first means "prefer dark". In the light theme the native date picker opens dark on a light page.
- **Why it matters**: A single jarring dark panel in an otherwise light UI, and it only shows up for people using search filters, so it is easy to miss in review.
- **Fix**: drop the declaration; `:root`/`[data-theme="light"]` already set `color-scheme` correctly (`tokens.css:78`, `:125`) and the input will inherit.

### [BAD] Dark-scoped call surfaces leak the light palette through portals

- **Where**: `web/src/styles/tokens.css:133`; `web/src/hooks/usePortalRoot.ts:5`–`:7`; `web/src/components/voice/VoiceView.tsx:436`–`:439`, `:441`–`:477`
- **What**: The dark palette is scoped to `[data-dark-scope]`, but menus, modals and tooltips portal to `document.body` — outside that scope. In the light theme the device menu, the tile right-click menu, the Share Screen and Guest Link dialogs and every control-bar tooltip render light on top of the black stage. Worse, `portalRoot()` returns the fullscreen element when the call is fullscreen, so the *same menu* is dark in fullscreen and light embedded.
- **Why it matters**: The whole point of the dark-scope mechanism — documented at length in `tokens.css:128`–`:132` — is undone at the portal boundary.
- **Fix**: pass `data-dark-scope` through `openContextMenu`/`Modal` when the opener is inside one, so the palette follows the trigger rather than DOM position.

### [BAD] The guest call page's own bar drops out of the dark scope

- **Where**: `web/src/pages/GuestCallPage.module.css:16`–`:17`; `web/src/pages/GuestCallPage.tsx:213`–`:223`; scope applied at `VoiceView.tsx:674`
- **What**: `.call` is hard `#000` but the 48px `.bar` above the stage resolves `--bg-raised` / `--text-strong` at document scope, and `VoiceView`'s `data-dark-scope` starts *below* it.
- **Why it matters**: A guest on a light-mode OS gets a bright grey bar and a black notch strip above a black call.
- **Fix**: `data-dark-scope=""` on the `.call` wrapper — it is black in every theme anyway.

### [BAD] Pinch-zoom is disabled app-wide, and the font-size control that would substitute for it doesn't work

- **Where**: `web/index.html:5`; `web/src/styles/base.css:8` (`touch-action: pan-x pan-y`); `web/src/lib/noZoom.ts`
- **What**: `maximum-scale=1, user-scalable=no` plus a JS enforcement layer. Combined with the font-scale finding above, a low-vision user on Android (where `user-scalable=no` is honoured) has no route to larger text at all.
- **Why it matters**: WCAG 1.4.4. The intent — stop a stray pinch from zooming the chrome — is sound, but the blanket ban is not the only way to get it.
- **Fix**: drop `maximum-scale`/`user-scalable` and keep `touch-action: pan-x pan-y` on the scrollers that need it; or, if the ban stays, make the in-app font-scale actually work.

### [BAD] "On" and "off" are the same white pill in the call control bar

- **Where**: `web/src/components/voice/Voice.module.css:84`
- **What**: `.ctl[data-off="true"], .ctl[data-on="true"] { background: #fff; color: #000 }` — muted mic (bad, off), deafened (bad, off), camera on (good, on) and screen sharing (good, on) all render as an identical white circle.
- **Why it matters**: Muted-versus-live is the single most important read in a call and it is carried by glyph shape alone, at speed, under stress.
- **Fix**: `--danger` fill for `data-off`, brand fill for `data-on`, white for neither.

### [BAD] Connecting, reconnecting and failed collapse into two words, one of which lies

- **Where**: `web/src/components/voice/VoiceView.tsx:614`; colour at `web/src/components/voice/Voice.module.css:63`
- **What**: `peerState === "failed" ? "reconnecting…" : "connecting…"`. `new`, `checking`, `disconnected` and `closed` all read "connecting…"; a genuinely dead peer reads "reconnecting…" forever. Both states are `--warning`. Screen tiles are excluded entirely (`t.kind !== "screen"`), so a stalled share is just a black rectangle.
- **Why it matters**: The user cannot tell "give it a second" from "this will never recover".
- **Fix**: distinct copy per state, `--danger` for failed, show it on screen tiles too, and offer a retry after N seconds of `failed`.

### [BAD] Failing to join a call leaves no trace: the error state is dead code

- **Where**: `web/src/voice/session.ts:330`–`:334`, `:878`–`:880`; store at `web/src/stores/voice.ts:192`; lobby at `web/src/components/voice/VoiceView.tsx:653`–`:669`
- **What**: `store.setError(...)` is written in two places and read nowhere. The lobby flips "Connecting…" back to "Join Voice" as if nothing happened; the only trace is a toast that has already gone.
- **Why it matters**: The user retries blindly with no idea what went wrong.
- **Fix**: render `useVoice((v) => v.error)` under the lobby button with `role="alert"`, cleared on the next attempt.

### [BAD] Being alone in a call has no state at all

- **Where**: `web/src/components/voice/VoiceView.tsx:293`–`:308`, `:683`
- **What**: With one participant, `tiles` is a single avatar stretched across the stage. Nothing says you are alone and nothing offers to invite anyone. The lobby's "No one is here yet" (`:658`) vanishes the moment you join.
- **Why it matters**: The most common first experience of the call feature is starting one and waiting, and the UI gives you nothing to do.
- **Fix**: when `tiles.length === 1`, overlay a "Waiting for others" block with Invite / Copy link.

### [BAD] Invite Guests disappears below 768px, with no other route in a server voice channel

- **Where**: `web/src/components/voice/Voice.module.css:201` (`.controlsSide { display: none }`) hiding `VoiceView.tsx:696`–`:701`
- **What**: The whole side column goes on a phone, taking the guest-link button with it. Fullscreen is restored via `.narrowOnly` (`VoiceView.tsx:713`); invite is not. The fallback menu item at `ChatView.tsx:280` is DM-only.
- **Why it matters**: Guests — a headline feature on the front page — cannot be invited from a phone in a server voice channel at all.
- **Fix**: move the invite button into `.controlsMain` with the same `narrowOnly` treatment.

### [BAD] The call control row has no wrap and no scroll, so it clips at ~320px

- **Where**: `web/src/components/voice/Voice.module.css:199`–`:205`
- **What**: Every `.ctl` is `flex: none` at `clamp(40px, 11.5vw, 52px)` in a single centred flex row with `gap: clamp(6px, 2.2vw, 12px)`, no `flex-wrap`, no `overflow`. At 320px with screen-share available, seven controls need ≈331px + 16px padding. Because the row is centre-justified, the overflow splits and clips **both** mute and hang-up.
- **Why it matters**: Hang-up is the one control that must always be reachable.
- **Fix**: `overflow-x: auto; justify-content: safe center`, or push Flip/Fullscreen into an overflow menu below ~360px.

### [BAD] Reduced motion turns the speaking ring into a strobe — the exact thing the code set out to avoid

- **Where**: `web/src/components/voice/Voice.module.css:32`–`:33`, `:140`–`:141`, `:161`–`:162`; global clamp at `web/src/styles/base.css:54`
- **What**: The ring's comment reads "comes on quickly and fades out gently, so the gaps between words never make it flash" — and it achieves that with a 240ms CSS transition. The global `transition-duration: 0.001ms !important` deletes the fade, so every pause between words snaps the green ring on and off. `.ringAvatar`'s `animation: pulse 1.2s infinite` is duration-clamped rather than stopped, so an infinite animation keeps ticking at maximum frame rate.
- **Why it matters**: High-contrast flicker delivered to the users who explicitly asked for less movement.
- **Fix**: hold the "speaking" flag in JS with its own hold time instead of relying on a CSS transition, and add `@media (prefers-reduced-motion: reduce) { .ringAvatar { animation: none } }`.

### [BAD] The mobile navigation drawer has no Escape, no focus management and a bare `div` backdrop

- **Where**: `web/src/components/shell/AppShell.tsx:148`–`:152`; scroll lock at `:58`–`:64`
- **What**: The backdrop is a `<div onClick>` with no `role`, `tabIndex` or key handler. The drawer is not a dialog, focus is never moved into it, the main column behind it stays fully tabbable, and nothing listens for Escape. `ChatView.tsx:313` uses the same bare-div pattern for the member-list backdrop.
- **Why it matters**: On a phone this is the primary navigation surface.
- **Fix**: `role="dialog" aria-modal="true" aria-label="Navigation"` on the drawer, Escape handler, focus the first item on open, restore to the burger (`PageHeader.tsx:13`) on close.

### [BAD] Losing the connection is never announced, and the banner is hardcoded English

- **Where**: `web/src/components/shell/AppShell.tsx:161`–`:163`
- **What**: The "Connecting…" / "Disconnected — reconnecting…" strip appears and disappears with no `aria-live`, `role="status"` or `role="alert"`. The text is also literal English in an app with ten localised catalogues.
- **Why it matters**: A screen-reader user keeps typing into a socket that is down.
- **Fix**: `role="status" aria-live="polite"` (assertive for `closed`), and route the strings through `t()`.

### [BAD] `Field` folds the error message into the input's accessible name, and never marks it invalid

- **Where**: `web/src/components/common/TextInput.tsx:18`–`:25`, `:34`–`:36`; `web/src/components/common/TextInput.module.css:10`
- **What**: The error renders inside the `<label>` span, so the input's accessible name becomes "Server name * — Name is taken" rather than a stable name plus a separate description. `invalid` only adds a CSS class; `aria-invalid` is never set and `hint` is not exposed via `aria-describedby`.
- **Why it matters**: This is the shared form primitive — every validation message in the app inherits the problem.
- **Fix**: render error and hint in elements with ids and pass `aria-describedby` + `aria-invalid` to the input.

### [BAD] `CreateChannelModal` nests radio labels inside a `<label>` — the exact bug the codebase documents

- **Where**: `web/src/components/modals/CreateChannelModal.tsx:77`–`:90`; `web/src/components/common/TextInput.tsx:11`, `:16`
- **What**: `Field` defaults to `Tag = "label"`, and the doc comment at `TextInput.tsx:11` says verbatim: *"`div` for a field wrapping a group of radios: a label would pass a stray tap on its caption or gaps to the first radio."* This call site doesn't pass `as="div"`.
- **Why it matters**: Tapping the "CHANNEL TYPE" caption, or any gap between the two option cards, silently selects "Text". It is also invalid nested-label HTML.
- **Fix**: `<Field as="div" …>`, plus a `role="radiogroup"` with an `aria-label` around the options.

### [BAD] Colour and notification radios have no `name`, so they aren't radio groups

- **Where**: `web/src/components/server/pages/RolesPage.tsx:174`–`:178`; `web/src/components/server/pages/ServerOverviewPage.tsx:110`–`:111`; `web/src/components/settings/AdminPage.tsx:116`
- **What**: `<input type="radio" checked …>` with no `name`. Arrow keys don't move between them, each is a separate tab stop, and the browser treats them as unrelated. `PrivacyPage.tsx:56` and `AppearancePage.tsx:79` do it correctly, so this is drift. The 21 role swatches at `RolesPage.tsx:176` also take their only name from `title={hex(c)}` — a screen reader reads "#1abc9c, radio button".
- **Why it matters**: Choosing a role colour by keyboard means 21 tab presses.
- **Fix**: add `name`, and give the swatches real `aria-label`s (colour names, or "Colour 3 of 21").

### [BAD] Permission tri-state buttons announce as toggles inside a radiogroup, and cost 120+ tab stops

- **Where**: `web/src/components/server/PermissionGrid.tsx:92`–`:95`
- **What**: `role="radiogroup"` wrapping three `<button aria-pressed>`. A radiogroup's children must be `role="radio"` with `aria-checked`. There is no roving tabindex, so each of ~40 permission rows costs three Tab presses.
- **Why it matters**: Reaching Save from the top of the grid takes over a hundred keystrokes.
- **Fix**: `role="radio" aria-checked`, roving `tabIndex`, ArrowLeft/Right on the group.

### [BAD] Settings nav and role tabs expose no selected state to assistive tech

- **Where**: `web/src/components/server/SettingsLayer.tsx:35`; `web/src/components/settings/SettingsModal.tsx:62`; `web/src/components/server/pages/RolesPage.tsx:117`–`:121`
- **What**: Selection lives entirely in `data-on` / `data-selected`, which is CSS-only.
- **Why it matters**: A screen reader hears ten identically-stated buttons in the settings nav with no way to tell which page is open.
- **Fix**: `aria-current="page"` on the nav buttons; `role="tablist"/"tab"` + `aria-selected` + `aria-controls` on the role tabs.

### [BAD] Lazy settings pages render a blank panel with no indication anything is happening

- **Where**: `web/src/components/settings/SettingsModal.tsx:75`; `web/src/components/server/ServerSettingsModal.tsx:62`
- **What**: `<Suspense fallback={null}>` with every page behind `lazyPage(...)`.
- **Why it matters**: On a slow link, clicking "Roles" leaves the nav highlighted and the content column completely empty — indistinguishable from a crash.
- **Fix**: `fallback={<Spinner label={…} />}` or a skeleton matching the page shape.

### [BAD] Switching settings pages or role tabs silently discards unsaved edits

- **Where**: `web/src/components/server/SettingsLayer.tsx:35`, save bar at `:57`–`:68`; worst at `web/src/components/server/pages/RolesPage.tsx:122`–`:124`
- **What**: `SaveBar` correctly says "Careful, you have unsaved changes" — and then the nav button unmounts the body with no guard. In RolesPage, `view === "display" ? <DisplayTab/> : null` plus `key={role.id}` means typing a new role name, clicking **Permissions**, and clicking back reverts it.
- **Why it matters**: The app tells you it is protecting your work and then throws it away.
- **Fix**: lift a `dirty` flag and intercept `setPage`/`setTab`/`setSelected` with a discard confirm, or keep both tabs mounted and hidden.

### [BAD] Destructive-action guards are inverted: the most irreversible acts have the weakest ones

- **Where**: `web/src/components/settings/AdminPage.tsx:148`, `:157`–`:163`; `web/src/components/server/ChannelSettingsModal.tsx:313`–`:319`; `web/src/components/settings/DevicesPage.tsx:32`–`:35`, `:52`; compare `web/src/components/server/pages/DeleteServerPage.tsx:41`–`:45`
- **What**: `DeleteServerPage` is exemplary — type the server's name, `norm()` handles smart quotes, the button stays disabled until it matches. Against that: granting instance admin (`AdminPage.tsx:148`) fires on a single unconfirmed click, one button away from Delete; deleting *someone else's account* (`:157`) gets a plain Cancel/Delete; deleting a channel and all its history (`ChannelSettingsModal.tsx:313`) has no dialog at all; and "Log out all other devices" (`DevicesPage.tsx:52`) is one click with no confirm, no progress and `.catch(() => undefined)` per session, so logging out 1 of 9 looks identical to full success.
- **Why it matters**: The gate strength should track the blast radius, and here it is roughly inverted.
- **Fix**: reuse the DeleteServerPage pattern for account deletion and channel deletion; `openModal("confirm", …)` for the admin grant and the device sweep; toast the failure count.

### [BAD] The microphone error is a monospace developer console inside user settings

- **Where**: `web/src/components/settings/VoicePage.tsx:94`; `web/src/components/settings/Voice.module.css:2`
- **What**: ``err instanceof Error ? `${err.name}: ${err.message}` `` renders `NotAllowedError: Permission denied` into `.diag`, which is `font-family: var(--font-mono); font-size: 11px; user-select: all`.
- **Why it matters**: The single most common failure here is the user declining the browser's permission prompt. It deserves "Your browser blocked microphone access — click the padlock in the address bar to allow it", not a DOMException name at 11px.
- **Fix**: switch on `err.name` (`NotAllowedError`, `NotFoundError`, `NotReadableError`) to human sentences; keep `.diag` for the successful device dump only.

### [BAD] Raw database column names and `JSON.stringify` output are shown to moderators

- **Where**: `web/src/components/server/pages/AuditLogPage.tsx:102`–`:110`, rendered at `:126`, verb fallback at `:124`
- **What**: ``parts.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)`` produces `permissions: 274877906944 · system_channel_id: null` in a monospace block, with untranslated keys. `:124` additionally falls back to the raw action enum (`member_role_add`) for any verb missing from `verbs()`.
- **Why it matters**: The audit log is a moderation tool, not a debug view.
- **Fix**: a label map for known change keys with humanised values; drop unknown keys rather than dumping them.

### [BAD] Nested descriptions inherit `text-transform: uppercase` and shout full sentences

- **Where**: `web/src/components/settings/SecurityPage.tsx:226`–`:229`, `:237`–`:239`, `:243`, `:252`; `web/src/components/settings/Settings.module.css:33`; `web/src/components/common/Toggle.module.css:4`–`:5`
- **What**: `.rowLabel` is 12px/700/uppercase, designed for one-word captions. SecurityPage nests a `.deviceSub` and a whole `<Toggle>` inside it; neither resets `text-transform`.
- **Why it matters**: "Nothing typed, clicked or scrolled for…" and every App Lock toggle label renders BOLD ALL-CAPS.
- **Fix**: stop nesting prose and controls in `.rowLabel`; add `text-transform: none` to `.deviceSub`.

### [BAD] Two async actions have `finally` but no `catch`, so failures are entirely silent

- **Where**: `web/src/components/server/pages/ServerOverviewPage.tsx:71`–`:79`; `web/src/components/server/pages/EncryptionPage.tsx:47`–`:55`; also `web/src/components/server/pages/EmojiPage.tsx:64`
- **What**: Both are invoked as `void fn()`. A rejected `deleteIcon` or `reconcile` becomes an unhandled rejection: busy clears, nothing changes, no toast. The siblings (`ServerOverviewPage.tsx:61`, `EncryptionPage.tsx:35`) both catch properly, so this is omission, not policy.
- **Why it matters**: The user presses "Remove icon", the spinner stops, and the icon is still there.
- **Fix**: the same `catch` + toast as the siblings.

### [BAD] Members page has no loading state and swallows its own paging error

- **Where**: `web/src/components/server/pages/MembersPage.tsx:38`, `:46`, `:61`
- **What**: `if (!server) return null`, and the paging loop ends in `.catch(() => {})`. Up to 20 sequential 1000-member requests run while the user sees a header, a search box and a list that grows silently; if request 3 fails, the list stops at ~2000 with no message.
- **Why it matters**: A moderator searching for a member simply won't find them and won't know why.
- **Fix**: skeleton rows while incomplete, and an inline "Couldn't load all members — Retry".

### [BAD] Registration-key Save has no pending state, and saving an empty field silently opens registration

- **Where**: `web/src/components/settings/AdminPage.tsx:126`–`:128`
- **What**: `saveKey` tracks no busy state, so the button never disables and can be fired repeatedly. With `key === ""` it PATCHes `registration_key: ""` — the effect of the adjacent Clear button — and then toasts "Registration key saved".
- **Why it matters**: The admin believes the instance is gated when it has just been thrown open.
- **Fix**: `disabled={!key.trim()}` plus a busy flag.

### [BAD] The friends tab strip scrolls horizontally with a hidden scrollbar and no edge affordance

- **Where**: `web/src/components/friends/Friends.module.css:2`–`:3`
- **What**: `.header { overflow-x: auto; scrollbar-width: none }` plus `::-webkit-scrollbar { display: none }`. At 380px, "Friends │ Online │ All │ Pending │ Blocked │ Add Friend" does not fit and nothing indicates there is more.
- **Why it matters**: Pending friend requests are effectively hidden on a phone. The settings nav (`Settings.module.css:84`) makes the same choice and also lacks a fade.
- **Fix**: a `mask-image` fade on the trailing edge, and `scrollIntoView({ inline: "center" })` on the selected tab.

### [BAD] The image cropper and the lightbox can only be driven with a pointer

- **Where**: `web/src/components/common/ImageCropModal.tsx:139`–`:148`, hint at `:171`; `web/src/components/common/ZoomPan.tsx:119`–`:171`, `:79`, `:86`
- **What**: The crop `.frame` takes `onPointerDown/Move/Up` and `onWheel` only. Zoom has a keyboard-operable range input and reset has a button, but `offset` — where the crop actually sits — can only be dragged. `ZoomPan` is a `div` with click/double-click/drag, no `tabIndex`, no `role`, no `keydown`; it exposes an imperative `zoomBy`/`reset` handle that nothing binds keys to, and its wheel handler calls `preventDefault` unconditionally.
- **Why it matters**: Anyone on a keyboard or a switch device can only ever crop the centre of their own avatar, and cannot zoom a picture in chat.
- **Fix**: `tabIndex={0}` + arrow keys to pan, `+`/`-` to zoom, `0` to reset, Escape to close; update the "Drag to move" hint.

### [BAD] Hardcoded English in the chat header, the composer and the call bar

- **Where**: `web/src/components/chat/ChatView.tsx:177` (`in {name}`), `:192` (`{n} members`); `web/src/components/composer/Composer.tsx:453` ("Replying to", "Unknown"), `:456` ("ON"/"OFF"); `web/src/components/common/Spinner.tsx:3` (`label = "Loading"`); `web/src/components/voice/VoiceView.tsx:450`, `:467`, `:614`, `:629`–`:630`, `:697`, `:703`–`:704`; `web/src/components/voice/VoiceStatus.tsx:47`, `:68`, `:71`; `web/src/pages/GuestCallPage.tsx:252`, `:268`; `web/src/components/server/MemberActionModal.tsx:158`, `:174`; `web/src/components/server/pages/DeleteServerPage.tsx:40`; `web/src/components/modals/ConfirmModal.tsx:17`; `web/src/components/pickers/StickerPicker.tsx:68`, `:84`; `web/src/components/pickers/GifPicker.tsx:108`, `:124`, `:146`; `web/src/components/search/SearchPanel.tsx:101`, `:121`, `:139`; `web/src/pages/FriendsPage.tsx:55`, `:78`; `web/src/pages/LoginPage.tsx:145`; `web/src/pages/PasscodePage.tsx:51`; `web/src/pages/DownloadPage.tsx:69`, `:76`, `:79`, `:88`, `:137`, `:143`, `:153`–`:156`; `web/src/lib/packRemoval.ts`
- **What**: Strings that never reach `t()` in an app that ships ten catalogues and an RTL locale. Several also hardcode *English grammar*: `ChatView.tsx:192` and `SearchPanel.tsx:101`/`:139` and `GifPicker.tsx:146` all pluralise with `n === 1 ? "" : "s"`, and `FriendsPage.tsx:55` builds `Pending (3)` then strips it again at `:78` with an English-shaped regex. `DeleteServerPage.tsx:40` glues "Are you sure you want to delete" onto a `t()` continuation, and `DownloadPage.tsx:153`–`:156` translates *half* of each "first time you open it" bullet and leaves the rest in English — in both cases the two halves cannot be reordered for any other language.
- **Why it matters**: A non-English user meets a red **Ban** / **Delete** button in English at exactly the moment they most need to be certain what it does, and the guest page's end-to-end-encryption reassurance — the one line that persuades someone to type their name — stays English.
- **Fix**: route through `t()`; use the existing plural-form support in `i18n/core.ts` rather than `"s"`; make each split sentence a single key with `Tr` and interpolated `<b>` values.

### [BAD] Tiles in a call are mouse-only, and their controls are deleted on any touch-capable device

- **Where**: `web/src/components/voice/VoiceView.tsx:546`–`:562`; `web/src/components/voice/Voice.module.css:103`, `:65`
- **What**: The tile is a plain `div` with `onClick`, no `tabIndex`, no `role`. `@media (hover: none) { .tile[data-place="grid"] .tileBtns { display: none } }` removes focus/unfocus/fullscreen — and `display: none` also cancels the `:focus-within` affordance at `:65`, so an iPad with a keyboard attached loses tile controls entirely.
- **Why it matters**: Focusing a speaker is the main interaction on the call stage.
- **Fix**: `role="button" tabIndex={0}` with Enter = focus and F = fullscreen; switch the touch rule to `opacity: 0; pointer-events: none` so `:focus-within` can still reveal them.

### [BAD] The picker and the lightbox size themselves with `vh` on a phone

- **Where**: `web/src/components/pickers/Picker.module.css:37`; `web/src/components/chat/Chat.module.css:165`, `:171`; `web/src/components/chat/VideoPlayer.module.css:4`; `web/src/components/composer/Composer.module.css:30`
- **What**: `height: 60vh !important` for the emoji bottom sheet, `height: 86vh` for the lightbox stage, `height: 100vh` for the fake-fullscreen video, `max-height: 50vh` for the composer. `vh` is the *large* viewport on mobile Safari, so each of these is taller than the visible area whenever the toolbars are showing. `Modal.module.css:16` and `QuickSwitcher.module.css:17` both correctly use `dvh`/`svh`, so the fix pattern is already in the codebase.
- **Why it matters**: The lightbox's action bar at `bottom: 16px` lands under the Safari toolbar, and it has no `env(safe-area-inset-bottom)` either, so on an iPhone the Download/Open buttons sit under the home indicator.
- **Fix**: `dvh` throughout, and `bottom: max(16px, env(safe-area-inset-bottom))` on `.lbBar`.

### [BAD] Long display names overflow the empty-conversation header

- **Where**: `web/src/components/chat/Chat.module.css:39`; used at `web/src/components/chat/MessageList.tsx:296`, `:307`, `:315`
- **What**: `.emptyName { font-size: 32px; font-weight: 700 }` with no `overflow-wrap`. A 30-character display name at 32px bold is far wider than a 380px phone. `.lockedTitle` at `:270` in the same file *does* set `overflow-wrap: anywhere`, so the pattern is known.
- **Why it matters**: The DM intro is the first thing you see in a new conversation, and a long name pushes the page sideways.
- **Fix**: `overflow-wrap: anywhere` on `.emptyName`, and a `clamp()` on the size.

### [BAD] Toast severity is a 4px border colour, and the toast disappears mid-read

- **Where**: `web/src/components/common/Toasts.module.css:2`–`:4`; lifetime at `web/src/stores/ui.ts:174`
- **What**: `.error` and `.success` differ from `.info` only by `border-inline-start-color`. Nothing in the text says "Error". The toast is auto-removed at 5000ms with no pause on hover and no pause on focus.
- **Why it matters**: Colour is the only severity signal, and a long error can time out before it has been read.
- **Fix**: an icon or an "Error:" prefix, and clear the timer while the stack is hovered or contains focus.

### [BAD] Touch targets under 32px, several overlapping their neighbour

- **Where**: `web/src/components/modals/CustomStatusModal.module.css:10` (**18×18**, at `top: -6px; inset-inline-end: -6px`, overlapping the 56×40 emoji button); `web/src/components/common/IconPicker.module.css:13` (24×24, and physical `right`); `web/src/components/chat/Chat.module.css:104` (`.addReact` 28×24, and explicitly *always shown* on touch at `:95`), `:157` (`.pinRemove` 26×26, always shown on touch at `:162`); `web/src/components/chat/AudioPlayer.module.css:17`, `:19` (26×26, not bumped in the phone block at `:23`); `web/src/components/chat/Embeds.module.css:17` (28×28, always shown on touch at `:21`); `web/src/components/modals/QuickSwitcher.module.css:28` (24×24); `web/src/components/search/Search.module.css:46` (20×20); `web/src/components/server/RoleChips.module.css:11` (a remove-X inside a 22px chip); `web/src/components/shell/DownloadBanner.module.css:11` (28×28); `web/src/components/voice/Voice.module.css:82` (`.ctlMenu` 24×24, overhanging its parent by 6px into a `clamp(6px, …)` gap)
- **What**: All below the 24px WCAG 2.5.8 minimum or the 32px practical one, and the first and last also fail the *spacing* half of that criterion.
- **Why it matters**: The pattern for fixing this already exists and is used correctly in four places (`Modal.module.css:19`, `PageHeader.module.css:3`, `Chat.module.css:264`, `Search.module.css:34`): `@media (pointer: coarse) { padding: 10px; margin: -6px }`. It just wasn't applied consistently.
- **Fix**: apply that pattern to each; raise `.emojiClear` to at least 24×24 with clearance.

### [BAD] Presence is exposed only through a `title` on a decorative span

- **Where**: `web/src/components/common/Avatar.tsx:53`, `:47`, `:49`
- **What**: `<span className={…} title={statusLabel(status)} data-status={status} />` — a role-less span. `title` on a generic element is not reliably announced and is unreachable by keyboard or touch. The *shapes* are excellent (crescent for idle, bar for dnd, ring for offline), so colour is not the only visual signal — but there is no textual one.
- **Why it matters**: Online/offline is one of the most consulted facts in the app.
- **Fix**: render the label in a `.visually-hidden` span beside the dot (`base.css:51`).

### [BAD] `Button loading` tells assistive tech nothing

- **Where**: `web/src/components/common/Button.tsx:19`–`:22`; `web/src/components/common/Button.module.css:20`
- **What**: `loading` sets `disabled` and hides the label while three `aria-hidden` dots animate. The accessible name is unchanged and there is no `aria-busy`.
- **Why it matters**: This is the feedback path for every slow action in the app (`ConfirmModal.tsx:32`, `CreateServerModal.tsx:78`, `EditGroupModal.tsx:63`, `SubchatModal.tsx:99`, `StickerPackModal.tsx:61`). A screen-reader user presses "Create", hears nothing, and finds a now-disabled button.
- **Fix**: `aria-busy={loading}` and a `.visually-hidden` "Working…" span.

### [BAD] The user-panel status popup is a `role="menu"` with foreign children, and the mic picker is right-click only

- **Where**: `web/src/components/shell/UserPanel.tsx:118`–`:142`, `:71`, `:49`, `:89`–`:94`
- **What**: Inside the menu sit an avatar block, two plain `<button>`s with no role, and four `role="menuitemradio"` buttons. Opening never moves focus in; Escape never returns it to the trigger. Separately, `onContextMenu` is the *only* path to `micMenuItems` — no Shift+F10, no long-press, no visible affordance.
- **Why it matters**: Keyboard and touch users cannot change their microphone from the user panel at all.
- **Fix**: correct roles, focus in on open and back on close, and open the menu on the ContextMenu key / a small chevron button.

### [BAD] Emoji table action buttons have their hover state killed by an inline style

- **Where**: `web/src/components/server/pages/EmojiPage.tsx:111`–`:112`; `web/src/components/server/PackEditor.module.css:35`–`:36`
- **What**: `style={{ background: "transparent", … }}` outranks `.cellBtn:hover { background: var(--brand) }`.
- **Why it matters**: Rename and Delete in the emoji list are the only two icon buttons in the server settings with no hover feedback at all.
- **Fix**: a dedicated `.tableBtn` class rather than reaching into PackEditor's overlay-button styles.

### [BAD] Users are shown `Request failed with status 500.`

- **Where**: `web/src/api/client.ts:82`; surfaced verbatim at `web/src/components/profile/ProfileCard.tsx:144`, `:152`, `:160`, `:163`, `:172`; `web/src/pages/FriendsPage.tsx:125`, `:149`, `:159`, `:237`; `web/src/pages/InvitePage.tsx:121`; `web/src/pages/GuestCallPage.tsx:200`; `web/src/pages/StickerPackPage.tsx:63`; `web/src/pages/LoginPage.tsx:37`; `web/src/pages/RegisterPage.tsx:55`; `web/src/pages/RecoverPage.tsx:48`
- **What**: ``new ApiError(status, "http_" + status, `Request failed with status ${status}.`)`` is the generic fallback, and thirteen call sites use `err.message` as their last resort. The string is also untranslated in every language.
- **Why it matters**: The pages already map *known* `err.code` values to good `t()` copy — it is only the unmapped path that leaks, which means the worst message appears in exactly the situation the user understands least.
- **Fix**: one `describeError(err)` helper that maps codes to `t()` and returns a translated generic for everything else. Never `err.message` as the fallback.

### [BAD] The passcode screen can print a raw WebCrypto exception

- **Where**: `web/src/pages/PasscodePage.tsx:42`
- **What**: `setError(err instanceof Error ? err.message : t("passcode.thatDidNotWork"))`. Anything that isn't `WrongPasscode` — a WebCrypto `OperationError`, an IndexedDB `InvalidStateError` — is rendered into the `role="alert"` box as-is.
- **Why it matters**: This is the app-lock screen. The user is already anxious, and the app answers with a DOMException.
- **Fix**: only trust `WrongPasscode.message`; everything else gets `t("passcode.thatDidNotWork")`, with the raw error to `console.error`.

### [BAD] Every member of a server is told to set an environment variable

- **Where**: `web/src/components/pickers/GifPicker.tsx:189` → `web/src/i18n/locales/en.json:929`
- **What**: "GIF search is off on this server: set `KLIPY_API_KEY` to enable it."
- **Why it matters**: It is a server-operator instruction shown to everyone, naming a variable they cannot reach and probably cannot parse.
- **Fix**: "GIF search isn't available on this server." for members; show the operator instruction only when the viewer has manage-server permission.

### [BAD] Removing a friend and blocking someone are single unconfirmed clicks, and blocking has no failure path

- **Where**: `web/src/components/profile/ProfileCard.tsx:181`, `:184`; `web/src/pages/FriendsPage.tsx:171`, `:173`
- **What**: Both sit in a context menu beside benign items like "Copy user ID", and both fire immediately. `FriendsPage.tsx:173` is `void relApi.block(...).then(...)` with **no** rejection handler — if the request fails, nothing changes on screen and the rejection goes unhandled.
- **Why it matters**: Blocking is socially hard to reverse, and the user can walk away believing they blocked someone they did not. The sticker-pack flow already routes through a confirm (`lib/packRemoval.ts`), so the pattern exists.
- **Fix**: the confirm modal for both, and an error toast on the block path.

### [BAD] "No friends yet" is shown when the search box matched nothing

- **Where**: `web/src/pages/FriendsPage.tsx:36`, `:79`, `:87`–`:101`
- **What**: `list` is filtered by both the tab and `query`, but `Empty` only receives the tab.
- **Why it matters**: Type a typo into the friends search and the app tells you that you have no friends and nobody is online.
- **Fix**: pass `query` and render "No friends match '<query>'" with a clear-search affordance.

### [BAD] "All history loaded" is claimed even when channels failed to search

- **Where**: `web/src/components/search/SearchPanel.tsx:88`, `:148`; failures swallowed at `:52`–`:55`, `:85`; copy at `:144`
- **What**: `exhausted` counts a 403 or 500 channel as done, so the button flips to "All history loaded" and disables while part of the scope was never read. Combined with "no results in N indexed messages", this produces confident false negatives.
- **Why it matters**: Search in an end-to-end-encrypted app is the feature people trust least to begin with; silently under-reporting is the worst thing it can do.
- **Fix**: surface `failed.current.size` ("2 channels couldn't be searched") and say "Loaded what we can" when any channel failed.

### [BAD] The reaction picker shows two permanently disabled tabs with no reason given

- **Where**: `web/src/components/pickers/ExpressionPicker.tsx:88`–`:89`; call site `web/src/components/chat/Reactions.tsx:84`
- **What**: `Reactions` passes neither `gifs` nor `stickers`, so "GIFs" and "Stickers" render `disabled` forever with no tooltip and no explanation.
- **Why it matters**: Two dead controls on the most frequently opened popover in the app, implying a feature that isn't coming.
- **Fix**: don't render tabs that have no content in this context.

### [BAD] Picker escape drops focus to `<body>`, and Tab walks out of the open picker

- **Where**: `web/src/components/pickers/ExpressionPicker.tsx:61`, `:71`–`:77`, `:86`; opener at `web/src/components/composer/Composer.tsx:503`
- **What**: `role="dialog"` with no `aria-modal`, no focus containment, and `onClose()` never returns focus to `[data-picker-toggle]`. On touch the composer is deliberately blurred first (`:61`), so after Escape there is nothing focused at all.
- **Why it matters**: A keyboard user restarts tabbing from the top of the document every time they close the emoji picker.
- **Fix**: capture `document.activeElement` on mount, restore on close, and trap Tab within the dialog (see the shared focus-trap idea below).

### [BAD] Profile and friend-row actions have no in-flight guard, so a double click fires two requests

- **Where**: `web/src/components/profile/ProfileCard.tsx:137`–`:162`, buttons at `:206`, `:208`, `:212`, `:289`; `web/src/pages/FriendsPage.tsx:133`–`:138`, button at `:194`
- **What**: `message()`, `addFriend()` and `accept()` are plain async functions with no `busy` state; the buttons stay enabled and unchanged for the whole round trip. Two quick clicks on "Message" fire two `createDM` calls and two navigations; two on "Add Friend" fire two captcha-guarded requests, the second usually failing with `already_sent` — which then surfaces as a raw error toast. `FriendsPage`'s `call()` chains `audioContext()` → `createDM` → `joinVoice` (network plus a media permission prompt) with no feedback at all, and a denied microphone is never reported on that page.
- **Why it matters**: `AddFriend` on the same page (`FriendsPage.tsx:249`) already does this correctly with `Button`'s loading state, so the fix is a copy-paste.
- **Fix**: per-action busy state driving `Button`'s `loading`, and a toast on `joinVoice` failure.

### [BAD] The GIF grid reflows as images load, moving tiles under the pointer

- **Where**: `web/src/components/pickers/GifGrid.tsx:96`–`:104` feeding the layout at `:79`–`:88`; default at `web/src/lib/masonry.ts:52`–`:55`
- **What**: A GIF with unknown dimensions is laid out as a square and then snaps to its real aspect ratio on load. Because masonry heights are cumulative, each measurement shifts everything below it. Favourites are the worst case: `lib/gifFavorites.ts` only persists `w`/`h` when the source provided them, so most favourites start square.
- **Why it matters**: You aim at a GIF and click a different one.
- **Fix**: persist `naturalWidth`/`naturalHeight` at favourite time, and lock a tile's height once first measured.

### [BAD] A server that vanished dumps you at home with no explanation

- **Where**: `web/src/pages/ServerPage.tsx:52`, `:87`–`:89`
- **What**: Any failure of `serversApi.get` — kicked, deleted, or a transient 500 — sets `missing` and silently `nav("/channels/@me", { replace: true })`.
- **Why it matters**: The user clicks a server and lands somewhere else with zero feedback, and a network blip is indistinguishable from being removed.
- **Fix**: toast on redirect, and only redirect on 403/404 — show a retry for anything else.

### [BAD] Results arriving are silent across pickers, search and friends

- **Where**: `web/src/components/pickers/GifPicker.tsx:176`–`:177`; `web/src/components/search/SearchPanel.tsx:101`; `web/src/pages/FriendsPage.tsx:251`
- **What**: `aria-live` does not appear anywhere in `components/pickers`, `components/search` or `pages`. The GIF result count changes silently, the search header's result count updates silently, and the add-friend success/error message is a plain `<div>` — while the auth pages next door correctly use `role="alert"`.
- **Why it matters**: The entire search and discovery half of the app is invisible to a screen reader once you start typing.
- **Fix**: `role="status"` on the result-count lines and the no-results nodes; `role="alert"` on the add-friend message.

### [BAD] Tabs across the app are `data-` attributes, not tabs

- **Where**: `web/src/components/pickers/ExpressionPicker.tsx:88`–`:90`; `web/src/components/pickers/GifPicker.tsx:123`–`:124`; `web/src/pages/FriendsPage.tsx:64`–`:67`; and the settings/role tabs covered above
- **What**: Selection is expressed only through `data-selected` / `data-on`, consumed by CSS. No `aria-selected`, no Left/Right arrow movement.
- **Why it matters**: Four identical unlabelled-state buttons, with no way to tell which view you are in. It is the same gap in five separate places, which suggests a missing shared `Tabs` primitive rather than five oversights.
- **Fix**: one `Tabs`/`Tab` pair with the roles, `aria-selected`, `aria-controls` and arrow-key roving built in.

---

### [POLISH] There is no z-index scale, and two overlays tie at 200

- **Where**: `web/src/styles/tokens.css` (no z tokens); values spread across `Modal.module.css:1` (100), `DropOverlay.module.css:3` (120), `Toasts.module.css:1` (200), `Chat.module.css:164` (200), `ContextMenu.module.css:1` (300), `Sticker.module.css:2` (350), `Tooltip.module.css:4` (400), `base.css:44` (1000), plus 0/1/2/3/5/6/10/30/35/39/40/50/90
- **What**: Nineteen distinct values, none named. The lightbox and the toast stack are both 200, so which wins depends on DOM order.
- **Fix**: `--z-drawer/-overlay/-modal/-toast/-menu/-tooltip` in `tokens.css`.

### [POLISH] `:focus-visible` overrides the element's own border radius

- **Where**: `web/src/styles/base.css:23`
- **What**: `:focus-visible { outline: …; outline-offset: 2px; border-radius: var(--radius-xs); }` — `border-radius` in a focus rule changes the element's *actual* shape, not the outline's. Circular buttons (`Rail.module.css:8`, `Avatar`, `.act`, `.lbClose`) share the same specificity, so whether they become rounded rectangles on focus depends on CSS injection order.
- **Fix**: drop `border-radius`; modern outlines already follow the element's radius.

### [POLISH] Hover reveals shrink the text beside them, so names re-truncate under the pointer

- **Where**: `web/src/components/sidebar/Sidebar.module.css:25`, `:33`; `web/src/components/sidebar/ServerSidebar.module.css:31`, `:42`–`:43`; `web/src/components/friends/Friends.module.css:22`–`:23`
- **What**: `.close`, `.actions` and `.rowUser` go from `display: none` / `opacity: 0` to visible on hover. They are flex siblings of a truncating text column, so revealing them steals width and the name's ellipsis moves.
- **Why it matters**: Rows visibly twitch as the pointer travels down a list.
- **Fix**: reserve the space (`visibility: hidden` / `opacity: 0` rather than `display: none`), or overlay the buttons with a gradient scrim as Discord does.

### [POLISH] The chat header's search box grows on focus and shoves the channel name

- **Where**: `web/src/components/search/Search.module.css:26`–`:27`, `:33`; used at `web/src/components/chat/ChatView.tsx:215`
- **What**: `width: 180px` → `260px` on `:focus-within`, with a 150ms transition. The channel name and topic are the flexible siblings that give up the 80px.
- **Fix**: keep it at its focused width, or animate a `max-width` on a fixed-width wrapper so the siblings don't move.

### [POLISH] Opening search silently closes the DM profile panel

- **Where**: `web/src/components/chat/ChatView.tsx:315`
- **What**: `… && profileOpen && !searchOpen ? <aside …> : null`. The panel the user deliberately pinned open vanishes when they click into search and returns when they close it, with no explanation.
- **Fix**: on a wide window show both; on a narrow one, close it with a visible transition and restore explicitly.

### [POLISH] At 1100–1199px the member list vanishes when search opens

- **Where**: `web/src/components/chat/MemberList.module.css:23`–`:25`
- **What**: `[data-search="true"] > .list { display: none }` — an abrupt, unexplained disappearance in a 100px-wide band of viewport widths.
- **Fix**: fall through to the same `position: absolute` drawer treatment the ≤1099px rule already uses.

### [POLISH] The profile side panel has no backdrop, unlike the member list beside it

- **Where**: `web/src/components/chat/Chat.module.css:28`; compare `:205` and `web/src/components/chat/ChatView.tsx:313`
- **What**: At ≤1099px `.profilePanel` becomes an absolute overlay over the chat. The member list in the same situation gets `.membersBackdrop` and tap-to-close; the profile gets neither.
- **Fix**: the same backdrop, or a close button inside the panel header.

### [POLISH] Jumping to a message shows nothing when motion is reduced

- **Where**: `web/src/components/chat/Chat.module.css:52`–`:53`; `web/src/components/chat/MessageList.tsx:259`–`:261`
- **What**: `animation: flash 2s ease-out` is the only indication of which message was jumped to, and the global clamp makes it instantaneous. The 2000ms `setTimeout` that clears `highlight` still runs.
- **Fix**: under reduced motion, hold a static `background: var(--bg-selected)` for the same two seconds instead of animating.

### [POLISH] Escape declines an incoming call

- **Where**: `web/src/components/voice/IncomingCall.tsx:32`; Modal's Escape at `web/src/components/common/Modal.tsx:38`
- **What**: `onClose={() => void declineCall(channelId)}`. `closeOnOverlay={false}` guards stray clicks but not the keyboard. The two 56px buttons also sit 16px apart with decline on the leading side.
- **Fix**: let Escape dismiss the ringer locally without sending a decline.

### [POLISH] `aria-pressed` is never `false`, and the label flips underneath it

- **Where**: `web/src/components/voice/VoiceView.tsx:113`
- **What**: `aria-pressed={on || off ? true : undefined}`. Muted announces "Unmute, button, pressed"; unmuted announces "Mute, button" with no state — two contradictory signals for one toggle.
- **Fix**: a stable name ("Microphone") with `aria-pressed={!muted}` always, or the flipping label with no `aria-pressed` — not both.

### [POLISH] Call quality is conveyed by hue alone, in two places

- **Where**: `web/src/components/voice/Voice.module.css:93`–`:97` with `VoiceView.tsx:697`–`:700`; `:122`–`:125` with `VoiceStatus.tsx:37`, `:46`–`:47`
- **What**: The chip reads "123 ms" whatever the level; only the dot's colour changes. In the sidebar the words stay "Voice Connected" and only the text colour changes — coloured 13px text is the worst case for a colour-blind reader.
- **Fix**: a signal-bars glyph, or append the word ("123 ms · Poor").

### [POLISH] Hover buttons blanket a small call tile

- **Where**: `web/src/components/voice/Voice.module.css:64`–`:67`; `web/src/components/voice/VoiceView.tsx:616`–`:648`, size guards at `:569`–`:586`
- **What**: Four 32px buttons ≈140px wide, shown unconditionally on hover. In a 16-person call on a 1000×500 stage, `fitGrid` yields ≈160×90 tiles — the overlay covers the top while `.tileBar` takes the bottom. The `offer` block already guards for tile height; `tileBtns` does not.
- **Fix**: below ~180px tile width show only Fullscreen; below ~120px, none.

### [POLISH] Focusing someone in a short viewport strands everyone else

- **Where**: `web/src/components/voice/VoiceView.tsx:323`; `web/src/components/voice/Voice.module.css:208`–`:211`
- **What**: `showStrip = tiles.length > 1 && stage.h >= 240 && …`. The CSS carefully shrinks the strip to 60px for short screens, but the 240px threshold removes it first in split-view or short landscape. The only way back is the Unfocus button on the tile — which is `display: none` on touch grids.
- **Fix**: lower the threshold to ~160px and let the existing `max-height: 520px` rule size it.

### [POLISH] Voice participant rows are the smallest targets in the sidebar

- **Where**: `web/src/components/voice/Voice.module.css:138`, `:137`; compare `Sidebar.module.css:14` (44px) and `ServerSidebar.module.css:14` (34px)
- **What**: 32px rows, not bumped by the `pointer: coarse` block at `:106`. `.participants { padding: 0 0 4px 22px }` is also physical, so in RTL the list detaches from the channel it belongs to.
- **Fix**: 40px under `pointer: coarse`; `padding-inline-start: 22px`.

### [POLISH] Fullscreen tile overrides re-introduce physical `left`/`right`

- **Where**: `web/src/components/voice/Voice.module.css:115`–`:116`; base rules at `:55`, `:64`
- **What**: The base rules correctly use `inset-inline-start`/`-end`; the `:fullscreen` overrides use `left:`/`right:`. In RTL, going fullscreen teleports the name label and the button cluster to the opposite corners from where they were a frame earlier.
- **Fix**: `inset-inline-start: max(8px, env(safe-area-inset-left))` and the mirror for the end.

### [POLISH] The mobile settings nav never scrolls the selected tab into view

- **Where**: `web/src/components/settings/Settings.module.css:84`–`:88`; driven by `web/src/components/server/ServerSettingsModal.tsx:39`
- **What**: The ≤767px rules turn the sidebar into an `overflow-x: auto` strip — a good adaptation, with a fixed close button that gives a way back. But server settings has ten items and nothing calls `scrollIntoView`, so deep-linking to `page: "audit"` shows a strip starting at "Overview" with the highlighted tab off-screen.
- **Fix**: `scrollIntoView({ inline: "center", block: "nearest" })` on the selected button when `page` changes.

### [POLISH] Every permission row in the role grid gets a doubled separator

- **Where**: `web/src/components/server/PermissionGrid.module.css:4` with `web/src/components/common/Toggle.module.css:1`; markup at `PermissionGrid.tsx:33`–`:35`
- **What**: `RoleGrid` renders `<div className={s.row}><Toggle/></div>`, and both `.row` rules carry `padding: 12px 0` and `border-bottom`. `OverwriteGrid` (`:87`–`:97`) builds its own markup and gets the intended single rule.
- **Why it matters**: The two permission editors in the same product have visibly different row rhythm.
- **Fix**: `.row:has(> label) { padding: 0; border: 0 }`, or align `RoleGrid` with `OverwriteGrid`'s markup.

### [POLISH] `Toggle`'s text column lacks `min-width: 0`, unlike its twin

- **Where**: `web/src/components/common/Toggle.module.css:3`; compare `web/src/components/server/PermissionGrid.module.css:6`
- **What**: `.text { display: flex; flex-direction: column; gap: 4px }` inside a `space-between` row, with no `min-width: 0`. The visually identical `.text` in PermissionGrid *has* it.
- **Why it matters**: A long German or Finnish compound in a toggle label pushes the 40px switch off the row at 380px.
- **Fix**: `min-width: 0; overflow-wrap: anywhere`.

### [POLISH] ProfilePage hand-rolls the save bar and leaves Reset live during a save

- **Where**: `web/src/components/settings/ProfilePage.tsx:176`–`:184`; original at `web/src/components/server/SettingsLayer.tsx:57`–`:63`
- **What**: A duplicated copy of `SaveBar` that drops `disabled={busy}` from Reset. Clicking Reset mid-save wipes the fields, and `save()` then writes the server's response back over them (`:59`–`:63`).
- **Why it matters**: The user watches their own edits reappear after they cancelled.
- **Fix**: import `SaveBar` and delete the copy.

### [POLISH] "Only holders can rotate" is a `title` on a disabled button, so it never shows

- **Where**: `web/src/components/server/pages/EncryptionPage.tsx:85`
- **What**: `disabled={!holdLatest} title={holdLatest ? … : t("…onlyHoldersCanRotate")}`. Disabled buttons don't receive pointer events, so the explanation exists only in the branch where it isn't needed.
- **Fix**: render the reason as visible text in `.keySub`.

### [POLISH] Crash-log rows are click-to-expand `div`s that shift the rows below them

- **Where**: `web/src/components/settings/AdminPage.tsx:208`; text styled by `web/src/components/server/ServerSettings.module.css:50`
- **What**: `<div style={{ cursor: "pointer" }} onClick>` with no `role`, `tabIndex` or key handler, and the message rendered with `white-space: nowrap; text-overflow: ellipsis`. The row grows from ~56px to ~316px on expand.
- **Fix**: a `<button>` wrapper with `aria-expanded`, and let the message wrap.

### [POLISH] The screen picker's tabs are ARIA tabs with no panels

- **Where**: `web/src/components/desktop/DisplayPicker.tsx:92`–`:95`, `:101`–`:110`
- **What**: `role="tablist"`/`role="tab"` with no `aria-controls`, no `tabpanel`, no arrow roving. Sources are `aria-pressed` buttons acting as a single-select group, and `onDoubleClick` is the only one-gesture share. The sibling `Choices` in `ShareScreenModal.tsx:31`–`:53` already does the radiogroup pattern correctly.
- **Fix**: `role="radiogroup"`/`role="radio"` for sources, real panels or plain buttons for the tabs, Enter on a source = share.

### [POLISH] Activity labels hang off elements that can't carry them

- **Where**: `web/src/components/activity/StatusLine.tsx:29`, `:31`, `:35`
- **What**: `aria-label` on a bare `<svg>` with no `role="img"`, and on a non-interactive `<span>`. Neither is reliably announced, so "Listening to music" and "+2 more" are dropped; the visible `title` at `:29` doesn't reach touch users either.
- **Fix**: `role="img"` on the svg; `.visually-hidden` text instead of the span's `aria-label`.

### [POLISH] The rail's server badge is read as a loose number

- **Where**: `web/src/components/rail/Rail.tsx:195`; compare `:130` and `:161`
- **What**: Home and Waiting correctly mark the badge `aria-hidden` and fold the count into the button's `aria-label`. The server button does neither, so its label is just the server name and the badge announces as "3".
- **Fix**: match the pattern already used two functions up.

### [POLISH] A tooltip cannot be dismissed with Escape

- **Where**: `web/src/components/common/Tooltip.tsx:88`–`:98`
- **What**: Handlers cover mouseenter/leave/focus/blur/pointerdown/click but not `keydown`. WCAG 1.4.13 requires hover/focus content be dismissable without moving the pointer or focus.
- **Fix**: a document `keydown` listener while `open` that calls `hide()` on Escape.

### [POLISH] Radio groups ship without a group name

- **Where**: `web/src/components/modals/ServerNotificationsModal.tsx:31`–`:38`; `web/src/components/modals/CreateChannelModal.tsx:78`
- **What**: Three `<input type="radio" name="level">` in a plain `<div>` — no `fieldset`/`legend`, no `role="radiogroup" aria-label`.
- **Fix**: wrap in a `radiogroup` with an accessible name.

### [POLISH] Search and name fields are labelled by placeholder only

- **Where**: `web/src/components/modals/CreateDMModal.tsx:64`, `:65`; `web/src/components/modals/QuickSwitcher.tsx:143`
- **What**: `TextInput` used bare, outside a `Field`, with only a `placeholder`. The placeholder vanishes on the first keystroke and is not a label.
- **Fix**: wrap in `Field`, or add `aria-label`.

### [POLISH] `ErrorBoundary`'s "Clear cache and reload" runs for seconds with no feedback

- **Where**: `web/src/components/shell/ErrorBoundary.tsx:89`, implementation at `:59`–`:71`
- **What**: `reset()` awaits service-worker unregistration and `caches.delete` for every key, then reloads. The button never disables and never changes appearance, so it looks dead and invites repeated clicks — each starting another pass. (The surrounding markup is otherwise right: `role="alert"` at `:78`, a real `<h1>` at `:80`.)
- **Fix**: a `busy` state that disables both buttons and swaps the label.

### [POLISH] Invite links blank out on every option change with no announcement

- **Where**: `web/src/components/modals/InviteModal.tsx:89`, `:90`, `:101`, `:106`; `web/src/components/modals/GroupInviteModal.tsx:79`
- **What**: While `busy`, the read-only field is empty with `placeholder="Generating…"` and Copy is disabled with no stated reason. Changing any Select silently re-fires `generate()`. The copy confirmation only swaps the focused button's own label, which most screen readers do not re-announce.
- **Fix**: `aria-busy` on the field plus a `role="status"` line ("Generating a new link…" / "Link copied").

### [POLISH] `SubchatModal` validation errors are red text with no role and no field link

- **Where**: `web/src/components/modals/SubchatModal.tsx:98`, set at `:38`–`:42`
- **What**: `<div style={{ color: "var(--danger)", fontSize: 14 }}>{error}</div>` — no `role="alert"`, no `aria-describedby`, no `aria-invalid`, and colour is the sole non-textual signal.
- **Fix**: `role="alert"`, link it to the failing field, and move focus there.

### [POLISH] Several actions give no feedback while in flight

- **Where**: `web/src/components/server/MemberActionModal.tsx:98`; `web/src/components/settings/ProfilePage.tsx:91`–`:99`; `web/src/components/server/pages/ServerOverviewPage.tsx:61`–`:70`
- **What**: Role checkboxes set `optimistic` but are never `disabled`, so rapid clicks queue conflicting add/remove calls. `remove("avatar")` has no busy state at all. The server icon upload shares `busy` with the form, so uploading a picture puts the unrelated **Save** button into a spinner.
- **Fix**: per-action busy keys rather than one shared flag.

### [POLISH] Two search surfaces highlight matches differently

- **Where**: `web/src/components/search/Search.module.css:23` (`rgba(128, 0, 255, 0.35)`, hardcoded) versus `web/src/components/modals/QuickSwitcher.module.css:37` (`var(--mention-bg)` + `var(--mention-fg)`)
- **What**: Two implementations of the same idea, one theme-aware and one not. The hardcoded one also ignores a chosen accent.
- **Fix**: one `--mark-bg` / `--mark-fg` pair in `tokens.css`, used by both.

### [POLISH] `ServerModals` uses `outline` for the selected radio, so selected and focused look identical

- **Where**: `web/src/components/modals/ServerModals.module.css:21`
- **What**: `.radio[data-on="true"] { outline: 2px solid var(--brand) }` — the same treatment as the global focus ring (`base.css:23`).
- **Fix**: `box-shadow: inset 0 0 0 2px var(--brand)` for selection, leaving `outline` to mean focus. `Picker.module.css:20` already does this correctly for the tone options.

### [POLISH] Dead CSS and a duplicated declaration

- **Where**: `web/src/components/composer/Composer.module.css:47` (`.hint` — no `s.hint` anywhere in `components/composer/`); `web/src/components/shell/AppShell.module.css:9` (`color: #fff` immediately overridden by `color: #111` on the same line)
- **Why it matters**: `.hint` and `.slowmode` are both absolutely positioned in the same 24px strip below the composer; if `.hint` is ever brought back they will overlap.
- **Fix**: delete both.

### [POLISH] Composer error and attachment labels are programmer-facing

- **Where**: `web/src/components/composer/Composer.module.css:49` (mobile hides `.counter`); `web/src/components/composer/Composer.tsx:465`, `:507`
- **What**: The character counter is hidden entirely below 768px, so on a phone there is no warning at all until Send produces a toast (`:313`). The attachment thumbnail for a non-previewable file renders `f.file.type.split("/")[0]` — literally "application" for a PDF.
- **Fix**: keep a compact counter on mobile (or show it inline once over the limit); map MIME groups to words.

### [POLISH] Ad-hoc pixel values where a token exists

- **Where**: `web/src/components/chat/Chat.module.css:236` (`top: 52px` where `--header-h: 49px`), `:128` (`.file { width: 432px }`), `:147` (`.pinsPop { width: 420px }`); `web/src/components/chat/Embeds.module.css:2` (`max-width: 516px`), `:28` (`432px`); `web/src/components/chat/VideoPlayer.module.css:2` (`550px`); `web/src/components/friends/Friends.module.css:10` (`padding: 16px 20px 16px 30px`); `web/src/components/settings/Settings.module.css:15` (`width: 740px`)
- **What**: Seven different content-width constants and a 30px gutter that matches nothing else in the app (chat uses 16px, settings 40px, server settings 16px).
- **Fix**: a `--content-narrow / --content-wide` pair and a `--gutter` token, and use `var(--header-h)` for the panel offset.

### [POLISH] Tooltip text is centre-aligned

- **Where**: `web/src/components/common/Tooltip.module.css:6`
- **What**: `max-width: 260px; text-align: center`. A three-line tooltip with a ragged left edge is measurably slower to read.
- **Fix**: `text-align: start` for anything that wraps.

### [POLISH] Error text is set in italic, the only italic in the product

- **Where**: `web/src/components/common/TextInput.module.css:4`
- **What**: `.errorText { … font-style: italic }`.
- **Fix**: keep the weight and colour change, drop the italic.

### [POLISH] Focused inputs get two focus rings

- **Where**: `web/src/components/common/TextInput.module.css:9` with `web/src/styles/base.css:23`
- **What**: `.input:focus { border-color: var(--brand) }` plus the global `:focus-visible` outline at 2px offset.
- **Fix**: use `:focus-visible` for the border too, or drop the border change and rely on the outline.

### [POLISH] The rail hides its scrollbar entirely

- **Where**: `web/src/components/rail/Rail.module.css:1`–`:2`
- **What**: `scrollbar-width: none` with the webkit pseudo-element hidden. With more servers than fit, nothing indicates there are more.
- **Fix**: a small fade at the bottom edge when scrollable.

### [POLISH] Front page: heading structure is flat, and the table has no header semantics

- **Where**: `web/src/pages/HomePage.tsx:133`, `:146`, `:162`, `:173`, `:182`, `:186`, `:203`–`:204`
- **What**: Twelve feature-card `<h2>`s sit at the same level as the four section `<h2>`s, and the `.points` section has no heading of its own. The comparison table has an empty `<th>`, no `scope` attributes and no `<caption>`; the ✓/✕ cells have no text alternative. At 18px, `--positive` on `--bg-base` is 4.1:1 and `--danger` is 3.1:1 — both below 4.5:1, though the glyph shape carries the meaning.
- **Fix**: `<h3>` for the cards under a section `<h2>`; `scope="col"`/`scope="row"`, a caption, and a `.visually-hidden` "Yes"/"No" beside each glyph.

### [POLISH] Front page: the hero CTA relabels itself after an async platform probe

- **Where**: `web/src/pages/HomePage.tsx:87`–`:96`, `:122`
- **What**: `{os ? t("home.hero.downloadFor", { os }) : t("home.nav.download")}` — "Download" becomes "Download for macOS" once `currentPlatform()` resolves, changing the button's width and shifting the row beside it.
- **Fix**: reserve the wider label's width, or resolve the platform synchronously from `navigator.userAgentData` where available.

### [POLISH] Code blocks are capped at 90% of an already narrow column, and cannot be copied

- **Where**: `web/src/styles/markdown.css:4`
- **What**: `.md-codeblock { max-width: 90%; overflow-x: auto }`. On a 380px phone the message content column is ≈300px, so a code block gets ≈270px with a horizontal scroll inside a vertical one.
- **Fix**: `max-width: 100%`, and see the copy-button idea below.

### [POLISH] Custom emoji and stickers have no broken-image fallback, though GIFs do

- **Where**: `web/src/components/pickers/EmojiPicker.tsx:104`, `:111`; `web/src/components/pickers/StickerPicker.tsx:45`; compare `web/src/components/pickers/GifGrid.tsx:138`
- **What**: `GifGrid` correctly wires `onError → onDead` and renders "This one is gone". The emoji and sticker grids don't, so a deleted or expired blob leaves broken-image glyphs scattered through the grid.
- **Fix**: reuse the `dead` pattern — `onError` marks the cell and renders a muted placeholder.

### [POLISH] Clipboard writes have no rejection path, including for the recovery key

- **Where**: `web/src/pages/RegisterPage.tsx:84`; `web/src/pages/RecoverPage.tsx:70`; `web/src/pages/DownloadPage.tsx:55`, `:139`; `web/src/components/profile/ProfileCard.tsx:186`; `web/src/pages/FriendsPage.tsx:175`
- **What**: All are `navigator.clipboard?.writeText(x).then(success)` with no `.catch`. In a non-secure context or with the permission denied the success toast never fires, nothing is said, and the rejection is unhandled.
- **Why it matters**: On Register and Recover this is the account recovery key. Believing it was copied when it wasn't is an account-loss event.
- **Fix**: `.catch(() => toast(t("…couldNotCopy"), "error"))`, and keep the key `user-select: all` as the fallback (`Auth.module.css:21` already does).

### [POLISH] Copying a release hash is a click-only `<span>`

- **Where**: `web/src/pages/DownloadPage.tsx:119`, `:139`; `web/src/pages/DownloadPage.module.css:22`
- **What**: `<span className={s.hash} title="Copy SHA-256" onClick={…}>` — not focusable, no `role`, no keyboard activation, and a native `title` as the only affordance.
- **Fix**: `<button type="button">` with an `aria-label`.

### [POLISH] Choosing a skin tone by keyboard drops focus, and the category rail never says which section you're in

- **Where**: `web/src/components/pickers/EmojiPicker.tsx:199`–`:202`, `:370`–`:385`, computed at `:351`–`:358`; Escape path at `:164`
- **What**: The tone option's `onClick` calls `setOpen(false)`, unmounting the focused `menuitemradio` without returning focus to the trigger — the Escape path gets this right, the click path doesn't. The category jump buttons carry only `title`: no `aria-label`, no `aria-current`, even though the component already computes `current`.
- **Fix**: refocus the trigger after selection; `aria-label` + `aria-current="true"` on the rail button matching `current`.

### [POLISH] Removing a favourite GIF is unconfirmed and unrecoverable, including in bulk

- **Where**: `web/src/components/pickers/GifPicker.tsx:142`, `:147`; `web/src/lib/gifFavorites.ts`
- **What**: The overlay X removes immediately, and "Remove them" wipes every dead favourite at once. There is no confirm and no undo.
- **Why it matters**: A mis-tap on a dense two-column grid silently deletes a saved GIF; the 24×24 target makes that likely.
- **Fix**: an undo toast for the single case; a count and a confirm for the bulk one.

### [POLISH] The GIF favourites tab gives the wrong instruction while the provider status is unknown

- **Where**: `web/src/components/pickers/GifPicker.tsx:129`, fetch at `:45`–`:51`
- **What**: `enabled` starts `null`, and the empty-state ternary is `enabled ? starInSearch : starInChat` — so during the in-flight `gifStatus()` call the user is told to "Hover any GIF in chat and press the star", and the text then swaps once the response lands.
- **Fix**: treat `enabled === null` as loading and hold the hint until it resolves.

---

## Ideas

Ranked by value for effort. Costs are honest estimates of implementation time for someone already in this codebase.

### [IDEA] A `--on-brand` derived from the accent, plus a contrast guard on the colour picker

- **Value**: high — **Effort**: half a day
- Fixes the accent contrast BROKEN above and makes the free colour picker safe to keep. Compute relative luminance, pick black or white for `--on-brand`, clamp lightness into a legible band per theme, and show a live preview chip with a "this is hard to read" warning rather than silently accepting `#ffffff`. Discord solves this by not letting you choose; doing it properly is a differentiator.

### [IDEA] A copy button on code blocks, and language labels

- **Value**: high — **Effort**: two hours
- `markdown/render.tsx:429` already emits a `<pre className="md-codeblock">` with a known `lang`. A small absolutely-positioned copy button in the corner (revealed on hover, always visible on touch) plus a faint language label is the single most-requested thing in a developer chat, and Discord has had it for years. Reuse the `.pinRemove` reveal pattern from `Chat.module.css:157`–`:162`, which already handles the touch case.

### [IDEA] A real loading skeleton for the message list

- **Value**: high — **Effort**: half a day
- `MessageList.tsx:369` shows an unlabelled spinner in the middle of an empty column. Three or four grey avatar-and-two-lines rows at the message rhythm, fading, would make channel switching feel instantaneous rather than empty-then-full. It also fixes the reduced-motion case for free, because a skeleton doesn't need to move.

### [IDEA] Keyboard reordering everywhere something is draggable

- **Value**: high — **Effort**: one day
- Three surfaces (roles, stickers, the server rail) share the same gap. One small `useReorderKeys(items, onMove)` hook wiring `Alt+Arrow` plus an `aria-live` announcement would close the BROKEN above and make the app usable on a phone for the moderation tasks that currently require a desktop.

### [IDEA] One focus-trap primitive, applied to `Modal`, `ContextMenu` and the mobile drawer

- **Value**: high — **Effort**: one day
- The three biggest accessibility findings are the same missing piece. A `useFocusTrap(ref, { restore: true })` plus an `inert` toggle on `#root` closes all three and makes the app keyboard-navigable end to end. `Modal.tsx:44`/`:50` already do the restore half correctly, so the pattern is half-written.

### [IDEA] Reduced motion that keeps the signal

- **Value**: medium-high — **Effort**: half a day
- Replace the blanket `animation-duration: 0.001ms !important` with `animation: none` for decorative classes and explicit reduced-motion rules for the four load-bearing animations: spinner, button loading dots, jump-to flash, speaking ring. Everything stops moving; nothing stops meaning.

### [IDEA] One `describeError(err)` used everywhere an error reaches a person

- **Value**: high — **Effort**: half a day
- Thirteen call sites currently fall back to `err.message`, which for an unmapped failure is the literal string `Request failed with status 500.` (`api/client.ts:82`). Two more print DOMException names (`VoicePage.tsx:94`, `PasscodePage.tsx:42`). One helper mapping `ApiError.code` → `t()`, `DOMException.name` → `t()`, and everything else to a translated generic would close a whole class of findings at once and give the team a single place to improve error copy.

### [IDEA] A shared `<AsyncList>` for the moderation pages

- **Value**: medium-high — **Effort**: one day
- Bans, Invites, Audit Log, Encryption, Devices and Members all hand-roll `T[] | null` and all get the error case wrong in the same way. One component taking `load()` and rendering pending / empty / error-with-retry would close five BROKEN findings and stop the sixth happening next time.

### [IDEA] Unread jump bar with a count, and "mark as read" from the sidebar

- **Value**: medium-high — **Effort**: one day
- `.newPill` (`Chat.module.css:144`) already exists and says "New messages"; giving it the count and an explicit "Mark as read" beside it — plus Escape to mark-read, as Discord does — is the biggest daily quality-of-life gap versus Discord. The pill is also currently a `<div onClick>` with no keyboard path, so this fixes that too.

### [IDEA] Per-viewer theme following the OS on first visit

- **Value**: medium — **Effort**: two hours
- `resolveTheme` (`lib/theme.ts:27`–`:31`) already handles `"system"`, but the default is `"dark"` (`stores/settings.ts:88`). Defaulting to `"system"` for a brand-new account means the front page and the app match what the visitor's machine already does, which costs nothing and reads as care.

### [IDEA] Message-list virtualisation

- **Value**: medium — **Effort**: two to three days
- `MessageList.tsx:359` renders every loaded row. A long backlog in a busy channel is thousands of DOM nodes with embeds, players and images. The front page claims 50ms channel switching; virtualising keeps that true for a channel someone has scrolled a long way back in. Non-trivial because of variable row heights, the sticky date dividers and the scroll anchoring already in place.

### [IDEA] A `dirty`-aware settings shell

- **Value**: medium — **Effort**: half a day
- `SaveBar` already knows when there are unsaved changes; the nav does not ask. Lifting that flag into `SettingsLayer` and intercepting page/tab/selection changes closes the BAD above and would let the same guard cover closing the modal entirely.

### [IDEA] A tokenised z-index and spacing scale

- **Value**: medium — **Effort**: half a day
- Nineteen ad-hoc z-index values with two collisions, and seven different content-width constants. Naming them in `tokens.css` is cheap, and it is the kind of thing that only gets harder as more surfaces are added.

### [IDEA] Per-message "jump to context" and a reading position marker that survives reload

- **Value**: medium — **Effort**: one to two days
- Search results already jump (`MessageList.tsx:254`–`:276`) with a flash. Keeping the unread divider's position per channel across a reload — and adding "Jump to first unread" to the pill — is the thing that makes a chat app feel like it remembers you, and is a visible advantage over a fresh Discord session.

### [IDEA] Pause-on-hover toasts with an explicit close

- **Value**: low-medium — **Effort**: two hours
- `stores/ui.ts:174` times out at 5s regardless. Clearing the timer while the stack is hovered or focused, plus a close X, turns the toast from something that might have said something important into something you can actually read.
