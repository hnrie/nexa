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
  return new URL("https://nexa.fish");
}

export const BASE = baseUrl();
export const ORIGIN = BASE.origin;
export const START_URL = new URL("/channels/@me", BASE).toString();

/**
 * Where Nexa was before nexa.fish. Copies of this app from before the move
 * signed in there, and a browser keeps a sign-in per address, so the first
 * time this one starts it opens the old address once: the page there seals
 * its sign-in and moves on to the new address with it (web/src/lib/move.ts),
 * and from then on the app opens the new one (window.ts). Only for the public
 * site; a development address has nothing to move.
 */
export const MOVED_FROM: string[] = ORIGIN === "https://nexa.fish" ? ["https://chat.evilion.xyz"] : [];
export const MOVE_URL: string | null = MOVED_FROM[0] ? new URL("/channels/@me", MOVED_FROM[0]).toString() : null;

export function isMovedUrl(url: string | undefined | null): boolean {
  return MOVED_FROM.includes(originOf(url));
}

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

/**
 * The origins the page is allowed to put in an iframe.
 *
 * Exactly what the server's own `frame-src` allows (internal/api/static.go):
 * the captcha, and the privacy-preserving YouTube host embeds use. A guard
 * here that is *stricter* than the policy the page is already served under
 * does not add safety, it removes a feature — and it did: blocking every
 * off-origin subframe left Turnstile's iframe unable to load, so signing in
 * sat on "checking" for ever with no callback to fail, and every embedded
 * video went blank.
 */
const FRAMEABLE = new Set(["https://challenges.cloudflare.com", "https://www.youtube-nocookie.com"]);

export function isFrameableUrl(url: string | undefined | null): boolean {
  if (isAppUrl(url)) return true;
  const origin = originOf(url);
  // A frame the page creates itself — about:blank before a src is set, and the
  // srcdoc/data documents Turnstile builds — has no origin of its own.
  if (!origin || origin === "null") return true;
  return FRAMEABLE.has(origin);
}
