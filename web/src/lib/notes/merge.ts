/**
 * Putting two people's changes to the same note together.
 *
 * A note saves itself, so two people writing in one at once each save over
 * the other unless something merges them. Each save names the version it
 * started from; when the server says the note has moved on, the app has three
 * texts: the one both started from, this person's, and the other's. merge3
 * keeps every change either of them made. Where both changed the very same
 * words differently there is no telling which is meant, so both are kept, one
 * after the other, and nothing anybody wrote is lost.
 */

import { alignment as matches } from "@/lib/align";

/** Text cut into lines, each with its line break. */
function lines(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const nl = text.indexOf("\n", at);
    if (nl < 0) break;
    out.push(text.slice(at, nl + 1));
    at = nl + 1;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A line cut into words and the spaces between them. */
function words(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);

/**
 * Merges token lists. Where both sides changed the same stretch differently,
 * `conflict` decides what stands there.
 */
function mergeTokens(base: string[], mine: string[], theirs: string[], conflict: (base: string[], mine: string[], theirs: string[]) => string[]): string[] {
  const inMine = matches(base, mine);
  const inTheirs = matches(base, theirs);
  const out: string[] = [];
  let b = 0;
  let m = 0;
  let t = 0;
  const settle = (bEnd: number, mEnd: number, tEnd: number): void => {
    const was = base.slice(b, bEnd);
    const ours = mine.slice(m, mEnd);
    const other = theirs.slice(t, tEnd);
    if (same(ours, was)) out.push(...other);
    else if (same(other, was) || same(ours, other)) out.push(...ours);
    else out.push(...conflict(was, ours, other));
  };
  for (let i = 0; i < base.length; i++) {
    const mi = inMine[i]!;
    const ti = inTheirs[i]!;
    // a token all three still have, in order: everything before it is settled
    if (mi < m || ti < t) continue;
    settle(i, mi, ti);
    out.push(base[i]!);
    b = i + 1;
    m = mi + 1;
    t = ti + 1;
  }
  settle(base.length, mine.length, theirs.length);
  return out;
}

/** Both kept: mine, then theirs, each on lines of its own. */
function both(mine: string[], theirs: string[]): string[] {
  const out = [...mine];
  const last = out[out.length - 1];
  if (last !== undefined && !last.endsWith("\n") && theirs.length > 0) out.push("\n");
  out.push(...theirs);
  return out;
}

/**
 * The text with both sides' changes since `base`. Lines are merged first;
 * lines both sides changed are merged again word by word, so two people
 * fixing different words of one sentence both keep their fix.
 */
export function merge3(base: string, mine: string, theirs: string): string {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  return mergeTokens(lines(base), lines(mine), lines(theirs), (was, ours, other) => {
    let clash = false;
    const merged = mergeTokens(words(was.join("")), words(ours.join("")), words(other.join("")), (_w, o, th) => {
      clash = true;
      return [...o, ...th];
    });
    return clash ? both(ours, other) : [merged.join("")];
  }).join("");
}
