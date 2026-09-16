import { Download, Laptop, Monitor, Smartphone, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { android, androidVersionName, type AndroidRelease } from "@/api/android";
import { desktop, type DesktopFile, type DesktopRelease } from "@/api/desktop";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { currentPlatform, isAndroid, pickDownload, type DesktopTarget } from "@/lib/platform";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "./DownloadPage.module.css";

const LABEL: Record<string, string> = {
  "windows:installer": "Windows",
  "mac:installer": "macOS",
  "linux:appimage": "Linux (AppImage)",
  "linux:deb": "Linux (.deb, Debian and Ubuntu)",
};
const ARCH: Record<DesktopFile["arch"], Record<DesktopFile["os"], string>> = {
  x64: { windows: "64-bit", mac: "Intel", linux: "x86-64" },
  arm64: { windows: "ARM", mac: "Apple Silicon (M1 and later)", linux: "ARM64" },
};
const ORDER: DesktopFile["os"][] = ["windows", "mac", "linux"];

function icon(os: DesktopFile["os"]) {
  return os === "mac" ? <Laptop size={22} /> : os === "linux" ? <Terminal size={22} /> : <Monitor size={22} />;
}

/** Every desktop download, with the visitor's own first. Needs no account. */
export default function DownloadPage() {
  const [rel, setRel] = useState<DesktopRelease | null | undefined>(undefined);
  const [apk, setApk] = useState<AndroidRelease | null | undefined>(undefined);
  const [target, setTarget] = useState<DesktopTarget>({ os: null, arch: null });
  const [failed, setFailed] = useState(false);
  const onAndroid = isAndroid();
  const toast = useUI((u) => u.toast);

  useEffect(() => {
    document.title = "Download Evilion Chat";
    void currentPlatform().then(setTarget);
    desktop.latest().then(setRel, () => setFailed(true));
    android.latest().then(setApk, () => setApk(null));
  }, []);

  const mine = rel ? pickDownload(rel, target) : null;
  // a Mac that would not say which chip it has gets the other one offered too
  const otherMac = rel && mine && target.os === "mac" && target.arch === null ? rel.files.find((f) => f.os === "mac" && f.kind === "installer" && f.arch !== mine.arch) : undefined;
  const shown = rel ? rel.files.filter((f) => f.kind !== "zip").sort((a, b) => ORDER.indexOf(a.os) - ORDER.indexOf(b.os) || a.kind.localeCompare(b.kind) || a.arch.localeCompare(b.arch)) : [];
  const copyHash = (f: DesktopFile) => void navigator.clipboard?.writeText(f.sha256).then(() => toast("SHA-256 copied.", "success"));

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.head}>
          <img className={s.logo} src="/icons/icon-192.png" alt="" />
          <h1 className={s.title}>{onAndroid ? "Evilion Chat for Android" : "Evilion Chat for your computer"}</h1>
          <p className={s.sub}>{onAndroid ? "Calls, notifications and a real app." : "RPC support and a better experience."}</p>
        </div>

        {apk && onAndroid ? (
          <div className={s.primary}>
            <a className={s.bigButton} href={android.fileUrl(apk.name)} data-testid="download-android">
              <Download size={20} /> Download for Android
            </a>
            <span className={s.meta}>
              Version {apk.version} · {formatBytes(apk.size)} · Android {androidVersionName(apk.min_sdk)} and later
            </span>
          </div>
        ) : null}

        {rel === undefined && !failed ? (
          <div className={s.primary}><Spinner size={28} /></div>
        ) : failed ? (
          <div className={s.empty}>
            Downloads could not be loaded.
            <div style={{ marginTop: 8 }}><Button size="sm" variant="secondary" onClick={() => { setFailed(false); desktop.latest().then(setRel, () => setFailed(true)); }}>Try again</Button></div>
          </div>
        ) : !rel ? (
          <div className={s.empty}>The desktop app has not been published yet.</div>
        ) : (
          <>
            {mine ? (
              <div className={s.primary}>
                <a className={s.bigButton} href={desktop.fileUrl(mine.name)} data-testid="download-primary">
                  <Download size={20} /> Download for {LABEL[`${mine.os}:${mine.kind}`]?.split(" (")[0] ?? mine.os}
                </a>
                <span className={s.meta}>Version {rel.version} · {ARCH[mine.arch][mine.os]} · {formatBytes(mine.size)}</span>
                {otherMac ? (
                  <span className={s.meta}>
                    {otherMac.arch === "x64" ? "On a Mac with an Intel processor? " : "On a Mac with Apple Silicon? "}
                    <a href={desktop.fileUrl(otherMac.name)} data-testid="download-other-mac">Download that version</a>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className={s.section}>
              <h2 className={s.label}>All downloads</h2>
              <div className={s.files}>
                {shown.map((f) => (
                  <div key={f.name} className={s.file} data-mine={mine?.name === f.name} data-testid="download-file">
                    <span className={s.fileIcon}>{icon(f.os)}</span>
                    <span className={s.fileText}>
                      <span className={s.fileName}>{LABEL[`${f.os}:${f.kind}`] ?? f.name} · {ARCH[f.arch][f.os]}</span>
                      <span className={s.fileSub}>
                        {formatBytes(f.size)} · <span className={s.hash} title="Copy SHA-256" onClick={() => copyHash(f)}>SHA-256 {f.sha256.slice(0, 16)}…</span>
                      </span>
                    </span>
                    <Button size="sm" variant={mine?.name === f.name ? "primary" : "secondary"} onClick={() => { location.href = desktop.fileUrl(f.name); }}>
                      <Download size={16} /> Download
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {apk ? (
              <div className={s.section}>
                <h2 className={s.label}>Android</h2>
                <div className={s.files}>
                  <div className={s.file} data-mine={onAndroid} data-testid="download-file">
                    <span className={s.fileIcon}><Smartphone size={22} /></span>
                    <span className={s.fileText}>
                      <span className={s.fileName}>Android · {apk.abis?.includes("arm64-v8a") ? "every phone" : (apk.abis ?? []).join(", ")}</span>
                      <span className={s.fileSub}>
                        {formatBytes(apk.size)} · Android {androidVersionName(apk.min_sdk)}+ · <span className={s.hash} title="Copy SHA-256" onClick={() => void navigator.clipboard?.writeText(apk.sha256).then(() => toast("SHA-256 copied.", "success"))}>SHA-256 {apk.sha256.slice(0, 16)}…</span>
                      </span>
                    </span>
                    <Button size="sm" variant={onAndroid ? "primary" : "secondary"} onClick={() => { location.href = android.fileUrl(apk.name); }}>
                      <Download size={16} /> Download
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className={s.section}>
              <h2 className={s.label}>The first time you open it</h2>
              <ul className={s.notes}>
                <li><b>Windows</b> may say it protected your PC, because the installer isn't signed with a paid certificate: choose <b>More info</b>, then <b>Run anyway</b>.</li>
                <li><b>macOS</b>: open the disk image and drag Evilion Chat into Applications. The first time, right-click the app and choose <b>Open</b>.</li>
                <li><b>Linux</b>: make the AppImage executable (<code>chmod +x</code>) and run it; it updates itself. The .deb installs with your package manager and says when a new version is out.</li>
                {apk ? <li><b>Android</b>: the app comes from this site rather than a store, so your phone asks once whether to allow installs from your browser. Open the downloaded file and choose <b>Install</b>.</li> : null}
              </ul>
            </div>
          </>
        )}

        <div className={s.foot}>
          <Link to="/channels/@me">Open Evilion Chat in your browser</Link>
        </div>
      </div>
    </div>
  );
}
