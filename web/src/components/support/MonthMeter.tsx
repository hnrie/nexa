import { useEffect } from "react";
import { limitsOf } from "@/lib/plans";
import { formatBytes, formatShortDate } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useBilling } from "@/stores/billing";
import { t } from "@/i18n";
import s from "./MonthMeter.module.css";

/**
 * Over the files waiting to be sent: how much of the 30-day upload allowance
 * the account has used, how much these files add, and when room comes back.
 * Read again each time files are picked, since every upload changes it.
 */
export function MonthMeter({ adding }: { adding: number }) {
  const plan = useAuth((a) => a.me?.plan ?? "");
  const billing = useBilling((b) => b.billing);
  useEffect(() => {
    void useBilling.getState().load().catch(() => undefined);
  }, []);
  const room = billing?.limits.month_upload_max ?? limitsOf(plan).month_upload_max;
  const used = billing?.month_used ?? 0;
  const over = used + adding > room;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, room)) * 100)}%`;
  return (
    <div className={s.meter} data-over={over || undefined} data-testid="month-meter">
      <span className={s.bar} aria-hidden="true">
        <i className={s.used} style={{ inlineSize: pct(used) }} />
        <i className={s.adding} style={{ inlineSize: pct(Math.min(adding, Math.max(0, room - used))), insetInlineStart: pct(used) }} />
      </span>
      <span className={s.text}>
        {over
          ? t("support.meter.over", { room: formatBytes(room) })
          : t("support.meter.line", { adding: formatBytes(adding), used: formatBytes(used), room: formatBytes(room) })}
        {billing?.month_frees_at && (over || used / room > 0.8) ? ` ${t("support.meter.freesAt", { date: formatShortDate(billing.month_frees_at) })}` : ""}
      </span>
    </div>
  );
}
