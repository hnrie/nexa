import type { Emoji } from "@/api/types";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { useSettings } from "@/stores/settings";
import { customKey, rankedKeys, scoreOf, unicodeKey, withUse, type EmojiUsage } from "./emojiUsage";

/**
 * Smart emoji suggestions: what the message box offers after a ":".
 *
 * A bare ":" offers the emoji this account uses most (emojiUsage.ts), then
 * the ones the picker last sent, then a few everybody reaches for. A few
 * letters match names by their start, by the start of any word in them
 * (":hea" finds broken_heart), by their words' first letters (":tu" finds
 * thumbs_up) and anywhere inside them; what this account uses often goes
 * ahead of what merely matches better, so the emoji it usually means by those
 * letters comes first.
 */

/** A suggestion: one of Unicode's, or a custom one (a server's, or a pack's), `own` when it is this server's. */
export type EmojiCandidate = { kind: "emoji"; entry: EmojiEntry } | { kind: "customEmoji"; emoji: Emoji; own?: boolean };

/** Offered after a bare ":" to someone who has not used any yet. */
export const STARTER_EMOJI = ["👍", "😂", "❤️", "😭", "🙏", "🔥", "😊", "🎉"];

/** How many suggestions show. */
export const SUGGESTIONS = 8;

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
 * Whole name, then its start, then the start of a word, then several words'
 * starts in order ("brok_hea"), then its words' initials, then anywhere.
 */
export function nameMatch(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return -1;
  if (n === q) return 100;
  // a longer name that starts the same is a little further from what was typed
  const tail = Math.min(6, (n.length - q.length) * 0.25);
  if (n.startsWith(q)) return 80 - tail;
  const words = wordsOf(name);
  if (words.some((w) => w.startsWith(q))) return 62 - tail;
  const parts = q.split(/[\s_\-]+/).filter(Boolean);
  if (parts.length > 1) {
    let at = 0;
    const found = parts.every((p) => {
      while (at < words.length && !words[at]!.startsWith(p)) at++;
      return at++ < words.length;
    });
    if (found) return 58 - tail;
  }
  if (q.length >= 2 && q.length <= words.length && words.slice(0, q.length).every((w, i) => w[0] === q[i])) return 50;
  if (n.includes(q)) return 40 - tail;
  return -1;
}

/** How far an emoji's use lifts it: nothing when unused, and more the more it is used, up to a point. */
export function useBoost(score: number): number {
  return score > 0 ? Math.min(70, 25 + 12 * Math.log2(1 + score)) : 0;
}

function keyOf(c: EmojiCandidate): string {
  return c.kind === "emoji" ? unicodeKey(c.entry.unicode) : customKey(c.emoji.blob_id);
}

function matchOf(c: EmojiCandidate, query: string): number {
  if (c.kind === "customEmoji") return nameMatch(c.emoji.name, query);
  let best = -1;
  for (const sc of c.entry.shortcodes) best = Math.max(best, nameMatch(sc, query));
  // the label is the emoji's name in words ("broken heart"), a little behind its codes
  best = Math.max(best, nameMatch(c.entry.label, query) - 5);
  const q = query.toLowerCase();
  for (const tag of c.entry.tags) {
    if (tag === q) best = Math.max(best, 45);
    else if (tag.startsWith(q)) best = Math.max(best, 30);
  }
  return best;
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
export function suggestEmoji({ query, candidates, usage, recent, now, limit = SUGGESTIONS }: SuggestInput): EmojiCandidate[] {
  const recentAt = new Map(recent.map((u, i) => [unicodeKey(u), i] as const));
  const lift = (c: EmojiCandidate) => {
    const key = keyOf(c);
    const r = recentAt.get(key);
    return Math.max(useBoost(scoreOf(usage[key], now)), r === undefined ? 0 : Math.max(0, 20 - r));
  };
  if (!query) {
    const byKey = new Map<string, EmojiCandidate>();
    for (const c of candidates) if (!byKey.has(keyOf(c))) byKey.set(keyOf(c), c);
    const order = [...rankedKeys(usage, now), ...recent.map(unicodeKey), ...STARTER_EMOJI.map(unicodeKey)];
    const out: EmojiCandidate[] = [];
    const seen = new Set<string>();
    for (const key of order) {
      const c = byKey.get(key);
      if (!c || seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  }
  const scored: { c: EmojiCandidate; s: number; i: number }[] = [];
  candidates.forEach((c, i) => {
    const m = matchOf(c, query);
    if (m < 0) return;
    // this server's own emoji, by a hair: its :name: is the one a message here gets
    scored.push({ c, s: m + lift(c) + (c.kind === "customEmoji" && c.own ? 2 : 0), i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const out: EmojiCandidate[] = [];
  const seen = new Set<string>();
  for (const { c } of scored) {
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** Counts a use of each emoji, while smart suggestions are on. */
export function noteEmojiUse(keys: readonly string[]): void {
  const st = useSettings.getState();
  if (!st.loaded || !st.settings.smartEmoji || keys.length === 0) return;
  st.patch({ emojiUsage: withUse(st.settings.emojiUsage, keys, Date.now()) });
}
