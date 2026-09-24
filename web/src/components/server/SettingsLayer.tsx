import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/common/Button";
import { isTopLayer } from "@/components/common/Modal";
import { useFocusTrap } from "@/components/common/useFocusTrap";
import s from "@/components/settings/Settings.module.css";
import { unlessUnsaved, useHoldUnsaved, useUnsaved } from "@/stores/unsaved";

import { t } from "@/i18n";
export interface NavGroup {
  head: string;
  items: { id: string; label: string; danger?: boolean }[];
}

/** The full-screen settings frame (nav on the left, content on the right) used by user, server and channel settings. */
export function SettingsLayer({ label, groups, page, setPage, onClose, children, footer }: { label: string; groups: NavGroup[]; page: string; setPage: (id: string) => void; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // into the layer when it opens, at the page it opened on
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
  return createPortal(
    <div ref={ref} className={s.layer} role="dialog" aria-modal="true" aria-label={label} data-modal-layer="" tabIndex={-1}>
      <div className={s.navWrap}>
        {/* Selection lived only in `data-selected`, which is a CSS hook: ten identically-stated buttons, with no way to hear which page is open. */}
        <nav className={s.nav} aria-label={label}>
          {groups.map((g, i) => (
            <div key={g.head + i}>
              {g.head ? <div className={s.navHead}>{g.head}</div> : <div className={s.navSep} />}
              {g.items.map((it) => (
                <button key={it.id} className={[s.navItem, it.danger ? s.danger : ""].join(" ")} data-selected={page === it.id} aria-current={page === it.id ? "page" : undefined} data-nav={it.id} onClick={page === it.id ? undefined : unlessUnsaved(() => setPage(it.id))}>
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
          <button className={s.close} aria-label={t("server.settingsLayer.closeSettings")} onClick={unlessUnsaved(onClose)}><X size={20} /></button>
          <span className={s.esc}>ESC</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The sticky "You have unsaved changes" bar. */
export function SaveBar({ dirty, busy, onReset, onSave, label = t("server.settingsLayer.saveChanges") }: { dirty: boolean; busy: boolean; onReset: () => void; onSave: () => void; label?: string }) {
  useHoldUnsaved(dirty);
  // shaken each time something tries to leave with these edits unsaved
  const nudge = useUnsaved((u) => u.nudge);
  const [calm] = useState(nudge);
  if (!dirty) return null;
  return (
    <div key={nudge} className={[s.saveBar, nudge !== calm ? s.shake : ""].join(" ")} data-testid="save-bar" role="status">
      <span>{t("server.settingsLayer.carefulYouHaveUnsavedChanges")}</span>
      <span className={s.saveBtns}>
        <Button variant="ghost" onClick={onReset} disabled={busy}>{t("common.imageCrop.reset")}</Button>
        <Button variant="positive" onClick={onSave} loading={busy} data-testid="save">{label}</Button>
      </span>
    </div>
  );
}
