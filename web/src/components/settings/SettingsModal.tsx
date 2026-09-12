import { X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lazyPage } from "@/lib/lazyChunk";
import { isTopLayer } from "@/components/common/Modal";
import { useAuth } from "@/stores/auth";
import s from "./Settings.module.css";

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

const NAV: { head: string; items: { id: string; label: string }[] }[] = [
  { head: "User Settings", items: [{ id: "account", label: "My Account" }, { id: "profiles", label: "Profiles" }, { id: "privacy", label: "Privacy & Safety" }, { id: "security", label: "Security" }, { id: "devices", label: "Devices" }] },
  { head: "App Settings", items: [{ id: "appearance", label: "Appearance" }, { id: "voice", label: "Voice & Video" }, { id: "notifications", label: "Notifications" }, { id: "stickers", label: "Expression Packs" }] },
];

export default function SettingsModal({ onClose, page: initial, packId }: { onClose: () => void; page: string; packId?: string | undefined }) {
  const [page, setPage] = useState(initial);
  const logout = useAuth((a) => a.logout);
  const isAdmin = useAuth((a) => ((a.me?.flags ?? 0) & 1) !== 0);
  const nav = isAdmin ? [...NAV, { head: "Instance", items: [{ id: "admin", label: "Instance Admin" }] }] : NAV;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopLayer(ref.current)) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const body =
    page === "profiles" ? <ProfilePage /> : page === "privacy" ? <PrivacyPage /> : page === "security" ? <SecurityPage /> : page === "devices" ? <DevicesPage /> : page === "appearance" ? <AppearancePage /> : page === "notifications" ? <NotificationsPage /> : page === "stickers" ? <StickersPage initialPackId={packId} /> : page === "voice" ? <VoicePage /> : page === "admin" && isAdmin ? <AdminPage /> : <AccountPage onClose={onClose} />;
  return createPortal(
    <div ref={ref} className={s.layer} role="dialog" aria-modal="true" aria-label="User Settings" data-modal-layer="">
      <div className={s.navWrap}>
        <nav className={s.nav}>
          {nav.map((g) => (
            <div key={g.head}>
              <div className={s.navHead}>{g.head}</div>
              {g.items.map((it) => (
                <button key={it.id} className={s.navItem} data-selected={page === it.id} data-nav={it.id} onClick={() => setPage(it.id)}>{it.label}</button>
              ))}
            </div>
          ))}
          <div className={s.navSep} />
          <button className={[s.navItem, s.danger].join(" ")} onClick={() => void logout()}>Log Out</button>
        </nav>
      </div>
      <div className={s.contentWrap}>
        <div className={s.content}>
          <Suspense fallback={null}>{body}</Suspense>
        </div>
        <div className={s.closeCol}>
          <button className={s.close} aria-label="Close settings" onClick={onClose}><X size={20} /></button>
          <span className={s.esc}>ESC</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
