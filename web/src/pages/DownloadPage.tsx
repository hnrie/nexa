import { Download, Laptop, Monitor, Smartphone, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { android, androidVersionName, builds, type AndroidFile, type AndroidRelease } from "@/api/android";
import { desktop, type DesktopFile, type DesktopRelease } from "@/api/desktop";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { currentAndroidAbi, currentPlatform, isAndroid, pickAndroid, pickDownload, type DesktopTarget } from "@/lib/platform";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "./DownloadPage.module.css";

import { t } from "@/i18n";
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

/**
 * What each Android build is for, in words somebody can act on. The APK's own
 * name for a processor — `armeabi-v7a` — tells a reader nothing about whether
 * it is the one their phone wants.
 */
function abiLabel(abi: string): string {
  const named: Record<string, string> = {
    universal: t("download.abi.universal"),
    "arm64-v8a": t("download.abi.arm64"),
    "armeabi-v7a": t("download.abi.arm32"),
    x86_64: t("download.abi.x64"),
    x86: t("download.abi.x86"),
  };
  return named[abi] ?? abi;
}

function icon(os: DesktopFile["os"]) {
  return os === "mac" ? <Laptop size={22} /> : os === "linux" ? <Terminal size={22} /> : <Monitor size={22} />;
}

/** Every desktop download, with the visitor's own first. Needs no account. */
export default function DownloadPage() {
  const [rel, setRel] = useState<DesktopRelease | null | undefined>(undefined);
  const [apk, setApk] = useState<AndroidRelease | null | undefined>(undefined);
  const [target, setTarget] = useState<DesktopTarget>({ os: null, arch: null });
  const [failed, setFailed] = useState(false);
  // Which APK this phone wants. Asking the browser is a promise that most
  // browsers never answer, so the page starts on the universal build — which
  // runs anywhere — and narrows to the right one if an answer arrives.
  const [abi, setAbi] = useState<string | null>(null);
  // Offline, a 500 and a CORS refusal all used to collapse into `apk === null`,
  // which the page then stated as a fact about the product: "The Android app is
  // being worked on and is not available to download at the moment." It is
  // published, so that sentence is now simply untrue. A request that failed
  // says it failed.
  const [apkFailed, setApkFailed] = useState(false);
  // The Android build the visitor tapped. Set while the rough-edges warning is
  // up; downloading only starts from that dialog's own button.
  const [warnApk, setWarnApk] = useState<AndroidFile | null>(null);
  const onAndroid = isAndroid();
  const toast = useUI((u) => u.toast);

  const loadDesktop = () => {
    setFailed(false);
    desktop.latest().then(setRel, () => setFailed(true));
  };
  const loadAndroid = () => {
    setApkFailed(false);
    android.latest().then(
      (r) => {
        setApk(r);
        setApkFailed(false);
      },
      () => {
        setApk(null);
        setApkFailed(true);
      },
    );
  };

  useEffect(() => {
    document.title = t("download.downloadNexa");
    void currentPlatform().then(setTarget);
    void currentAndroidAbi().then(setAbi);
    loadDesktop();
    loadAndroid();
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
  // The universal build is 39 MB; the one for a phone's own processor is about
  // a third of that, and so is every update after it. The server publishes all
  // four and this page used to offer only the big one.
  const apkFiles: AndroidFile[] = apk ? builds(apk) : [];
  const myApk = apk ? pickAndroid(apk, abi) : null;

  return (
    <div className={s.page}>
      <main className={s.card}>
        <div className={s.head}>
          <img className={s.logo} src="/icons/icon-192.png" alt="" />
          <h1 className={s.title}>{onAndroid ? t("download.nexaForAndroid") : t("download.nexaForYourComputer")}</h1>
          <p className={s.sub}>{onAndroid ? t("download.callsNotificationsAndARealApp") : t("download.rpcSupportAndABetterExperience")}</p>
        </div>

        {/* The fetch failed; the app may well be published and this page simply could not ask. */}
        {onAndroid && apkFailed ? (
          <div className={s.empty} data-testid="android-failed" role="alert">
            {t("download.theAndroidDownloadCouldNotBe")}
            <div style={{ marginTop: 8 }}><Button size="sm" variant="secondary" onClick={loadAndroid}>{t("chat.messageList.tryAgain")}</Button></div>
          </div>
        ) : null}

        {/* Nothing published for Android right now: say so rather than leave a page with no download on it. */}
        {onAndroid && apk === null && !apkFailed && apk !== undefined ? (
          <div className={s.empty} data-testid="android-paused">
            {t("download.theAndroidAppIsBeingWorked")}
          </div>
        ) : null}

        {apk && myApk && onAndroid ? (
          <div className={s.primary}>
            <a className={s.bigButton} href={android.fileUrl(myApk.name)} data-testid="download-android" data-abi={myApk.abi} onClick={(e) => { e.preventDefault(); setWarnApk(myApk); }}>
              <Download size={20} /> {t("download.downloadForAndroid")}
            </a>
            <span className={s.meta}>
              {t("download.versionLine", { version: apk.version })} · {formatBytes(myApk.size)} · {t("download.androidMin", { version: androidVersionName(apk.min_sdk) })}
              {myApk.abi === "universal" ? "" : ` · ${abiLabel(myApk.abi)}`}
            </span>
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

            {apk ? (
              <div className={s.section}>
                <h2 className={s.label}>{t("download.android")}</h2>
                {apkFiles.length > 1 ? <p className={s.meta} style={{ textAlign: "start", margin: 0 }}>{t("download.aBuildForYourOwnProcessor")}</p> : null}
                <div className={s.files}>
                  {apkFiles.map((f) => (
                    <div key={f.name} className={s.file} data-mine={onAndroid && myApk?.name === f.name} data-abi={f.abi} data-testid="download-file">
                      <span className={s.fileIcon}><Smartphone size={22} /></span>
                      <span className={s.fileText}>
                        <span className={s.fileName}>{t("download.android")} · {abiLabel(f.abi)}</span>
                        <span className={s.fileSub}>
                          {formatBytes(f.size)} · {t("download.androidMin", { version: androidVersionName(apk.min_sdk) })} · <button type="button" className={s.hash} title={t("download.copySha256")} aria-label={t("download.copySha256")} onClick={() => copyText(f.sha256)}>SHA-256 {f.sha256.slice(0, 16)}…</button>
                        </span>
                      </span>
                      <Button size="sm" variant={onAndroid && myApk?.name === f.name ? "primary" : "secondary"} onClick={() => setWarnApk(f)}>
                        <Download size={16} /> {t("chat.attachments.download")}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={s.section}>
              <h2 className={s.label}>{t("download.theFirstTimeYouOpenIt")}</h2>
              <ul className={s.notes}>
                <li><b>{t("download.windows")}</b> may say it protected your PC, because the installer isn't signed with a paid certificate: choose <b>{t("download.moreInfo")}</b>, then <b>{t("download.runAnyway")}</b>.</li>
                <li><b>macOS</b>: open the disk image and drag Nexa into Applications. The first time, right-click the app and choose <b>{t("chat.lockedChannel.open")}</b>.</li>
                <li><b>{t("download.linux")}</b>: make the AppImage executable (<code>{t("download.chmodX")}</code>{t("download.andRunItItUpdatesItself")}</li>
                {apk ? <li><b>{t("download.android")}</b>: the app comes from this site rather than a store, so your phone asks once whether to allow installs from your browser. Open the downloaded file and choose <b>{t("settings.stickers.install")}</b>.</li> : null}
              </ul>
            </div>
          </>
        )}

        <div className={s.foot}>
          <Link to="/channels/@me">{t("download.openNexaInYourBrowser")}</Link>
        </div>

        {/* Android is not polished yet: nobody starts that download without
            being told so first, in the same dialog style as everywhere else. */}
        {warnApk ? (
          <Modal
            open
            onClose={() => setWarnApk(null)}
            title={t("download.androidWarningTitle")}
            width={460}
            footer={
              <>
                <Button variant="ghost" onClick={() => setWarnApk(null)}>{t("chat.editMessage.cancel")}</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    location.href = android.fileUrl(warnApk.name);
                    setWarnApk(null);
                  }}
                >
                  {t("download.androidWarningDownload")}
                </Button>
              </>
            }
          >
            <div style={{ color: "var(--text)", fontSize: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <span>{t("download.androidWarningBody")}</span>
              <span>
                {t("download.androidWarningWeb")}{" "}
                <a href="https://evilion.xyz/login" target="_blank" rel="noreferrer noopener">{t("download.androidWarningWebLink")}</a>
              </span>
            </div>
          </Modal>
        ) : null}
      </main>
    </div>
  );
}
