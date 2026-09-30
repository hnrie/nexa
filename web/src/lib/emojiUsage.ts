import { parse, type Node } from "@/markdown";

/**
 * Which emoji this account reaches for, and how lately. Each emoji has a
 * score that goes up by one every time it is used, in a message sent or as a
 * reaction, and halves for every week it is not. Smart emoji suggestions
 * (lib/emojiSuggest.ts) put the highest first, so a bare ":" offers the
 * emoji someone is most likely to want, and a few letters find the one they
 * usually mean by them.
 *
 * It is kept with the account's other settings, encrypted like them, so every
 * device learns the same habits. Only the emoji that score highest are kept,
 * and nothing is counted while smart suggestions are off (noteEmojiUse).
 */
export interface EmojiUse {
  /** The score when it was last used. */
  s: number;
  at: number;
}
export type EmojiUsage = Record<string, EmojiUse>;

/** A score halves over this long without the emoji being used. */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
/** How many emoji are remembered: the highest scores. */
export const KEEP = 60;

const TONES = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION = /️/g;

/** The key a unicode emoji is counted under: its skin tones together, with or without a variation selector. */
export function unicodeKey(emoji: string): string {
  return emoji.replace(TONES, "").replace(VARIATION, "");
}

/** The key a custom emoji is counted under: the picture its token names, as every message and reaction carries it. */
export function customKey(blobId: string): string {
  return `c:${blobId}`;
}

/** The key of a reaction as the server keeps it: a unicode emoji, or `a?:name:blobId`. */
export function reactionKey(emoji: string): string {
  const custom = /^a?:[^:]+:(\d+)$/.exec(emoji);
  return custom ? customKey(custom[1]!) : unicodeKey(emoji);
}

/** An emoji's score now. */
export function scoreOf(use: EmojiUse | undefined, now: number): number {
  if (!use) return 0;
  return use.s * 0.5 ** (Math.max(0, now - use.at) / HALF_LIFE_MS);
}

/** Usage with one more use of each key, keeping the ones that score highest. */
export function withUse(usage: EmojiUsage, keys: readonly string[], now: number): EmojiUsage {
  const next: EmojiUsage = { ...usage };
  for (const key of new Set(keys)) next[key] = { s: scoreOf(next[key], now) + 1, at: now };
  const all = Object.entries(next);
  if (all.length <= KEEP) return next;
  all.sort((a, b) => scoreOf(b[1], now) - scoreOf(a[1], now));
  return Object.fromEntries(all.slice(0, KEEP));
}

/** The keys in order of use, most first. */
export function rankedKeys(usage: EmojiUsage, now: number): string[] {
  return Object.entries(usage)
    .map(([key, use]) => [key, scoreOf(use, now)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

/** The emoji a message uses, each once: a row of ten hearts is one choice of heart. */
export function emojiKeysIn(text: string): string[] {
  const out = new Set<string>();
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.type === "unicodeEmoji") out.add(unicodeKey(n.text));
      else if (n.type === "emoji") out.add(customKey(n.id));
      else if (n.type === "details") walk([...n.summary, ...n.children]);
      else if ("children" in n) walk(n.children);
      else if (n.type === "list") for (const item of n.items) walk(item);
      else if (n.type === "table") for (const row of [n.head, ...n.rows]) for (const cell of row) walk(cell);
      else if (n.type === "footnotes") for (const note of n.notes) walk(note.children);
    }
  };
  if (text) walk(parse(text));
  return [...out];
}

/** Reads a stored copy defensively: whatever an older or damaged copy holds, only well-formed entries come through. */
export function sanitizeUsage(v: unknown): EmojiUsage {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: EmojiUsage = {};
  for (const [key, use] of Object.entries(v as Record<string, unknown>)) {
    if (key.length > 80 || typeof use !== "object" || use === null) continue;
    const { s, at } = use as Record<string, unknown>;
    if (typeof s === "number" && Number.isFinite(s) && s > 0 && typeof at === "number" && Number.isFinite(at)) out[key] = { s, at };
  }
  const all = Object.entries(out);
  if (all.length <= KEEP) return out;
  const now = Date.now();
  all.sort((a, b) => scoreOf(b[1], now) - scoreOf(a[1], now));
  return Object.fromEntries(all.slice(0, KEEP));
}
