/**
 * Keeping the app up to date from Evilion Chat's own server.
 *
 * Windows (NSIS) and the Linux AppImage use electron-updater; the Mac build
 * uses its own updater (see mac.ts); a .deb can only be told there is a new
 * version. Checks run shortly after start and every six hours; downloads
 * happen in the background and install on restart.
 */
import { app, net } from "electron";
import { EventEmitter } from "node:events";
import type { UpdateState } from "../../shared/bridge";
import { compareVersions, parseManifest } from "./manifest";
import { canReplace, installMacUpdate, stageMacUpdate, type MacUpdate } from "./mac";

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 3600_000;

type AutoUpdater = typeof import("electron-updater").autoUpdater;

export declare interface Updater {
  on(event: "state", listener: (s: UpdateState) => void): this;
}

export class Updater extends EventEmitter {
  state: UpdateState = { status: "idle" };
  private timer: ReturnType<typeof setInterval> | null = null;
  private auto: AutoUpdater | null = null;
  private mac: MacUpdate | null = null;
  private busy = false;

  constructor(
    /** Where releases are published, e.g. https://chat.evilion.xyz/desktop/ */
    private readonly feed: string,
    /** The download page, for builds that cannot update themselves. */
    private readonly downloadPage: string,
    private readonly quitForUpdate: (install: () => void) => void,
    private readonly log: (msg: string, extra?: Record<string, unknown>) => void,
  ) {
    super();
  }

  private get kind(): "auto" | "mac" | "manual" {
    if (process.platform === "darwin") return "mac";
    if (process.platform === "win32" || (process.platform === "linux" && process.env.APPIMAGE)) return "auto";
    return "manual";
  }

  start(): void {
    if (!app.isPackaged && !process.env.EVILION_UPDATE_TEST) return;
    setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.check(), EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(next: UpdateState): void {
    this.state = { ...next, lastCheck: next.lastCheck ?? this.state.lastCheck };
    this.emit("state", this.state);
  }

  async check(): Promise<void> {
    if (this.busy || this.state.status === "ready") return;
    this.busy = true;
    this.set({ status: "checking", lastCheck: Date.now() });
    try {
      if (this.kind === "auto") await this.checkAuto();
      else if (this.kind === "mac") await this.checkMac();
      else await this.checkManual();
    } catch (err) {
      this.log("update check failed", { err: String(err) });
      this.set({ status: "error", error: err instanceof Error ? err.message : String(err), lastCheck: Date.now() });
    } finally {
      this.busy = false;
    }
  }

  private async checkAuto(): Promise<void> {
    if (!this.auto) {
      const { autoUpdater } = await import("electron-updater");
      autoUpdater.setFeedURL({ provider: "generic", url: this.feed });
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.logger = null;
      autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", version: this.state.version, progress: p.percent / 100 }));
      autoUpdater.on("update-downloaded", (info) => this.set({ status: "ready", version: info.version, lastCheck: Date.now() }));
      autoUpdater.on("error", (err) => this.set({ status: "error", error: err.message, lastCheck: Date.now() }));
      this.auto = autoUpdater;
    }
    const result = await this.auto.checkForUpdates();
    const version = result?.updateInfo.version;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      this.set({ status: "idle", lastCheck: Date.now() });
      return;
    }
    this.set({ status: "downloading", version, progress: 0 });
    // the download runs on; "update-downloaded" marks it ready
    await result?.downloadPromise;
  }

  private async checkMac(): Promise<void> {
    const newer = await this.newerThanRunning("latest-mac.yml");
    if (!newer) {
      this.set({ status: "idle", lastCheck: Date.now() });
      return;
    }
    if (!canReplace()) {
      this.set({ status: "manual", version: newer, downloadUrl: this.downloadPage, lastCheck: Date.now() });
      return;
    }
    this.set({ status: "downloading", version: newer, progress: 0 });
    const staged = await stageMacUpdate(this.feed, (progress) => this.set({ status: "downloading", version: newer, progress }));
    if (!staged) {
      this.set({ status: "idle", lastCheck: Date.now() });
      return;
    }
    this.mac = staged;
    this.set({ status: "ready", version: staged.version, lastCheck: Date.now() });
  }

  private async checkManual(): Promise<void> {
    const newer = await this.newerThanRunning("latest-linux.yml");
    this.set(newer ? { status: "manual", version: newer, downloadUrl: this.downloadPage, lastCheck: Date.now() } : { status: "idle", lastCheck: Date.now() });
  }

  private async newerThanRunning(manifest: string): Promise<string | null> {
    const res = await net.fetch(new URL(manifest, this.feed).toString(), { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`update server answered ${res.status}`);
    const m = parseManifest(await res.text());
    return m.version && compareVersions(m.version, app.getVersion()) > 0 ? m.version : null;
  }

  /** Restarts into the downloaded update. */
  restart(): void {
    if (this.state.status !== "ready") return;
    if (this.kind === "mac" && this.mac) {
      const staged = this.mac;
      this.quitForUpdate(() => installMacUpdate(staged));
      return;
    }
    if (this.auto) {
      const auto = this.auto;
      this.quitForUpdate(() => auto.quitAndInstall(true, true));
    }
  }
}
