import { X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/common/Spinner";
import { lazyPage } from "@/lib/lazyChunk";
import { isTopLayer } from "@/components/common/Modal";
import { useFocusTrap } from "@/components/common/useFocusTrap";
import { useAuth } from "@/stores/auth";
import { unlessUnsaved } from "@/stores/unsaved";
import { desktopBridge } from "@/lib/desktopBridge";
import { useIsMobile } from "@/hooks/useIsMobile";
import s from "./Settings.module.css";

import { t } from "@/i18n";
import { confirmLogout } from "@/lib/confirmLogout";
import { usePortalRoot } from "@/hooks/usePortalRoot";
const AccountPage = lazyPage(() => import("./AccountPage"));
const ProfilePage = lazyPage(() => import("./ProfilePage"));
const PrivacyPage = lazyPage(() => import("./PrivacyPage"));
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
function navGroups(): { id: string; head: string; items: { id: string; label: string }[] }[] {
  return [
    { id: "user", head: t("settings.settings.userSettings"), items: [{ id: "account", label: t("settings.account.myAccount") }, { id: "profiles", label: t("settings.profile.profiles") }, { id: "privacy", label: t("settings.privacy.privacySafety") }, { id: "security", label: t("settings.security.security") }, { id: "devices", label: t("settings.devices.devices") }] },
    { id: "app", head: t("settings.settings.appSettings"), items: [{ id: "appearance", label: t("settings.appearance.appearance") }, { id: "voice", label: t("settings.voice.voiceVideo") }, { id: "notifications", label: t("settings.notifications.notifications") }, { id: "stickers", label: t("settings.stickers.expressionPacks") }] },
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
  const appItems = [...(inApp ? [{ id: "desktop", label: t("settings.desktop.desktopApp") }] : []), { id: "licenses", label: t("settings.licenses.licenses") }, { id: "about", label: t("legal.aboutTitle") }];
  const base = navGroups().map((g) => (g.id === "app" ? { ...g, items: [...g.items, ...appItems] } : g));
  const nav = isAdmin ? [...base, { id: "instance", head: t("settings.settings.instance"), items: [{ id: "admin", label: t("settings.admin.instanceAdmin") }] }] : base;
  const ref = useRef<HTMLDivElement>(null);
  // into the full-screen element when a call is full screen, where the body is not seen
  const portalRoot = usePortalRoot();
  useFocusTrap(ref, true, () => ref.current?.querySelector<HTMLElement>('[aria-current="page"]'));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopLayer(ref.current)) {
        e.stopPropagation();
        unlessUnsaved(onClose)();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const body =
    page === "profiles" ? <ProfilePage /> : page === "privacy" ? <PrivacyPage /> : page === "security" ? <SecurityPage /> : page === "devices" ? <DevicesPage /> : page === "appearance" ? <AppearancePage /> : page === "notifications" ? <NotificationsPage /> : page === "stickers" ? <StickersPage initialPackId={packId} /> : page === "voice" ? <VoicePage /> : page === "licenses" ? <LicensesPage /> : page === "about" ? <AboutPage /> : page === "admin" && isAdmin ? <AdminPage /> : page === "desktop" && inApp ? <DesktopPage /> : <AccountPage onClose={onClose} />;
  return createPortal(
    <div ref={ref} className={s.layer} role="dialog" aria-modal="true" aria-label={t("settings.settings.userSettings")} data-modal-layer="" tabIndex={-1}>
      <div className={s.navWrap}>
        <nav className={s.nav} aria-label={t("settings.settings.userSettings")}>
          {nav.map((g) => (
            <div key={g.id}>
              <div className={s.navHead}>{g.head}</div>
              {g.items.map((it) => (
                <button key={it.id} className={s.navItem} data-selected={page === it.id} aria-current={page === it.id ? "page" : undefined} data-nav={it.id} onClick={page === it.id ? undefined : unlessUnsaved(() => setPage(it.id))}>{it.label}</button>
              ))}
            </div>
          ))}
          <div className={s.navSep} />
          {!inApp && !mobile ? (
            <button className={s.navItem} onClick={() => window.open("/download", "_blank", "noopener")} data-nav="get-app">{t("settings.settings.getTheDesktopApp")}</button>
          ) : null}
          <button className={[s.navItem, s.danger].join(" ")} onClick={confirmLogout}>{t("settings.settings.logOut")}</button>
        </nav>
      </div>
      <div className={s.contentWrap}>
        <div className={s.content}>
          {/* A blank content column on a slow link is indistinguishable from a crash. */}
          <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner label={t("chat.pins.loading")} /></div>}>{body}</Suspense>
        </div>
        <div className={s.closeCol}>
          <button className={s.close} aria-label={t("server.settingsLayer.closeSettings")} onClick={unlessUnsaved(onClose)}><X size={20} /></button>
          <span className={s.esc}>ESC</span>
        </div>
      </div>
    </div>,
    portalRoot,
  );
}
