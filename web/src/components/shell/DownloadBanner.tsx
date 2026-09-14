import { Download, Monitor, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { desktop, type DesktopFile } from "@/api/desktop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { desktopBridge } from "@/lib/desktopBridge";
import { currentPlatform, pickDownload } from "@/lib/platform";
import { storage } from "@/lib/storage";
import { formatBytes } from "@/lib/time";
import s from "./DownloadBanner.module.css";

const DISMISSED = "ec:desktopBanner";
const OS_NAME: Record<DesktopFile["os"], string> = { windows: "Windows", mac: "macOS", linux: "Linux" };

/**
 * Offers the desktop app, once published, to someone using a computer's
 * browser. Closing it keeps it closed on this device; the app itself, phones
 * and tablets never show it.
 */
export function DownloadBanner() {
  const mobile = useIsMobile();
  // sure: the computer is known well enough to hand it a file straight away
  const [pick, setPick] = useState<{ file: DesktopFile; sure: boolean } | null>(null);
  const [closed, setClosed] = useState(() => storage.get(DISMISSED) !== null);

  useEffect(() => {
    if (closed || mobile || desktopBridge()) return;
    let alive = true;
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
  }, [closed, mobile]);

  if (closed || mobile || !pick) return null;
  const { file, sure } = pick;
  const close = () => {
    storage.set(DISMISSED, String(Date.now()));
    setClosed(true);
  };
  return (
    <div className={s.banner} role="region" aria-label="Desktop app" data-testid="download-banner">
      <span className={s.icon}><Monitor size={18} /></span>
      <span className={s.text}>
        <b>Get Evilion Chat for {OS_NAME[file.os]}</b> — RPC support and a better experience.
      </span>
      {sure ? (
        <>
          <a className={s.download} href={desktop.fileUrl(file.name)} data-testid="download-banner-button">
            <Download size={14} /> Download <span style={{ opacity: 0.7 }}>{formatBytes(file.size)}</span>
          </a>
          <Link className={s.other} to="/download">Other platforms</Link>
        </>
      ) : (
        // a Mac that does not say which chip it has chooses between the two on the download page
        <Link className={s.download} to="/download" data-testid="download-banner-button">
          <Download size={14} /> Download
        </Link>
      )}
      <button className={s.close} aria-label="Close" title="Close" onClick={close} data-testid="download-banner-close"><X size={16} /></button>
    </div>
  );
}
