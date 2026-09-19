# Progress — web-shell-ui
State: auditing
Last checkpoint: 2026-09-19T00:45Z
Next finding id: 032

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
- [ ] web/src/components/settings/LicensesPage.test.tsx
- [x] web/src/components/settings/Licenses.module.css

Server settings:
- [x] web/src/components/server/SettingsLayer.tsx
- [x] web/src/components/server/ServerSettingsModal.tsx
- [x] web/src/components/server/ServerSettings.module.css
- [ ] web/src/components/server/ChannelSettingsModal.tsx
- [ ] web/src/components/server/MemberActionModal.tsx
- [x] web/src/components/server/PermissionGrid.tsx
- [ ] web/src/components/server/PermissionGrid.module.css
- [ ] web/src/components/server/RoleChips.module.css
- [ ] web/src/components/server/PackEditor.tsx
- [ ] web/src/components/server/PackEditor.module.css
- [ ] web/src/components/server/memberMenu.ts
- [x] web/src/components/server/pages/ServerOverviewPage.tsx
- [x] web/src/components/server/pages/RolesPage.tsx
- [ ] web/src/components/server/pages/rolePositions.ts
- [ ] web/src/components/server/pages/rolePositions.test.ts
- [x] web/src/components/server/pages/MembersPage.tsx
- [ ] web/src/components/server/pages/BansPage.tsx
- [ ] web/src/components/server/pages/BansPage.test.tsx
- [ ] web/src/components/server/pages/InvitesPage.tsx
- [ ] web/src/components/server/pages/EmojiPage.tsx
- [ ] web/src/components/server/pages/ServerStickersPage.tsx
- [ ] web/src/components/server/pages/AuditLogPage.tsx
- [ ] web/src/components/server/pages/EncryptionPage.tsx
- [ ] web/src/components/server/pages/DeleteServerPage.tsx

Friends and desktop:
- [ ] web/src/components/friends/Friends.module.css
- [ ] web/src/components/desktop/DesktopEffects.tsx
- [ ] web/src/components/desktop/DisplayPicker.tsx
- [ ] web/src/components/desktop/Desktop.module.css

Pages:
- [ ] web/src/pages/AuthLayout.tsx
- [ ] web/src/pages/AuthLayout.test.tsx
- [ ] web/src/pages/Auth.module.css
- [ ] web/src/pages/LoginPage.tsx
- [ ] web/src/pages/LoginPage.test.tsx
- [x] web/src/pages/RegisterPage.tsx
- [ ] web/src/pages/RecoverPage.tsx
- [ ] web/src/pages/RecoverPage.test.tsx
- [ ] web/src/pages/LockPage.tsx
- [ ] web/src/pages/PasscodePage.tsx
- [ ] web/src/pages/HomePage.tsx
- [ ] web/src/pages/Home.module.css
- [ ] web/src/pages/DownloadPage.tsx
- [ ] web/src/pages/DownloadPage.module.css
- [ ] web/src/pages/InvitePage.tsx
- [ ] web/src/pages/InvitePage.module.css
- [ ] web/src/pages/OfflinePage.tsx
- [ ] web/src/pages/FriendsPage.tsx
- [ ] web/index.html                            (meta/OG/CSP for HomePage — brief asks for it)

Context only (not in scope, read to know what exists): `web/src/components/common/*`,
`web/src/pages/DMPage.tsx`, `web/src/pages/ServerPage.tsx`, `web/src/pages/StickerPackPage.tsx`
(web-chat-ui), `web/src/pages/GuestCallPage.tsx` (voice).

Parity (read-only, Android):
- [ ] android/.../ui/main/MainScreen.kt
- [ ] android/.../ui/main/Sidebar.kt
- [ ] android/.../ui/auth/AuthScreen.kt
- [ ] android/.../ui/auth/RecoveryKeyOverlay.kt
- [ ] android/.../ui/settings/SettingsScreen.kt
- [ ] android/.../ui/server/ServerSettingsScreen.kt
- [ ] android/.../ui/friends/FriendsScreen.kt
- [ ] android/.../ui/invite/InviteScreen.kt
- [ ] android/.../ui/sheets/*
- [ ] android/.../ui/Nav.kt

Round 1:
- [ ] audit/REVIEW.md (Done / Not doing / Still open)
- [ ] audit/web-ui.md (shell/settings/modal/page parts)
- [ ] audit/web-bugs.md (same)
- [ ] audit/product-gaps.md (the 15 IDEA findings — re-judge as design)

## Handoff note
Resumed 2026-09-19T00:05Z by successor #2. The header said "Next finding id: 001" but
FINDINGS.md already held WSHELL-001..010 (shell, rail/sidebar, modals) — corrected to 011.
Shell, rail/sidebar and modals were done by the predecessor. Working through settings now
(SettingsModal, Settings.module.css, Account, Profile, Security, Privacy done; RegisterPage
read early for the recovery-key comparison). Two cross-cutting threads to finish:
(a) hard-coded English — WSHELL-001/020 hold the list, scan each new file;
(b) one-time secrets dismissible by Escape — WSHELL-012/021.
Next: EncryptionSection, DevicesPage, NotificationsPage, AppearancePage, CustomColorIcon,
VoicePage, DesktopPage, StickersPage, AdminPage, LicensesPage → server/* → pages/* →
desktop/* → Android parity → round-1 reports.
