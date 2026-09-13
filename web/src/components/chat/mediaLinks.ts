import type { UnfurlResult } from "@/api/types";

const LINK = /^https?:\/\/\S+$/i;

export function isMediaEmbed(e: UnfurlResult | null | undefined): boolean {
  return !!e && (e.type === "image" || e.type === "gif" || e.type === "video");
}

/**
 * Whether a message's text is nothing but links to the pictures and videos
 * shown under it. Such text only repeats them, so like an uploaded file the
 * media stands alone. A word counts as such a link when it is the address a
 * preview was made for, which is how a GIF from the picker arrives (through
 * this server's proxy, as a path), or any web link at all, since a preview
 * records where a pasted link ended up after redirects; the counts then have
 * to line up.
 */
export function isOnlyMediaLinks(text: string, embeds: readonly UnfurlResult[]): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || embeds.length === 0 || !embeds.every(isMediaEmbed)) return false;
  const own = new Set(embeds.flatMap((e) => [e.url, e.image]).filter((u): u is string => !!u));
  if (!words.every((w) => own.has(w) || LINK.test(w))) return false;
  return embeds.length >= words.length;
}
