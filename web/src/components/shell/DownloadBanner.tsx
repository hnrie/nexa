import { Download, Monitor, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { android, androidPaused, type AndroidRelease } from "@/api/android";
import { desktop, type DesktopFile } from "@/api/desktop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { desktopBridge } from "@/lib/desktopBridge";
import { currentPlatform, isAndroid, pickDownload } from "@/lib/platform";
import { storage } from "@/lib/storage";
import { formatBytes } from "@/lib/time";
import s from "./DownloadBanner.module.css";

import { t } from "@/i18n";
const DISMISSED = "ec:desktopBanner";
const DISMISSED_ANDROID = "ec:androidBanner";
const OS_NAME: Record<DesktopFile["os"], string> = { windows: "Windows", mac: "macOS", linux: "Linux" };

/**
 * Offers the app a visitor's device can actually run: the installer on a
 * computer, the APK on an Android phone. Saying no thanks keeps it away on
 * that device; the desktop app, iPhones and anything with no build never see
 * it.
 */
export function DownloadBanner() {
  const mobile = useIsMobile();
  const androidBrowser = isAndroid();
  // sure: the computer is known well enough to hand it a file straight away
  const [pick, setPick] = useState<{ file: DesktopFile; sure: boolean } | null>(null);
  const [apk, setApk] = useState<AndroidRelease | null>(null);
  const key = androidBrowser ? DISMISSED_ANDROID : DISMISSED;
  const [closed, setClosed] = useState(() => storage.get(key) !== null);

  useEffect(() => {
    if (closed || desktopBridge() || androidBrowser) return;
    let alive = true;
    if (androidBrowser) {
      void android
        .latest()
        .then((rel) => {
          if (alive) setApk(rel);
        })
        .catch(() => {
          /* no banner is better than a broken one */
        });
      return () => {
        alive = false;
      };
    }
    if (mobile) return;
    void Promise.all([desktop.latest(), currentPlatform()])
      .then(([rel, target]) => {
        const file = rel ? pickDownload(rel, target) : null;
        if (alive && file) setPick({ file, sure: target.os !== "mac" || target.arch !== null });
      })
      .catch(() => {
        /* no banner is better than a broken one */
      });
    return () => {
      alive = false;
    };
  }, [closed, mobile, androidBrowser]);

  const close = () => {
    storage.set(key, String(Date.now()));
    setClosed(true);
  };

  if (closed) return null;

  if (androidBrowser) {
    // Android downloads are paused: phones get no banner until the app is worth installing again.
    if (androidPaused || !apk) return null;
    return (
      <div className={s.banner} role="region" aria-label={t("shell.downloadBanner.androidApp")} data-testid="android-banner">
        <span className={s.icon}><Smartphone size={18} /></span>
        <span className={s.text}>
          <b>{t("shell.downloadBanner.getTheAndroidApp")}</b><span className={s.tagline}> {t("shell.downloadBanner.callsNotificationsAndARealApp")}</span>
        </span>
        <a className={s.download} href={android.fileUrl(apk.name)} data-testid="android-banner-button">
          <Download size={14} /> {t("shell.downloadBanner.download")} <span style={{ opacity: 0.7 }}>{formatBytes(apk.size)}</span>
        </a>
        <button className={s.other} onClick={close} data-testid="android-banner-dismiss">{t("shell.downloadBanner.noThanks")}</button>
        <button className={s.close} aria-label={t("chat.attachments.close")} title={t("chat.attachments.close")} onClick={close}><X size={16} /></button>
      </div>
    );
  }

  if (mobile || !pick) return null;
  const { file, sure } = pick;
  return (
    <div className={s.banner} role="region" aria-label={t("shell.downloadBanner.desktopApp")} data-testid="download-banner">
      <span className={s.icon}><Monitor size={18} /></span>
      <span className={s.text}>
        <b>{t("shell.downloadBanner.getNexaFor", { os: OS_NAME[file.os] })}</b> — {t("download.rpcSupportAndABetterExperience")}
      </span>
      {sure ? (
        <>
          <a className={s.download} href={desktop.fileUrl(file.name)} data-testid="download-banner-button">
            <Download size={14} /> {t("shell.downloadBanner.download")} <span style={{ opacity: 0.7 }}>{formatBytes(file.size)}</span>
          </a>
          <Link className={s.other} to="/download">{t("shell.downloadBanner.otherPlatforms")}</Link>
        </>
      ) : (
        // a Mac that does not say which chip it has chooses between the two on the download page
        <Link className={s.download} to="/download" data-testid="download-banner-button">
          <Download size={14} /> {t("shell.downloadBanner.download")}
        </Link>
      )}
      <button className={s.close} aria-label={t("chat.attachments.close")} title={t("chat.attachments.close")} onClick={close} data-testid="download-banner-close"><X size={16} /></button>
    </div>
  );
}
