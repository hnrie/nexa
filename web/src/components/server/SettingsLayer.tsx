import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/common/Button";
import { isTopLayer } from "@/components/common/Modal";
import { useFocusTrap } from "@/components/common/useFocusTrap";
import s from "@/components/settings/Settings.module.css";
import { useIsMobile } from "@/hooks/useIsMobile";
import { unlessUnsaved, useHoldUnsaved, useUnsaved } from "@/stores/unsaved";

import { t } from "@/i18n";
import { usePortalRoot } from "@/hooks/usePortalRoot";
export interface NavGroup {
  /** The group's heading; without one the group is set apart by a divider instead. */
  head: string;
  items: { id: string; label: string; danger?: boolean }[];
}

/**
 * The full-screen settings frame used by user, server and channel settings.
 *
 * On a wide screen the nav stands beside the page. A phone has room for one of
 * them at a time, so there the nav is a list of its own: a page opens from it
 * and has a way back to it. The sideways-scrolling strip of page names it used
 * to be ran under the close button and showed three of fifteen pages at once.
 */
export function SettingsLayer({
  label,
  groups,
  page,
  setPage,
  onClose,
  children,
  footer,
  startOnList = false,
}: {
  label: string;
  groups: NavGroup[];
  page: string;
  setPage: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  /** Entries under the pages that are not pages themselves, such as Log Out. */
  footer?: ReactNode;
  /** On a phone, open on the list instead of on `page`: settings opened as a whole rather than at one page. */
  startOnList?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // into the full-screen element when a call is full screen, where the body is not seen
  const portalRoot = usePortalRoot();
  const mobile = useIsMobile();
  const [atList, setAtList] = useState(() => startOnList && mobile);
  // A window narrowed to phone width keeps showing the page it had, and
  // whatever is unsaved on it, rather than swapping it for the list.
  useEffect(() => {
    if (!mobile) setAtList(false);
  }, [mobile]);
  const onList = mobile && atList;
  // into the layer when it opens: at the page it opened on, or its way back to the list
  useFocusTrap(ref, true, () => (mobile && !atList ? backRef.current : ref.current?.querySelector<HTMLElement>('[aria-current="page"]')));
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
  // Each page starts at its top. The column scrolls, not the page, so it kept
  // the last page's offset: Licenses scrolled halfway opened My Account halfway.
  useLayoutEffect(() => {
    scroller.current?.scrollTo?.(0, 0);
  }, [page, onList]);
  // On a phone, focus follows the swap: to the way back when a page opens, and
  // to the page's own entry when the list comes back.
  const swapped = useRef(false);
  useEffect(() => {
    if (!swapped.current) {
      swapped.current = true;
      return;
    }
    if (!mobile) return;
    if (onList) ref.current?.querySelector<HTMLElement>(`[data-nav="${page}"]`)?.focus();
    else backRef.current?.focus({ preventScroll: true });
    // only the swap itself moves focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList]);

  const open = (id: string) => {
    if (id !== page) setPage(id);
    setAtList(false);
  };
  const close = (
    <button className={s.close} aria-label={t("server.settingsLayer.closeSettings")} onClick={unlessUnsaved(onClose)}>
      <X size={mobile ? 22 : 20} />
    </button>
  );
  return createPortal(
    <div ref={ref} className={s.layer} role="dialog" aria-modal="true" aria-label={label} data-modal-layer="" data-view={mobile ? (onList ? "list" : "page") : undefined} tabIndex={-1}>
      {mobile ? (
        <div className={s.topBar}>
          {onList ? (
            <h2 className={s.topTitle}>{label}</h2>
          ) : (
            <button ref={backRef} className={s.back} onClick={unlessUnsaved(() => setAtList(true))} aria-label={t("server.settingsLayer.backTo", { name: label })} data-testid="settings-back">
              <ChevronLeft className={s.flip} size={22} aria-hidden="true" />
              <span className={s.backLabel}>{label}</span>
            </button>
          )}
          {close}
        </div>
      ) : null}
      {!mobile || onList ? (
        <div className={s.navWrap}>
          {/* Selection lived only in `data-selected`, which is a CSS hook: ten identically-stated buttons, with no way to hear which page is open. */}
          <nav className={s.nav} aria-label={label}>
            {groups.map((g, i) => (
              <div key={g.head + i} className={s.navSection}>
                {g.head ? <div className={s.navHead}>{g.head}</div> : <div className={s.navSep} />}
                <div className={s.navGroup}>
                  {g.items.map((it) => {
                    // the list on a phone stands in for the page rather than beside it, so nothing in it is "here"
                    const here = !mobile && page === it.id;
                    return (
                      <button
                        key={it.id}
                        className={[s.navItem, it.danger ? s.danger : ""].join(" ")}
                        data-selected={here}
                        aria-current={here ? "page" : undefined}
                        data-nav={it.id}
                        onClick={mobile ? unlessUnsaved(() => open(it.id)) : here ? undefined : unlessUnsaved(() => setPage(it.id))}
                      >
                        <span className={s.navLabel}>{it.label}</span>
                        {mobile ? <ChevronRight className={[s.navChevron, s.flip].join(" ")} size={18} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {footer}
          </nav>
        </div>
      ) : null}
      {onList ? null : (
        <div ref={scroller} className={s.contentWrap}>
          <div className={s.content}>{children}</div>
          {mobile ? null : (
            <div className={s.closeCol}>
              {close}
              <span className={s.esc}>ESC</span>
            </div>
          )}
        </div>
      )}
    </div>,
    portalRoot,
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
      <span className={s.saveText}>{t("server.settingsLayer.carefulYouHaveUnsavedChanges")}</span>
      <span className={s.saveBtns}>
        <Button variant="ghost" onClick={onReset} disabled={busy}>{t("common.imageCrop.reset")}</Button>
        <Button variant="positive" onClick={onSave} loading={busy} data-testid="save">{label}</Button>
      </span>
    </div>
  );
}
