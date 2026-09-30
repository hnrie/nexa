import type { Emoji } from "@/api/types";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { querySearch, useSearchIndex } from "@/search/indexer";
import { useMessages } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { popularity } from "./emojiPopular";
import { customKey, rankedKeys, scoreOf, unicodeKey, usageFromHistory, withUse, type EmojiUsage } from "./emojiUsage";
import { ensureShortcodes, onShortcodesReady, shortcodesReady } from "./shortcodes";

/**
 * Smart emoji suggestions: what the message box offers after a ":".
 *
 * A bare ":" offers the emoji this account uses most (emojiUsage.ts), then
 * the ones the picker last sent, then a few everybody reaches for. A few
 * letters match a name by the start of any of its words as well as by its
 * own start, so ":hea" finds broken_heart and ":heart" finds it among the
 * first; then by several words' starts, by initials and, for three letters
 * or more, anywhere inside. Among matches about as good, what this account
 * uses goes first, and then what is common everywhere (emojiPopular.ts), so
 * the emoji someone most likely means by those letters comes first.
 */

/** A suggestion: one of Unicode's, or a custom one (a server's, or a pack's), `own` when it is this server's. */
export type EmojiCandidate = { kind: "emoji"; entry: EmojiEntry } | { kind: "customEmoji"; emoji: Emoji; own?: boolean };

/** A suggestion with the name it goes by in the list: the code that matched what was typed, which is not always its first. */
export type EmojiSuggestion = EmojiCandidate & { name: string };

/** The group of Unicode's emoji the flags are in. */
const FLAGS = 9;

/** Offered after a bare ":" to someone who has not used any yet. */
export const STARTER_EMOJI = ["👍", "😂", "❤️", "😭", "🙏", "🔥", "😊", "🎉"];

/** How many suggestions show. */
export const SUGGESTIONS = 10;

/** A name's words: split at underscores, dashes and spaces, and where a lower-case letter meets a capital. */
export function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean);
}

/**
 * How well one name answers a query, higher for better; -1 for not at all.
 * The whole name, then a whole word of it, then its start or the start of
 * any word in it (as good as each other, nearly: "hea" is as much the start
 * of broken_heart's "heart" as of heartbeat), then several words' starts in
 * order ("brok_hea"), then its words' initials, then, for three letters or
 * more, anywhere inside a word.
 */
export function nameMatch(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return -1;
  if (n === q) return 100;
  // a longer name that matches as well is a little further from what was typed
  const tail = Math.min(4, (n.length - q.length) * 0.2);
  const words = wordsOf(name);
  if (words.includes(q)) return 90 - tail;
  if (n.startsWith(q)) return 88 - tail;
  if (words.some((w) => w.startsWith(q))) return 86 - tail;
  const parts = q.split(/[\s_\-]+/).filter(Boolean);
  if (parts.length > 1) {
    let at = 0;
    const found = parts.every((p) => {
      while (at < words.length && !words[at]!.startsWith(p)) at++;
      return at++ < words.length;
    });
    if (found) return 80 - tail;
  }
  if (q.length >= 2 && q.length <= words.length && words.slice(0, q.length).every((w, i) => w[0] === q[i])) return 64;
  if (q.length >= 3 && n.includes(q)) return 34 - tail;
  return -1;
}

/** How far an emoji's use lifts it: nothing when unused, and more the more it is used, up to a point. */
export function useBoost(score: number): number {
  return score > 0 ? Math.min(70, 25 + 12 * Math.log2(1 + score)) : 0;
}

function keyOf(c: EmojiCandidate): string {
  return c.kind === "emoji" ? unicodeKey(c.entry.unicode) : customKey(c.emoji.blob_id);
}

/** The name an emoji goes by when nothing was typed: its first code, or its own name. */
function shownName(c: EmojiCandidate): string {
  return c.kind === "customEmoji" ? c.emoji.name : (c.entry.shortcodes[0] ?? c.entry.label);
}

/** How well an emoji answers a query, and by which of its codes; -1 for not at all. */
function matchOf(c: EmojiCandidate, query: string): { score: number; name: string } {
  if (c.kind === "customEmoji") return { score: nameMatch(c.emoji.name, query), name: c.emoji.name };
  let score = -1;
  let name = shownName(c);
  for (const sc of c.entry.shortcodes) {
    const m = nameMatch(sc, query);
    if (m > score) {
      score = m;
      name = sc;
    }
  }
  // Its name in words ("smiling face with smiling eyes") well behind its
  // codes: a match through it shows a code that says nothing of what was
  // typed, so it has to be worth it.
  const label = nameMatch(c.entry.label, query);
  if (label >= 0 && label - 8 > score) score = label - 8;
  const q = query.toLowerCase();
  for (const tag of c.entry.tags) {
    if (tag === q) score = Math.max(score, 56);
    else if (q.length >= 3 && tag.startsWith(q)) score = Math.max(score, 40);
  }
  // a country's flag is found by its name, but a short query is rarely a
  // country, and two letters are the start of a dozen of them
  if (c.entry.group === FLAGS && score >= 0 && score < 100) score -= 8;
  return { score, name };
}

