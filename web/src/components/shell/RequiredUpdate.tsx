import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { NexaMark } from "@/components/common/Brand";
import { desktopBridge, type UpdateState } from "@/lib/desktopBridge";
import { useRequiredUpdate, type RequiredUpdate as Need } from "@/lib/requiredDesktop";
import { t, useLocale } from "@/i18n";
import s from "./RequiredUpdate.module.css";

/** What the desktop app says about its own update, kept current. */
function useAppUpdateState(enabled: boolean): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const updates = desktopBridge()?.updates;
    if (!updates) return;
    void updates.getState().then(setState, () => undefined);
    const off = updates.onState(setState);
    // look at once rather than at the app's next minute
    void updates.check().catch(() => undefined);
    return off;
  }, [enabled]);
  return enabled ? state : null;
}

function percent(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value * 100)}%`;
  }
}

/**
 * Everything a desktop app too old for Nexa shows (lib/requiredDesktop.ts):
 * the way from its version to the new one, which fills as the update
 * downloads, and the one thing to do next.
 */
export function RequiredUpdate({ need }: { need: Need }) {
  const locale = useLocale();
  const state = useAppUpdateState(!need.manual);
  const status = state?.status;
  const ready = status === "ready";
  const downloading = status === "downloading";
  const fill = ready ? 1 : downloading ? Math.max(0, Math.min(1, state?.progress ?? 0)) : 0;
  const download = () => {
    window.open(need.url ?? new URL("/download", window.location.origin).toString(), "_blank", "noopener,noreferrer");
  };

  const line = need.manual ? t("shell.requiredUpdate.manualRequired") : ready
    ? t("shell.requiredUpdate.ready")
    : downloading
      ? t("shell.requiredUpdate.downloading", { percent: percent(fill, locale) })
      : status === "checking"
        ? t("shell.requiredUpdate.checking")
        : t("shell.requiredUpdate.manual");

  return (
    <main className={s.wrap} data-testid="required-update">
      <section className={s.panel} aria-labelledby="required-update-title">
        <NexaMark size={36} className={s.mark} />
        <h1 id="required-update-title" className={s.title}>{t("shell.requiredUpdate.title")}</h1>
        <p className={s.body}>{t("shell.requiredUpdate.body")}</p>

        <div className={s.way}>
          <span className={s.from}>{need.running}</span>
          <div
            className={s.track}
            role="progressbar"
            aria-label={t("shell.update.progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill * 100)}
            data-state={need.manual ? "manual" : ready ? "ready" : downloading ? "downloading" : "waiting"}
          >
            <div className={s.fill} style={{ width: `${fill * 100}%` }} />
          </div>
          <span className={s.to}>{need.version}</span>
        </div>
        <p className={s.status} aria-live="polite">{line}</p>

        <div className={s.actions}>
          {need.manual ? (
            <Button onClick={download} data-testid="required-update-download">{t("shell.requiredUpdate.download")}</Button>
          ) : ready ? (
            <Button onClick={() => void desktopBridge()?.updates.restart()} data-testid="required-update-restart">{t("settings.desktop.restartToUpdate")}</Button>
          ) : downloading ? null : (
            <>
              {need.url ? <Button onClick={download} data-testid="required-update-download">{t("shell.requiredUpdate.download")}</Button> : null}
              <Button variant="secondary" loading={status === "checking"} onClick={() => void desktopBridge()?.updates.check().catch(() => undefined)} data-testid="required-update-check">
                {t("settings.desktop.checkForUpdates")}
              </Button>
            </>
          )}
          {downloading && need.url ? (
            <Button variant="secondary" onClick={download}>{t("shell.requiredUpdate.download")}</Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

/** Tells App whether this desktop app must update first (loaded only inside the desktop app). */
export function RequiredUpdateCheck({ onChange }: { onChange: (need: Need | null) => void }) {
  const need = useRequiredUpdate();
  useEffect(() => {
    if (need) onChange(need);
  }, [need, onChange]);
  return null;
}
