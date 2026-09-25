/**
 * How search reads text.
 *
 * Text is folded before it is compared, so that what someone types finds what
 * was written however either was spelled: case does not matter, nor do the
 * accents of Latin, Greek and Cyrillic letters ("cafe" finds "café"), nor the
 * vowel marks of Arabic, nor full-width or ligature forms. Marks that are part
 * of a letter elsewhere stay: a Devanagari vowel sign or a Japanese voicing
 * mark changes the word, so dropping it would match the wrong one.
 *
 * Folded text is then cut into the words the index is keyed by. Chinese and
 * Japanese are written without spaces, so their runs are cut into characters
 * and pairs of characters instead of words, the usual way to search them
 * without a dictionary.
 *
 * Nothing here touches the DOM or React: the search worker runs it too.
 */

/** Scripts whose combining accents are decoration a search should see through. */
const ACCENTED = /(\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic})\p{M}+/gu;
/** Arabic vowel marks, the superscript alef and the tatweel stretch. */
const ARABIC_MARKS = /[ً-ٰٟـ]/g;
const PLAIN_ASCII = /^[\x00-\x7f]*$/;

/**
 * Folds text for comparison. `fold(a).includes(fold(b))` is how search asks
 * whether `a` contains `b`.
 */
export function fold(text: string): string {
  if (PLAIN_ASCII.test(text)) return text.toLowerCase();
  return text
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFKD")
    .replace(ACCENTED, "$1")
    .replace(ARABIC_MARKS, "")
    .normalize("NFC")
    .replace(/ς/g, "σ")
    .replace(/ß/g, "ss");
}

/** One character as a reader sees it: a base and the marks that sit on it. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

export interface Folded {
  /** The text as it will be shown (NFC), which positions below refer to. */
  shown: string;
  /** The folded text; the same as `fold(shown)`. */
  folded: string;
  /**
   * For each UTF-16 unit of `folded`, where the character it came from starts
   * in `shown`; one extra entry at the end holds `shown.length`.
   */
  map: number[];
}

/**
 * Folds text and remembers where every folded character came from, so a match
 * found in the folded text can be marked in the text as written: "café" is
 * found by "cafe", and it is "café" that is highlighted.
 */
export function foldWithMap(text: string): Folded {
  const shown = text.normalize("NFC");
  if (PLAIN_ASCII.test(shown)) {
    const map = Array.from({ length: shown.length + 1 }, (_, i) => i);
    return { shown, folded: shown.toLowerCase(), map };
  }
  let folded = "";
  const map: number[] = [];
  for (const m of shown.matchAll(CLUSTER)) {
    const piece = fold(m[0]);
    for (let k = 0; k < piece.length; k++) map.push(m.index);
    folded += piece;
  }
  map.push(shown.length);
  return { shown, folded, map };
}

/** Chinese characters and Japanese kana, which are written without spaces. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Letters, digits and the marks on them: everything else separates words. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
/** The Arabic definite article, which is written joined to its word. */
const ARABIC_THE = /^ال(?=\p{Script=Arabic}{2,})/u;

/** A word the index is keyed by, and whether it may be matched by its beginning. */
export interface Token {
  text: string;
  /**
   * False for the characters and pairs a CJK run is cut into, which only mean
   * something whole; true for words, which a search finds by their beginning.
   */
  prefix: boolean;
}

/** Splits a word into its runs of CJK and of everything else. */
function* runs(word: string): Generator<{ text: string; cjk: boolean }> {
  let start = 0;
  let cjk: boolean | null = null;
  let i = 0;
  for (const ch of word) {
    const isCjk = CJK.test(ch);
    if (cjk !== null && isCjk !== cjk) {
      yield { text: word.slice(start, i), cjk };
      start = i;
    }
    cjk = isCjk;
    i += ch.length;
  }
  if (cjk !== null && start < word.length) yield { text: word.slice(start), cjk };
}

/**
 * The tokens of text that is already folded, in order, repeats included (a
 * word said twice counts twice towards how well a message matches).
 */
export function tokenize(folded: string): Token[] {
  const out: Token[] = [];
  for (const m of folded.matchAll(WORD)) {
    for (const run of runs(m[0])) {
      if (!run.cjk) {
        out.push({ text: run.text, prefix: true });
        // "الكتاب" (the book) is found by "كتاب" (book), as a reader expects
        const bare = run.text.replace(ARABIC_THE, "");
        if (bare !== run.text) out.push({ text: bare, prefix: true });
        continue;
      }
      const chars = Array.from(run.text);
      if (chars.length === 1) {
        out.push({ text: chars[0]!, prefix: false });
        continue;
      }
      for (let i = 0; i < chars.length; i++) {
        out.push({ text: chars[i]!, prefix: false });
        if (i + 1 < chars.length) out.push({ text: chars[i]! + chars[i + 1]!, prefix: false });
      }
    }
  }
  return out;
}

/**
 * What a search term needs from the index: every token it is made of. A word
 * ("need") asks for any token that starts with it; a CJK run of two or more
 * characters asks for each of its pairs, and one character for itself.
 */
export function termTokens(folded: string): Token[] {
  const out: Token[] = [];
  for (const m of folded.matchAll(WORD)) {
    for (const run of runs(m[0])) {
      if (!run.cjk) {
        out.push({ text: run.text, prefix: true });
        continue;
      }
      const chars = Array.from(run.text);
      if (chars.length === 1) out.push({ text: chars[0]!, prefix: false });
      for (let i = 0; i + 1 < chars.length; i++) out.push({ text: chars[i]! + chars[i + 1]!, prefix: false });
    }
  }
  return out;
}

/** A run of text, and whether it is part of a match. */
export interface Run {
  text: string;
  hit: boolean;
}

/**
 * Splits text into highlighted and plain runs for every place a needle occurs.
 * Needles are folded; matching is on the folded text and marking on the text
 * as written, so an accent or a capital never stops a match from showing.
 */
export function highlightRuns(text: string, needles: string[]): Run[] {
  const wanted = [...new Set(needles.filter(Boolean))];
  const { shown, folded, map } = foldWithMap(text);
  if (wanted.length === 0 || !shown) return shown ? [{ text: shown, hit: false }] : [];
  const spans: [number, number][] = [];
  for (const n of wanted) {
    let at = folded.indexOf(n);
    while (at >= 0) {
      spans.push([at, at + n.length]);
      at = folded.indexOf(n, at + Math.max(1, n.length));
    }
  }
  if (spans.length === 0) return [{ text: shown, hit: false }];
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  // Overlapping and touching matches ("need" and "needle") read as one.
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const out: Run[] = [];
  let pos = 0;
  for (const [from, to] of merged) {
    const start = map[from]!;
    // A match ends where the next written character starts, so one that ends
    // halfway through a character's folding (the first "s" of the "ss" a "ß"
    // folds to) still marks the whole of that character.
    const last = map[to - 1]!;
    let k = to;
    // (the entry past the end holds the text's length, so this always stops)
    while (k < map.length - 1 && map[k]! <= last) k++;
    const end = map[k]!;
    if (start < pos) continue;
    if (start > pos) out.push({ text: shown.slice(pos, start), hit: false });
    if (end > start) out.push({ text: shown.slice(start, end), hit: true });
    pos = Math.max(pos, end);
  }
  if (pos < shown.length) out.push({ text: shown.slice(pos), hit: false });
  return out;
}
