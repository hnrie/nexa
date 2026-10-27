/**
 * Which Nexa the app opens: the public one, or another given in
 * EVILION_URL while developing. Everything the page may do through the app is
 * allowed for this origin only.
 */
import { app } from "electron";

/** Development and test overrides never change an installed app. */
export function testHook(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name];
}

function baseUrl(): URL {
  // Only while developing. A packaged app that honoured this would let
  // anything able to set an environment variable point it at a page of its
  // choosing — and that page would get the bridge, plus the camera,
  // microphone and screen-recording grants macOS has already given this
  // bundle by name.
  const raw = testHook("EVILION_URL")?.trim();
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
 * hCaptcha (hcaptcha.com and its subdomains), and the privacy-preserving
 * YouTube host embeds use. Cloudflare's Turnstile, the captcha before
 * hCaptcha, stays allowed: an app updated before its server moves to hCaptcha
 * still shows that server's captcha, and the server's own frame-src lets the
 * page frame only the one it uses. A guard
 * here that is *stricter* than the policy the page is already served under
 * does not add safety, it removes a feature — and it did: blocking every
 * off-origin subframe left the captcha's iframe unable to load, so signing in
 * sat on "checking" for ever with no callback to fail, and every embedded
 * video went blank.
 */
const FRAMEABLE = new Set(["https://hcaptcha.com", "https://challenges.cloudflare.com", "https://www.youtube-nocookie.com"]);

/** https://*.hcaptcha.com, as the server's frame-src writes it. */
const isHCaptcha = (origin: string): boolean => /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.hcaptcha\.com$/.test(origin);

export function isFrameableUrl(url: string | undefined | null): boolean {
  if (isAppUrl(url)) return true;
  const origin = originOf(url);
  // A frame the page creates itself — about:blank before a src is set, and the
  // srcdoc/data documents a captcha builds — has no origin of its own.
  if (!origin || origin === "null") return true;
  return FRAMEABLE.has(origin) || isHCaptcha(origin);
}
