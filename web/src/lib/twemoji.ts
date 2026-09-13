/**
 * Twemoji file names.
 *
 * Every emoji in the app is drawn with Twitter's artwork, served from this
 * instance, so the same picture appears on every platform and no third party
 * learns who is reading what. The naming follows Twemoji's own rule: the code
 * points in lower-case hex joined by dashes, with the variation selector
 * dropped unless the sequence is joined with a zero-width joiner.
 */

const ZWJ = "‍";
const VARIATION = /️/g;

/** The asset directory, served by the app itself. */
export const TWEMOJI_BASE = "/twemoji";

/** The code point sequence Twemoji names a file after, or null if there is none. */
export function twemojiCode(text: string): string | null {
  if (!text) return null;
  const source = text.includes(ZWJ) ? text : text.replace(VARIATION, "");
  const parts: string[] = [];
  for (const ch of source) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) return null;
    parts.push(cp.toString(16));
  }
  return parts.length > 0 ? parts.join("-") : null;
}

/** Where to find the picture for an emoji, or null when it is not one. */
export function twemojiUrl(text: string): string | null {
  const code = twemojiCode(text);
  return code ? `${TWEMOJI_BASE}/${code}.svg` : null;
}

/** The names the set actually holds, once the list has been fetched. */
let available: Set<string> | null = null;
let loading: Promise<void> | null = null;
/** The list could not be had, so pictures are tried blind rather than never shown. */
let unlisted = false;
const waiting = new Set<() => void>();

/**
 * Fetches the list of artwork this build ships. Twemoji trails Unicode, so
 * without it the app asks for pictures that were never drawn.
 */
export function ensureTwemojiIndex(): void {
  if (available || loading) return;
  loading = fetch(`${TWEMOJI_BASE}/available.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no index"))))
    .then((names: unknown) => {
      if (!Array.isArray(names)) return;
      available = new Set(names.filter((n): n is string => typeof n === "string"));
      for (const fn of waiting) fn();
    })
    .catch(() => {
      // no list: fall back to trying, which still works
      loading = null;
      unlisted = true;
      for (const fn of waiting) fn();
    });
}

export function twemojiIndexReady(): boolean {
  return available !== null;
}

/**
 * Whether it is known which pictures to ask for: the list has arrived, or it
 * could not be had. Until then nothing is asked for, or every emoji the set
 * lacks would be a request that can only fail.
 */
export function twemojiIndexSettled(): boolean {
  return available !== null || unlisted;
}

export function onTwemojiIndexReady(fn: () => void): () => void {
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/**
 * Twemoji is not quite consistent about the variation selector inside joined
 * sequences: the rainbow flag keeps it, the eye in a speech bubble does not.
 * Rather than encode the exceptions, offer both spellings; once the list of
 * artwork is known, only the spellings that exist are offered at all.
 */
export function twemojiCandidates(text: string): string[] {
  const codes: string[] = [];
  const first = twemojiCode(text);
  if (first) codes.push(first);
  if (text.includes(ZWJ)) {
    const stripped = twemojiCode(text.replace(VARIATION, ""));
    if (stripped && stripped !== first) codes.push(stripped);
  }
  const known = available;
  const usable = known ? codes.filter((c) => known.has(c)) : codes;
  return usable.map((c) => `${TWEMOJI_BASE}/${c}.svg`);
}
