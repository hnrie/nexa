import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { applyUpdate, cancelUpdate, isSnoozed, snoozeUpdate, startUpdateChecks, useAppUpdate, type Applying, type Waiting } from "@/lib/appUpdate";
import { desktopBridge, type UpdateState } from "@/lib/desktopBridge";
import { useInterrupt } from "@/lib/interrupt";
import { useMacReplacement, type Replacement } from "@/lib/macReplacement";
import { useDesktop } from "@/stores/desktop";
import { useVoice } from "@/stores/voice";
import { t, useLocale } from "@/i18n";
import s from "./Update.module.css";

/**
 * The update on offer. The desktop app's own new version comes first: the
 * app restarted into it loads the newest web app anyway.
 * ready: downloaded, a restart installs it. downloading: on its way.
 * manual: a build that cannot update itself (a .deb), so the download page.
 * replace: a Mac app too old to update itself to the new version, which it
 * is offered to download instead (lib/macReplacement.ts). It comes first:
 * nothing else it could install is newer.
 */
export type Offer =
  | { kind: "web"; key: string }
  | { kind: "ready" | "downloading" | "manual" | "replace"; key: string; version: string | null; progress: number; url: string | null };

export function offerOf(web: string | null, desktop: UpdateState | null, inApp: boolean, replacement: Replacement | null = null): Offer | null {
  if (replacement) return { kind: "replace", key: `replace:${replacement.version}`, version: replacement.version, progress: 0, url: replacement.url };
  if (inApp && desktop) {
    const version = desktop.version ?? null;
    // one key for the whole of one version, so Later holds while it downloads and once it is ready
    const key = `app:${version ?? ""}`;
    if (desktop.status === "ready") return { kind: "ready", key, version, progress: 1, url: null };
    if (desktop.status === "downloading") return { kind: "downloading", key, version, progress: desktop.progress ?? 0, url: null };
    if (desktop.status === "manual" && desktop.downloadUrl) return { kind: "manual", key, version, progress: 0, url: desktop.downloadUrl };
  }
  return web ? { kind: "web", key: `web:${web}` } : null;
}

const WAITING_RELOAD: Record<Exclude<Waiting, null | "update">, string> = {
  call: "shell.update.reloadingCall",
  upload: "shell.update.reloadingUpload",
  download: "shell.update.reloadingDownload",
  send: "shell.update.reloadingSend",
  // words in the box: they go when the message is sent
  typing: "shell.update.reloadingSend",
};
const WAITING_RESTART: Record<Exclude<Waiting, null>, string> = {
  call: "shell.update.restartingCall",
  upload: "shell.update.restartingUpload",
  download: "shell.update.restartingDownload",
  send: "shell.update.restartingSend",
  typing: "shell.update.restartingSend",
  update: "shell.update.restartingUpdate",
};

/** What a reload or restart under way says it is waiting for. */
function waitingText(how: Applying, waiting: Waiting): string {
  if (how === "reload") return waiting && waiting !== "update" ? t(WAITING_RELOAD[waiting]) : t("shell.update.reloadingNow");
  return waiting ? t(WAITING_RESTART[waiting]) : t("shell.update.restartingNow");
}

