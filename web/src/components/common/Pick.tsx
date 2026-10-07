import { Check, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { menuAnchor } from "@/components/common/ContextMenu";
import { Tooltip } from "@/components/common/Tooltip";
import { usePick, type PickList } from "@/stores/pick";
import type { MenuPlacement } from "@/lib/contextMenus/registry";
import s from "./Pick.module.css";

import { t } from "@/i18n";

/** The circle a row shows while its list is being picked from, with a tick once it is picked. */
export function PickMark({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={s.mark} data-on={on} role="checkbox" aria-checked={on} aria-label={label} data-testid="pick-mark">
      {on ? <Check size={13} strokeWidth={3.5} aria-hidden="true" /> : null}
    </span>
  );
}

export interface PickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The bar across the foot of a list being picked from: how many are picked,
 * the things done to them most, the rest in a menu, and the way out. Escape
 * puts it away as well.
 */
export function PickBar({ list, count, actions, more, label }: { list: PickList; count: number; actions: PickAction[]; more: (at: MenuPlacement) => void; label: string }) {
  const clear = usePick((p) => p.clear);
  const mode = usePick((p) => p.list === list && p.mode);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[data-modal-layer]")) return;
      e.preventDefault();
      clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clear]);
  return (
    <div className={s.bar} role="toolbar" aria-label={label} data-testid={`pick-bar-${list}`}>
      <div className={s.head}>
        <span className={s.count} aria-live="polite">{count ? t("pick.count", { count }) : mode ? t("pick.tapToPick") : ""}</span>
        <button type="button" className={s.done} onClick={clear} data-testid="pick-done">
          <X size={15} aria-hidden="true" />
          {t("pick.done")}
        </button>
      </div>
      <div className={s.actions}>
        {actions.map((a) => (
          <Tooltip key={a.id} text={a.label} side="top">
            <button type="button" className={s.action} data-danger={a.danger || undefined} disabled={a.disabled || count === 0} onClick={a.onSelect} aria-label={a.label} data-testid={`pick-${a.id}`}>
              <a.icon size={18} aria-hidden="true" />
            </button>
          </Tooltip>
        ))}
        <Tooltip text={t("pick.more")} side="top">
          <button
            type="button"
            className={s.action}
            disabled={count === 0}
            aria-label={t("pick.more")}
            aria-haspopup="menu"
            onClick={(e) => more({ x: 0, y: 0, anchor: menuAnchor(e.currentTarget), label: t("pick.count", { count }) })}
            data-testid="pick-more"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
