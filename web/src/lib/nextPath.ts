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
  // A URL parser drops tabs and line breaks and reads a backslash as a slash,
  // so "/<tab>/evil.example" is "//evil.example" by the time anything opens
  // it. None of them belongs in a path of this app.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  // and whatever is left must still be this site once resolved
  try {
    const base = "https://nexa.invalid";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
