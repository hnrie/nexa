/**
 * What changed between two texts, as the few steps that turn one into the
 * other: keep so many characters, take so many out, put this in.
 *
 * A note is kept as a CRDT (ydoc.ts), which wants each edit as just that: the
 * smallest change, so that two people writing in the same sentence at once
 * each keep their own words. Formatting a word adds its markers on both
 * sides; the word itself is kept, not taken out and put back.
 *
 * Lengths are counted in UTF-16 code units, as JavaScript strings and the
 * CRDT count them, but a change never cuts an emoji or any other character in
 * half: the comparison is made a whole character at a time.
 */

export type Delta = ({ retain: number } | { delete: number } | { insert: string })[];

/** Past this many characters on both sides of what differs, the middle is replaced whole rather than compared. */
const COMPARE_MAX = 4000;

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The steps from `a` to `b`. Empty when they are the same. */
export function textDelta(a: string, b: string): Delta {
  if (a === b) return [];
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre += 1;
  // not between the two halves of one character
  if (pre > 0 && pre < a.length && isLow(a.charCodeAt(pre)) && isHigh(a.charCodeAt(pre - 1))) pre -= 1;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf += 1;
  if (suf > 0 && suf < a.length - pre && isLow(a.charCodeAt(a.length - suf)) && isHigh(a.charCodeAt(a.length - suf - 1))) suf -= 1;
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const out: Delta = [];
  if (pre > 0) out.push({ retain: pre });
  if (!midA) out.push({ insert: midB });
  else if (!midB) out.push({ delete: midA.length });
  else if (midA.length + midB.length > COMPARE_MAX) out.push({ delete: midA.length }, { insert: midB });
  else out.push(...compare(midA, midB));
  return tidy(out);
}

/** Joins neighbouring steps of the same kind and drops empty ones; a trailing keep says nothing. */
function tidy(steps: Delta): Delta {
  const out: Delta = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if ("retain" in s) {
      if (s.retain <= 0) continue;
      if (last && "retain" in last) last.retain += s.retain;
      else out.push({ ...s });
    } else if ("delete" in s) {
      if (s.delete <= 0) continue;
      if (last && "delete" in last) last.delete += s.delete;
      else out.push({ ...s });
    } else {
      if (!s.insert) continue;
      if (last && "insert" in last) last.insert += s.insert;
      else out.push({ ...s });
    }
  }
  while (out.length && "retain" in out[out.length - 1]!) out.pop();
  return out;
}

/**
 * The shortest edit between two short texts, whole characters at a time
 * (Myers's O(ND) difference algorithm), as steps over their UTF-16 lengths.
 */
function compare(a: string, b: string): Delta {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = x.length;
  const m = y.length;
  const offset = n + m;
  const v = new Int32Array(2 * offset + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= n + m; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i += 1;
        j += 1;
      }
      v[offset + k] = i;
      if (i >= n && j >= m) break outer;
    }
  }
  // walk back from the end, one step of the edit at a time
  const steps: ("keep" | "del" | "ins")[] = [];
  let i = n;
  let j = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d]!;
    const k = i - j;
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const pk = down ? k + 1 : k - 1;
    const pi = prev[offset + pk]!;
    const pj = pi - pk;
    while (i > pi && j > pj) {
      steps.push("keep");
      i -= 1;
      j -= 1;
    }
    steps.push(down ? "ins" : "del");
    if (down) j -= 1;
    else i -= 1;
  }
  while (i > 0 && j > 0) {
    steps.push("keep");
    i -= 1;
    j -= 1;
  }
  steps.reverse();
  const out: Delta = [];
  let ai = 0;
  let bi = 0;
  for (const s of steps) {
    if (s === "keep") {
      out.push({ retain: x[ai]!.length });
      ai += 1;
      bi += 1;
    } else if (s === "del") {
      out.push({ delete: x[ai]!.length });
      ai += 1;
    } else {
      out.push({ insert: y[bi]! });
      bi += 1;
    }
  }
  return out;
}

/** Applies steps to a text: what the CRDT does with them, for tests. */
export function applyDelta(a: string, delta: Delta): string {
  let at = 0;
  let out = "";
  for (const s of delta) {
    if ("retain" in s) {
      out += a.slice(at, at + s.retain);
      at += s.retain;
    } else if ("delete" in s) at += s.delete;
    else out += s.insert;
  }
  return out + a.slice(at);
}
