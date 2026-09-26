import { Ban } from "lucide-react";
import { memo } from "react";
import s from "./Blocked.module.css";

import { t } from "@/i18n";

/**
 * A run of messages from people this account has blocked, folded into one
 * row that says how many there are, with a button to show them (and hide them
 * again). With "Hide their messages completely" on there is no row at all:
 * the list leaves the messages out (see lib/blocked.ts).
 */
export const BlockedRun = memo(function BlockedRun({ runKey, count, open, compact, onToggle }: { runKey: string; count: number; open: boolean; compact: boolean; onToggle: (key: string) => void }) {
  const label = t("people.blockedRun.count", { count });
  return (
    // reachable with the list's arrow keys like a message, its button with Tab
    <div className={s.run} data-row="" tabIndex={-1} data-blocked-run={runKey} data-open={open || undefined} data-compact={compact || undefined} role="group" aria-label={label}>
      <span className={s.icon} aria-hidden="true"><Ban size={16} /></span>
      <span className={s.text}>{label}</span>
      <button type="button" className={s.toggle} aria-expanded={open} onClick={() => onToggle(runKey)} data-testid="blocked-run-toggle">
        {open ? t("people.blockedRun.hide") : t("people.blockedRun.show")}
      </button>
    </div>
  );
});
