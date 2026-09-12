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

/**
 * Twemoji is not quite consistent about the variation selector inside joined
 * sequences: the rainbow flag keeps it, the eye in a speech bubble does not.
 * Rather than encode the exceptions, offer both spellings and let the first
 * one that loads win.
 */
export function twemojiCandidates(text: string): string[] {
  const out: string[] = [];
  const first = twemojiUrl(text);
  if (first) out.push(first);
  if (text.includes(ZWJ)) {
    const stripped = twemojiUrl(text.replace(VARIATION, ""));
    if (stripped && stripped !== first) out.push(stripped);
  }
  return out;
}
