/**
 * Lining up two lists of the same kind of thing: which items of one are still
 * there in the other, in order. Merging two people's changes to a note uses it
 * on lines and words, and the editor on paragraphs, to tell what of a note
 * stayed as it was when someone else's change arrives.
 */

/** Above this many cells the table of matches is not built, and the two stretches count as wholly different. */
const MAX_CELLS = 4_000_000;

/**
 * For each item of `a`, the index of the item of `b` it matches in a longest
 * common subsequence, or -1.
 */
export function alignment(a: string[], b: string[]): Int32Array {
  const map = new Int32Array(a.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    map[start] = start;
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    map[endA] = endB;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return map;
  // lengths of the longest common subsequence of the tails a[i:], b[j:]
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[start + i] === b[start + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      map[start + i] = start + j;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  return map;
}
