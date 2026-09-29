/**
 * How far apart two words are as typos go: a letter added, dropped or
 * changed costs 1, two letters swapped only half that, as it is the commonest
 * slip ("teh", "tset"). Capitals do not count.
 */
export function typoDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const change = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + change);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 0.5);
      d[i]![j] = best;
    }
  }
  return d[x.length]![y.length]!;
}

/**
 * A handful of the likeliest spellings, with the apostrophe the word was
 * typed with: the dictionaries' own, nearest typo first, then those that
 * start with the same letter, then in the dictionaries' order.
 */
export function rank(word: string, found: string[]): string[] {
  const first = word.charAt(0).toLowerCase();
  return found
    .map((s, i) => ({ s, i, cost: typoDistance(word, s), other: s.charAt(0).toLowerCase() !== first }))
    .sort((a, b) => a.cost - b.cost || Number(a.other) - Number(b.other) || a.i - b.i)
    .map((x) => x.s);
}
