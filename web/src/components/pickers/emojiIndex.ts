import { hasTwemoji, twemojiIndexSettledPromise } from "@/lib/twemoji";

export interface EmojiEntry {
  unicode: string;
  hexcode: string;
  label: string;
  group: number;
  tags: string[];
  shortcodes: string[];
  skins?: { tone: number | number[]; unicode: string }[];
}

interface CompactEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: { hexcode: string; unicode: string; label: string; tone?: number | number[] }[];
}

export const GROUPS: { id: number; name: string }[] = [
  { id: 0, name: "Smileys & Emotion" },
  { id: 1, name: "People & Body" },
  { id: 3, name: "Animals & Nature" },
  { id: 4, name: "Food & Drink" },
  { id: 5, name: "Travel & Places" },
  { id: 6, name: "Activities" },
  { id: 7, name: "Objects" },
  { id: 8, name: "Symbols" },
  { id: 9, name: "Flags" },
];

let loaded: Promise<EmojiEntry[]> | null = null;
let grouped: { id: number; name: string; items: EmojiEntry[] }[] = [];
let all: EmojiEntry[] = [];
let byShortcode = new Map<string, EmojiEntry>();
let byUnicode = new Map<string, EmojiEntry>();

/**
 * Loads the dataset once (separate chunk, ~700 KB before compression),
 * keeping only the emoji Twemoji has drawn: emojibase follows Unicode, which
 * Twemoji trails, and an emoji without its picture would show the system's
 * glyph instead.
 */
export function loadEmoji(): Promise<EmojiEntry[]> {
  if (loaded) return loaded;
  loaded = Promise.all([
    import("emojibase-data/en/compact.json"),
    // iamcal is the naming Slack and Discord use, so :heart_eyes: means here
    // what it means everywhere else; emojibase's names stay searchable behind it
    import("emojibase-data/en/shortcodes/iamcal.json"),
    import("emojibase-data/en/shortcodes/emojibase.json"),
    twemojiIndexSettledPromise(),
  ]).then(([data, primary, secondary]) => {
    const list = (data.default as unknown as CompactEmoji[]).filter((e) => e.group !== undefined && e.group !== 2);
    const first = primary.default as unknown as Record<string, string | string[]>;
    const second = secondary.default as unknown as Record<string, string | string[]>;
    const codes: Record<string, string[]> = {};
    for (const [hex, raw] of Object.entries(first)) codes[hex] = Array.isArray(raw) ? [...raw] : [raw];
    for (const [hex, raw] of Object.entries(second)) {
      const extra = Array.isArray(raw) ? raw : [raw];
      const have = codes[hex] ?? [];
      codes[hex] = [...have, ...extra.filter((n) => !have.includes(n))];
    }
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    all = list
      .filter((e) => hasTwemoji(e.unicode))
      .map((e) => {
        const shortcodes = codes[e.hexcode] ?? [];
        const entry: EmojiEntry = { unicode: e.unicode, hexcode: e.hexcode, label: e.label, group: e.group ?? 0, tags: e.tags ?? [], shortcodes };
        const skins = e.skins?.filter((s) => s.tone !== undefined && hasTwemoji(s.unicode)).map((s) => ({ tone: s.tone as number | number[], unicode: s.unicode }));
        if (skins?.length) entry.skins = skins;
        return entry;
      });
    grouped = GROUPS.map((g) => ({ ...g, items: all.filter((e) => e.group === g.id) })).filter((g) => g.items.length > 0);
    byShortcode = new Map();
    byUnicode = new Map();
    for (const e of all) {
      byUnicode.set(e.unicode, e);
      for (const s of e.shortcodes) if (!byShortcode.has(s)) byShortcode.set(s, e);
    }
    return all;
  });
  return loaded;
}

export function emojiLoaded(): boolean {
  return all.length > 0;
}

export function allEmoji(): EmojiEntry[] {
  return all;
}

/** The emoji by category, in the picker's order; worked out once as the set loads. */
export function emojiGroups(): { id: number; name: string; items: EmojiEntry[] }[] {
  return grouped;
}

/**
 * Loads the set in a quiet moment after the app starts, so the first open of
 * the picker (or a :shortcode: typed) does not wait for it.
 */
export function preloadEmoji(): void {
  if (loaded || typeof window === "undefined") return;
  const start = () => void loadEmoji();
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(start, { timeout: 5000 });
  else setTimeout(start, 2000);
}

export function emojiByShortcode(name: string): EmojiEntry | undefined {
  return byShortcode.get(name.toLowerCase());
}

export function emojiByUnicode(u: string): EmojiEntry | undefined {
  return byUnicode.get(u);
}

/** Prefix/substring search over shortcodes, labels and tags. */
export function searchEmoji(q: string, limit = 50): EmojiEntry[] {
  const query = q.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!query) return [];
  const scored: { e: EmojiEntry; s: number }[] = [];
  for (const e of all) {
    let s = -1;
    for (const sc of e.shortcodes) {
      if (sc === query) s = Math.max(s, 100);
      else if (sc.startsWith(query)) s = Math.max(s, 80);
      else if (sc.includes(query)) s = Math.max(s, 40);
    }
    const label = e.label.toLowerCase();
    if (label === query) s = Math.max(s, 90);
    else if (label.startsWith(query)) s = Math.max(s, 70);
    else if (label.includes(query)) s = Math.max(s, 35);
    else if (e.tags.some((t) => t.startsWith(query))) s = Math.max(s, 30);
    if (s >= 0) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.e);
}

/** The emoji for a skin tone (1–5), or the base when the entry has no variants. */
export function withTone(e: EmojiEntry, tone: number): string {
  if (!tone || !e.skins) return e.unicode;
  const hit = e.skins.find((s) => (Array.isArray(s.tone) ? s.tone.every((t) => t === tone) : s.tone === tone));
  return hit?.unicode ?? e.unicode;
}

export const TONES = ["#ffcc22", "#fadcbc", "#e0bb95", "#bf8f68", "#9b643d", "#594539"];
