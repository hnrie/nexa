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
/** After a failed fetch of the list, not before this; the wait doubles up to a few minutes. */
let retryAt = 0;
let retryWait = 0;

/**
 * Fetches the list of artwork this build ships. Twemoji trails Unicode, so
 * without it the app asks for pictures that were never drawn.
 */
export function ensureTwemojiIndex(): void {
  if (available || loading) return;
  // Offline, every emoji drawn asked for the list again. The pictures are
  // tried blind meanwhile, so waiting a while between tries costs nothing.
  if (Date.now() < retryAt) return;
  loading = fetch(`${TWEMOJI_BASE}/available.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no index"))))
    .then((names: unknown) => {
      // A body that is not the list is a failure like any other. Returning here
      // left a resolved promise behind, so nothing asked again, nothing waiting
      // was ever told, and every emoji in the app fell back to the system glyph
      // for the life of the tab — taking the picker down with it.
      if (!Array.isArray(names)) throw new Error("bad index");
      available = new Set(names.filter((n): n is string => typeof n === "string"));
      retryWait = 0;
      for (const fn of waiting) fn();
    })
    .catch(() => {
      // no list: fall back to trying, which still works
      loading = null;
      unlisted = true;
      retryWait = Math.min(5 * 60_000, retryWait ? retryWait * 2 : 5_000);
      retryAt = Date.now() + retryWait;
      for (const fn of waiting) fn();
    });
}

/** Resolves once it is known which pictures exist, or that the list could not be had. */
export function twemojiIndexSettledPromise(): Promise<void> {
  if (twemojiIndexSettled()) return Promise.resolve();
  ensureTwemojiIndex();
  return new Promise((resolve) => {
    const done = () => {
      waiting.delete(done);
      resolve();
    };
    waiting.add(done);
  });
}

/**
 * Whether the set has a picture for this emoji. Before the list has arrived,
 * or when it could not be had, nothing is ruled out.
 */
export function hasTwemoji(text: string): boolean {
  return available === null || twemojiCandidates(text).length > 0;
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
  return twemojiFiles(text).map((c) => `${TWEMOJI_BASE}/${c}.svg`);
}

/** The artwork files an emoji may be drawn from (names without the extension), best first. */
export function twemojiFiles(text: string): string[] {
  const codes: string[] = [];
  const first = twemojiCode(text);
  if (first) codes.push(first);
  if (text.includes(ZWJ)) {
    const stripped = twemojiCode(text.replace(VARIATION, ""));
    if (stripped && stripped !== first) codes.push(stripped);
  }
  const known = available;
  return known ? codes.filter((c) => known.has(c)) : codes;
}
