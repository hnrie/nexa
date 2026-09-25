/**
 * The search query: what someone types, read as words and filters.
 *
 * Messages are end-to-end encrypted, so the server cannot search them; this
 * device does, over what it has decrypted (src/search keeps that index).
 *
 * The syntax: plain words (every one must appear, each found by its
 * beginning), "a quoted phrase", -word to leave one out, and filters:
 *
 *   from:bob           written by someone (from:me for yourself)
 *   in:general         in a channel or conversation, by its name
 *   mentions:bob       mentioning someone (mentions:everyone too)
 *   has:image          link, image, video, audio, file, embed or sticker
 *   before:2026-01-31  sent before a day, a month (2026-01) or a year
 *   after:2026-01-31   sent after one
 *   during:2026-01     sent within one
 *   pinned:yes         pinned (or pinned:no)
 *
 * A filter's value can be quoted when it has spaces: in:"weekend plans".
 * Nothing in this file touches the DOM or React; the search worker uses it.
 */
import type { PublicUser } from "@/api/types";
import { hasKinds, searchableText, type SearchDoc } from "@/search/doc";
import { fold, highlightRuns, type Run } from "@/search/text";

export type HasKind = "link" | "image" | "video" | "audio" | "file" | "embed" | "sticker";
export const HAS_KINDS: readonly HasKind[] = ["link", "image", "video", "audio", "file", "embed", "sticker"];

export type FilterKey = "from" | "in" | "mentions" | "has" | "before" | "after" | "during" | "pinned";
export const FILTER_KEYS: readonly FilterKey[] = ["from", "in", "mentions", "has", "before", "after", "during", "pinned"];

/** One piece of a query and where it sits in the text: a word, a phrase or a filter. */
export interface QueryToken {
  kind: "term" | "phrase" | "exclude" | "filter";
  /** The filter's name, for a filter. */
  key?: FilterKey;
  /** The word, the phrase or the filter's value, as typed (without quotes). */
  value: string;
  /** Where it starts and ends in the raw query. */
  start: number;
  end: number;
  /** A filter whose value could not be read (a date that is not one, has:unicorn). */
  invalid?: boolean;
}

export interface SearchQuery {
  /** Words, lowercased, as typed. */
  terms: string[];
  phrases: string[];
  exclude: string[];
  from: string[];
  in: string[];
  mentions: string[];
  has: HasKind[];
  /** Sent at or after this (ms), from after: and during:. */
  since: number | null;
  /** Sent before this (ms), from before: and during:. */
  until: number | null;
  pinned: boolean | null;
  /** Every piece of the query in order, for the chips that read it back and for suggestions. */
  tokens: QueryToken[];
}

const EMPTY_QUERY: SearchQuery = { terms: [], phrases: [], exclude: [], from: [], in: [], mentions: [], has: [], since: null, until: null, pinned: null, tokens: [] };

