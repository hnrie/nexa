/**
 * What to offer while someone types a search: the "auto fill".
 *
 * It looks at the piece of the query the caret is in. In a filter being typed
 * it offers what that filter takes: people for from: and mentions:,
 * conversations for in:, kinds of thing for has:, days and months for the
 * dates, yes or no for pinned:. In a plain word it offers the filters that
 * word begins (fr: from:) and, once it could be a name, the person or the
 * conversation it names. In an empty box it offers the last few searches and
 * the filters there are.
 *
 * Choosing one gives back the whole new query and where the caret goes.
 */
import type { Channel } from "@/api/types";
import { FILTER_KEYS, HAS_KINDS, filterValue, parseQuery, type FilterKey, type HasKind } from "@/lib/search";
import { fold } from "@/search/text";
import type { Names } from "./scope";

export type SuggestionKind = "recent" | "key" | "person" | "everyone" | "channel" | "has" | "date" | "pickDate" | "pinned";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  /** The query once this is chosen. */
  text: string;
  /** Where the caret goes in it. */
  caret: number;
  /** The filter it fills in, or offers. */
  key?: FilterKey;
  /** The value it puts in: a username, a channel, a kind, a date. */
  value?: string;
  userId?: string;
  channel?: Channel;
  has?: HasKind;
  /** For a date: the day, month or year it stands for. */
  date?: { start: number; unit: "day" | "month" | "year"; relative?: "today" | "yesterday" | "thisMonth" | "lastMonth" | "thisYear" };
  /** For a recent search: the search. */
  recent?: string;
}

export interface SuggestionGroup {
  kind: "recent" | "keys" | "people" | "conversations" | "kinds" | "dates" | "pinned" | "filters";
  items: Suggestion[];
}

export interface SuggestInput {
  raw: string;
  caret: number;
  names: Names;
  /** Conversations in:, the scope's own first. */
  channels: Channel[];
  /** People to offer first: those in the conversation being searched. */
  nearby: string[];
  recent: string[];
  now: number;
}

/** The piece of the query the caret is in: a filter's value, or a word. */
export interface Partial {
  key: FilterKey | null;
  value: string;
  start: number;
  end: number;
}

export function partialAt(raw: string, caret: number): Partial | null {
  for (const tok of parseQuery(raw).tokens) {
    if (caret < tok.start || caret > tok.end) continue;
    if (tok.kind === "filter") return { key: tok.key!, value: tok.value, start: tok.start, end: tok.end };
    if (tok.kind === "term") return { key: null, value: tok.value, start: tok.start, end: tok.end };
    return null;
  }
  return null;
}

/** Puts `insert` where the piece was; a finished filter gets a space after it, ready for the next word. */
export function replacePiece(raw: string, p: Pick<Partial, "start" | "end">, insert: string, finished: boolean): { text: string; caret: number } {
  const before = raw.slice(0, p.start);
  const after = raw.slice(p.end);
  if (!finished) return { text: before + insert + after, caret: before.length + insert.length };
  const rest = after.replace(/^\s+/, "");
  const text = `${before}${insert} ${rest}`;
  return { text, caret: before.length + insert.length + 1 };
}

const LIMIT = 8;

/** Matches a name by its beginning first, then anywhere in it; -1 for no match. */
function rank(name: string, wanted: string): number {
  const n = fold(name);
  if (!wanted) return 1;
  if (n.startsWith(wanted)) return 3;
  if (n.split(/[\s._-]+/).some((w) => w.startsWith(wanted))) return 2;
  return n.includes(wanted) ? 1 : -1;
}

