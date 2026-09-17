/**
 * Captchas for the actions a bot would abuse: signing up, logging in,
 * recovering an account, sending friend requests, creating and joining
 * servers. They use Cloudflare Turnstile, which is free and usually shows a
 * person nothing at all; it only puts up a click when it is unsure.
 *
 * The server says in /instance whether they are on and with which public
 * site key. Each guarded request carries a fresh token, good for that one
 * action once.
 */

import { ApiError, api } from "@/api/client";

import { t } from "@/i18n";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/**
 * Captcha problems are ApiErrors, so every screen that already shows what
 * went wrong with a request shows these too, in words.
 */
const captchaError = (code: string, message: string): ApiError => new ApiError(0, code, message);

/** undefined until the server has been asked; null when captchas are off. */
let siteKey: string | null | undefined;
let asking: Promise<void> | null = null;

/** Asks the server whether captchas are on. The app does this once as it starts. */
export function loadCaptchaConfig(): Promise<void> {
  asking ??= api
    .request<{ captcha?: { provider?: string; site_key?: string } | null }>("GET", "/instance")
    .then((info) => {
      siteKey = info.captcha?.provider === "turnstile" && info.captcha.site_key ? info.captcha.site_key : null;
    })
    .catch(() => {
      // unknown for now: a guarded request that needs one says so, and is retried
      siteKey = undefined;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}

async function currentSiteKey(): Promise<string | null> {
  if (asking) await asking;
  return siteKey ?? null;
}

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(captchaError("captcha_unavailable", t("captcha.theCaptchaCouldNotStart"))));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(captchaError("captcha_unavailable", t("captcha.theCaptchaCouldNotLoadCheck")));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * A fresh token for one guarded request, or null when captchas are off. If
 * Turnstile wants a click, a small sheet comes up for it, with a way out.
 */
export async function captchaToken(action: string): Promise<string | null> {
  const key = await currentSiteKey();
  if (!key) return null;
  const turnstile = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.className = "captcha-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Captcha");
    const sheet = document.createElement("div");
    sheet.className = "captcha-sheet";
    const title = document.createElement("div");
    title.className = "captcha-title";
    title.textContent = t("captcha.oneQuickCheck");
    const slot = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "captcha-cancel";
    cancel.textContent = "Cancel";
    sheet.append(title, slot, cancel);
    overlay.append(sheet);
    document.body.append(overlay);

    let id = "";
    let settled = false;
    const finish = (then: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        if (id) turnstile.remove(id);
      } catch {
        /* already gone */
      }
      overlay.remove();
      then();
    };
    cancel.onclick = () => finish(() => reject(captchaError("captcha_cancelled", t("captcha.theCaptchaWasCancelled"))));
    try {
      id = turnstile.render(slot, {
        sitekey: key,
        action,
        // stays out of sight unless a click is needed
        appearance: "interaction-only",
        callback: (token: string) => finish(() => resolve(token)),
        "error-callback": () => finish(() => reject(captchaError("captcha_failed", t("captcha.theCaptchaCheckFailedPleaseTry")))),
        "timeout-callback": () => finish(() => reject(captchaError("captcha_failed", t("captcha.theCaptchaTimedOutPleaseTry")))),
        "before-interactive-callback": () => overlay.classList.add("captcha-shown"),
        "after-interactive-callback": () => overlay.classList.remove("captcha-shown"),
      });
    } catch {
      finish(() => reject(captchaError("captcha_unavailable", t("captcha.theCaptchaCouldNotStart"))));
    }
  });
}

/**
 * Sends a guarded request with a token when captchas are on. If the server
 * turned them on after this page loaded, it says so, and the request is sent
 * once more with one.
 */
export async function guarded<T>(action: string, send: (captcha: string | null) => Promise<T>): Promise<T> {
  try {
    return await send(await captchaToken(action));
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "captcha_required" || siteKey) throw err;
    await loadCaptchaConfig();
    if (!siteKey) throw err;
    return send(await captchaToken(action));
  }
}
