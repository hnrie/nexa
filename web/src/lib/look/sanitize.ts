import { checkLink } from "./fetchText";
import type { CssLink, CustomCss, PluginEntry, PluginMeta } from "./types";

/**
 * Limits on what the look settings may hold, and the checks that hold them to
 * it. These travel in the encrypted settings blob, which is uploaded again on
 * every change (drafts live there) and capped at 1 MiB by the server, so
 * anything that could be big is kept on the device instead and only its
 * address and hash travel: stylesheets and plugin code from links. What must
 * travel, because there is nowhere else it lives, is capped.
 */
export const MAX_SNIPPET_BYTES = 64 * 1024;
export const MAX_LINKS = 20;
export const MAX_PLUGINS = 30;
export const MAX_PASTED_PLUGIN_BYTES = 64 * 1024;
/** All pasted plugins together. */
export const MAX_PASTED_TOTAL_BYTES = 256 * 1024;
export const MAX_PLUGIN_SETTINGS_BYTES = 8 * 1024;

const ID = /^[a-z0-9]{10}$/;
const HASH = /^[0-9a-f]{64}$/;

export function newLookId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

function sanitizeLink(v: unknown): CssLink | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !ID.test(r["id"])) return null;
  if (typeof r["url"] !== "string" || r["url"].length > 2048 || !checkLink(r["url"])) return null;
  return { id: r["id"], url: r["url"], enabled: r["enabled"] !== false, addedAt: typeof r["addedAt"] === "number" ? r["addedAt"] : 0 };
}

export function sanitizeCustomCss(v: unknown): CustomCss {
  const r = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const links: CssLink[] = [];
  for (const item of Array.isArray(r["links"]) ? r["links"] : []) {
    const link = sanitizeLink(item);
    if (!link || seen.has(link.id)) continue;
    seen.add(link.id);
    links.push(link);
    if (links.length >= MAX_LINKS) break;
  }
  return { snippet: typeof r["snippet"] === "string" ? r["snippet"] : "", snippetOn: r["snippetOn"] !== false, links };
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeMeta(v: unknown): PluginMeta | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const name = text(r["name"], 80).trim();
  if (!name) return null;
  return { name, description: text(r["description"], 400), version: text(r["version"], 32), author: text(r["author"], 80) };
}

/** A plugin's saved setting values: plain JSON only, and not too much of it. */
export function sanitizeValues(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (k.length > 64) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[k] = typeof value === "string" ? value.slice(0, 2000) : value;
  }
  return JSON.stringify(out).length > MAX_PLUGIN_SETTINGS_BYTES ? {} : out;
}

function sanitizePlugin(v: unknown): PluginEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !ID.test(r["id"])) return null;
  if (typeof r["hash"] !== "string" || !HASH.test(r["hash"])) return null;
  const source = r["source"] === "code" ? "code" : r["source"] === "url" ? "url" : null;
  if (!source) return null;
  const url = typeof r["url"] === "string" && r["url"].length <= 2048 && checkLink(r["url"]) ? r["url"] : null;
  const code = typeof r["code"] === "string" ? r["code"] : null;
  if (source === "url" && !url) return null;
  if (source === "code" && !code) return null;
  return {
    id: r["id"],
    source,
    url: source === "url" ? url : null,
    code: source === "code" ? code : null,
    hash: r["hash"],
    enabled: r["enabled"] === true,
    settings: sanitizeValues(r["settings"]),
    meta: sanitizeMeta(r["meta"]),
    addedAt: typeof r["addedAt"] === "number" ? r["addedAt"] : 0,
  };
}

export function sanitizePlugins(v: unknown): PluginEntry[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PluginEntry[] = [];
  for (const item of v) {
    const p = sanitizePlugin(item);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_PLUGINS) break;
  }
  return out;
}

/** A name for a stylesheet from its address: the file's name, or the site's. */
export function linkName(url: string): string {
  try {
    const u = new URL(url);
    const file = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return file || u.hostname;
  } catch {
    return url;
  }
}
