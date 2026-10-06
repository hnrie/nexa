/**
 * Captchas for the actions a bot would abuse: signing up, logging in,
 * recovering an account, sending friend requests, creating and joining
 * servers, a first message to a stranger, bug reports; and for what a stolen
 * session would be used for: a new username, password or recovery key,
 * turning two-factor off, deleting the account. They use Cloudflare
 * Turnstile, which is free and usually shows a person nothing at all; it only
 * puts up a click when it is unsure. The routes that ask for one name the
 * action on their refusal, and the API client solves it and asks again
 * (api.captchaSolver), so a guarded request needs no handling of its own.
 *
 * The server says in /instance whether they are on and with which public
 * site key. Each guarded request carries a fresh token, good for that one
 * action once.
 */

import { ApiError, api } from "@/api/client";
import { setPublicUrl } from "@/lib/appLinks";

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
    .request<{ captcha?: { provider?: string; site_key?: string } | null; public_url?: string }>("GET", "/instance")
    .then((info) => {
      siteKey = info.captcha?.provider === "turnstile" && info.captcha.site_key ? info.captcha.site_key : null;
      // the same answer says which address links to Nexa use
      setPublicUrl(info.public_url);
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
    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      // A blocker that stubs the script still fires load. Without letting the
      // memo go, every later captcha awaits this same rejected promise, and
      // signing in, recovering an account and joining a server stay broken
      // until the page is reloaded.
      loading = null;
      script.remove();
      reject(captchaError("captcha_unavailable", t("captcha.theCaptchaCouldNotStart")));
    };
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
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", t("captcha.label"));
    const sheet = document.createElement("div");
    sheet.className = "captcha-sheet";
    // focusable itself, so moving focus here announces the sheet
    sheet.tabIndex = -1;
    const title = document.createElement("div");
    title.className = "captcha-title";
    title.textContent = t("captcha.oneQuickCheck");
    const slot = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "captcha-cancel";
    cancel.textContent = t("chat.editMessage.cancel");
    sheet.append(title, slot, cancel);
    overlay.append(sheet);
    document.body.append(overlay);

    let id = "";
    let settled = false;
    // where focus was before the sheet asked for it, to hand it back
    let before: HTMLElement | null = null;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || !overlay.classList.contains("captcha-shown")) return;
      e.preventDefault();
      e.stopPropagation();
      cancelIt();
    };
    const finish = (then: () => void): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      try {
        if (id) turnstile.remove(id);
      } catch {
        /* already gone */
      }
      const hadFocus = overlay.contains(document.activeElement);
      overlay.remove();
      if (hadFocus && before?.isConnected) before.focus();
      then();
    };
    const cancelIt = (): void => finish(() => reject(captchaError("captcha_cancelled", t("captcha.theCaptchaWasCancelled"))));
    cancel.onclick = cancelIt;
    // Escape leaves it, as it leaves every other sheet in the app; caught
    // before the page's own handlers, which would close something underneath
    document.addEventListener("keydown", onKey, true);
    // The sheet comes up over the form while focus stays on the button that
    // asked for it: a keyboard user tabbed on into the form, and a screen
    // reader said nothing. Focus moves into it when it shows, and back after.
    const show = (): void => {
      overlay.classList.add("captcha-shown");
      before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      sheet.focus();
    };
    try {
      id = turnstile.render(slot, {
        sitekey: key,
        action,
        // stays out of sight unless a click is needed
        appearance: "interaction-only",
        callback: (token: string) => finish(() => resolve(token)),
        "error-callback": () => finish(() => reject(captchaError("captcha_failed", t("captcha.theCaptchaCheckFailedPleaseTry")))),
        "timeout-callback": () => finish(() => reject(captchaError("captcha_failed", t("captcha.theCaptchaTimedOutPleaseTry")))),
        "before-interactive-callback": show,
        "after-interactive-callback": () => overlay.classList.remove("captcha-shown"),
      });
    } catch {
      finish(() => reject(captchaError("captcha_unavailable", t("captcha.theCaptchaCouldNotStart"))));
    }
  });
}

/**
 * A token for an action the server asked one for, on a request sent without
 * one (api.captchaSolver): null when captchas are off here, in which case the
 * server's refusal stands.
 */
async function solveFor(action: string): Promise<string | null> {
  if (siteKey === undefined) await loadCaptchaConfig();
  if (!siteKey) return null;
  return captchaToken(action);
}
api.captchaSolver = solveFor;

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
