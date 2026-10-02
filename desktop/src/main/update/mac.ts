/**
 * Updates on macOS without an Apple Developer ID. The system updater
 * (Squirrel.Mac) only installs signed updates, so this one downloads the new
 * zip from Nexa, checks it against the manifest's sha512, unpacks it
 * in a temporary folder and, on restart, swaps it for the running app and
 * opens the new one. If the app cannot be replaced where it is (read-only, or run from
 * the disk image), it says so and points to the download page instead.
 */
import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { compareVersions, parseManifest, type ManifestFile } from "./manifest";

/**
 * The feed this app updates from. latest-mac.yml belongs to the copies before
 * 1.1.0, which cannot update themselves to this version: it stays at their
 * last release, and the page offers them this one as a download instead
 * (web/src/lib/macReplacement.ts).
 */
export const MAC_FEED = "latest-mac-2.yml";

export interface MacUpdate {
  version: string;
  /** The unpacked new app, ready to swap in. */
  staged: string;
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https:") ? https.get : http.get;
    get(url, { headers: { "User-Agent": `Nexa/${app.getVersion()}`, "Cache-Control": "no-cache" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`manifest answered ${res.statusCode}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        body += c;
        if (body.length > 1 << 20) res.destroy(new Error("manifest too large"));
      });
      res.on("end", () => resolve(body));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function download(url: string, dest: string, size: number, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https:") ? https.get : http.get;
    get(url, { headers: { "User-Agent": `Nexa/${app.getVersion()}` } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download answered ${res.statusCode}`));
        return;
      }
      const hash = createHash("sha512");
      const out = fs.createWriteStream(dest, { mode: 0o600 });
      let got = 0;
      res.on("data", (c: Buffer) => {
        got += c.length;
        hash.update(c);
        if (size > 0) onProgress(Math.min(1, got / size));
      });
      res.pipe(out);
      out.on("finish", () => resolve(hash.digest("base64")));
      out.on("error", reject);
      res.on("error", reject);
    }).on("error", reject);
  });
}

const run = (file: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(file, args, { timeout: 180_000 }, (err) => (err ? reject(err) : resolve())));

/** The .app bundle this process runs from. */
export function runningBundle(): string {
  return path.resolve(app.getPath("exe"), "..", "..", "..");
}

/** Whether the running app can be replaced in place. */
export function canReplace(bundle = runningBundle()): boolean {
  if (!bundle.endsWith(".app") || bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds, downloads and unpacks a newer version; null when this one is current. */
export async function stageMacUpdate(base: string, onProgress: (fraction: number) => void): Promise<MacUpdate | null> {
  const manifestUrl = new URL(MAC_FEED, base).toString();
  const manifest = parseManifest(await fetchText(manifestUrl));
  if (!manifest.version || compareVersions(manifest.version, app.getVersion()) <= 0) return null;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const file: ManifestFile | undefined = manifest.files.find((f) => f.url.endsWith(`-mac-${arch}.zip`)) ?? manifest.files.find((f) => f.url.endsWith(".zip") && f.url.includes(arch));
  if (!file) throw new Error(`no ${arch} build in version ${manifest.version}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "evilion-update-"));
  const zip = path.join(work, "update.zip");
  const digest = await download(new URL(file.url, base).toString(), zip, file.size, onProgress);
  if (digest !== file.sha512) {
    fs.rmSync(work, { recursive: true, force: true });
    throw new Error("the download does not match the release (sha512)");
  }
  const unpacked = path.join(work, "app");
  await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
  fs.rmSync(zip, { force: true });
  const staged = fs.readdirSync(unpacked).find((n) => n.endsWith(".app"));
  if (!staged) throw new Error("the update has no app inside");
  // No signature is checked: the app has none worth checking since its Apple
  // identity went, and the download already matched the release's checksum
  // above, which is what says it is the file that was published.
  const stagedApp = path.join(unpacked, staged);
  return { version: manifest.version, staged: stagedApp };
}

/**
 * Quits and lets a small script swap the bundles once this process is gone,
 * then opens the new app. The old one waits in the update's folder until the
 * new one is in place, so a failed swap puts it back where it was.
 */
export function installMacUpdate(update: MacUpdate): void {
  const bundle = runningBundle();
  const backup = `${update.staged}.previous`;
  // the update's folder in the temporary directory, which holds the unpacked app
  const work = path.dirname(path.dirname(update.staged));
  // a release that renames the app (nexa -> Nexa, Evilion Chat -> Nexa) lands under its
  // name; the swap itself still goes through the old path, so a failure puts
  // the old app back exactly where it was.
  const renamed = path.join(path.dirname(bundle), path.basename(update.staged));
  const script = `
pid=${process.pid}
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
if mv "$1" "$3"; then
  if mv "$2" "$1"; then
    xattr -dr com.apple.quarantine "$1" 2>/dev/null
    # a rename that only changes case (nexa.app -> Nexa.app) looks like a
    # collision on a case-insensitive disk, so it goes through a temporary name
    if [ "$6" != "$1" ] && { [ ! -e "$6" ] || [ "$1" -ef "$6" ]; } && mv "$1" "$1.rename" && mv "$1.rename" "$6"; then
      set -- "$6" "$2" "$3" "$4" "$5" "$6"
    fi
  else
    mv "$3" "$1"
  fi
  # the update's folder holds the old app until an app is back in its place
  [ -d "$1" ] && rm -rf "$4"
  [ -z "$5" ] && open "$1"
fi
`;
  // a test of the swap leaves the reopening out (EVILION_UPDATE_NO_RELAUNCH)
  spawn("/bin/sh", ["-c", script, "evilion-update", bundle, update.staged, backup, work, process.env.EVILION_UPDATE_NO_RELAUNCH ? "1" : "", renamed], { detached: true, stdio: "ignore" }).unref();
  app.quit();
}
