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
let loading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function charsOf(hexcode: string): string {
  let out = "";
  for (const part of hexcode.split("-")) {
    const cp = Number.parseInt(part, 16);
    if (!Number.isFinite(cp)) return "";
    out += String.fromCodePoint(cp);
  }
  return out;
}

function add(map: Map<string, string>, hexcode: string, raw: string | string[]): void {
  const emoji = charsOf(hexcode);
  if (!emoji) return;
  for (const name of Array.isArray(raw) ? raw : [raw]) {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, emoji);
  }
}

/** Starts loading the table if it is not here yet. Safe to call on every render. */
export function ensureShortcodes(): void {
  if (table || loading) return;
  loading = Promise.all([
    import("emojibase-data/en/shortcodes/iamcal.json"),
    import("emojibase-data/en/shortcodes/emojibase.json"),
  ])
    .then(([iamcal, base]) => {
      const map = new Map<string, string>();
      // iamcal first, so its name wins where the two sets disagree
      for (const [hexcode, raw] of Object.entries(iamcal.default as Record<string, string | string[]>)) add(map, hexcode, raw);
      for (const [hexcode, raw] of Object.entries(base.default as Record<string, string | string[]>)) add(map, hexcode, raw);
      table = map;
      version += 1;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      // leave the text alone; a failed fetch must not break rendering
      loading = null;
    });
}

/** The emoji for a `:name:`, or undefined while the table is still loading. */
export function shortcodeToEmoji(name: string): string | undefined {
  return table?.get(name.toLowerCase());
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