function percent(value: number, locale: string): string {
  const v = Math.max(0, Math.min(1, value));
  try {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${Math.round(v * 100)}%`;
  }
}

/**
 * Offers a new version the moment one is found, in the middle of the screen:
 * Reload for a new build of the web app, Update for a new version of the
 * desktop app. It waits for a quiet moment (no call, no other dialog, nobody
 * writing), and Later tucks it into a reminder along the top that brings it
 * back after a while. Moving onto the update waits for anything it would cut
 * off, and the reminder says what (lib/appUpdate.ts).
 */
export function UpdatePrompt() {
  const web = useAppUpdate((u) => u.web);
  const snoozed = useAppUpdate((u) => u.snoozed);
  const applying = useAppUpdate((u) => u.applying);
  const desktop = useDesktop((d) => d.update);
  const inCall = useVoice((v) => !!v.mine);
  const [, wake] = useState(0);
  const replacement = useMacReplacement();
  const offer = offerOf(web, desktop, !!desktopBridge(), replacement);

  useEffect(() => startUpdateChecks(), []);

  // put off with Later, it asks again when the time is up
  useEffect(() => {
    const left = snoozed ? snoozed.until - Date.now() : 0;
    if (left <= 0) return;
    const timer = setTimeout(() => wake((n) => n + 1), left + 50);
    return () => clearTimeout(timer);
  }, [snoozed]);

  // Not in the middle of a call: the prompt would cover its controls. The
  // reminder says it meanwhile, and the prompt comes once the call is over.
  const open = useInterrupt("update", !!offer && !applying && !inCall && !isSnoozed(offer.key, snoozed));
  if (!offer) return null;

  const go = () => {
    if (offer.kind === "manual" || offer.kind === "replace") {
      if (offer.url) window.open(offer.url, "_blank", "noopener");
      // the page is open elsewhere; the reminder stays until the new version is installed
      snoozeUpdate(offer.key);
      return;
    }
    void applyUpdate(offer.kind === "web" ? "reload" : "restart");
  };
  return open ? <UpdateDialog offer={offer} onGo={go} onLater={() => snoozeUpdate(offer.key)} /> : <UpdateReminder offer={offer} onGo={go} />;
}

function Progress({ value }: { value: number }) {
  const locale = useLocale();
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={s.progress}>
      <div className={s.track} role="progressbar" aria-label={t("shell.update.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
        <div className={s.fill} style={{ width: `${v * 100}%` }} />
      </div>
      <span className={s.percent}>{percent(v, locale)}</span>
    </div>
  );
}

function UpdateDialog({ offer, onGo, onLater }: { offer: Offer; onGo: () => void; onLater: () => void }) {
  const web = offer.kind === "web";
  const body = web
    ? t("shell.update.webBody")
    : offer.kind === "ready"
      ? t("shell.update.readyBody")
      : offer.kind === "downloading"
        ? t("shell.update.downloadingBody")
        : offer.kind === "replace"
          ? t("shell.update.replaceBody")
          : t("shell.update.manualBody");
  return (
    <Modal
      open
      centered
      onClose={onLater}
      title={t("shell.update.title")}
      width={440}
      footer={
        <>
          <Button variant="secondary" className={s.action} onClick={onLater} data-testid="update-later">
            {t("shell.update.later")}
          </Button>
          <Button className={s.action} onClick={onGo} data-testid="update-go">
            {web ? t("shell.update.reload") : offer.kind === "replace" ? t("shell.update.download") : t("shell.update.update")}
          </Button>
        </>
      }
    >
      <div data-testid="update-dialog" data-kind={offer.kind}>
        <p className={s.lead}>{body}</p>
        {!web && offer.version ? <p className={s.version}>{t("shell.update.version", { version: offer.version })}</p> : null}
        {offer.kind === "downloading" ? <Progress value={offer.progress} /> : null}
      </div>
    </Modal>
  );
}

/** The update put off, along the top of the page: one press to take it, and what it waits for once pressed. */
function UpdateReminder({ offer, onGo }: { offer: Offer; onGo: () => void }) {
  const applying = useAppUpdate((u) => u.applying);
  const waiting = useAppUpdate((u) => u.waiting);
  const locale = useLocale();
  const text = applying
    ? waitingText(applying, waiting)
    : offer.kind === "web"
      ? t("shell.update.webReady")
      : offer.kind === "ready"
        ? t("shell.update.appReady")
        : offer.kind === "downloading"
          ? t("shell.update.appDownloading")
          : offer.kind === "replace"
            ? t("shell.update.replaceOut")
            : t("shell.update.appOut");
  return (
    <div className={s.bar} role="region" aria-label={t("shell.update.title")} data-testid="update-reminder" data-kind={offer.kind}>
      <span className={s.barIcon} aria-hidden="true">
        {applying ? <LoaderCircle size={18} className={s.spin} /> : offer.kind === "web" ? <RefreshCw size={18} /> : <Download size={18} />}
      </span>
      <span className={s.barText} aria-live="polite" data-testid="update-reminder-text">
        {text}
      </span>
      {offer.kind === "downloading" ? <span className={s.barMeter}>{percent(offer.progress, locale)}</span> : null}
      {applying ? (
        <Button size="sm" variant="secondary" className={s.barBtn} onClick={cancelUpdate} data-testid="update-cancel">
          {t("shell.update.cancel")}
        </Button>
      ) : (
        <Button size="sm" className={s.barBtn} onClick={onGo} data-testid="update-reminder-go">
          {offer.kind === "web" ? t("shell.update.reload") : offer.kind === "replace" ? t("shell.update.download") : t("shell.update.update")}
        </Button>
      )}
    </div>
  );
}
