# Progress — web-shell-ui
State: auditing
Last checkpoint: 2026-09-19T06:15Z
Next finding id: 066

## Inspected

Shell:
- [x] web/src/components/shell/AppShell.tsx
- [x] web/src/components/shell/AppShell.module.css
- [x] web/src/components/shell/PaneGrid.tsx
- [x] web/src/components/shell/PaneView.tsx
- [x] web/src/components/shell/Tabs.tsx
- [x] web/src/components/shell/paneScope.ts
- [x] web/src/components/shell/Panes.module.css
- [x] web/src/components/shell/PageHeader.tsx
- [x] web/src/components/shell/PageHeader.module.css
- [x] web/src/components/shell/UserPanel.tsx
- [x] web/src/components/shell/UserPanel.module.css
- [x] web/src/components/shell/RequireAuth.tsx
- [x] web/src/components/shell/ErrorBoundary.tsx
- [x] web/src/components/shell/ErrorBoundary.module.css
- [x] web/src/components/shell/Shortcuts.tsx
- [x] web/src/components/shell/ThemeEffect.tsx
- [x] web/src/components/shell/AppLockEffect.tsx
- [x] web/src/components/shell/AppLockEffect.test.tsx
- [x] web/src/components/shell/DownloadBanner.tsx
- [x] web/src/components/shell/DownloadBanner.module.css
- [x] web/src/components/shell/UpdateBanner.tsx
- [x] web/src/components/shell/RpcBanner.tsx

Rail and sidebar:
- [x] web/src/components/rail/Rail.tsx
- [x] web/src/components/rail/Rail.module.css
- [x] web/src/components/sidebar/DMSidebar.tsx
- [x] web/src/components/sidebar/ServerSidebar.tsx
- [x] web/src/components/sidebar/ServerSidebar.module.css
- [x] web/src/components/sidebar/Sidebar.module.css
- [x] web/src/components/sidebar/dmMenu.ts
- [x] web/src/components/sidebar/dmMenu.test.ts
- [x] web/src/components/sidebar/serverMenu.ts
- [x] web/src/components/sidebar/openMenu.ts

Modals:
- [x] web/src/components/modals/ModalHost.tsx
- [x] web/src/components/modals/ConfirmModal.tsx
- [x] web/src/components/modals/ConfirmModal.test.tsx
- [x] web/src/components/modals/PromptModal.tsx
- [x] web/src/components/modals/QuickSwitcher.tsx
- [x] web/src/components/modals/QuickSwitcher.module.css
- [x] web/src/components/modals/ShortcutsHelp.tsx
- [x] web/src/components/modals/ChannelTopicModal.tsx
- [x] web/src/components/modals/CreateCategoryModal.tsx
- [x] web/src/components/modals/CreateChannelModal.tsx
- [x] web/src/components/modals/CreateDMModal.tsx
- [x] web/src/components/modals/CreateDMModal.module.css
- [x] web/src/components/modals/CreateDMModal.test.tsx
- [x] web/src/components/modals/CreateServerModal.tsx
- [x] web/src/components/modals/CustomStatusModal.tsx
- [x] web/src/components/modals/CustomStatusModal.module.css
- [x] web/src/components/modals/EditGroupModal.tsx
- [x] web/src/components/modals/GroupInviteModal.tsx
- [x] web/src/components/modals/GroupInviteModal.test.tsx
- [x] web/src/components/modals/InviteModal.tsx
- [x] web/src/components/modals/KeyChangeModal.tsx
- [x] web/src/components/modals/ServerModals.module.css
- [x] web/src/components/modals/ServerNotificationsModal.tsx
- [x] web/src/components/modals/ServerProfileModal.tsx
- [x] web/src/components/modals/StickerPackModal.tsx
- [x] web/src/components/modals/StickerPackModal.module.css
- [x] web/src/components/modals/SubchatModal.tsx
- [x] web/src/components/modals/VerifyKeyModal.tsx

Settings:
- [x] web/src/components/settings/SettingsModal.tsx
- [x] web/src/components/settings/Settings.module.css
- [x] web/src/components/settings/AccountPage.tsx
- [x] web/src/components/settings/ProfilePage.tsx
- [x] web/src/components/settings/SecurityPage.tsx
- [x] web/src/components/settings/EncryptionSection.tsx
- [x] web/src/components/settings/DevicesPage.tsx
- [x] web/src/components/settings/PrivacyPage.tsx
- [x] web/src/components/settings/NotificationsPage.tsx
- [x] web/src/components/settings/AppearancePage.tsx
- [x] web/src/components/settings/CustomColorIcon.tsx
- [x] web/src/components/settings/VoicePage.tsx
- [x] web/src/components/settings/Voice.module.css
- [x] web/src/components/settings/DesktopPage.tsx
- [x] web/src/components/settings/StickersPage.tsx
- [x] web/src/components/settings/AdminPage.tsx
- [x] web/src/components/settings/LicensesPage.tsx
- [x] web/src/components/settings/LicensesPage.test.tsx
- [x] web/src/components/settings/Licenses.module.css