/** How far everyday use lifts one of Unicode's emoji; a custom one is lifted by its use here alone. */
function commonness(c: EmojiCandidate): number {
  return c.kind === "emoji" ? popularity(c.entry.unicode) : 0;
}

export interface SuggestInput {
  /** What was typed after the colon; empty for a bare ":". */
  query: string;
  /** Every emoji to choose from, custom ones first as the box lists them. */
  candidates: EmojiCandidate[];
  usage: EmojiUsage;
  /** The picker's recent row, newest first. */
  recent: readonly string[];
  now: number;
  limit?: number;
}

/** The suggestions, best first. */
export function suggestEmoji({ query, candidates, usage, recent, now, limit = SUGGESTIONS }: SuggestInput): EmojiSuggestion[] {
  const recentAt = new Map(recent.map((u, i) => [unicodeKey(u), i] as const));
  const lift = (c: EmojiCandidate) => {
    const key = keyOf(c);
    const r = recentAt.get(key);
    return Math.max(useBoost(scoreOf(usage[key], now)), r === undefined ? 0 : Math.max(0, 18 - r));
  };
  if (!query) {
    const byKey = new Map<string, EmojiCandidate>();
    for (const c of candidates) if (!byKey.has(keyOf(c))) byKey.set(keyOf(c), c);
    const order = [...rankedKeys(usage, now), ...recent.map(unicodeKey), ...STARTER_EMOJI.map(unicodeKey)];
    const out: EmojiSuggestion[] = [];
    const seen = new Set<string>();
    for (const key of order) {
      const c = byKey.get(key);
      if (!c || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, name: shownName(c) });
      if (out.length >= limit) break;
    }
    return out;
  }
  const scored: { c: EmojiCandidate; name: string; s: number; i: number }[] = [];
  candidates.forEach((c, i) => {
    const m = matchOf(c, query);
    if (m.score < 0) return;
    // this server's own emoji, by a hair: its :name: is the one a message here gets
    scored.push({ c, name: m.name, s: m.score + lift(c) + commonness(c) + (c.kind === "customEmoji" && c.own ? 2 : 0), i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const out: EmojiSuggestion[] = [];
  const seen = new Set<string>();
  for (const { c, name } of scored) {
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, name });
    if (out.length >= limit) break;
  }
  return out;
}

/** How many of this account's own newest messages the history is learned from. */
export const HISTORY_MESSAGES = 3000;
/** How long to wait for the :name: table before reading history without it. */
const NAMES_WAIT_MS = 4000;

let learning: Promise<boolean> | null = null;

/** The :name: table, so a name typed out in an old message counts as its emoji; gives up waiting after a while. */
function shortcodeNames(): Promise<void> {
  if (shortcodesReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, NAMES_WAIT_MS);
    const off = onShortcodesReady(done);
    ensureShortcodes();
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

/**
 * Teaches smart suggestions what this account already sends, the first time
 * they are used: the emoji in its own newest messages that this device holds
 * (the search index keeps them, beside the conversations open now), each
 * counted as a use at the time it was sent. Before this, someone who had used
 * an emoji a hundred times was offered it as though they never had. Done once
 * per account, once the index is open to read; true when there was any history to learn from.
 */
export function learnEmojiHistory(meId: string): Promise<boolean> {
  const st = useSettings.getState();
  if (!st.loaded || !st.settings.smartEmoji || st.settings.emojiLearned) return Promise.resolve(false);
  const index = useSearchIndex.getState().mode;
  // still opening, or locked: the next time suggestions are asked for, then
  if (index !== "memory" && index !== "disk") return Promise.resolve(false);
  learning ??= (async () => {
    const res = await querySearch({
      query: { terms: [], phrases: [], exclude: [], from: [meId], channels: null, mentions: null, everyone: false, has: [], since: null, until: null, pinned: null },
      scope: null,
      tab: "messages",
      sort: "newest",
      offset: 0,
      limit: HISTORY_MESSAGES,
    });
    const messages = new Map<string, { text: string; at: number }>();
    for (const d of res.docs) if (d.t) messages.set(d.id, { text: d.t, at: d.ts });
    for (const ch of Object.values(useMessages.getState().channels)) {
      for (const id of ch.ids) {
        const m = ch.byId[id];
        if (m && m.author_id === meId && m.payload?.t && !messages.has(id)) messages.set(id, { text: m.payload.t, at: m.created_at });
      }
    }
    await shortcodeNames();
    const now = Date.now();
    const cur = useSettings.getState();
    if (!cur.loaded || cur.settings.emojiLearned) return false;
    cur.patch({ emojiUsage: usageFromHistory(cur.settings.emojiUsage, [...messages.values()], now), emojiLearned: true });
    return messages.size > 0;
  })().finally(() => {
    learning = null;
  });
  return learning;
}

/** Counts a use of each emoji, while smart suggestions are on. */
export function noteEmojiUse(keys: readonly string[]): void {
  const st = useSettings.getState();
  if (!st.loaded || !st.settings.smartEmoji || keys.length === 0) return;
  st.patch({ emojiUsage: withUse(st.settings.emojiUsage, keys, Date.now()) });
}
