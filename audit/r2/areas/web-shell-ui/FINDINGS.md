# Findings — web-shell-ui (prefix WSHELL)

(Summary is written at the top when the audit is done.)

---

### WSHELL-001 · P2 · i18n · About twenty shell and modal strings are hard-coded English and never reach the eleven catalogues
- Where: `web/src/components/shell/AppShell.tsx:205`, `web/src/components/shell/ErrorBoundary.tsx:80`, `web/src/components/shell/RpcBanner.tsx:42`, `web/src/components/shell/DownloadBanner.tsx:93,105`, `web/src/components/sidebar/DMSidebar.tsx:113`, `web/src/components/sidebar/dmMenu.ts:128`, `web/src/components/modals/QuickSwitcher.tsx:85,88`, `web/src/components/modals/PromptModal.tsx:44`, `web/src/components/modals/StickerPackModal.tsx:54,58,62,83`, `web/src/components/modals/SubchatModal.tsx:81,100`, `web/src/components/modals/CreateServerModal.tsx:23`, `web/src/components/modals/CreateChannelModal.tsx:97`
- What: literals rendered to the user, file by file — AppShell: `"Connecting…"` and `"Disconnected — reconnecting…"` (a key `shell.requireAuth.connecting` already exists for the first); ErrorBoundary: the first-crash title `"Reloading…"`; RpcBanner: `"Restarting…"`; DownloadBanner: the tagline `" — RPC support and a better experience."` and the unsure-Mac button `"Download"` (the same file translates `shell.downloadBanner.download` two lines earlier); DMSidebar: the badge `aria-label` `` `${count > 99 ? "more than 99" : count} unread` ``; dmMenu: the leave-group confirm title `` `Leave '${name}'` `` (its body and button are translated); QuickSwitcher: subtitles `` `${n} members` `` and `"Server"`; PromptModal: the default `confirmLabel = "Save"` (every `promptText` caller that passes no label shows an English button); StickerPackModal: `"Edit Pack"`, `"Installed"`, `"Install Sticker Pack"`, `"1 sticker"`/`` `${n} stickers` ``; SubchatModal: the field label `"Password"` and the edit button `"Save"`; CreateServerModal: the default server name `` `${name}'s server` `` — an English possessive that is wrong in every other language and typographically in English (straight quote); CreateChannelModal: the placeholder `"new-channel"`. `tools/i18n_keys_used.py` cannot see any of these because they are not keys, which is why the "0 missing" check is green.
- Impact: an Arabic or German user on a flaky connection sees an English strip across the top of every channel — the one message shown precisely when they are worried; a new user's first server is called "Ahmed's server" in an Arabic UI; a screen-reader user hears "more than 99 unread" in English in the middle of their DM list.
- Fix: add keys and route them through `t()` (`shell.appShell.connecting`, `shell.appShell.disconnectedReconnecting`, `shell.errorBoundary.reloading`, `shell.rpcBanner.restarting`, `shell.downloadBanner.rpcSupportTagline`, `sidebar.dmMenu.leaveNamed`, `modals.quickSwitcher.membersCount`/`server`, `modals.prompt.save`, `modals.stickerPack.editPack`/`installed`/`install`/`stickersCount`, `modals.subchat.password`/`save`, `modals.createServer.someonesServer`, `modals.createChannel.newChannelPlaceholder`; reuse `shell.downloadBanner.download`, `rail.rail.moreThan99Unread` + `rail.rail.unreadMessagesCount`). The tagline copy stays exactly "RPC support and a better experience" (owner-approved). Consider a lint (`eslint-plugin-i18n-json`'s `no-literal-string`, or a small grep in `tools/i18n_keys_used.py` for JSX text nodes and template literals with a capital letter) so the next one cannot land.
- Effort: S
- Status: open

### WSHELL-002 · P2 · bug · On a right-to-left phone the drawer gesture is mirrored the wrong way: the natural edge swipe opens the member list, and the drawer slides in from the far side
- Where: `web/src/components/shell/AppShell.tsx:142-185`, `web/src/components/shell/AppShell.module.css:28-30`
- What: the CSS mirrors the drawer's *resting* transform for `[dir="rtl"]` (`translateX(100%)`, drawer parked off the right edge), but the touch maths in `onTouchMove`/`onTouchEnd` and the inline `drawerStyle` (`translateX(${dragX - drawerWidth()}px)`) have no notion of direction. In RTL a leftward swipe (from the edge the drawer lives on) clamps `dragX` to 0, so the inline transform becomes `translateX(-w)`: the drawer, whose resting box is on the right, is shoved a full width to the left and a sliver of it appears at the *left* screen edge for the length of the drag; on release `open` is false and the `dx < -60` branch runs `setRightOpen(true)`, so the member list opens instead. A rightward swipe does open the drawer, but it visibly travels across the screen from the left edge to settle on the right.
- Impact: every Arabic user on a phone (a first-class target per the brief). The gesture is the drawer's main affordance; the hamburger still works, so it is not a blocker.
- Fix: read `getComputedStyle(document.documentElement).direction === "rtl"` once at `onTouchStart` and store `sign = rtl ? -1 : 1`; use `dx * sign` everywhere `dx` is compared, and emit `translateX(${sign * (dragX - w)}px)` (or drop the inline transform and drive a CSS custom property `--drawer-x` that the RTL rule negates). Also mirror the "left swipe with nothing open opens the members" branch.
- Effort: S
- Status: open

### WSHELL-003 · P2 · bug · A background pane whose fetch fails for any reason says the conversation "is no longer here"
- Where: `web/src/components/shell/PaneView.tsx:41-49`
- What: `fetched.catch(() => alive && setMissing(true))` treats every rejection — a 401 during token refresh, a 5xx, a captive portal, simply being offline when the tab is restored — as the channel being gone, and renders `panes.thatConversationIsNoLongerHere` with a single "Close pane" button. There is no retry and nothing re-runs the effect (`known` stays false, `channelId` and `serverId` do not change), so the pane stays "gone" for the life of the tab even after the network returns. This is the same class of defect round 1 fixed on thirteen other surfaces ("a failed request drawn as an empty state").
- Impact: someone who reopens the app on a train with two split panes sees one of them declare its channel deleted; closing it loses the layout they set up. Reproducible by restoring a split layout with the throwaway server stopped.
- Fix: only set `missing` on `ApiError` with status 403/404; otherwise show `LoadError` (common/) with a retry that bumps an `attempt` counter in the effect's deps. `ServerPage`/`DMPage` already distinguish these — copy their branch.
- Effort: S
- Status: open

### WSHELL-004 · P3 · a11y · The tab strip is announced as a tablist but does not behave like one, and the pane dividers have no accessible value
- Where: `web/src/components/shell/Tabs.tsx:42-115`, `web/src/components/shell/PaneGrid.tsx:190-197`
- What: `role="tablist"` contains `role="tab"` children plus a plain `<button>` (the `+`), no `aria-controls`/`tabpanel`, and no arrow-key movement — each tab is `tabIndex={0}` so a keyboard user Tabs through them one by one and presses Enter (the ARIA tabs pattern is one tab stop plus Left/Right). Closing a tab from the keyboard requires reaching the × button, which is `opacity: 0` until focused, so it is invisible on the way there. The split dividers are `role="separator"` `tabIndex={0}` with `aria-orientation` but no `aria-label` or `aria-valuenow`/`min`/`max`, so a screen reader announces "separator" with no hint that arrows resize it.
- Impact: keyboard and screen-reader users of tabs/panes; a small population but the roles as written promise a behaviour that is not there.
- Fix: either drop `role="tablist"/"tab"` for `role="list"`/buttons with `aria-current`, or implement Left/Right/Home/End with roving tabindex; move `+` outside the tablist; give dividers `aria-label={t("panes.resizePanes")}` and `aria-valuenow={Math.round(sizes[at]*100)}`.
- Effort: S
- Status: open

### WSHELL-005 · P3 · ux · Alt+Up/Down always cycles direct messages, even from inside a server, and steals Option+Arrow from the composer on macOS
- Where: `web/src/components/shell/Shortcuts.tsx:85-96`
- What: the handler ignores where the user is: in `/channels/123/456` the current channel is not a DM, `idx` is -1, and Alt+Down jumps to the first DM in the list. Discord (the reference for this shortcut) moves through the channels of the view you are in. The handler also does not check `inEditable`, and on macOS Option+Up/Down in a text field is the standard caret move to the previous/next paragraph — typing a multi-line message and pressing Option+Down navigates away from the channel instead.
- Impact: anyone who learns the shortcut from `ShortcutsHelp`; Mac users lose a native editing key inside the composer.
- Fix: when the path is a server, cycle that server's text channels in sidebar order (categories flattened) instead of DMs; skip the shortcut while `inEditable(e.target)` unless the field is the composer and the caret is on its first/last line (Discord's rule).
- Effort: S
- Status: open

