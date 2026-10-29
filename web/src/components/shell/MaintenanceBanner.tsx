import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { api } from "@/api/client";
import { t } from "@/i18n";
import s from "./MaintenanceBanner.module.css";

type Schedule = { reboot_at: number; now: number; notice_ms: number };

export function maintenanceRemaining(schedule: Schedule, now: number): number | null {
  if (!Number.isFinite(schedule.reboot_at) || schedule.reboot_at <= 0 || schedule.reboot_at - now > schedule.notice_ms) return null;
  return Math.max(0, Math.ceil((schedule.reboot_at - now) / 1000));
}

export function MaintenanceBanner() {
  const [schedule, setSchedule] = useState<(Schedule & { received: number }) | null>(null);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const ctrl = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || ctrl.signal.aborted) return;
      busy = true;
      try {
        const next = await api.request<Schedule>("GET", "/maintenance", undefined, { signal: ctrl.signal });
        if (!ctrl.signal.aborted) setSchedule({ ...next, received: performance.now() });
      } catch { /* Keep the known deadline during a reboot or a network interruption. */ }
      finally { busy = false; }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 30_000);
    const visible = () => { if (document.visibilityState === "visible") { setNow(performance.now()); void refresh(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { ctrl.abort(); clearInterval(poll); document.removeEventListener("visibilitychange", visible); };
  }, []);
  const remaining = schedule ? maintenanceRemaining(schedule, schedule.now + Math.max(0, now - schedule.received)) : null;
  useEffect(() => {
    // Only the visible warning needs a second-by-second clock.
    const tick = window.setInterval(() => setNow(performance.now()), remaining === null ? 30_000 : 1000);
    return () => clearInterval(tick);
  }, [remaining === null]);
  if (remaining === null) return null;
  const time = `${Math.floor(remaining / 3600)}:${String(Math.floor(remaining / 60) % 60).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  return <div className={s.banner} data-testid="maintenance-banner" role="region" aria-label={t("maintenance.title")}>
    <Timer size={20} aria-hidden="true" />
    <div className={s.words}><strong>{remaining > 0 ? t("maintenance.countdown", { time }) : t("maintenance.pending")}</strong><span>{t("maintenance.downtime")}</span></div>
  </div>;
}
