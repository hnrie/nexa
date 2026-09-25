/**
 * The inverted index: for every token, the messages it occurs in.
 *
 * Messages are numbered in the order they are added (their ordinal), so each
 * token's list only ever grows at its end and stays sorted. A message that
 * goes is not taken out of the lists; its number simply stops pointing at a
 * message, and the engine rebuilds the whole index once enough of them have
 * gone (see SearchEngine.compact).
 *
 * A search word is found by its beginning ("need" finds "needle"), so the
 * distinct tokens are also kept sorted, and a word looks up the run of tokens
 * that start with it. Tokens added since the last lookup wait in a small
 * unsorted list and are merged in when a lookup needs them.
 */
import type { Token } from "./text";

/** A set of ordinals, one byte each: small, and fast to intersect. */
export type OrdSet = Uint8Array;

export class TokenIndex {
  private readonly postings = new Map<string, number[]>();
  private sorted: string[] = [];
  private pending: string[] = [];

  /** Adds one message's tokens under its ordinal. Ordinals must only grow. */
  add(ord: number, tokens: Iterable<string>): void {
    for (const t of new Set(tokens)) {
      const list = this.postings.get(t);
      if (list) {
        if (list[list.length - 1] !== ord) list.push(ord);
      } else {
        this.postings.set(t, [ord]);
        this.pending.push(t);
      }
    }
  }

  /** How many distinct tokens there are. */
  get size(): number {
    return this.postings.size;
  }

  clear(): void {
    this.postings.clear();
    this.sorted = [];
    this.pending = [];
  }

  private settle(): void {
    if (this.pending.length === 0) return;
    const fresh = this.pending.sort();
    this.pending = [];
    const out: string[] = new Array(this.sorted.length + fresh.length);
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < this.sorted.length && j < fresh.length) out[k++] = this.sorted[i]! <= fresh[j]! ? this.sorted[i++]! : fresh[j++]!;
    while (i < this.sorted.length) out[k++] = this.sorted[i++]!;
    while (j < fresh.length) out[k++] = fresh[j++]!;
    this.sorted = out;
  }

  /** Where the first token not below `prefix` is. */
  private lowerBound(prefix: string): number {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sorted[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Every message holding the token: any token that starts with it for a
   * word, or exactly it for a CJK character or pair. `size` is one past the
   * highest ordinal in use.
   */
  lookup(tok: Token, size: number): OrdSet {
    const out = new Uint8Array(size);
    const mark = (list: number[] | undefined) => {
      if (!list) return;
      for (const o of list) if (o < size) out[o] = 1;
    };
    if (!tok.prefix) {
      mark(this.postings.get(tok.text));
      return out;
    }
    this.settle();
    for (let i = this.lowerBound(tok.text); i < this.sorted.length; i++) {
      const t = this.sorted[i]!;
      if (!t.startsWith(tok.text)) break;
      mark(this.postings.get(t));
    }
    return out;
  }
}

/** Keeps only what is in both, in `a`; says whether anything is left. */
export function intersectInto(a: OrdSet, b: OrdSet): boolean {
  let any = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && !b[i]) a[i] = 0;
    else if (a[i]) any = true;
  }
  return any;
}

/** How many ordinals are in the set. */
export function countOf(a: OrdSet): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i]!;
  return n;
}