### WSHELL-006 · P2 · ux · Clicking into another pane of a split remounts both chats
- Where: `web/src/components/shell/AppShell.tsx:225`, `web/src/components/shell/PaneGrid.tsx:45-54`
- What: the focused pane is rendered as the routed page (`children`) and every other pane as `<PaneView>`. When focus moves from pane A to pane B, A's slot switches from `children` to `<PaneView>` and B's from `<PaneView>` to `children` — two different element types at the same tree position, so React unmounts and remounts the `ChatView` in *both* panes. `MessageList` re-runs its initial load (`scrollTop = scrollHeight` at MessageList.tsx:220), so both scroll positions jump to the bottom, an open reply/edit in the pane you left is dropped, and any media that was playing stops. The design note in `stores/panes.ts` explains why the routed page is the focused one (deep links, back button) but does not anticipate the remount.
- Impact: every focus change in a split — a click anywhere in the other chat. It makes splits feel broken for reading two long conversations side by side, which is their whole point.
- Fix: render every pane through `PaneView` and have the routed page only *drive* the focused pane's channel (it already does via `setPaneChannel`), so the element type never changes; `DMPage`/`ServerPage` become thin controllers that render nothing when the pane grid is on. The fix is `M` because the routed pages own `?jump=` and the "channel gone" redirect.
- Effort: M
- Status: open

