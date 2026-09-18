# Brief — web-shell-ui (finding prefix `WSHELL`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

Everything around the message surface: navigation, onboarding, settings,
server administration, friends, the marketing and download pages.

```
web/src/components/shell/      all 22 (AppShell, PaneGrid, PaneView, Tabs, paneScope, PageHeader,
                               UserPanel, RequireAuth, ErrorBoundary, Shortcuts, ThemeEffect,
                               AppLockEffect, DownloadBanner, UpdateBanner, RpcBanner, the CSS)
web/src/components/sidebar/    all 8 (DMSidebar, ServerSidebar, the menus, openMenu, CSS)
web/src/components/rail/       Rail.tsx Rail.module.css
web/src/components/modals/     all 28 (ModalHost, ConfirmModal, PromptModal, QuickSwitcher,
                               ShortcutsHelp, Create*/Edit* modals, InviteModal, GroupInviteModal,
                               KeyChangeModal, VerifyKeyModal, ServerProfileModal,
                               ServerNotificationsModal, StickerPackModal, SubchatModal,
                               CustomStatusModal, ChannelTopicModal, the CSS)
web/src/components/settings/   all 19 (SettingsModal and every page: Account, Profile, Security,
                               Devices, Privacy, Notifications, Appearance, Voice*, Desktop,
                               Stickers, Admin, Licenses, EncryptionSection, CustomColorIcon, CSS)
web/src/components/server/     all 11 + pages/ 13 (ServerSettingsModal, SettingsLayer,
                               ChannelSettingsModal, MemberActionModal, PermissionGrid, RoleChips,
                               PackEditor, memberMenu, and Overview/Roles/Members/Bans/Invites/
                               Emoji/Stickers/AuditLog/Encryption/DeleteServer pages, rolePositions)
web/src/components/friends/    Friends.module.css
web/src/components/desktop/    DesktopEffects.tsx DisplayPicker.tsx Desktop.module.css
web/src/pages/                 AuthLayout, LoginPage, RegisterPage, RecoverPage, LockPage,
                               PasscodePage, HomePage, DownloadPage, InvitePage, OfflinePage,
                               FriendsPage, and their CSS + tests
```

`VoicePage.tsx`/`Voice.module.css` in settings: you cover the settings-page
UX; the device logic is `voice`'s. `GuestCallPage.tsx` is `voice`'s.

Out of scope: `chat/`, `composer/`, `pickers/`, `search/`, `profile/`,
`activity/`, `common/` (`web-chat-ui` — but you read `common/` to know what
exists and report any modal/settings component that hand-rolls a copy);
`voice/` components; stores/lib/api (`web-core`).

## What this area is

