/**
 * Links to this app, told apart from links to anywhere else.
 *
 * A link to one of Nexa's own pages (an invite, a channel, a message, a
 * sticker pack, the download page) opens inside the app instead of a new tab:
 * in the desktop app a new tab is the system browser, and on the web it is a
 * second copy of the app. The instance's public address counts as well as the
 * page's own, so a link someone copied from https://chat.example.org works on
 * a page the same server serves under another name, and plain http counts
 * because it only redirects to https.
 */

/** Where a link to this app leads. `hash` keeps an invite's key, which never leaves the device. */
export type AppLink = { kind: "invite"; code: string; hash: string } | { kind: "route"; path: string };

/** An invite link found in a message: its code, and the key in its fragment when it has one. */
export interface InviteLinkRef {
  code: string;
  hash: string;
  url: string;
}

let publicHost: string | null = null;

/** Remembers the instance's public address, as GET /instance reports it. */
export function setPublicUrl(url: string | null | undefined): void {
  try {
    publicHost = url ? new URL(url).host.toLowerCase() : null;
  } catch {
    publicHost = null;
  }
}

/** Paths the server answers itself (files, media, the API), which the router knows nothing of. */
const SERVER_PATH = /^\/(?:api|media|assets|twemoji|icons|home|sounds|__download|\.well-known)(?:\/|$)/;
/** A file: the service workers, the manifest, anything with an extension. Nothing of the app's has one. */
const FILE_PATH = /\.[a-z0-9]{2,12}$/i;
/**
 * A guest call link starts a guest session of its own, which cannot share a
 * page with a signed-in one, so it keeps opening where it did.
 */
const OWN_SESSION = /^\/call\//;
const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{1,64})\/?$/;
const MESSAGE_PATH = /^\/channels\/(@me|\d+)\/(\d+)\/(\d+)\/?$/;

interface Here {
  href: string;
  host: string;
}

/**
 * What a link leads to when it is one of the app's own pages, or null for
 * everything the browser should handle as it would anyway: other sites, the
 * server's files, a jump to a heading on this same page.
 */
export function appLink(href: string, here: Here = window.location): AppLink | null {
  let u: URL;
  let cur: URL;
  try {
    cur = new URL(here.href);
    u = new URL(href, cur);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.host.toLowerCase();
  if (host !== here.host.toLowerCase() && host !== publicHost) return null;
  const path = u.pathname;
  if (SERVER_PATH.test(path) || FILE_PATH.test(path) || OWN_SESSION.test(path)) return null;
  // a footnote or a table of contents on the page being read
  if (u.hash && path === cur.pathname && u.search === cur.search) return null;
  const invite = INVITE_PATH.exec(path);
  if (invite) return { kind: "invite", code: invite[1]!, hash: u.hash };
  return { kind: "route", path: path + u.search + u.hash };
}

/** The channel and message a message link points to. */
export function messageTarget(path: string): { channelId: string; messageId: string } | null {
  const m = MESSAGE_PATH.exec(path.split(/[?#]/)[0]!);
  return m ? { channelId: m[2]!, messageId: m[3]! } : null;
}

/** How many invite cards one message shows at most. */
export const MAX_INVITE_CARDS = 3;

/**
 * The invites to this instance that a message links to, in order and each
 * once. `nodes` is the message's parsed markdown: a link in code is not a
 * link, and one written as <url> asked for no preview.
 */
export function inviteLinksIn(nodes: unknown, here: Here = window.location): InviteLinkRef[] {
  const out: InviteLinkRef[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 64 || out.length >= MAX_INVITE_CARDS || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node["type"] === "code" || node["type"] === "codeblock") return;
    if (node["type"] === "link" && typeof node["url"] === "string" && node["noEmbed"] !== true) {
      const link = appLink(node["url"], here);
      if (link?.kind === "invite" && !seen.has(link.code)) {
        seen.add(link.code);
        out.push({ code: link.code, hash: link.hash, url: node["url"] });
      }
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };
  visit(nodes, 0);
  return out;
}
