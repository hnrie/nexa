import { Download, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktopBridge } from "@/lib/desktopBridge";
import { useDesktop } from "@/stores/desktop";
import s from "./DownloadBanner.module.css";

/**
 * Tells someone in the desktop app that a new version is out, across the top
 * of the app, as soon as the app's minute-by-minute check finds it. Download
 * installs it: straight away once it has been fetched in the background, or
 * as soon as that finishes. A build that cannot update itself (a .deb, a Mac
 * app run from somewhere it cannot be replaced) opens the download page.
 * Closing it hides it until a newer version still comes along.
 */
export function UpdateBanner() {
  const update = useDesktop((x) => x.update);
  const [closed, setClosed] = useState<string | null>(null);
  // Download was pressed while the new version was still coming down
  const [installWhenReady, setInstallWhenReady] = useState(false);
  const bridge = desktopBridge();

  useEffect(() => {
    if (installWhenReady && update?.status === "ready") void desktopBridge()?.updates.restart();
  }, [installWhenReady, update?.status]);

  if (!bridge || !update) return null;
  const found = update.status === "downloading" || update.status === "ready" || (update.status === "manual" && !!update.downloadUrl);
  if (!found || closed === (update.version ?? "")) return null;

  const downloading = update.status === "downloading";
  const waiting = downloading && installWhenReady;
  const download = () => {
    if (update.status === "ready") void bridge.updates.restart();
    else if (update.status === "manual" && update.downloadUrl) window.open(update.downloadUrl, "_blank", "noopener");
    else setInstallWhenReady(true);
  };
  const percent = Math.round((update.progress ?? 0) * 100);

  return (
    <div className={s.banner} role="region" aria-label="Update" data-testid="update-banner">
      <span className={s.icon}><Sparkles size={18} /></span>
      <span className={s.text}>
        <b>A new version is here</b>
        {update.version ? <span style={{ opacity: 0.8 }}> — nexa {update.version}</span> : null}
      </span>
      <button className={s.download} onClick={download} disabled={waiting} data-testid="update-banner-download">
        <Download size={14} /> {waiting ? `Downloading… ${percent}%` : "Download"}
      </button>
      <button className={s.close} aria-label="Close" title="Close" onClick={() => setClosed(update.version ?? "")} data-testid="update-banner-close"><X size={16} /></button>
    </div>
  );
}
