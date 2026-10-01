import type { ReactNode } from "react";
import type { PostLink } from "@/api/types";
import { trimUrl } from "@/markdown/parse";

/**
 * A social post's words, as its card draws them: its addresses made into
 * links, and its mentions and hashtags pointed at the site they belong to.
 *
 * Nothing here comes from the post's own markup. The server read the post
 * into plain text (internal/unfurl), and every link is built from that text
 * and a fixed address for the site, so a post cannot bring a link of its own
 * making into a chat except as an address the reader can see.
 */

/** Where a mention leads, per site. Sites that are missing send their mentions as links instead. */
const PROFILE: Record<string, (name: string) => string> = {
  twitter: (n) => `https://x.com/${n}`,
  tiktok: (n) => `https://www.tiktok.com/@${n}`,
  instagram: (n) => `https://www.instagram.com/${n}/`,
  threads: (n) => `https://www.threads.com/@${n}`,
  telegram: (n) => `https://t.me/${n}`,
  youtube: (n) => `https://www.youtube.com/@${n}`,
};

const TAG: Record<string, (tag: string) => string> = {
  twitter: (tag) => `https://x.com/hashtag/${encodeURIComponent(tag)}`,
  tiktok: (tag) => `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
  instagram: (tag) => `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
  threads: (tag) => `https://www.threads.com/search?q=${encodeURIComponent(tag)}&serp_type=tags`,
  youtube: (tag) => `https://www.youtube.com/hashtag/${encodeURIComponent(tag.toLowerCase())}`,
};

/**
 * One pass over a stretch of plain text finds, in order: an address, a
 * mention, a hashtag, and a Reddit place or person. A mention and a hashtag
 * only count at the start of a word, so the "@" of an email address and the
 * "#" of a link's anchor are left alone; the character before is matched and
 * put back.
 */
const RE_PIECE = /(https?:\/\/[^\s<>"]+)|(^|[^\p{L}\p{N}_@/.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)|(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,100})|(^|[^\p{L}\p{N}_/])\/?([ru])\/([A-Za-z0-9_-]{2,40})/giu;

function anchor(key: string, href: string, label: string): ReactNode {
  return (
    <a key={key} className="md-link" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** A stretch of text with no link from the server in it. */
function plain(text: string, platform: string, key: string, out: ReactNode[]): void {
  let at = 0;
  const push = (upTo: number) => {
    if (upTo > at) out.push(text.slice(at, upTo));
  };
  for (const m of text.matchAll(RE_PIECE)) {
    const start = m.index ?? 0;
    if (start < at) continue;
    const k = `${key}:${start}`;
    if (m[1]) {
      // the full stop or bracket after an address belongs to the sentence
      const url = trimUrl(m[1]);
      if (!/^https?:\/\/\S/i.test(url)) continue;
      push(start);
      out.push(anchor(k, url, url));
      at = start + url.length;
    } else if (m[3] !== undefined) {
      const to = PROFILE[platform];
      if (!to) continue;
      const lead = m[2] ?? "";
      push(start + lead.length);
      out.push(anchor(k, to(m[3]), `@${m[3]}`));
      at = start + m[0].length;
    } else if (m[5] !== undefined) {
      const to = TAG[platform];
      // "#1" is a number, not a tag
      if (!to || !/\p{L}/u.test(m[5])) continue;
      const lead = m[4] ?? "";
      push(start + lead.length);
      out.push(anchor(k, to(m[5]), `#${m[5]}`));
      at = start + m[0].length;
    } else if (m[8] !== undefined) {
      if (platform !== "reddit") continue;
      const lead = m[6] ?? "";
      const kind = (m[7] ?? "r").toLowerCase();
      const shown = m[0].slice(lead.length);
      push(start + lead.length);
      out.push(anchor(k, kind === "r" ? `https://www.reddit.com/r/${m[8]}/` : `https://www.reddit.com/user/${m[8]}`, shown));
      at = start + m[0].length;
    }
  }
  push(text.length);
}

/**
 * A post's text as nodes. `links` are the addresses behind words the text
 * shows in their place (a shortened link, a link with a label); each is
 * found by looking for its words after the one before, which is how the
 * server checked that they land where they should.
 */
export function postText(text: string, links: PostLink[] | undefined, platform: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const link of links ?? []) {
    if (!link?.text || !/^https?:\/\//i.test(link.url)) continue;
    const found = text.indexOf(link.text, at);
    if (found < 0) continue;
    plain(text.slice(at, found), platform, `p${n}`, out);
    out.push(anchor(`l${n}`, link.url, link.text));
    at = found + link.text.length;
    n += 1;
  }
  plain(text.slice(at), platform, `p${n}`, out);
  return out;
}