/** A day, a month or a year, as the local time it starts and the one after it ends. */
export function dateRange(v: string): { start: number; end: number } | null {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] === undefined ? null : Number(m[2]);
  const day = m[3] === undefined ? null : Number(m[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  const start = new Date(year, (month ?? 1) - 1, day ?? 1);
  // Date rolls an impossible day over into the next month: 2026-02-30 would
  // quietly mean the 2nd of March. A date that does not come back as itself
  // is not a date.
  if (Number.isNaN(start.getTime()) || start.getFullYear() !== year || start.getMonth() !== (month ?? 1) - 1 || start.getDate() !== (day ?? 1)) return null;
  const end = day !== null ? new Date(year, month! - 1, day + 1) : month !== null ? new Date(year, month, 1) : new Date(year + 1, 0, 1);
  return { start: start.getTime(), end: end.getTime() };
}

function yesNo(v: string): boolean | null {
  const s = v.toLowerCase();
  if (s === "yes" || s === "true" || s === "y" || s === "1") return true;
  if (s === "no" || s === "false" || s === "n" || s === "0") return false;
  return null;
}

/** A filter with a quoted value, a quoted phrase, or anything else up to a space; an unclosed quote runs to the end. */
const PIECE = /\b(from|in|mentions|has|before|after|during|pinned):"([^"]*)"?|"([^"]*)"?|(\S+)/gi;

export function parseQuery(raw: string): SearchQuery {
  const q: SearchQuery = { ...EMPTY_QUERY, terms: [], phrases: [], exclude: [], from: [], in: [], mentions: [], has: [], tokens: [] };
  const narrow = (range: { start: number; end: number }, from: "since" | "until" | "both") => {
    if (from !== "until") q.since = q.since === null ? range.start : Math.max(q.since, range.start);
    if (from !== "since") q.until = q.until === null ? range.end : Math.min(q.until, range.end);
  };
  const filter = (key: string, value: string, start: number, end: number): boolean => {
    const k = key.toLowerCase() as FilterKey;
    if (!(FILTER_KEYS as readonly string[]).includes(k)) return false;
    const tok: QueryToken = { kind: "filter", key: k, value, start, end };
    q.tokens.push(tok);
    // a filter still being typed ("from:") narrows nothing yet
    if (!value) return true;
    const v = value.toLowerCase();
    switch (k) {
      case "from":
        q.from.push(v.replace(/^@/, ""));
        break;
      case "in":
        q.in.push(v.replace(/^[#@]/, ""));
        break;
      case "mentions":
        q.mentions.push(v.replace(/^@/, ""));
        break;
      case "has":
        if ((HAS_KINDS as readonly string[]).includes(v)) {
          if (!q.has.includes(v as HasKind)) q.has.push(v as HasKind);
        } else tok.invalid = true;
        break;
      case "pinned": {
        const yn = yesNo(v);
        if (yn === null) tok.invalid = true;
        else q.pinned = yn;
        break;
      }
      default: {
        const range = dateRange(v);
        if (!range) {
          tok.invalid = true;
          break;
        }
        // before a day is before it starts; after a day is once it is over
        if (k === "before") narrow({ start: range.start, end: range.start }, "until");
        else if (k === "after") narrow({ start: range.end, end: range.end }, "since");
        else narrow(range, "both");
      }
    }
    return true;
  };
  for (const m of raw.matchAll(PIECE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[1] !== undefined) {
      filter(m[1], m[2] ?? "", start, end);
      continue;
    }
    if (m[3] !== undefined) {
      const phrase = m[3].trim().toLowerCase();
      if (phrase) {
        q.phrases.push(phrase);
        q.tokens.push({ kind: "phrase", value: phrase, start, end });
      }
      continue;
    }
    const word = m[4]!;
    const colon = word.indexOf(":");
    if (colon > 0 && filter(word.slice(0, colon), word.slice(colon + 1), start, end)) continue;
    if (word.startsWith("-") && word.length > 1) {
      q.exclude.push(word.slice(1).toLowerCase());
      q.tokens.push({ kind: "exclude", value: word.slice(1), start, end });
    } else {
      q.terms.push(word.toLowerCase());
      q.tokens.push({ kind: "term", value: word, start, end });
    }
  }
  return q;
}

/** True when the query asks for nothing yet: no words and no filter with a value. */
export function isEmptyQuery(q: SearchQuery): boolean {
  return (
    q.terms.length === 0 &&
    q.phrases.length === 0 &&
    q.exclude.length === 0 &&
    q.from.length === 0 &&
    q.in.length === 0 &&
    q.mentions.length === 0 &&
    q.has.length === 0 &&
    q.since === null &&
    q.until === null &&
    q.pinned === null
  );
}

/** Removes one piece from the raw query, tidying the space it leaves. */
export function withoutToken(raw: string, tok: Pick<QueryToken, "start" | "end">): string {
  const before = raw.slice(0, tok.start).replace(/\s+$/, "");
  const after = raw.slice(tok.end).replace(/^\s+/, "");
  return before && after ? `${before} ${after}` : before || after;
}

/** A filter value as it goes into a query: quoted when it has a space or a quote cannot be avoided. */
export function filterValue(v: string): string {
  return /\s/.test(v) ? `"${v.replace(/"/g, "")}"` : v;
}

/** What names mean, from the stores: filters are resolved to ids before the index sees them. */
export interface SearchCtx {
  users: Record<string, PublicUser>;
  /** Other names a person goes by, lowercased: nicknames in servers, a friend nickname. */
  nicknames?: Record<string, string[]>;
  /** The names a channel answers to, lowercased: "general"; a DM's person; a group's name. */
  channelNames: Record<string, string[]>;
  /** Who is signed in, so `from:me` and `mentions:me` mean them. */
  meId?: string;
}

/** A query with its names turned into ids and its words folded: what the index is asked. */
export interface ResolvedQuery {
  terms: string[];
  phrases: string[];
  exclude: string[];
  /** Any of these authors; null for no filter. An empty list matches nothing. */
  from: string[] | null;
  /** Any of these channels, from in:; null for no filter. */
  channels: string[] | null;
  /** Mentioning any of these people; null for no filter. */
  mentions: string[] | null;
  /** mentions:everyone (or here) was asked for. */
  everyone: boolean;
  has: HasKind[];
  since: number | null;
  until: number | null;
  pinned: boolean | null;
}

function usersNamed(wanted: string, ctx: SearchCtx): string[] {
  if (wanted === "me") return ctx.meId ? [ctx.meId] : [];
  const out: string[] = [];
  for (const u of Object.values(ctx.users)) {
    if (u.id === wanted || u.username.toLowerCase() === wanted || u.display_name.toLowerCase() === wanted || (ctx.nicknames?.[u.id] ?? []).includes(wanted)) out.push(u.id);
  }
  // an id nobody has loaded is still an id
  if (out.length === 0 && /^\d+$/.test(wanted)) out.push(wanted);
  return out;
}

function channelsNamed(wanted: string, ctx: SearchCtx): string[] {
  const out: string[] = [];
  for (const [id, names] of Object.entries(ctx.channelNames)) if (id === wanted || names.includes(wanted)) out.push(id);
  return out;
}

export function resolveQuery(q: SearchQuery, ctx: SearchCtx): ResolvedQuery {
  const unique = (xs: string[]) => [...new Set(xs)];
  const mentionNames = q.mentions.filter((w) => w !== "everyone" && w !== "here");
  return {
    terms: unique(q.terms.map(fold).filter(Boolean)),
    phrases: unique(q.phrases.map(fold).filter(Boolean)),
    exclude: unique(q.exclude.map(fold).filter(Boolean)),
    from: q.from.length ? unique(q.from.flatMap((w) => usersNamed(w, ctx))) : null,
    channels: q.in.length ? unique(q.in.flatMap((w) => channelsNamed(w, ctx))) : null,
    mentions: mentionNames.length ? unique(mentionNames.flatMap((w) => usersNamed(w, ctx))) : null,
    everyone: q.mentions.length > mentionNames.length,
    has: [...q.has],
    since: q.since,
    until: q.until,
    pinned: q.pinned,
  };
}

/** Whether a resolved query has anything to look for. */
export function isEmptyResolved(r: ResolvedQuery): boolean {
  return r.terms.length === 0 && r.phrases.length === 0 && r.exclude.length === 0 && r.from === null && r.channels === null && r.mentions === null && !r.everyone && r.has.length === 0 && r.since === null && r.until === null && r.pinned === null;
}

/** The filters alone: everything but the words. Cheap, so it goes first. */
export function matchFilters(d: SearchDoc, r: ResolvedQuery): boolean {
  if (r.since !== null && d.ts < r.since) return false;
  if (r.until !== null && d.ts >= r.until) return false;
  if (r.from && !r.from.includes(d.a)) return false;
  if (r.channels && !r.channels.includes(d.c)) return false;
  if (r.pinned !== null && ((d.fl & 1) !== 0) !== r.pinned) return false;
  if (r.mentions || r.everyone) {
    const byName = r.mentions ? (d.mn ?? []).some((id) => r.mentions!.includes(id)) : false;
    if (!byName && !(r.everyone && d.ev)) return false;
  }
  if (r.has.length) {
    const kinds = hasKinds(d);
    for (const h of r.has) if (!kinds.has(h)) return false;
  }
  return true;
}

/** The words, against a message's folded searchable text. */
export function matchText(folded: string, r: ResolvedQuery): boolean {
  for (const w of r.exclude) if (folded.includes(w)) return false;
  for (const p of r.phrases) if (!folded.includes(p)) return false;
  for (const t of r.terms) if (!folded.includes(t)) return false;
  return true;
}

/** Whether a message satisfies the query. */
export function matches(d: SearchDoc, r: ResolvedQuery): boolean {
  return matchFilters(d, r) && matchText(fold(searchableText(d)), r);
}

/** What to mark in a result: the words and phrases searched for, folded. */
export function needlesOf(q: Pick<SearchQuery, "terms" | "phrases">): string[] {
  return [...q.terms, ...q.phrases].map(fold).filter(Boolean);
}

/** Splits text into highlighted and plain runs for a result. */
export function highlight(text: string, needles: string[]): Run[] {
  return highlightRuns(text, needles);
}
