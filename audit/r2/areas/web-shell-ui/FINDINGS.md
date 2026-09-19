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

### WSHELL-011 · P1 · a11y · The full-screen settings layers never take focus, so a keyboard user is still in the app behind them
- Where: `web/src/components/settings/SettingsModal.tsx:45-59`, `web/src/components/server/SettingsLayer.tsx:16-28`; compare `web/src/components/common/Modal.tsx:60-101`
- What: both layers `createPortal` into `document.body` with `role="dialog" aria-modal="true"` and bind **only** Escape. `Modal` does three more things neither of them does: it moves focus into the dialog on open (`(first ?? ref.current)?.focus()`), traps Tab inside it, and restores focus to the opener on close. Because the portal is appended after `#root`, focus stays on the gear/menu item that is now covered and the first Tab walks into the rail, the sidebar and the composer *behind* the layer, where Space/Enter activate them — you can switch channels or open a context menu while settings covers the whole screen, with no visible focus ring anywhere. `aria-modal="true"` simultaneously tells a screen reader that everything outside the layer does not exist, so a virtual cursor is confined to a dialog the real focus is not in, and opening settings announces nothing at all.
- Impact: keyboard-only and screen-reader users cannot reach user settings, server settings or channel settings — the three layers behind every account, privacy, security and moderation control in the product. Round 1's "zero axe violations" does not cover it: axe cannot see focus behaviour or focus order.
- Fix: lift `Modal`'s effect into a `useDialogLayer(ref, onClose)` hook (Escape + initial focus + Tab cycle + restore) and call it from `SettingsModal` and `SettingsLayer`; focus the selected nav button on open so the first Tab lands in the page. Add `inert` (or `aria-hidden`) on `#root` while a layer is up so assistive tech and Tab agree.
- Effort: S
- Status: open

### WSHELL-012 · P1 · bug · A recovery key generated from settings can be dismissed with Escape, and the account then claims a key the user never saw
- Where: `web/src/components/settings/AccountPage.tsx:126-142`, `web/src/stores/auth.ts:365-367` (`newRecoveryKey` sets `has_recovery: true`); compare `web/src/pages/RegisterPage.tsx:72-96`
- What: the dialog guards the backdrop (`closeOnOverlay={!recovery}`) but not the two other ways out: `Modal`'s Escape handler and its header × are live the whole time, and a reload dismisses it too. By then the server has already replaced the recovery wrap, so the previous key is dead and the new one is gone. The only way to keep it is a single "Copy" button — no download, no "I have saved it" gate, and `void navigator.clipboard?.writeText(recovery)` with the optional chain means that on any non-secure origin (or when the permission is refused) the click does nothing and says nothing; the promise is not awaited, so a rejection is an unhandled one and the user still sees no error. `RegisterPage` gets this right for the same key: Copy **and** Download .txt, a warning, and a "I have saved my recovery key" checkbox that gates Continue.
- Impact: a user who generates a key and mis-taps Escape (or whose clipboard silently failed) ends up with no recovery key at all, while Account now says "A recovery key is set. Generating a new one replaces it." They are strictly worse off than before they touched it, and nothing tells them. This is the only path back from a forgotten password — `settings.account.withoutARecoveryKeyAForgotten` says so.
- Impact (second half): the same unchecked `navigator.clipboard?.` copy is on the register screen (`RegisterPage.tsx:86`), where it is the primary action on a key that is never shown again.
- Fix: while `recovery` is set, block Escape and hide the header × (a `dismissible={false}` prop on `Modal`, which several dialogs would use), and require the same checkbox + Download .txt as registration — best factored into one `<RecoveryKeyPanel>` used by both. `await` the clipboard write and toast success or failure.
- Effort: S
- Status: open