The Discord-shaped shell: a server rail on the far left, a sidebar (DMs +
friends, or a server's channels in categories), the main pane, an optional
member list, a user panel at the bottom-left with mute/deafen/settings/
status. Tabs and side-by-side panes (`43d5f21`). On phones the rail and
sidebar live in a drawer opened by a gesture or "Open navigation". Settings
is a full-screen layer with a left nav (tabs scroll sideways on phones);
server settings likewise. Modals for creating things, inviting, confirming,
prompting (no native dialogs — Electron's are no-ops). Auth pages
(login with captcha and TOTP, register with the recovery key shown once,
recover, app lock with a passcode), the marketing home page, the download
page (desktop installers and Android APKs from `/api/v1/desktop/latest` and
the Android manifest), the invite page, the offline page, the update and
download banners, keyboard shortcuts and the quick switcher.

Mobile is a first-class target; the owner uses the iPhone home-screen app.
Eleven languages including Arabic (RTL). Light and dark themes, any accent.

## Checklist

Navigation and layout:
- The phone drawer: gesture conflicts with swipe-to-reply and horizontal
  scrollers; the voice bar and user panel staying visible (round 1's grid
  row fix — verify); back-button/history behaviour (does Android's back
  close the drawer, a modal, settings, or leave the app?); deep links into
  a channel on a phone (does the drawer open or the channel?); tabs and
  panes on phones (hidden? usable?); `100dvh`, safe areas, the keyboard.
- Rail: ordering, drag on touch, badges, folders (none — is that a gap
  worth a design finding?), tooltips on touch, active state, "Add a
  Server", the home button, unread dots vs. mention counts, RTL mirroring.
- Sidebar: categories collapse state persistence, unread/muted styling,
  voice channel participants inline, channel context menus, drag reorder
  on touch, long names, the DM list ordering (recent activity?), presence,
  friends entry, "create DM", the search/quick switcher entry.
- Tabs/panes: discoverability, keyboard shortcuts, closing, restoring on
  reload, memory of panes that are not visible, what happens with two
  panes of the same channel.
- `PageHeader`: channel topic (click to expand?), pins/search/members
  toggles on phones, the call buttons.
- `UserPanel`: status picker, custom status, mute/deafen state visible,
  settings gear, the voice status block (`voice`'s content, your layout).

Auth and onboarding:
- Login: field labels, autocomplete attributes (`username`, `current-password`),
  password managers, Enter to submit, the captcha's failure state, wrong
  password message, TOTP step (autofocus, paste, backup code path), rate
  limit message, "remember me"? (sessions are 90 days — say so somewhere?),
  the disabled-account message.
- Register: username rules explained before failure, display name, password
  strength guidance, the recovery-key screen (copy, download, "I saved it"
  confirmation, what if they close the tab — is there a way back?), the
  first-run experience after registering (empty state that teaches the app:
  add a friend, join a server).
- Recover: flow clarity, what it resets, what it cannot restore.
- App lock / passcode: setup discoverability, unlock UX on phones, what is
  visible while locked (notifications? titles?), timeout settings.
- Invite page: signed-out vs. signed-in, key in the fragment, expired/
  invalid states, the Android app handoff (`assetlinks`), captcha.
- Offline page and `ErrorBoundary`: recoverable? Do they lose state? Copy?

Settings (every page):
- Information architecture: the order and grouping of pages vs. what people
  look for (compare Discord's); pages that mix concerns; settings that
  exist in code but have no UI or vice versa (grep `useSettings` keys).
- Each control: label, help text, immediate vs. saved-on-click, unsaved
  changes guard, success/failure feedback, keyboard, touch, RTL.
- Account: change username/email?/password (re-wrap flow, sign-out
  everywhere option), delete account (what it says will happen), export.
- Profile: avatar/banner crop (`ImageCropModal` — touch?), animated
  formats, about-me limit, colours/theme with contrast, preview.
- Security: MFA enrol/disable, backup codes (regenerate, download), devices
  and sessions (names? last seen? current marked? revoke others), the
  encryption section (safety number, recovery key re-show?, key pins list
  and unpin, what happens on "reset identity").
- Privacy: DM permissions, friend request sources, read receipts?, link
  previews, the direct-image-link hint (rewritten on 2026-09-18).
- Notifications: per-server/per-channel overrides live in
  `ServerNotificationsModal` — consistent with the global page? Sounds
  test buttons, the iOS sound-trouble hint, desktop notifications
  permission state and how to fix it when denied.
- Appearance: theme, accent, font size/zoom?, message display (cozy/
  compact?), spell check, reduced motion, language (does changing it
  re-render everything at once, including dates and the document `dir`?).
- Voice page: layout/UX only.
- Desktop page (in the browser: hidden? teasing the app?), Admin (stats,
  registration mode, the realtime usage — round 1 left "Calls this month:
  X of Y GB" undone; check), Licenses, Stickers.
- The settings layer on a phone: nav as a list first, then the page, with
  a back button; or sideways tabs (current) — judge it.

Server settings and moderation:
- Overview (name, icon, banner?, system channel?), Roles (create, colour,
  hoist, mentionable, permissions grid — tri-state overwrites explained?
  dangerous permissions flagged? hierarchy drag on touch?), Members (search,
  roles chips, kick/ban/timeout with reasons, hierarchy respected in the
  UI), Bans (reason, unban), Invites (expiry, uses, revoke, copy), Emoji and
  Stickers (upload limits shown, name rules, animated), Audit log
  (readable entries, filters), Encryption (rotate key, who has grants),
  Delete server (name confirmation).
- Channel settings: name rules, topic, slowmode, private channel with
  role/member picker, the overwrite editor, delete with confirmation.
- Every "dangerous" action confirms, and the confirm says what will
  happen; every action reports failure.

Modals in general:
- `ModalHost` stacking, focus trap, restore focus on close, Escape and
  backdrop click, scroll lock without layout shift, phone presentation
  (sheet from the bottom? full screen?), forms submit on Enter, the primary
  button placement consistent, loading state on submit, double-submit
  prevention, the `PromptModal`/`ConfirmModal` API used everywhere (no
  native `prompt`/`confirm`/`alert` — grep the whole `web/src`).
- `QuickSwitcher`: fuzzy matching quality, recents, keyboard, phone.
- `ShortcutsHelp`: complete and accurate against `Shortcuts.tsx`; platform
  key names (⌘ vs Ctrl).

Public pages:
- `HomePage`: the argument it makes, its media (`public/home/*` — sizes,
  lazy loading, `prefers-reduced-motion` for the loops), load performance,
  mobile layout, the CTA flow, SEO/meta/OG tags (`index.html`), the CSP
  beacon warning.
- `DownloadPage`: the desktop offer per OS, the Android per-ABI APKs (round
  1's open item: `AndroidRelease` lacks `files`, so every phone gets the
  39 MB universal build — check), unsigned-build warnings, checksums,
  version and date shown, what a Linux user gets, what an iPhone user gets
  (a PWA install hint?).
- `DownloadBanner`/`UpdateBanner`/`RpcBanner`: when they show, dismissal
  memory, stacking, phones.

Cross-cutting (as in `web-chat-ui`): touch targets, hover guards, RTL
logical properties and mirrored icons, keyboard/screen reader (roles,
names, live regions, focus), contrast in both themes with any accent,
reduced motion, truncation, loading/empty/error states, safe areas, and
consistency with `common/`. Where the design is clearly worse than the
reference or than a good mobile app, propose the better thing concretely.

Parity with Android (read-only): `android/.../ui/main/MainScreen.kt`,
`Sidebar.kt`, `ui/auth/AuthScreen.kt`, `RecoveryKeyOverlay.kt`,
`ui/settings/SettingsScreen.kt`, `ui/server/ServerSettingsScreen.kt`,
`ui/friends/FriendsScreen.kt`, `ui/invite/InviteScreen.kt`,
`ui/sheets/*`, `ui/Nav.kt`. Say which platform does each thing better.

## Round 1

`audit/REVIEW.md`, then the shell/settings/modal/page parts of
`audit/web-ui.md` and `audit/web-bugs.md`, and `audit/product-gaps.md`.
Verify: the mobile controls fix, the settings bottom padding
(`align-self: flex-start`), the keyboard/screen-reader pass ("zero axe
violations" — spot-check the claim with your own reading), the RTL fixes.
Round 1's 15 IDEA findings — re-judge them here as `design` findings.

## Facts you would otherwise rediscover

- `window.prompt` is a no-op in Electron; `PromptModal` replaced six uses.
- The desktop app reports window focus through `getWindowState`;
  `document.hasFocus()` lies there.
- The desktop `UpdateBanner` is web-side, driven by the app's minute poll.
- The owner rejected the copy "games, music and videos you have open" for
  the desktop banner; the approved copy is "RPC support and a better
  experience". Do not propose the former.
- Registration on a throwaway server rate-limits after ~10 sign-ups.
- Playwright is Chromium-only here; `tools/screenshot.py` for layouts.

## Reading order

`shell/AppShell.tsx` + CSS, `PaneGrid`, `PaneView`, `Tabs`, `paneScope` →
`rail/*`, `sidebar/*` → `shell/PageHeader`, `UserPanel`, `Shortcuts`,
`RequireAuth`, `ErrorBoundary`, `ThemeEffect`, `AppLockEffect`, the banners
→ `modals/ModalHost`, `ConfirmModal`, `PromptModal`, then every modal →
`settings/SettingsModal` then every page → `server/SettingsLayer`,
`ServerSettingsModal`, then every page, `ChannelSettingsModal`,
`PermissionGrid`, `MemberActionModal`, `PackEditor` → `pages/*` →
`desktop/*` → the Android files for parity → the tests.
