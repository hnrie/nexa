/**
 * Which Nexa the app opens: the public one, or another given in
 * EVILION_URL while developing. Everything the page may do through the app is
 * allowed for this origin only.
 */
import { app } from "electron";

function baseUrl(): URL {
  // Only while developing. A packaged app that honoured this would let
  // anything able to set an environment variable point it at a page of its
  // choosing — and that page would get the bridge, plus the camera,
  // microphone and screen-recording grants macOS has already given this
  // bundle by name.
  const raw = app.isPackaged ? "" : process.env.EVILION_URL?.trim();
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
