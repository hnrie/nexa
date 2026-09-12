import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/common/Button";
import s from "@/components/settings/Settings.module.css";

export interface NavGroup {
  head: string;
  items: { id: string; label: string; danger?: boolean }[];
}

/** The full-screen settings frame (nav on the left, content on the right) used by user, server and channel settings. */
export function SettingsLayer({ label, groups, page, setPage, onClose, children, footer }: { label: string; groups: NavGroup[]; page: string; setPage: (id: string) => void; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.layer} role="dialog" aria-modal="true" aria-label={label}>
      <div className={s.navWrap}>
        <nav className={s.nav}>
          {groups.map((g, i) => (
            <div key={g.head + i}>
              {g.head ? <div className={s.navHead}>{g.head}</div> : <div className={s.navSep} />}
              {g.items.map((it) => (
                <button key={it.id} className={[s.navItem, it.danger ? s.danger : ""].join(" ")} data-selected={page === it.id} data-nav={it.id} onClick={() => setPage(it.id)}>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
          {footer}
        </nav>
      </div>
      <div className={s.contentWrap}>
        <div className={s.content}>{children}</div>
        <div className={s.closeCol}>
          <button className={s.close} aria-label="Close settings" onClick={onClose}><X size={20} /></button>
          <span className={s.esc}>ESC</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The sticky "You have unsaved changes" bar. */
export function SaveBar({ dirty, busy, onReset, onSave, label = "Save Changes" }: { dirty: boolean; busy: boolean; onReset: () => void; onSave: () => void; label?: string }) {
  if (!dirty) return null;
  return (
    <div className={s.saveBar} data-testid="save-bar">
      <span>Careful — you have unsaved changes!</span>
      <span className={s.saveBtns}>
        <Button variant="ghost" onClick={onReset} disabled={busy}>Reset</Button>
        <Button variant="positive" onClick={onSave} loading={busy} data-testid="save">{label}</Button>
      </span>
    </div>
  );
}
