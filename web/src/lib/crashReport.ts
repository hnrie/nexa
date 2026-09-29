/**
 * Crash reporting.
 *
 * Every uncaught error, rejected promise and render crash is sent to Nexa
 * so whoever runs it can see what is breaking, instead of only the
 * person it broke for. Nothing from a conversation is included: the report is
 * the error, where in the code it came from, and which build it was.
 */

import { api } from "@/api/client";

interface Report {
  kind: "error" | "render" | "promise";
  message: string;
  stack?: string;
  component?: string;
}

/** The same crash in a loop should be one report, not hundreds. */
const seen = new Map<string, number>();
const REPEAT_MS = 60_000;
const MAX_PER_SESSION = 20;
let sent = 0;
let installed = false;

function appVersion(): string {
  try {
    return typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
  } catch {
    return "";
  }
}

/** Sends one crash, unless it is a repeat of one just sent. */
export function reportCrash(r: Report): void {
  const message = (r.message || "").slice(0, 500);
  if (!message || sent >= MAX_PER_SESSION) return;
  const key = `${r.kind}:${message}:${(r.stack ?? "").slice(0, 200)}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < REPEAT_MS) return;
  seen.set(key, now);
  sent += 1;
  void api
    .request<void>("POST", "/client-errors", {
      kind: r.kind,
      message,
      stack: (r.stack ?? "").slice(0, 4000),
      component: (r.component ?? "").slice(0, 2000),
      path: typeof location !== "undefined" ? location.pathname : "",
      version: appVersion(),
    })
    .catch(() => undefined);
}

/** Starts listening for the errors nothing else catches. */
export function installCrashReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // a failed image or script load also fires this, with no error object
    if (!e.error && !e.message) return;
    reportCrash({
      kind: "error",
      message: e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : String(e.message),
      stack: e.error instanceof Error ? (e.error.stack ?? "") : `${e.filename}:${e.lineno}:${e.colno}`,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    reportCrash({
      kind: "promise",
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason).slice(0, 200),
      stack: reason instanceof Error ? (reason.stack ?? "") : "",
    });
  });
}