### WSHELL-013 · P2 · ux · On a phone the Back gesture never closes settings, a modal or the drawer — it leaves the app with them still on screen
- Where: `web/src/components/shell/AppShell.tsx:92-96` (only the drawers react to a route change), `web/src/stores/ui.ts:101-132` (modals are plain state), `web/src/components/shell/AppShell.tsx:67-82` (`?settings=` is stripped from the URL as soon as it opens); `grep -rn "popstate\|pushState" web/src` → nothing
- What: every overlay in the app — the settings layer, server settings, all 28 modals, the phone drawer — is React state with no history entry. The route change that Back produces closes the drawers but not modals, so with settings open Back navigates the chat *behind* the layer (invisibly), and on the first history entry it leaves the site entirely with the layer still drawn in the snapshot the browser keeps. On the iPhone home-screen app (the owner's own daily client) the edge-swipe back gesture does the same, and there is no visible Back button to learn the difference. Android's native app handles Back properly (`Nav.kt`/`BackHandler`), so this is a web-only regression in behaviour people carry between the two.
- Impact: the system gesture every phone user reaches for first to dismiss a sheet quits the app instead. It also means a deep-linked `?settings=notifications` cannot be backed out of.
- Fix: push a history entry when the top-most overlay opens (`history.pushState({ overlay: id }, "")`) and close it on `popstate`, ignoring the entry when the overlay is closed another way (`history.back()` on × / Escape). One hook in `ui.ts` covers modals, the settings layers and `leftOpen`, in stack order.
- Effort: M
- Status: open

### WSHELL-014 · P2 · ux · The close buttons on tabs and on a split pane only appear on hover, so on a touch tablet they cannot be reached at all
- Where: `web/src/components/shell/Panes.module.css` (`.tabClose { opacity: 0 }` revealed by `.tab:hover`/`[data-selected]`/`:focus-visible`; `.paneClose { opacity: 0 }` revealed by `.pane:hover`/`:focus-visible`), `web/src/hooks/useIsMobile.ts:3` (`max-width: 767px`)
- What: the mobile cut-off is 767px, so an iPad in portrait (768px), any Android tablet and a touchscreen laptop all get the full desktop shell — tabs and split panes included — while having no hover. `.paneClose` is then unreachable by any means: there is no other way to close a pane except the channel context menu, and nothing in the pane says it can be closed. `.tabClose` is reachable only on the tab that is already selected, so closing a background tab on a tablet takes two taps and shows no affordance for the first one. `Panes.module.css` has no `@media` or `(hover: hover)` query anywhere, so nothing adapts.
- Impact: tablet users cannot undo a split they opened by accident (the split is offered from the same context menu on touch) and are left with a layout they cannot get out of short of clearing storage, since panes persist.
- Fix: wrap the reveal in `@media (hover: hover) and (pointer: fine)` and leave the buttons visible otherwise (the pattern `common/` already uses elsewhere); give `.tabClose`/`.paneClose` a 32px hit area on coarse pointers. Round 1's "mobile controls" fix did this for the chat header; the pane chrome was added later (`43d5f21`) and missed it.
- Effort: S
- Status: open

### WSHELL-015 · P2 · ux · None of the five Account dialogs submit on Enter, including "Change your display name"
- Where: `web/src/components/settings/AccountPage.tsx:107-160` (display name, username, password, recovery, delete), `web/src/components/common/TextInput.tsx:66-68` (a bare `<input>`: no key handling anywhere), `web/src/components/server/MemberActionModal.tsx:184` (reason), `web/src/components/server/ChannelSettingsModal.tsx:259`
- What: each of these dialogs autofocuses a field and has a "Done"/"Delete Account" button in the footer, but nothing binds Enter and none of them is a `<form>`, so typing a new display name and pressing Enter does nothing at all — not even a hint that the key was ignored. It is the same defect as WSHELL-010 on the two dialogs there, but on the most-used dialogs in settings, and on a phone it is worse: the on-screen keyboard's blue Go key is the natural way to finish and it is dead, so the keyboard has to be dismissed to reach the footer.
- Impact: everyone who renames themselves, changes their password or confirms a deletion; iOS/Android keyboard users most.
- Fix: the clean version is one `onSubmit` prop on `Modal` that wraps `children` in a `<form>` and fires the footer's primary action — that fixes WSHELL-010, this, and prevents the next one. Short of that, `onKeyDown={(e) => e.key === "Enter" && submit()}` on each field.
- Effort: S
- Status: open

### WSHELL-016 · P3 · ux · "Log Out" is unconfirmed, sits at the end of the phone settings strip, and quietly discards the app-lock passcode
- Where: `web/src/components/settings/SettingsModal.tsx:74`, `web/src/components/shell/UserPanel.tsx:170`, `web/src/stores/auth.ts:369-392` (`clearLock(me.id)`, `keystore.clear(me.id)`), `web/src/components/settings/Settings.module.css:82-88` (the phone nav is a horizontal scroller)
- What: logging out fires on one click with no confirmation, and it does more than end the session: it clears the account's app-lock passcode and wipes the device keystore, so the next sign-in needs the full password (and MFA) and the app lock has to be set up again. On a phone the settings nav becomes one sideways-scrolling row of nine to eleven items with the red "Log Out" last, so the gesture used to reach "Licenses" or "Instance Admin" ends with a finger on Log Out.
- Impact: low frequency, high cost — an accidental logout on a phone means finding a password that the app-lock passcode existed precisely to avoid typing.
- Fix: route it through the existing `confirm` modal ("Log out of Nexa? You will need your password to sign back in, and this device's passcode will be forgotten."), which is one `openModal("confirm", …)` call; or keep it instant in the user panel and confirm only in settings. Consider pinning Log Out outside the scroller on phones.
- Effort: S
- Status: open

### WSHELL-017 · P2 · ux · "Careful, you have unsaved changes" warns you and then lets the changes go without a word
- Where: `web/src/components/settings/ProfilePage.tsx:49,176-184`, `web/src/components/server/SettingsLayer.tsx:57-69` (`SaveBar`), and its users: `web/src/components/server/pages/ServerOverviewPage.tsx:32,133`, `web/src/components/server/pages/RolesPage.tsx:194,247,258,278`, `web/src/components/server/ChannelSettingsModal.tsx:82,133,177,298`, `web/src/components/server/PackEditor.tsx:104,377`; the nav that discards them: `web/src/components/settings/SettingsModal.tsx:66`, `web/src/components/server/SettingsLayer.tsx:36` (`onClick={() => setPage(it.id)}`)
- What: seven editors compute `dirty` and raise a sticky bar that says the changes are unsaved — and nothing stops you losing them. Clicking another nav item, closing with ×, pressing Escape (which the layer binds unconditionally), or reloading throws the edits away with no prompt; there is no `beforeunload` handler anywhere in `web/src` and no guard in `setPage`. The worst case is the roles editor: colour, name, hoist, mentionable and the whole permission grid are per-role state, so clicking the next role in the list to compare it silently discards everything typed into the previous one.
- Impact: everybody who edits a profile or a role and then clicks the wrong thing. It is the exact scenario the bar was added for, and the bar's promise ("careful") makes it worse — it implies something is holding the changes for you.
- Fix: hoist `dirty` into the layer (a `useDirty()` context the `SaveBar` registers with) and have `setPage`/`onClose`/Escape route through the existing `confirm` modal: "Leave without saving? / Discard changes / Keep editing". Add `beforeunload` while dirty. One place, all seven editors.
- Effort: M
- Status: open

### WSHELL-018 · P3 · test · The profile colour fields pick their test ids from an English string, so the e2e selectors point at the wrong input in any other language
- Where: `web/src/components/settings/ProfilePage.tsx:214` (`data-testid={label.startsWith("Primary") ? "accent-hex" : "accent2-hex"}`)
- What: `label` is `t("settings.profile.primaryColourHex")`. In Arabic, German or any of the other nine catalogues it does not start with "Primary", so **both** hex fields get `data-testid="accent2-hex"` and `accent-hex` does not exist. Any e2e test that sets an accent colour then either fails to find the field or silently drives the second one — a test that checks the wrong thing is worse than one that fails.
- Impact: only tests, but it is a trap: the suite is green in English and wrong everywhere else, and the same trick will be copied.
- Fix: pass the id in (`<HexInput testId="accent-hex" …>`), never derive a test hook from translated text. Worth a grep for the pattern elsewhere.
- Effort: S
- Status: open

### WSHELL-019 · P2 · bug · Two settings headings use a CSS class that does not exist, so "App lock" and "Encryption" are drawn at browser-default size among the small uppercase ones
- Where: `web/src/components/settings/SecurityPage.tsx:231` and `web/src/components/settings/EncryptionSection.tsx:55` — both `<h3 className={s.h} …>`; `web/src/components/settings/Settings.module.css` defines `.h5`, never `.h`; `web/src/styles/base.css` has no heading reset
- What: with CSS modules an unknown key is `undefined`, so `className={s.h}` renders `<h3>` with no class at all. Every other heading on the Security page is `.h5` — 12px, 700, uppercase, `--text-subtle` — while these two get the user agent's defaults: 1.17em, bold, mixed case, `1em 0` margins and full-contrast `--text`. So "Two-factor authentication" is a small grey caption and "App lock" immediately below it is a large black heading; the inline `marginTop: 28` on top of the UA margin makes the gap wrong too. The same two lines break the visual hierarchy of the Security page in both themes and at every width.
- Impact: the Security page — the page people open when they are already nervous — looks half-finished, and the heading level no longer matches its visual weight (App lock reads as more important than two-factor).
- Fix: `s.h5` in both places, and drop the inline `marginTop` in favour of the class. Worth a lint: a small script (or `typed-css-modules`) that checks every `s.<key>` against the module it comes from would have caught it; grep found no other bad key in this area.
- Effort: S
- Status: open

### WSHELL-020 · P2 · i18n · Four whole explanatory paragraphs and several composed sentences in settings and server settings are hard-coded English (beyond the list in WSHELL-001)
- Where: `web/src/components/settings/SecurityPage.tsx:233` (the App-lock paragraph, ~55 words), `web/src/components/server/pages/EncryptionPage.tsx:80` (what an unrotated key means), `web/src/components/settings/AdminPage.tsx:293` (what the crash reports contain), `web/src/components/server/pages/DeleteServerPage.tsx:40` (`Are you sure you want to delete <b>{name}</b>` + a translated tail), `web/src/components/server/pages/RolesPage.tsx:244` (`` title: `Delete '${role.name}'` ``), `web/src/components/server/PackEditor.tsx:31` (`` `${n} emoji` `` / `` `${n} sticker${n === 1 ? "" : "s"}` ``), `web/src/components/settings/SecurityPage.tsx:400` (`copied ? "Copied" : "Copy"`)
- What: the same defect as WSHELL-001 on surfaces the first pass did not reach. Two of them are the longest prose in the product: the App-lock paragraph explains that ten wrong tries wipe the wrapped key, and the encryption paragraph explains why a conversation still shows as needing rotation — exactly the text a non-English speaker must understand to use the feature safely. `DeleteServerPage` is worse than a bare literal: the sentence is *split* between a hard-coded English opening and a translated ending, so in Arabic the line reads left-to-right English followed by right-to-left Arabic inside one paragraph, and no translator can reorder it. `packCount()` hard-codes English plural rules for every place a pack's size is shown (settings, the server pack editor, the public pack page).
- Impact: eleven catalogues exist and `tools/i18n_keys_used.py` reports zero missing keys, so nobody will notice; a German or Arabic user meets English in the middle of the security and moderation copy.
- Fix: keys for all of them; make the delete-server confirmation one key with a `{name}` placeholder (the catalogue already uses that form elsewhere); `packCount` takes a count key with the plural forms the i18n layer supports. Same lint suggestion as WSHELL-001.
- Effort: S
- Status: open

### WSHELL-021 · P2 · bug · The ten backup codes, shown once, are dismissed by Escape or the × with nothing saved
- Where: `web/src/components/settings/SecurityPage.tsx:288,329` (`closeOnOverlay={!codes}` only), `web/src/components/settings/SecurityPage.tsx:389-406` (`BackupCodes`)
- What: the same gap as WSHELL-012 one page over. The dialog defends against a stray backdrop click while the codes are up, but `Modal` still closes on Escape and still draws its header ×, and two-factor has *already* been turned on by then (`finishSetup` enables it, then shows the codes). The panel does offer Copy and Download — it is better than the recovery-key one — but neither is required, and `Done` is the only button that means "I have them".
- Impact: a user who presses Escape out of habit has two-factor on with ten codes they have never seen; the status row will tell them "10 backup codes left", which is true and useless. Recoverable (regenerate with the password) but nothing tells them to, and someone who loses their phone at that point is locked out for good.
- Fix: the same `dismissible={false}` on `Modal` while `codes` is set, plus a "I have saved these codes" gate on the Done button (or enable Done only after Copy or Download has been used). Consider showing `status.backup_codes_left` with a "you have never saved these" hint the first time.
- Effort: S
- Status: open

### WSHELL-022 · P2 · i18n · The devices list and the timeout notice format their dates in the browser's language, not the app's, and "Chrome on macOS" is glued together in English
- Where: `web/src/components/settings/DevicesPage.tsx:87` (`new Date(se.last_seen_at).toLocaleString()`), `web/src/components/settings/DevicesPage.tsx:13-15` (`` `${browser} on ${os}` ``), `web/src/components/server/MemberActionModal.tsx:137` (same `toLocaleString()`); the rule they break is `web/src/lib/time.ts:1-40`
- What: `lib/time.ts` exists precisely so this cannot happen — it builds every `Intl.DateTimeFormat` with `translator().locale` and its header says why: "Intl is given the app's tag rather than `undefined`, which would follow the browser and put English months beside Arabic words, not a line that changes language halfway." These two call sites call `toLocaleString()` with no argument, which follows the *browser*. A German UI on an English-locale machine shows "Zuletzt aktiv: 9/18/2026, 3:04:11 PM"; an Arabic UI shows a left-to-right English timestamp inside a right-to-left line, which is also where bidi reordering makes the date hard to read. `describe()` then composes the device name with the English preposition "on", so every row in the list is part-translated.
- Impact: two of the places where a person checks something security-relevant — which devices are signed in, and until when a member is timed out — are the two places whose dates do not follow the app's language.
- Fix: `formatDateTime`/`formatDateDivider` from `lib/time.ts` in both, and a key with `{browser}` and `{os}` placeholders for the device name (or just `browser · os`, which needs no grammar at all).
- Effort: S
- Status: open

### WSHELL-023 · P2 · bug · The server notification dialog shows "All messages" selected when in fact only mentions notify
- Where: `web/src/components/modals/ServerNotificationsModal.tsx:22` (`perChannel[serverId] ?? "all"`) vs. `web/src/lib/notify.ts:116` (`?? (serverId ? "mentions" : "all")`) and `web/src/lib/unread.ts:17`
- What: the dialog reads the stored level for the server and falls back to `"all"`; the code that decides whether to notify falls back to `"mentions"` for anything inside a server. Nothing is stored until the user picks a radio, so for every server nobody has configured — that is, all of them — the dialog shows "All messages · Every message in this server notifies you" while the app notifies only on mentions.
- Impact: someone who is missing messages opens this dialog, sees that it is already set to notify for everything, and concludes notifications are broken. The one action that would fix it (clicking the radio that is already selected) looks like a no-op — and it is not, because it writes the value. Verifiable without a server: `settings.notifications.perChannel` is empty on a fresh profile, and the two fallbacks differ.
- Fix: one shared helper `notificationLevel(settings, channelId, serverId)` used by the dialog, `notify.ts` and `unread.ts`, so there is one default. Decide which default is wanted — Discord's is "All messages" for small servers — and show it as the selected radio with "(default)" beside it.
- Effort: S
- Status: open

### WSHELL-024 · P2 · bug · "Default notification setting" in server settings is stored, synced and read by nobody
- Where: `web/src/components/server/pages/ServerOverviewPage.tsx:27,32,46,115-116`, `web/src/api/types.ts:99`, `internal/store/servers.go:140`; the clients that never read it: `web/src/lib/notify.ts:116`, `web/src/lib/unread.ts:17`, and `grep -rn default_notifications android/` → nothing
- What: the server overview page offers "All messages" / "Only mentions" as the server's default, PATCHes it, and the server persists it. Every client then ignores it: `notify.ts` resolves a level from `perChannel[channel] ?? perChannel[server] ?? "mentions"` — the member's own overrides only — so the admin's choice has no effect on anyone, ever. With the field's default value being 0 ("All messages"), every server in existence is configured to notify for everything and none of them does.
- Impact: an owner who sets it believes they have changed what their members receive. It is also the one control in server settings that cannot be shown to be working, which is the sort of thing that erodes trust in the rest of the page.
- Fix: either read it — `perChannel[channel] ?? perChannel[server] ?? levelFromServer(server.default_notifications) ?? "mentions"` in the one shared helper from WSHELL-023, on web and in Android's notifier — or drop the control and the column. Reading it is the better product: it is why the field exists, and it makes a new member's experience the owner's decision rather than a hard-coded constant. Android needs the same change (parity).
- Effort: M
- Status: open

### WSHELL-025 · P3 · ux · On a phone the push-to-talk key box can be entered and never left, and push-to-talk itself silently means "always on"
- Where: `web/src/components/settings/VoicePage.tsx:111-126,205-211`, `web/src/voice/session.ts:250-252,260,269` (`noKeyToHold()`)
- What: choosing "Push to talk" shows a key-capture button whose only way out is a `keydown` — either the new key or Escape. On a touch device there is no keyboard to produce either, so tapping the box leaves it reading "Press a key · Esc to cancel" for as long as the page is open; no tap, and not even the × of the settings layer's own close button, clears it (the handler is `window`-level with `capture: true` and swallows nothing else, so the rest of the page keeps working — it is the box that is stuck). Meanwhile `session.ts` treats push-to-talk on a coarse pointer as "always transmit", which is the right call, but the radio still promises "Transmit only while you hold a key" — on a phone the truthful description is the opposite. Voice settings travel with the account (`Settings.voice` is synced), so a desktop user who picks push-to-talk finds this state on their phone without ever visiting the page there.
- Impact: small; a confusing dead control on the platform the owner uses most, and a description that is untrue there.
- Fix: hide the push-to-talk radio (or show it disabled with "needs a keyboard") when `matchMedia("(hover: none) and (pointer: coarse)")` matches, and reuse `noKeyToHold()` for it rather than repeating the query; give the capture box a Cancel button and close it on `pointerdown` elsewhere. Android's equivalent is a per-device toggle with an on-screen hold button (`android/.../ui/settings/SettingsScreen.kt:417`) — that is the better design, and the web could offer the same hold button on touch.
- Effort: S
- Status: open

### WSHELL-026 · P2 · ux · The instance admin cannot see this month's call usage, although the server meters it and starts pausing video at 90 %
- Where: `web/src/components/settings/AdminPage.tsx:101-110` (the Overview rows), `web/src/api/types.ts:318-326` (`AdminStats` has no usage field), `internal/realtime/meter.go:92,243-256`, `internal/store/realtime.go`, `internal/config/config.go:68-70,97` (`RealtimeMonthlyGB: 1000`)
- What: the server keeps a monthly total of estimated SFU egress in `realtime_usage`, compares it with a 1000 GB allowance, and changes behaviour as it fills: `underSoftLimit` is false past 90 %, which pauses camera and screen tracks, and `underHardLimit` is false past 99 %. None of this is exposed. `AdminStats` carries users, servers, messages, blobs, bytes and version; there is no admin endpoint for the meter at all, so the one person who can act on it — the operator, reading their own admin page — cannot see the number, and the first sign of the allowance running out is video quietly refusing to start in calls with no explanation anywhere in the product. This is round 1's open item ("Calls this month: X of Y GB"); it is still undone.
- Impact: the operator finds out that calls have degraded from a user complaint, and has no way to confirm why or how much is left. It also hides the one running cost of the instance.
- Fix: add `realtime_bytes` and `realtime_limit_bytes` to `GET /admin/stats` (cross-area: `[server-api]`, one call to `Meter.Used`/`Limit`), then one row here — "Calls this month · 412 GB of 1000 GB" with `formatBytes`, turning amber past 90 % with "video is paused in calls while the allowance is this full". Worth surfacing the same fact to people in a call when a track is refused, which is `voice`'s.
- Effort: M
- Status: open

### WSHELL-027 · P2 · ux · "Make admin" hands over the whole instance on one unconfirmed click, while the two lesser actions beside it both confirm
- Where: `web/src/components/settings/AdminPage.tsx:148` (no confirm) vs. `:149` (disable confirms) and `:156-164` (delete confirms)
- What: in the admin user list the three buttons sit together: Make admin / Disable / Delete. Disable and Delete each open a `confirm` modal that says what will happen; Make admin fires immediately on click and grants the `flags & 1` bit — which is the right to do everything on this page, including disabling and deleting the account that granted it. Nothing says what admin means, and on a phone the three buttons wrap into a row of similar-width pills (`.adminActions { flex-wrap: wrap }`), which is where a mis-tap is likeliest.
- Impact: the single most dangerous action in the product is its least guarded. It is also silent: there is no toast on success, so an accidental grant leaves no trace in the UI — the only clue is a small "admin" tag appearing beside a name.
- Fix: route it through the same `confirm` modal ("Make @name an admin? They will be able to see instance settings, disable and delete any account, including yours."), and toast on success. Removing admin should confirm too when it is your own last co-admin.
- Effort: S
- Status: open

### WSHELL-028 · P3 · a11y · Settings headings skip from h2 to h5, and the crash-log rows are clickable divs
- Where: `<h5>` directly under the page `<h2>`: `web/src/components/settings/DesktopPage.tsx:91,118,129,139`, `web/src/components/settings/AdminPage.tsx:101,111,134,235,291`, `web/src/components/server/pages/EmojiPage.tsx:102`; the rest of settings uses `<h3 className={s.h5}>` for the identical caption (e.g. `SecurityPage.tsx:197`); the rows: `web/src/components/settings/AdminPage.tsx:302-312`
- What: two spellings of the same visual caption — `<h3 className={s.h5}>` and `<h5 className={s.h5}>` — so on three pages a screen reader's heading list reads "Instance Admin (2) → Overview (5) → Registration (5)", which reports two missing levels of structure and is flagged by every audit tool as heading-order. Separately, each crash report is a `<div onClick>` with `cursor: pointer` and no `role`, `tabIndex` or `aria-expanded`, so the stack traces cannot be opened from the keyboard at all and nothing announces that a row expands.
- Impact: small populations, both trivially fixable, and the heading one is the sort of thing that makes "zero axe violations" untrue the moment someone re-runs it.
- Fix: `<h3 className={s.h5}>` everywhere (the class is the look, the element is the structure — worth a comment in `Settings.module.css` saying so); make the crash row a `<button>` with `aria-expanded` wrapping the summary line.
- Effort: S
- Status: open

### WSHELL-029 · P3 · design · Server banners exist end to end — endpoint, client method, invite payload — and there is no way to set one or anywhere that shows one
- Where: `internal/api/server_handlers.go:35-36,382-413` (PUT/DELETE `/servers/{id}/banner`), `web/src/api/servers.ts:86-89` (`uploadBanner`, `deleteBanner` — no callers), `web/src/api/types.ts:153` (the invite preview carries `banner_id`), `web/src/components/server/pages/ServerOverviewPage.tsx:86-118` (icon only), `web/src/pages/InvitePage.tsx` (never reads `banner_id`)
- What: the whole feature is built except its two user-facing ends. `grep -rn banner_id web/src/components web/src/pages` finds the *user* banner everywhere and the server banner nowhere: no upload control in the server overview, no render on the invite page that already receives the id, nothing at the top of the channel list. Upload limits for it are even configured separately (`limitsFor("banner")`).
- Impact: no user harm today — it is invisible — but it is dead weight in the API surface and a missed chance on the one page whose whole job is persuading a stranger to join. A server's invite page is currently an icon, a name, a description and a count.
- Fix: in Overview, a `.bannerPick` row exactly like the profile page's (that CSS is already in `Settings.module.css`, 5:2 aspect, crop modal, Remove); on the invite page, the banner behind the icon and name (fall back to the accent gradient as the profile card does); optionally at the top of the server's channel list, which is what Discord does with it. Either that or delete the endpoints and the client methods — a half-built feature is worse than neither.
- Effort: M
- Status: open

### WSHELL-030 · P2 · ux · The "Clear" button beside the permission search wipes every permission on the role, not the search box
- Where: `web/src/components/server/pages/RolesPage.tsx:272-275` (`<TextInput placeholder="Search permissions" …/>` then `<Button …onClick={() => setValue(0n)}>{t("modals.quickSwitcher.clear")}</Button>`), `web/src/components/server/ServerSettings.module.css` (`.searchRow { display: flex; gap: 8px }`)
- What: the two controls sit side by side, 8px apart, inside a row whose class is literally `searchRow`; the button's label is the same "Clear" string the quick switcher uses to clear *its* search box. It does not clear the filter — it sets the role's permission bitfield to zero, unchecking all forty toggles at once. The only undo is noticing the save bar and pressing Reset; nothing warns, and if the role is one whose permissions the moderator had just filtered to look at, the destroyed state is mostly off screen.
- Impact: a moderator loses a role's whole permission set on a click they expected to clear a text box. Recoverable only if they spot it before saving, which the filter makes less likely.
- Fix: label it for what it does — "Clear all permissions" — move it out of `.searchRow` (under the grid, beside the save bar, or in a small menu), and confirm it ("Turn off all 12 permissions on @moderator?"). Giving the search box its own × to clear the filter would remove the ambiguity completely.
- Effort: S
- Status: open

### WSHELL-031 · P3 · ux · The role's "Manage members" tab silently stops at 100 people
- Where: `web/src/components/server/pages/RolesPage.tsx:292-296` (`.slice(0, 100)`), compare `web/src/components/server/pages/MembersPage.tsx:21,119` (50 at a time with "Show more (N left)")
- What: the tab lists members sorted by "has this role" then name, cut at 100 with no count, no "show more" and no hint that anything was cut. On a server with more than 100 members, whether someone appears depends on where the alphabet put them; a moderator who does not think to search concludes the person is not in the server. The members page two entries above solves the same problem properly.
- Impact: only on servers above 100 members, but there it is silent and misleading rather than merely limited.
- Fix: reuse the `shown`/`PAGE`/`showMoreLeft` pattern from `MembersPage`, and say how many carry the role above the list.
- Effort: S
- Status: open

### WSHELL-032 · P2 · ux · An existing invite cannot be copied — the table shows the code and nothing else
- Where: `web/src/components/server/pages/InvitesPage.tsx:88-104` (columns: inviter, code, channel, uses, expires, revoke), compare `web/src/components/modals/InviteModal.tsx:69-90` (`inviteUrl(code, key)` + a Copy button with a copied state)
- What: the only thing the invites page lets you do with an invite is revoke it. The code is rendered as plain monospace text in a table cell, so re-sharing an invite someone else made means selecting the code by hand and knowing that the URL is `https://chat.evilion.xyz/invite/<code>` — and for a server with encrypted channels the useful link is the one carrying the key in the fragment, which only `InviteModal` can build. There is also no way to see or reuse an invite's settings, so the practical workflow is "make another one", which is why invite lists grow.
- Impact: every time an owner wants to re-post the server link. It is one of the two or three things this page exists for.
- Fix: a copy button per row using the same `inviteUrl()` helper and copied state as `InviteModal` (and the same key checkbox where the server has encrypted channels); make the code cell itself a click-to-copy. While there, a "Created" column and the inviter's avatar would make the table readable at a glance.
- Effort: S
- Status: open
