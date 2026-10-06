/**
 * Moving on to Nexa's new address.
 *
 * The page at an address Nexa moved away from carries where Nexa is now (the
 * server marks it, see movedTag in internal/api/static.go), and goes on to the
 * same page there before it draws anything. A browser keeps a sign-in per
 * address and none is carried across: whoever was signed in at the old
 * address signs in again at the new one. The part of the link after the #
 * goes along, so an invite that carries its key there still opens.
 */
import { desktopBridge } from "@/lib/desktopBridge";

/** Where Nexa has moved to, when this page is at an address it moved away from. */
export function movedTo(): string | null {
  if (typeof document === "undefined") return null;
  const to = document.querySelector('meta[name="nexa-moved-to"]')?.getAttribute("content")?.trim();
  if (!to) return null;
  try {
    const u = new URL(to);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.origin === location.origin) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Whether `version` ("1.1.0") comes before `than`. */
export function olderThan(version: string, than: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = than.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/**
 * A desktop app from before the move opens the old address and can open no
 * other, so there the app goes on as it was until the app updates itself
 * (1.2.0 opens the new address).
 */
export function stayForOldDesktop(): boolean {
  const bridge = desktopBridge();
  return !!bridge && olderThan(bridge.version ?? "0", "1.2.0");
}

/** The same page at `origin`: its path, its query and the part after the #. */
export function movedLink(origin: string, path: string, search: string, hash: string): string {
  return origin + path + search + (hash === "#" ? "" : hash);
}

/** Goes on to the same page at Nexa's new address. */
export function moveTo(origin: string, go: (url: string) => void = (url) => location.replace(url)): void {
  go(movedLink(origin, location.pathname, location.search, location.hash));
}