### WSHELL-007 · P3 · bug · In a right-to-left layout the rail's tooltips are drawn over the icons instead of beside them
- Where: `web/src/components/rail/Rail.tsx:146,160,213,232` (`side="right"`), `web/src/components/common/Tooltip.tsx:24-49`
- What: the rail asks for its tooltips on the physical right. Under `dir="rtl"` the grid lays the rail out at the right edge of the window, so `anchor.right + GAP` is past the viewport; `place()` only *clamps* (`left = min(left, vw - box.width - 4)`), it never flips a left/right tooltip, so the bubble lands on top of the server icon it names, with its arrow pointing at nothing.
- Impact: Arabic desktop users hovering the rail (tooltips are skipped on coarse pointers, so phones are unaffected).
- Fix: accept `side="inline-end"`/`"inline-start"` in `Tooltip` resolved against `getComputedStyle(anchor).direction`, and flip left↔right in `place()` when the bubble would leave the viewport, as it already does for top↔bottom. Rail passes `inline-end`. Cross-area: the component is `common/` (web-chat-ui); the call sites are here.
- Effort: S
- Status: open

### WSHELL-008 · P3 · ux · The shortcuts help omits the tab and pane shortcuts and names the Option key "Alt" on a Mac
- Where: `web/src/components/modals/ShortcutsHelp.tsx:7-18`, `web/src/components/shell/Shortcuts.tsx:66-84`
- What: `Shortcuts.tsx` binds Ctrl/⌘+Alt+←/→ (switch tab) and Ctrl/⌘+Alt+W (close pane, else tab); neither is in the list, and nothing else in the UI mentions them — tabs are otherwise only discoverable through a right-click menu. The list converts the modifier to "⌘" on a Mac but leaves "Alt ↑ / ↓" as "Alt", where the key is labelled ⌥. Ctrl+K for the quick switcher is listed, but Ctrl+Tab inside it (mode switch, QuickSwitcher.tsx:175) is not.
- Impact: the split-pane feature is close to invisible to anyone who does not right-click channels; small, but the list exists to be complete.
- Fix: add the three rows; use `⌥` when `isMac`; the `+` button in the tab strip could also carry a `title` mentioning the shortcut.
- Effort: S
- Status: open

### WSHELL-009 · P3 · ux · The eight lazily loaded dialogs show nothing at all while their chunk downloads
- Where: `web/src/components/modals/ModalHost.tsx:27-34,90-100`
- What: Settings, Profile, Server settings, Channel settings, Member action, Subchat, Verify key and Key change are `lazyPage()` chunks rendered inside `<Suspense fallback={null}>`. The first time each is opened in a session (and every time after a deploy, since chunk names change) the tap on the gear or the profile does nothing visible until the chunk arrives; `loadPatiently` retries for a while before giving up, so on a bad mobile connection that can be several seconds of apparently dead UI, and people tap again.
- Impact: every user, once per dialog per session; worst on phones on cellular, which is where the owner uses the app.
- Fix: a fallback that draws the overlay and a centred `Spinner` (`<Modal open bare ariaLabel={t("common.loading")}><Spinner/></Modal>`), so the tap is acknowledged instantly; or preload the settings chunk on hover/`pointerdown` of the gear (`import()` in an event handler warms the cache).
- Effort: S
- Status: open

### WSHELL-010 · P3 · ux · Enter submits most single-field dialogs but not the custom-status or subchat ones
- Where: `web/src/components/modals/CustomStatusModal.tsx:79`, `web/src/components/modals/SubchatModal.tsx:67`, compare `CreateCategoryModal.tsx:33`, `CreateChannelModal.tsx:97`, `CreateServerModal.tsx:85`, `ServerProfileModal.tsx:37`, `EditGroupModal.tsx:88`, `PromptModal.tsx:71-85`
- What: six dialogs bind Enter on their text field (or wrap it in a `<form>`); `CustomStatusModal` and `SubchatModal` do not, so typing a status and pressing Enter does nothing and the person has to reach for the mouse or Tab to the button. `CreateDMModal` is a legitimate exception (Enter in a search box should not create a DM with whatever is selected).
- Impact: keyboard users, and anyone who expects Enter to work because it does in the dialog they used a moment ago.
- Fix: wrap the two in a `<form onSubmit>` with a hidden submit button the way `PromptModal` does; longer term, make `Modal` accept an `onSubmit` so every dialog gets it for free.
- Effort: S
- Status: open
