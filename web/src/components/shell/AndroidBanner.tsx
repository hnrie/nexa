import { Download, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { android, type AndroidFile } from "@/api/android";
import { desktopBridge } from "@/lib/desktopBridge";
import { currentAndroidAbi, isAndroidBrowser, pickAndroid } from "@/lib/platform";
import { formatBytes } from "@/lib/time";
import s from "./DownloadBanner.module.css";

import { t } from "@/i18n";

// Closing it lasts until the page is loaded again: moving to another page of
// the site keeps it closed, and a reload brings it back.
let closedThisLoad = false;

/**
 * Offers the Android app to an Android browser, with the build for its own
 * processor one tap away. Nothing shows anywhere else, in the desktop app or
 * the Android app's own web views, or while no build is published.
 *
 * `bleed` is for the public pages, whose padding it spans to sit edge to edge
 * at the top.
 */
export function AndroidBanner({ bleed = false }: { bleed?: boolean }) {
  const [file, setFile] = useState<AndroidFile | null>(null);
  const [closed, setClosed] = useState(closedThisLoad);
  // after the tap, the next step: the file has to be opened to install
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (closed || !isAndroidBrowser() || desktopBridge()) return;
    let alive = true;
    void Promise.all([android.latest(), currentAndroidAbi()])
      .then(([rel, abi]) => {
        if (alive && rel) setFile(pickAndroid(rel.files, abi));
      })
      .catch(() => {
        /* no banner is better than a broken one */
      });
    return () => {
      alive = false;
    };
  }, [closed]);

  if (closed || !file) return null;
  const close = () => {
    closedThisLoad = true;
    setClosed(true);
  };
  return (
    <div className={[s.banner, bleed ? s.bleed : ""].join(" ")} role="region" aria-label={t("shell.downloadBanner.androidApp")} data-testid="android-banner">
      <span className={s.icon}><Smartphone size={18} /></span>
      <span className={[s.text, s.wrap].join(" ")} aria-live="polite">
        {started ? (
          t("shell.downloadBanner.androidOpenFile")
        ) : (
          <>
            <b>{t("shell.downloadBanner.getNexaFor", { os: "Android" })}</b>
            <span className={s.tagline}>{t("shell.downloadBanner.androidTagline")}</span>
          </>
        )}
      </span>
      <a className={s.download} href={android.fileUrl(file)} onClick={() => setStarted(true)} data-testid="android-banner-download">
        <Download size={14} /> {t("shell.downloadBanner.download")} <span className={s.size}>{formatBytes(file.size)}</span>
      </a>
      <button className={s.close} aria-label={t("chat.attachments.close")} title={t("chat.attachments.close")} onClick={close} data-testid="android-banner-close"><X size={16} /></button>
    </div>
  );
}
