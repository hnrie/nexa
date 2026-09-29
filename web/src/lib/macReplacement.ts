/**
 * The Mac desktop app before 1.1.0 cannot update itself to later versions:
 * its updater reads latest-mac.yml, which stays at its last release (see
 * desktop/src/main/update/mac.ts). So inside it, once 1.1.0 or later is
 * published, the page offers the new version as a download. Opened, the new
 * app quits the old one and moves itself into Applications in its place
 * (desktop/src/main/succession.ts).
 */
import { useEffect, useState } from "react";
import { desktop, type DesktopFile, type DesktopRelease } from "@/api/desktop";
import { desktopBridge } from "@/lib/desktopBridge";
import { currentPlatform, pickDownload } from "@/lib/platform";

/** The first Mac version that updates itself. */
export const SELF_UPDATING = "1.1.0";

/** -1, 0 or 1 as a is older than, the same as, or newer than b (x.y.z; a pre-release sorts below its release). */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? "" };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** Whether this page runs inside a Mac app too old to update itself. */
export function inOldMacApp(): boolean {
  const bridge = desktopBridge();
  return !!bridge && bridge.platform === "darwin" && compareVersions(bridge.version, SELF_UPDATING) < 0;
}

export interface Replacement {
  version: string;
  /** The disk image to download, as an absolute address the browser can open. */
  url: string;
}

/** The disk image a published release offers this Mac, or null when it has nothing for it. */
export function replacementIn(rel: DesktopRelease | null, arch: DesktopFile["arch"] | null, origin: string): Replacement | null {
  if (!rel || compareVersions(rel.version, SELF_UPDATING) < 0) return null;
  const file = pickDownload(rel, { os: "mac", arch });
  return file ? { version: rel.version, url: new URL(desktop.fileUrl(file.name), origin).toString() } : null;
}

/** How often the old app looks again for the new one. */
const EVERY_MS = 60 * 60 * 1000;

/** The new version on offer while this page runs inside the old Mac app. */
export function useMacReplacement(): Replacement | null {
  const [offer, setOffer] = useState<Replacement | null>(null);
  useEffect(() => {
    if (!inOldMacApp()) return;
    let alive = true;
    const look = () =>
      Promise.all([desktop.latest(), currentPlatform()])
        .then(([rel, target]) => {
          if (alive) setOffer(replacementIn(rel, target.arch, window.location.origin));
        })
        .catch(() => undefined);
    void look();
    const timer = setInterval(() => void look(), EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return offer;
}
