import { Download, Laptop, Monitor, Smartphone, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { desktop, type DesktopFile, type DesktopRelease } from "@/api/desktop";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { currentPlatform, noDesktopBuild, pickDownload, type DesktopTarget } from "@/lib/platform";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "./DownloadPage.module.css";

import { t, Tr } from "@/i18n";
/** The name each build goes by, per render so it follows the language. */
function labels(): Record<string, string> {
  return {
    "windows:installer": "Windows",
    "mac:installer": "macOS",
    "linux:appimage": t("download.linuxAppImage"),
    "linux:deb": t("download.linuxDeb"),
  };
}
function arches(): Record<DesktopFile["arch"], Record<DesktopFile["os"], string>> {
  return {
    x64: { windows: t("download.arch64Bit"), mac: "Intel", linux: "x86-64" },
    arm64: { windows: "ARM", mac: t("download.appleSiliconM1"), linux: "ARM64" },
  };
}
const ORDER: DesktopFile["os"][] = ["windows", "mac", "linux"];

function icon(os: DesktopFile["os"]) {
  return os === "mac" ? <Laptop size={22} /> : os === "linux" ? <Terminal size={22} /> : <Monitor size={22} />;
}

/** Every desktop download, with the visitor's own first. Needs no account. */
export default function DownloadPage() {
  const [rel, setRel] = useState<DesktopRelease | null | undefined>(undefined);
  const [target, setTarget] = useState<DesktopTarget>({ os: null, arch: null });
  const [failed, setFailed] = useState(false);
  // A phone or a tablet runs Nexa in its browser; the page still lists every
  // installer, for the computer the visitor may be choosing one for.
  const [handheld] = useState(noDesktopBuild);
  const toast = useUI((u) => u.toast);

  const loadDesktop = () => {
    setFailed(false);
    desktop.latest().then(setRel, () => setFailed(true));
  };

  useEffect(() => {
    document.title = t("download.downloadNexa");
    void currentPlatform().then(setTarget);
    loadDesktop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = rel ? pickDownload(rel, target) : null;
  // a Mac that would not say which chip it has gets the other one offered too
  const otherMac = rel && mine && target.os === "mac" && target.arch === null ? rel.files.find((f) => f.os === "mac" && f.kind === "installer" && f.arch !== mine.arch) : undefined;
  const shown = rel ? rel.files.filter((f) => f.kind !== "zip").sort((a, b) => ORDER.indexOf(a.os) - ORDER.indexOf(b.os) || a.kind.localeCompare(b.kind) || a.arch.localeCompare(b.arch)) : [];
  // A clipboard write rejects in a non-secure context and when the permission
  // is refused; with no catch the success toast simply never came and nothing
  // was said at all.
  const copyText = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast(t("download.sha256Copied"), "success"),
      () => toast(t("download.theHashCouldNotBeCopied"), "error"),
    );
  const copyHash = (f: DesktopFile) => copyText(f.sha256);

  return (
    <div className={s.page}>
      <main className={s.card}>
        <div className={s.head}>
          <img className={s.logo} src="/icons/icon-192.png" alt="" />
          <h1 className={s.title}>{t("download.nexaForYourComputer")}</h1>
          <p className={s.sub}>{t("download.rpcSupportAndABetterExperience")}</p>
        </div>

        {handheld ? (
          <div className={s.handheld} data-testid="download-handheld">
            <Smartphone size={20} aria-hidden />
            <span>{t("download.onAPhoneOrTablet")}</span>
          </div>
        ) : null}

        {rel === undefined && !failed ? (
          <div className={s.primary}><Spinner size={28} label={t("download.loadingDownloads")} /></div>
        ) : failed ? (
          <div className={s.empty} role="alert">
            {t("download.theDownloadsCouldNotBeLoaded")}
            <div style={{ marginTop: 8 }}><Button size="sm" variant="secondary" onClick={loadDesktop}>{t("chat.messageList.tryAgain")}</Button></div>
          </div>
        ) : !rel ? (
          <div className={s.empty}>{t("download.theDesktopAppHasNotBeen")}</div>
        ) : (
          <>
            {mine ? (
              <div className={s.primary}>
                <a className={s.bigButton} href={desktop.fileUrl(mine.name)} data-testid="download-primary">
                  <Download size={20} /> {t("download.downloadFor", { what: labels()[`${mine.os}:${mine.kind}`]?.split(" (")[0] ?? mine.os })}
                </a>
                <span className={s.meta}>{t("download.versionLine", { version: rel.version })} · {arches()[mine.arch][mine.os]} · {formatBytes(mine.size)}</span>
                {otherMac ? (
                  <span className={s.meta}>
                    {otherMac.arch === "x64" ? `${t("download.onIntelMac")} ` : `${t("download.onAppleSilicon")} `}
                    <a href={desktop.fileUrl(otherMac.name)} data-testid="download-other-mac">{t("download.downloadThatVersion")}</a>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className={s.section}>
              <h2 className={s.label}>{t("download.allDownloads")}</h2>
              <div className={s.files}>
                {shown.map((f) => (
                  <div key={f.name} className={s.file} data-mine={mine?.name === f.name} data-testid="download-file">
                    <span className={s.fileIcon}>{icon(f.os)}</span>
                    <span className={s.fileText}>
                      <span className={s.fileName}>{labels()[`${f.os}:${f.kind}`] ?? f.name} · {arches()[f.arch][f.os]}</span>
                      <span className={s.fileSub}>
                        {formatBytes(f.size)} · <button type="button" className={s.hash} title={t("download.copySha256")} aria-label={t("download.copySha256")} onClick={() => copyHash(f)}>SHA-256 {f.sha256.slice(0, 16)}…</button>
                      </span>
                    </span>
                    <Button size="sm" variant={mine?.name === f.name ? "primary" : "secondary"} onClick={() => { location.href = desktop.fileUrl(f.name); }}>
                      <Download size={16} /> {t("chat.attachments.download")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className={s.section}>
              <h2 className={s.label}>{t("download.theFirstTimeYouOpenIt")}</h2>
              <ul className={s.notes}>
                <li><Tr id="download.firstRunWindows" values={{ windows: <b>{t("download.windows")}</b>, moreInfo: <b>{t("download.moreInfo")}</b>, runAnyway: <b>{t("download.runAnyway")}</b> }} /></li>
                <li><Tr id="download.firstRunMac" values={{ macos: <b>macOS</b>, open: <b>{t("chat.lockedChannel.open")}</b> }} /></li>
                <li><Tr id="download.firstRunLinux" values={{ linux: <b>{t("download.linux")}</b>, chmod: <code>{t("download.chmodX")}</code> }} /></li>
              </ul>
            </div>
          </>
        )}

        <div className={s.foot}>
          <Link to="/channels/@me">{t("download.openNexaInYourBrowser")}</Link>
        </div>

      </main>
    </div>
  );
}