function people(input: SuggestInput, wanted: string): { id: string; score: number }[] {
  const { users } = input.names;
  const scored: { id: string; score: number }[] = [];
  const near = new Set(input.nearby);
  for (const u of Object.values(users)) {
    const nicks = input.names.ctx.nicknames?.[u.id] ?? [];
    const score = Math.max(rank(u.username, wanted), rank(u.display_name, wanted), ...nicks.map((n) => rank(n, wanted)));
    if (score < 0) continue;
    // the people of the conversation being searched come first
    scored.push({ id: u.id, score: score + (near.has(u.id) ? 10 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || input.names.person(a.id).localeCompare(input.names.person(b.id)));
  return scored;
}

function conversations(input: SuggestInput, wanted: string): Channel[] {
  const out: { ch: Channel; score: number; order: number }[] = [];
  input.channels.forEach((ch, order) => {
    const label = input.names.channel(ch).replace(/^[#@]/, "");
    const score = Math.max(rank(label, wanted), ...(input.names.ctx.channelNames[ch.id] ?? []).map((n) => rank(n, wanted)));
    if (score >= 0) out.push({ ch, score, order });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.map((x) => x.ch);
}

/** The value in: puts in for a conversation: a DM by its person's username, anything else by its name. */
export function channelValue(ch: Channel, names: Names): string {
  if (ch.type === "dm") {
    const other = ch.recipient_ids.find((id) => id !== names.meId);
    const u = other ? names.users[other] : undefined;
    if (u) return u.username;
  }
  const label = names.channel(ch).replace(/^#/, "");
  return filterValue(label || ch.id);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoMonth = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function dates(now: number): { value: string; date: NonNullable<Suggestion["date"]> }[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const year = new Date(today.getFullYear(), 0, 1);
  return [
    { value: isoDay(today), date: { start: today.getTime(), unit: "day", relative: "today" } },
    { value: isoDay(yesterday), date: { start: yesterday.getTime(), unit: "day", relative: "yesterday" } },
    { value: isoMonth(month), date: { start: month.getTime(), unit: "month", relative: "thisMonth" } },
    { value: isoMonth(lastMonth), date: { start: lastMonth.getTime(), unit: "month", relative: "lastMonth" } },
    { value: String(today.getFullYear()), date: { start: year.getTime(), unit: "year", relative: "thisYear" } },
  ];
}

export function suggest(input: SuggestInput): SuggestionGroup[] {
  const { raw, caret } = input;
  const groups: SuggestionGroup[] = [];
  if (!raw.trim()) {
    const recent = input.recent.slice(0, 5).map((r, i): Suggestion => ({ id: `recent-${i}`, kind: "recent", text: r, caret: r.length, recent: r }));
    if (recent.length) groups.push({ kind: "recent", items: recent });
    groups.push({ kind: "keys", items: FILTER_KEYS.map((key): Suggestion => ({ id: `key-${key}`, kind: "key", key, text: `${raw.trimEnd()}${raw.trim() ? " " : ""}${key}:`, caret: raw.trimEnd().length + (raw.trim() ? 1 : 0) + key.length + 1 })) });
    return groups;
  }
  const p = partialAt(raw, caret);
  if (!p) return groups;
  const wanted = fold(p.value.replace(/^[@#]/, ""));
  const fill = (key: FilterKey, value: string) => replacePiece(raw, p, `${key}:${value}`, true);

  if (p.key === "from" || p.key === "mentions") {
    const items: Suggestion[] = [];
    const me = input.names.meId;
    // "me" is always a way to say yourself
    if (me && (!wanted || "me".startsWith(wanted))) items.push({ id: `${p.key}-me`, kind: "person", key: p.key, value: "me", userId: me, ...fill(p.key, "me") });
    if (p.key === "mentions" && (!wanted || "everyone".startsWith(wanted))) items.push({ id: "mentions-everyone", kind: "everyone", key: "mentions", value: "everyone", ...fill("mentions", "everyone") });
    for (const { id } of people(input, wanted)) {
      if (items.length >= LIMIT) break;
      if (id === me && items.some((s) => s.value === "me")) continue;
      const u = input.names.users[id]!;
      items.push({ id: `${p.key}-${id}`, kind: "person", key: p.key, value: u.username, userId: id, ...fill(p.key, u.username) });
    }
    if (items.length) groups.push({ kind: "people", items });
    return groups;
  }
  if (p.key === "in") {
    const items = conversations(input, wanted)
      .slice(0, LIMIT)
      .map((ch): Suggestion => {
        const value = channelValue(ch, input.names);
        return { id: `in-${ch.id}`, kind: "channel", key: "in", value, channel: ch, ...fill("in", value) };
      });
    if (items.length) groups.push({ kind: "conversations", items });
    return groups;
  }
  if (p.key === "has") {
    const items = HAS_KINDS.filter((h) => h.startsWith(wanted)).map((h): Suggestion => ({ id: `has-${h}`, kind: "has", key: "has", value: h, has: h, ...fill("has", h) }));
    if (items.length) groups.push({ kind: "kinds", items });
    return groups;
  }
  if (p.key === "pinned") {
    const items = (["yes", "no"] as const).filter((v) => v.startsWith(wanted)).map((v): Suggestion => ({ id: `pinned-${v}`, kind: "pinned", key: "pinned", value: v, ...fill("pinned", v) }));
    if (items.length) groups.push({ kind: "pinned", items });
    return groups;
  }
  if (p.key === "before" || p.key === "after" || p.key === "during") {
    const key = p.key;
    const items = dates(input.now)
      .filter((d) => !wanted || d.value.startsWith(wanted))
      .map((d): Suggestion => ({ id: `${key}-${d.value}`, kind: "date", key, value: d.value, date: d.date, ...fill(key, d.value) }));
    // and a calendar, for any other day
    items.push({ id: `${key}-pick`, kind: "pickDate", key, text: raw, caret });
    groups.push({ kind: "dates", items });
    return groups;
  }
  // A plain word: the filters it could be the start of, and once it could be
  // a name, the person or conversation it names.
  const keys = FILTER_KEYS.filter((k) => wanted && k.startsWith(wanted) && k !== wanted).map((key): Suggestion => ({ id: `key-${key}`, kind: "key", key, ...replacePiece(raw, p, `${key}:`, false) }));
  if (keys.length) groups.push({ kind: "keys", items: keys });
  if (wanted.length >= 2) {
    const items: Suggestion[] = [];
    for (const { id } of people(input, wanted).slice(0, 3)) {
      const u = input.names.users[id]!;
      items.push({ id: `from-${id}`, kind: "person", key: "from", value: u.username, userId: id, ...replacePiece(raw, p, `from:${u.username}`, true) });
    }
    for (const ch of conversations(input, wanted).slice(0, 2)) {
      const value = channelValue(ch, input.names);
      items.push({ id: `in-${ch.id}`, kind: "channel", key: "in", value, channel: ch, ...replacePiece(raw, p, `in:${value}`, true) });
    }
    if (items.length) groups.push({ kind: "filters", items });
  }
  return groups;
}

/** Every suggestion in the order the arrow keys go through them. */
export function flat(groups: SuggestionGroup[]): Suggestion[] {
  return groups.flatMap((g) => g.items);
}
