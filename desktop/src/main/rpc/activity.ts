/**
 * Cleans a Rich Presence activity the way Discord's own RPC server accepts it,
 * before the page sends it on to chatd (which checks everything again).
 */
import type { RpcActivity } from "../../shared/bridge";

const TEXT = 128;
const LINK = 256;
const IMAGE = 1024;
const LABEL = 32;
const BUTTON_URL = 512;
const TEN_YEARS = 10 * 365 * 24 * 3600 * 1000;

/** Characters that are invisible or reorder text: control characters and bidirectional overrides. */
function hidden(code: number): boolean {
  return code < 0x20 || code === 0x7f || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function line(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  let s = "";
  for (const ch of v.replace(/[\r\n\t]+/g, " ")) {
    if (!hidden(ch.codePointAt(0) ?? 0)) s += ch;
  }
  s = s.trim();
  if (!s) return undefined;
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join("").trim() : s;
}

function link(v: unknown, max: number): string | undefined {
  if (typeof v !== "string" || v.length > max) return undefined;
  try {
    const u = new URL(v.trim());
    // `https://:pw@evil.example` has an empty username and a password, so a
    // check on the username alone let it through; the server's copy of this
    // rule tests the whole userinfo, and these two should not disagree.
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function image(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= IMAGE ? v.trim() : undefined;
}

function time(v: unknown, now: number): number | undefined {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  // libraries send seconds as often as milliseconds; nothing in milliseconds is below 1e12
  const ms = Math.round(n < 1e12 ? n * 1000 : n);
  return Math.abs(ms - now) > TEN_YEARS ? undefined : ms;
}

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : undefined);

/** A cleaned activity, or null when the program cleared it or sent nothing usable. */
export function normalizeActivity(clientId: string, input: unknown, now = Date.now()): RpcActivity | null {
  const a = obj(input);
  if (!a) return null;
  const out: RpcActivity = { application_id: clientId, type: 0 };
  if (a.type === 2 || a.type === 3 || a.type === 5) out.type = a.type;
  const name = line(a.name, TEXT);
  if (name) out.name = name;
  if (a.status_display_type === 0 || a.status_display_type === 1 || a.status_display_type === 2) out.status_display_type = a.status_display_type;
  const details = line(a.details, TEXT);
  if (details) out.details = details;
  const state = line(a.state, TEXT);
  if (state) out.state = state;
  const detailsUrl = link(a.details_url, LINK);
  if (detailsUrl) out.details_url = detailsUrl;
  const stateUrl = link(a.state_url, LINK);
  if (stateUrl) out.state_url = stateUrl;

  const ts = obj(a.timestamps);
  if (ts) {
    const start = time(ts.start, now);
    let end = time(ts.end, now);
    if (start !== undefined && end !== undefined && end <= start) end = undefined;
    if (start !== undefined || end !== undefined) out.timestamps = { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
  }

  const as = obj(a.assets);
  if (as) {
    const assets: NonNullable<RpcActivity["assets"]> = {};
    const set = (k: keyof typeof assets, v: string | undefined) => {
      if (v) assets[k] = v;
    };
    set("large_image", image(as.large_image));
    set("large_text", line(as.large_text, TEXT));
    set("large_url", link(as.large_url, LINK));
    set("small_image", image(as.small_image));
    set("small_text", line(as.small_text, TEXT));
    set("small_url", link(as.small_url, LINK));
    if (Object.keys(assets).length) out.assets = assets;
  }

  const party = obj(a.party);
  if (party) {
    const p: NonNullable<RpcActivity["party"]> = {};
    const id = line(party.id, TEXT);
    if (id) p.id = id;
    const size = party.size;
    if (Array.isArray(size) && size.length === 2 && size.every((n) => Number.isInteger(n))) {
      const [cur, max] = size as [number, number];
      if (cur >= 0 && max >= 1 && cur <= max) p.size = [cur, max];
    }
    if (p.id || p.size) out.party = p;
  }

  // Discord shows the first two buttons at most, so a third never stands in for a broken one
  if (Array.isArray(a.buttons)) {
    const buttons = a.buttons
      .slice(0, 2)
      .map((b) => ({ label: line(obj(b)?.label, LABEL), url: link(obj(b)?.url, BUTTON_URL) }))
      .filter((b): b is { label: string; url: string } => !!b.label && !!b.url);
    if (buttons.length) out.buttons = buttons;
  }
  if (a.instance === true) out.instance = true;
  return out;
}
