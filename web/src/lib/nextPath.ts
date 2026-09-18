/**
 * Where a `next=` parameter is allowed to send someone after signing in.
 *
 * A leading "/" alone does not make a path this app's: `//evil.example` and
 * `/\evil.example` are protocol-relative URLs that lead off the site, and
 * `next` is written into the links the invite page hands out, so a crafted one
 * is plausible. What the browser then does with it differs by browser, which
 * is its own reason not to hand one over.
 */
export function safeNext(next: string | null | undefined, fallback = "/channels/@me"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
