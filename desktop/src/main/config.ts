/**
 * Which Evilion Chat the app opens: the public one, or another given in
 * EVILION_URL (a local server while testing). Everything the page may do
 * through the app is allowed for this origin only.
 */

function baseUrl(): URL {
  const raw = process.env.EVILION_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) return u;
    } catch {
      /* fall back to the public site */
    }
  }
  return new URL("https://chat.evilion.xyz");
}

export const BASE = baseUrl();
export const ORIGIN = BASE.origin;
export const START_URL = new URL("/channels/@me", BASE).toString();

/** The origin of any URL, or "" when it is not one. */
export function originOf(url: string | undefined | null): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function isAppUrl(url: string | undefined | null): boolean {
  return originOf(url) === ORIGIN;
}