Server settings:
- [x] web/src/components/server/SettingsLayer.tsx
- [x] web/src/components/server/ServerSettingsModal.tsx
- [x] web/src/components/server/ServerSettings.module.css
- [x] web/src/components/server/ChannelSettingsModal.tsx
- [x] web/src/components/server/MemberActionModal.tsx
- [x] web/src/components/server/PermissionGrid.tsx
- [x] web/src/components/server/PermissionGrid.module.css
- [x] web/src/components/server/RoleChips.module.css
- [x] web/src/components/server/PackEditor.tsx
- [x] web/src/components/server/PackEditor.module.css
- [x] web/src/components/server/memberMenu.ts
- [x] web/src/components/server/pages/ServerOverviewPage.tsx
- [x] web/src/components/server/pages/RolesPage.tsx
- [x] web/src/components/server/pages/rolePositions.ts
- [x] web/src/components/server/pages/rolePositions.test.ts
- [x] web/src/components/server/pages/MembersPage.tsx
- [x] web/src/components/server/pages/BansPage.tsx
- [x] web/src/components/server/pages/BansPage.test.tsx
- [x] web/src/components/server/pages/InvitesPage.tsx
- [x] web/src/components/server/pages/EmojiPage.tsx
- [x] web/src/components/server/pages/ServerStickersPage.tsx
- [x] web/src/components/server/pages/AuditLogPage.tsx
- [x] web/src/components/server/pages/EncryptionPage.tsx
- [x] web/src/components/server/pages/DeleteServerPage.tsx

Friends and desktop:
- [x] web/src/components/friends/Friends.module.css
- [x] web/src/components/desktop/DesktopEffects.tsx
- [x] web/src/components/desktop/DisplayPicker.tsx
- [x] web/src/components/desktop/Desktop.module.css

Pages:
- [x] web/src/pages/AuthLayout.tsx
- [x] web/src/pages/AuthLayout.test.tsx
- [x] web/src/pages/Auth.module.css
- [x] web/src/pages/LoginPage.tsx
- [x] web/src/pages/LoginPage.test.tsx
- [x] web/src/pages/RegisterPage.tsx
- [x] web/src/pages/RecoverPage.tsx
- [x] web/src/pages/RecoverPage.test.tsx
- [x] web/src/pages/LockPage.tsx
- [x] web/src/pages/PasscodePage.tsx
- [x] web/src/pages/HomePage.tsx
- [x] web/src/pages/Home.module.css
- [x] web/src/pages/DownloadPage.tsx
- [x] web/src/pages/DownloadPage.module.css
- [x] web/src/pages/InvitePage.tsx
- [x] web/src/pages/InvitePage.module.css
- [x] web/src/pages/OfflinePage.tsx
- [x] web/src/pages/FriendsPage.tsx
- [x] web/index.html                            (meta/OG/CSP for HomePage — brief asks for it)

Context only (not in scope, read to know what exists): `web/src/components/common/*`,
`web/src/pages/DMPage.tsx`, `web/src/pages/ServerPage.tsx`, `web/src/pages/StickerPackPage.tsx`
(web-chat-ui), `web/src/pages/GuestCallPage.tsx` (voice).

Parity (read-only, Android):
- [x] android/.../ui/main/MainScreen.kt
- [ ] android/.../ui/main/Sidebar.kt
- [x] android/.../ui/auth/AuthScreen.kt
- [x] android/.../ui/auth/RecoveryKeyOverlay.kt
- [ ] android/.../ui/settings/SettingsScreen.kt
- [ ] android/.../ui/server/ServerSettingsScreen.kt
- [x] android/.../ui/friends/FriendsScreen.kt
- [ ] android/.../ui/invite/InviteScreen.kt
- [ ] android/.../ui/sheets/*
- [x] android/.../ui/Nav.kt

Round 1:
- [ ] audit/REVIEW.md (Done / Not doing / Still open)
- [ ] audit/web-ui.md (shell/settings/modal/page parts)
- [ ] audit/web-bugs.md (same)
- [ ] audit/product-gaps.md (the 15 IDEA findings — re-judge as design)

## Handoff note
Successor #3, 2026-09-19T05:12Z. Server settings are done (all pages, modals, PackEditor,
memberMenu, rolePositions, the CSS), friends is done. Findings through WSHELL-043.
Remaining: desktop/* -> pages/* + web/index.html -> Android parity -> round-1 reports.
Two cross-cutting threads, scan every new file for them:
(a) hard-coded English — WSHELL-001/020/033/034 hold the running list; also found and NOT
    yet written up anywhere: `EmojiPage.tsx:87` (`title: `Delete :name:``). Put it in the
    Summary addendum if no better home.
(b) one-time secrets dismissible by Escape — WSHELL-012/021; `RecoverPage.tsx` shows a
    fresh recovery key at :71, check it for the same gap when you read it.
Open question to settle in pages/*: `LoginPage` autocomplete attributes, the TOTP step,
and whether the 90-day session length is stated anywhere (brief asks).
