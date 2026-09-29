/**
 * `:shortcode:` names for unicode emoji.
 *
 * The names follow the iamcal set, which is what Slack and Discord use, so a
 * name typed anywhere else works here. The emojibase set is loaded behind it
 * so its older names keep resolving too. The table is fetched on demand: most
 * of a session never needs it, and it is around 100 KB.
 */

/** name -> the emoji itself. */
let table: Map<string, string> | null = null;
/** The emoji, without variation selectors -> the name it goes by. */
let names: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
/** After a failed load, not before this; the wait doubles up to a few minutes. */
let retryAt = 0;
let retryWait = 0;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

/**
 * Whether a text could hold a `:name:` at all, by the parser's own pattern.
 * Asking only whether it has a colon fetched the table for every link, every
 * "12:30" and every "re:", which is most of the first page of any channel.
 */
export function mightHaveShortcode(text: string): boolean {
  return /:[a-z0-9_+-]{1,60}:/.test(text);
}

function charsOf(hexcode: string): string {
  let out = "";
  for (const part of hexcode.split("-")) {
    const cp = Number.parseInt(part, 16);
    if (!Number.isFinite(cp)) return "";
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** U+FE0F: whether it is there or not, the emoji is the same one. */
const VARIATION = /\uFE0F/g;

function add(map: Map<string, string>, reverse: Map<string, string>, hexcode: string, raw: string | string[]): void {
  const emoji = charsOf(hexcode);
  if (!emoji) return;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const name of list) {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, emoji);
  }
  // the first name a set gives is the one it goes by
  const plain = emoji.replace(VARIATION, "");
  if (list[0] && !reverse.has(plain)) reverse.set(plain, list[0].toLowerCase());
}

/** Starts loading the table if it is not here yet. Safe to call on every render. */
export function ensureShortcodes(): void {
  if (table || loading) return;
  // offline, every message on screen asking again at every render was a
  // request each; a failure waits a while before the next try
  if (Date.now() < retryAt) return;
  loading = Promise.all([
    import("emojibase-data/en/shortcodes/iamcal.json"),
    import("emojibase-data/en/shortcodes/emojibase.json"),
  ])
    .then(([iamcal, base]) => {
      const map = new Map<string, string>();
      const reverse = new Map<string, string>();
      // iamcal first, so its name wins where the two sets disagree
      for (const [hexcode, raw] of Object.entries(iamcal.default as Record<string, string | string[]>)) add(map, reverse, hexcode, raw);
      for (const [hexcode, raw] of Object.entries(base.default as Record<string, string | string[]>)) add(map, reverse, hexcode, raw);
      table = map;
      names = reverse;
      version += 1;
      retryWait = 0;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      // leave the text alone; a failed fetch must not break rendering
      loading = null;
      retryWait = Math.min(MAX_RETRY_MS, retryWait ? retryWait * 2 : FIRST_RETRY_MS);
      retryAt = Date.now() + retryWait;
    });
}

/** The emoji for a `:name:`, or undefined while the table is still loading. */
export function shortcodeToEmoji(name: string): string | undefined {
  return table?.get(name.toLowerCase());
}

/**
 * The name an emoji goes by, without its colons: the one that brings it back
 * when typed as `:name:`. Undefined while the table is still loading, and for
 * an emoji no set names.
 */
export function emojiShortcode(emoji: string): string | undefined {
  return names?.get(emoji.replace(VARIATION, ""));
}

export function shortcodesReady(): boolean {
  return table !== null;
}

/** Bumps whenever the table arrives, so a render can try again. */
export function shortcodeVersion(): number {
  return version;
}

export function onShortcodesReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
