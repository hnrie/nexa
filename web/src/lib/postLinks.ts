/**
 * Whether a link is to a social post, the kind whose card is drawn as a post.
 *
 * The server reads a post from the site's own data and from the services
 * that fix these embeds, which takes longer than reading a page's tags, so
 * Send waits longer for such a link's card. The lists are the server's
 * (internal/unfurl/post.go), which is what decides what a post is; a test
 * there keeps the two the same.
 */

/** Services, and the "fixer" domains people swap into a link, under any subdomain. */
const HOSTS = new Set([
  "x.com", "twitter.com", "fxtwitter.com", "fixupx.com", "vxtwitter.com", "fixvx.com", "twittpr.com", "nitter.net", "xcancel.com",
  "bsky.app", "fxbsky.app", "bskx.app", "bskye.app", "vxbsky.app",
  "tiktok.com", "tnktok.com", "tfxktok.com", "vxtiktok.com", "kktiktok.com", "tiktxk.com", "tiktokez.com",
  "instagram.com", "ddinstagram.com", "kkinstagram.com", "instagramez.com", "eeinstagram.com", "vxinstagram.com", "uuinstagram.com",
  "reddit.com", "rxddit.com", "vxreddit.com", "redditez.com", "rxyddit.com",
  "threads.net", "threads.com", "fixthreads.net", "vxthreads.net",
  "youtube.com", "youtube-nocookie.com", "koutube.com",
]);

/** Services under their exact name only: a subdomain of these is something else (i.redd.it is a picture). */
const EXACT_HOSTS = new Set(["redd.it", "t.me", "telegram.me", "telegram.dog", "fx-t.me", "txlegram.me", "txlegram.org", "youtu.be", "koutu.be"]);

/** A Mastodon post is known by the shape of its address, on whatever server. */
const RE_MASTODON = /^\/(?:@[A-Za-z0-9_]{1,64}(?:@[A-Za-z0-9.-]{1,255})?\/\d{10,24}|users\/[A-Za-z0-9_]{1,64}\/statuses\/\d{10,24})\/?$/;

export function isPostLink(link: string): boolean {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (EXACT_HOSTS.has(host)) return true;
  const labels = host.split(".");
  if (labels.length >= 2 && labels.length <= 4 && HOSTS.has(labels.slice(-2).join("."))) return true;
  return RE_MASTODON.test(u.pathname);
}
