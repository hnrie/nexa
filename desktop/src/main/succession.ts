/**
 * Taking over from an older Nexa on macOS.
 *
 * The Mac app before 1.1.0 only installs updates signed with a key that is
 * lost, so people download this version and open it (the page inside the old
 * app offers the download: web/src/lib/macReplacement.ts). That usually
 * happens straight from the disk image, with the old app still running in the
 * menu bar, and two things would go wrong on their own. The two copies share a
 * profile, and with it the single-instance lock, so this one would only bring
 * the old window forward and quit; and Finder cannot replace an app that is
 * running. So, when this copy is not in Applications:
 *
 * - any older Nexa that is running is asked to quit before this one takes the
 *   lock (retireOlderCopies), and
 * - once the page is up, this copy offers to move itself into Applications,
 *   where Electron's mover puts the older copy in the Trash and opens the
 *   moved app (offerMoveToApplications).
 *
 * Everyone stays signed in: the profile is the same one.
 */
import { app, dialog, type BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SettingsStore } from "./settings";
import { nativeStrings } from "./strings";
import { compareVersions } from "./update/manifest";

type Log = (msg: string, extra?: Record<string, unknown>) => void;

export interface Copy {
  pid: number;
  /** The .app bundle it runs from. */
  bundle: string;
}

/**
 * The copies of this app that `ps -axww -o pid=,comm=` lists (each process's
 * program, without its arguments), other than this process: main processes
 * only, which run `<bundle>.app/Contents/MacOS/<exe>` (a helper runs from a
 * bundle inside the app's Frameworks, so its path holds a second ".app/").
 */
export function runningCopies(ps: string, exe: string, self: number): Copy[] {
  const copies: Copy[] = [];
  for (const line of ps.split("\n")) {
    const m = /^\s*(\d+)\s+(\/(?:(?!\.app\/).)+\.app)\/Contents\/MacOS\/([^/]+)$/.exec(line.trimEnd());
    if (!m || m[3] !== exe || Number(m[1]) === self) continue;
    copies.push({ pid: Number(m[1]), bundle: m[2]! });
  }
  return copies;
}

/** The version in an Info.plist as electron-builder writes it (XML), or null. */
export function plistVersion(plist: string): string | null {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]?.trim() ?? null;
}

/** The .app bundle this process runs from. */
export function runningBundle(): string {
  return path.resolve(app.getPath("exe"), "..", "..", "..");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits without an event loop, which does not run yet this early. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Asks every older copy of Nexa that is running to quit (SIGTERM, which
 * Electron takes as a quit, so Rich Presence gives Discord's socket back), and
 * waits for it to go, forcing it after five seconds. Runs before this copy
 * takes the single-instance lock. A copy of this version or a newer one is left
 * alone: then this one is the second launch it should be.
 */
export function retireOlderCopies(log: Log): void {
  if (process.platform !== "darwin" || app.isInApplicationsFolder()) return;
  let ps: string;
  try {
    ps = execFileSync("/bin/ps", ["-axww", "-o", "pid=,comm="], { encoding: "utf8", timeout: 5000 });
  } catch (err) {
    log("could not list running apps", { err: String(err) });
    return;
  }
  const me = runningBundle();
  const older = runningCopies(ps, path.basename(app.getPath("exe")), process.pid).filter((c) => {
    if (c.bundle === me) return false;
    let version: string | null = null;
    try {
      version = plistVersion(fs.readFileSync(path.join(c.bundle, "Contents", "Info.plist"), "utf8"));
    } catch {
      /* gone already, or not readable: leave it */
    }
    return version !== null && compareVersions(version, app.getVersion()) < 0;
  });
  if (older.length === 0) return;
  for (const c of older) {
    log("asking an older copy to quit", { pid: c.pid, bundle: c.bundle });
    try {
      process.kill(c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + 5000;
  while (older.some((c) => alive(c.pid)) && Date.now() < deadline) sleep(100);
  for (const c of older.filter((c) => alive(c.pid))) {
    log("forcing an older copy to quit", { pid: c.pid });
    try {
      process.kill(c.pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  // the lock it held is taken over once it is gone
  sleep(300);
}

/**
 * Offers to move this copy into Applications, in the page's language once it
 * has sent its words over. An older copy there goes to the Trash; the moved
 * app opens by itself. Turning it down is remembered for this copy.
 */
export async function offerMoveToApplications(settings: SettingsStore, win: BrowserWindow | null, log: Log): Promise<void> {
  if (process.platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) return;
  const here = runningBundle();
  if (settings.get("declinedMove") === here) return;
  const s = nativeStrings();
  const replacing = fs.existsSync(path.join("/Applications", path.basename(here)));
  const options = {
    type: "info" as const,
    message: s.moveTitle,
    detail: replacing ? `${s.moveBody}\n\n${s.moveReplaceBody}` : s.moveBody,
    buttons: [s.moveButton, s.notNow],
    defaultId: 0,
    cancelId: 1,
  };
  const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
  // a test of the move answers for the person (EVILION_MOVE_ANSWER=move or not-now)
  const answer = process.env.EVILION_MOVE_ANSWER;
  const { response } = answer ? { response: answer === "move" ? 0 : 1 } : parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response !== 0) {
    settings.set({ declinedMove: here }, { now: true });
    return;
  }
  settings.flush();
  let moved = false;
  try {
    // an older copy in the way is not running any more (retireOlderCopies), so it goes to the Trash
    moved = app.moveToApplicationsFolder({ conflictHandler: (conflict) => conflict === "exists" });
  } catch (err) {
    log("moving into Applications failed", { err: String(err) });
  }
  if (!moved) await dialog.showMessageBox({ type: "warning", message: s.moveFailed, buttons: ["OK"] });
}
