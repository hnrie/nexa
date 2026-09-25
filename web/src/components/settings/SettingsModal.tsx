import { Suspense, useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { lazyPage } from "@/lib/lazyChunk";
import { SettingsLayer, type NavGroup } from "@/components/server/SettingsLayer";
import { useAuth } from "@/stores/auth";
import { desktopBridge } from "@/lib/desktopBridge";
import { useIsMobile } from "@/hooks/useIsMobile";
import s from "./Settings.module.css";

import { t } from "@/i18n";
import { confirmLogout } from "@/lib/confirmLogout";
const AccountPage = lazyPage(() => import("./AccountPage"));
const ProfilePage = lazyPage(() => import("./ProfilePage"));
const PrivacyPage = lazyPage(() => import("./PrivacyPage"));
const BlockedPage = lazyPage(() => import("./BlockedPage"));
const SecurityPage = lazyPage(() => import("./SecurityPage"));
const DevicesPage = lazyPage(() => import("./DevicesPage"));
const AppearancePage = lazyPage(() => import("./AppearancePage"));
const NotificationsPage = lazyPage(() => import("./NotificationsPage"));
const StickersPage = lazyPage(() => import("./StickersPage"));
const VoicePage = lazyPage(() => import("./VoicePage"));
const AdminPage = lazyPage(() => import("./AdminPage"));
const DesktopPage = lazyPage(() => import("./DesktopPage"));
const LicensesPage = lazyPage(() => import("./LicensesPage"));
const AboutPage = lazyPage(() => import("./AboutPage"));

/** The navigation, built per render so it follows the language. */
function navGroups(): NavGroup[] {
  return [
    { head: t("settings.settings.userSettings"), items: [{ id: "account", label: t("settings.account.myAccount") }, { id: "profiles", label: t("settings.profile.profiles") }, { id: "privacy", label: t("settings.privacy.privacySafety") }, { id: "blocked", label: t("people.blockedPage.title") }, { id: "security", label: t("settings.security.security") }, { id: "devices", label: t("settings.devices.devices") }] },
    { head: t("settings.settings.appSettings"), items: [{ id: "appearance", label: t("settings.appearance.appearance") }, { id: "voice", label: t("settings.voice.voiceVideo") }, { id: "notifications", label: t("settings.notifications.notifications") }, { id: "stickers", label: t("settings.stickers.expressionPacks") }] },
  ];
}

export default function SettingsModal({ onClose, page: initial, packId }: { onClose: () => void; page: string; packId?: string | undefined }) {
  const [page, setPage] = useState(initial);
  const isAdmin = useAuth((a) => ((a.me?.flags ?? 0) & 1) !== 0);
  const inApp = !!desktopBridge();
  const mobile = useIsMobile();
  // Licenses sits at the bottom of the app settings: nobody comes looking for it, and
  // the desktop entry only exists when there is a desktop app to have settings for.
  // About is last of all: Terms, Privacy, encryption note, and owner contact.
  const appItems = [...(inApp ? [{ id: "desktop", label: t("settings.desktop.desktopApp") }] : []), { id: "licenses", label: t("settings.licenses.licenses") }, { id: "about", label: t("settings.about.title") }];
  const base = navGroups().map((g, i) => (i === 1 ? { ...g, items: [...g.items, ...appItems] } : g));
  const groups = isAdmin ? [...base, { head: t("settings.settings.instance"), items: [{ id: "admin", label: t("settings.admin.instanceAdmin") }] }] : base;
  const body =
    page === "profiles" ? <ProfilePage /> : page === "privacy" ? <PrivacyPage /> : page === "security" ? <SecurityPage /> : page === "devices" ? <DevicesPage /> : page === "appearance" ? <AppearancePage /> : page === "notifications" ? <NotificationsPage /> : page === "stickers" ? <StickersPage initialPackId={packId} /> : page === "voice" ? <VoicePage /> : page === "licenses" ? <LicensesPage /> : page === "about" ? <AboutPage /> : page === "admin" && isAdmin ? <AdminPage /> : page === "desktop" && inApp ? <DesktopPage /> : <AccountPage onEditProfile={() => setPage("profiles")} />;
  // Log Out is an action rather than a page, so it closes the nav instead of joining a group.
  const footer = (
    <div className={s.navSection}>
      <div className={s.navSep} />
      <div className={s.navGroup}>
        {!inApp && !mobile ? (
          <button className={s.navItem} onClick={() => window.open("/download", "_blank", "noopener")} data-nav="get-app">
            <span className={s.navLabel}>{t("settings.settings.getTheDesktopApp")}</span>
          </button>
        ) : null}
        <button className={[s.navItem, s.danger].join(" ")} onClick={confirmLogout} data-nav="logout">
          <span className={s.navLabel}>{t("settings.settings.logOut")}</span>
        </button>
      </div>
    </div>
  );
  return (
    // Opened at My Account is opened as a whole, from the user panel: a phone starts on the list.
    <SettingsLayer label={t("settings.settings.userSettings")} groups={groups} page={page} setPage={setPage} onClose={onClose} footer={footer} startOnList={initial === "account"}>
      {/* A blank content column on a slow link is indistinguishable from a crash. */}
      <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner label={t("chat.pins.loading")} /></div>}>{page === "blocked" ? <BlockedPage /> : body}</Suspense>
    </SettingsLayer>
  );
}
