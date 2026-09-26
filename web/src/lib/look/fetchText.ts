import { t } from "@/i18n";

/**
 * Fetching a stylesheet or a plugin from a link, on this device. Only https:
 * a plain http link can be changed by anyone on the way, and what comes back
 * from it runs with the person's whole account. Credentials and the referrer
 * are left off, so the site learns nothing about who asked.
 */

export const MAX_LINK_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type FetchFailure = "https" | "network" | "status" | "html" | "size" | "empty" | "timeout";

export class FetchError extends Error {
  constructor(
    readonly reason: FetchFailure,
    readonly status = 0,
  ) {
    super(`fetch failed: ${reason}${status ? ` ${status}` : ""}`);
  }
}

/** The address as a URL when it is one Nexa will load from: https and nothing else. */
export function checkLink(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname) return null;
  // user:password@ in a link is never needed for a public file and hides where it really goes
  if (url.username || url.password) return null;
  return url;
}

export async function fetchText(raw: string, maxBytes = MAX_LINK_BYTES): Promise<string> {
  const url = checkLink(raw);
  if (!url) throw new FetchError("https");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.href, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow", mode: "cors", signal: abort.signal });
  } catch {
    clearTimeout(timer);
    throw new FetchError(abort.signal.aborted ? "timeout" : "network");
  }
  try {
    // a redirect may not leave https either
    if (res.url && !res.url.startsWith("https:")) throw new FetchError("https");
    if (!res.ok) throw new FetchError("status", res.status);
    const type = res.headers.get("content-type") ?? "";
    if (/html|xml/i.test(type)) throw new FetchError("html");
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new FetchError("size");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new FetchError("size");
    const text = new TextDecoder().decode(bytes);
    if (!text.trim()) throw new FetchError("empty");
    // a page that says it is text but is not: an error page, a login wall
    if (/^\s*<(!doctype|html)/i.test(text)) throw new FetchError("html");
    return text;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError(abort.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

/** What went wrong, said so the person knows what to do about it. */
export function fetchFailure(reason: FetchFailure, status = 0): string {
  switch (reason) {
    case "https":
      return t("look.fetch.https");
    case "status":
      return t("look.fetch.status", { status });
    case "html":
      return t("look.fetch.html");
    case "size":
      return t("look.fetch.size");
    case "empty":
      return t("look.fetch.empty");
    case "timeout":
      return t("look.fetch.timeout");
    default:
      return t("look.fetch.network");
  }
}
