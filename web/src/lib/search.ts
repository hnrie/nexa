/**
 * Client-side message search. Messages are end-to-end encrypted, so the
 * server cannot index them; we search what this device has decrypted.
 *
 * Query syntax (Discord-style): plain words (all must match), "quoted phrase",
 * from:@user or from:username, in:#channel, has:link|image|file|sticker|embed,
 * before:YYYY-MM-DD, after:YYYY-MM-DD, -word to exclude, mentions:@user.
 */
import type { PublicUser } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";

export interface SearchQuery {
  terms: string[];
  phrases: string[];
  exclude: string[];
  from: string[];
  in: string[];
  has: ("link" | "image" | "file" | "sticker" | "embed")[];
  mentions: string[];
  before: number | null;
  after: number | null;
}

const EMPTY: SearchQuery = { terms: [], phrases: [], exclude: [], from: [], in: [], has: [], mentions: [], before: null, after: null };

function parseDate(v: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (Number.isNaN(d.getTime())) return null;
  // Date rolls an impossible day over into the next month: 2026-02-30 would
  // quietly search from the 2nd of March. A date that does not come back as
  // itself is not a date.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

export function parseQuery(raw: string): SearchQuery {
  const q: SearchQuery = { ...EMPTY, terms: [], phrases: [], exclude: [], from: [], in: [], has: [], mentions: [] };
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) {
      if (m[1].trim()) q.phrases.push(m[1].trim().toLowerCase());
      continue;
    }
    const tok = m[2]!;
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const key = tok.slice(0, colon).toLowerCase();
      const val = tok.slice(colon + 1);
      if (!val) continue;
      switch (key) {
        case "from":
          q.from.push(val.replace(/^@/, "").toLowerCase());
          continue;
        case "in":
          q.in.push(val.replace(/^#/, "").toLowerCase());
          continue;
        case "has": {
          const v = val.toLowerCase();
          if (v === "link" || v === "image" || v === "file" || v === "sticker" || v === "embed") q.has.push(v);
          continue;
        }
        case "mentions":
          q.mentions.push(val.replace(/^@/, "").toLowerCase());
          continue;
        case "before":
          q.before = parseDate(val, false);
          continue;
        case "after":
          q.after = parseDate(val, true);
          continue;
        default:
          break;
      }
    }
    if (tok.startsWith("-") && tok.length > 1) q.exclude.push(tok.slice(1).toLowerCase());
    else q.terms.push(tok.toLowerCase());
  }
  return q;
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return q.terms.length === 0 && q.phrases.length === 0 && q.from.length === 0 && q.in.length === 0 && q.has.length === 0 && q.mentions.length === 0 && q.before === null && q.after === null && q.exclude.length === 0;
}

export interface SearchCtx {
  users: Record<string, PublicUser>;
  /** channel id → lowercase name, for in: */
  channelNames: Record<string, string>;
  /** Optional member nicknames by user id (lowercase). */
  nicknames?: Record<string, string>;
  /** Who is signed in, so `from:me` and `mentions:me` mean them. */
  meId?: string;
}

const URL_RE = /https?:\/\/\S+/i;

function userMatches(uid: string, wanted: string, ctx: SearchCtx): boolean {
  if (wanted === "me" && ctx.meId) return uid === ctx.meId;
  const u = ctx.users[uid];
  if (!u) return uid === wanted;
  return u.username.toLowerCase() === wanted || u.display_name.toLowerCase() === wanted || (ctx.nicknames?.[uid] ?? "") === wanted || uid === wanted;
}

/** Whether one decrypted message satisfies the query. */
export function matches(msg: DecryptedMessage, q: SearchQuery, ctx: SearchCtx): boolean {
  if (msg.type.startsWith("system_")) return false;
  const text = (msg.payload?.t ?? "").toLowerCase();
  if (q.before !== null && msg.created_at > q.before) return false;
  if (q.after !== null && msg.created_at < q.after) return false;
  if (q.from.length && !q.from.some((w) => userMatches(msg.author_id, w, ctx))) return false;
  if (q.in.length && !q.in.some((w) => (ctx.channelNames[msg.channel_id] ?? "") === w || msg.channel_id === w)) return false;
  if (q.mentions.length && !q.mentions.some((w) => msg.mentions.some((id) => userMatches(id, w, ctx)) || (w === "everyone" && msg.mention_everyone))) return false;
  for (const h of q.has) {
    const att = msg.payload?.att ?? [];
    const ok =
      h === "link" ? URL_RE.test(text) :
      h === "image" ? att.some((a) => a.type.startsWith("image/")) || (msg.payload?.embeds ?? []).some((e) => (e as { type?: string }).type === "image" || (e as { type?: string }).type === "gif") :
      h === "file" ? att.length > 0 :
      h === "sticker" ? !!msg.payload?.sticker :
      (msg.payload?.embeds?.length ?? 0) > 0;
    if (!ok) return false;
  }
  for (const w of q.exclude) if (text.includes(w)) return false;
  for (const p of q.phrases) if (!text.includes(p)) return false;
  for (const t of q.terms) if (!text.includes(t)) return false;
  return true;
}

/** Search a set of messages; newest first. */
export function search(msgs: Iterable<DecryptedMessage>, q: SearchQuery, ctx: SearchCtx, limit = 200): DecryptedMessage[] {
  const out: DecryptedMessage[] = [];
  for (const m of msgs) if (matches(m, q, ctx)) out.push(m);
  out.sort((a, b) => b.created_at - a.created_at);
  return out.slice(0, limit);
}

/** Splits text into highlighted and plain runs for the result list. */
export function highlight(text: string, q: SearchQuery): { text: string; hit: boolean }[] {
  const needles = [...q.terms, ...q.phrases].filter(Boolean);
  if (needles.length === 0) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    let best: { at: number; len: number } | null = null;
    for (const n of needles) {
      const at = lower.indexOf(n, i);
      if (at >= 0 && (!best || at < best.at)) best = { at, len: n.length };
    }
    if (!best) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (best.at > i) out.push({ text: text.slice(i, best.at), hit: false });
    out.push({ text: text.slice(best.at, best.at + best.len), hit: true });
    i = best.at + best.len;
  }
  return out;
}
