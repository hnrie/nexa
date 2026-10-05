/**
 * AutoMod's matching, as the server's internal/automod does it: text read past
 * the usual disguises, and a rule's words (with * wildcards), patterns and
 * allowed words matched against it. internal/automod/testdata/vectors.json
 * holds the cases this and the server (and the Android app) agree on.
 */

/** Letters from other scripts and symbols that pass for Latin ones. */
const CONFUSABLES: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ү": "y", "һ": "h", "ɡ": "g",
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
  "ł": "l", "ø": "o", "đ": "d", "ß": "s", "æ": "a", "œ": "o", "ı": "i", "ƒ": "f", "€": "e", "¢": "c", "£": "l", "¥": "y",
};

/** Digits and symbols swapped for letters. */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };

const INVISIBLE = /[​‌‍⁠﻿­᠎]|\p{Cf}/u;
const MARK = /\p{M}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const SPELL_SEP = " .-_*,~/\\";

/** Folded text, and the spelled-out runs put back together within it. */
function foldWithRuns(s: string): { text: string; runs: string[] } {
  const runes: string[] = [];
  for (const ch of s.normalize("NFKD")) {
    if (MARK.test(ch) || INVISIBLE.test(ch)) continue;
    let c = ch.toLowerCase();
    c = CONFUSABLES[c] ?? c;
    c = LEET[c] ?? c;
    runes.push(c);
  }
  return joinSpelled(runes);
}

/**
 * Reads text the way a rule should see it: lower case, without accents or the
 * marks stacked on letters, look-alike letters and number swaps read as the
 * letters they stand for, invisible characters gone, and letters spelled out
 * one at a time with the same thing between each put back together.
 */
export function fold(s: string): string {
  return foldWithRuns(s).text;
}

function isLetterOrDigit(c: string | undefined): boolean {
  return c !== undefined && LETTER_OR_DIGIT.test(c);
}

function single(r: string[], i: number): boolean {
  return isLetterOrDigit(r[i]) && (i === 0 || !isLetterOrDigit(r[i - 1])) && (i + 1 >= r.length || !isLetterOrDigit(r[i + 1]));
}

function joinSpelled(r: string[]): { text: string; runs: string[] } {
  const out: string[] = [];
  const runs: string[] = [];
  for (let i = 0; i < r.length; ) {
    if (single(r, i) && i + 2 < r.length && SPELL_SEP.includes(r[i + 1]!) && single(r, i + 2)) {
      const sep = r[i + 1];
      const letters = [r[i]!];
      let j = i;
      while (j + 2 < r.length && r[j + 1] === sep && single(r, j + 2)) {
        letters.push(r[j + 2]!);
        j += 2;
      }
      if (letters.length >= 3) {
        out.push(...letters);
        runs.push(letters.join(""));
        i = j + 1;
        continue;
      }
    }
    out.push(r[i]!);
    i++;
  }
  return { text: out.join(""), runs };
}

const WORD_CHAR = /[\p{L}\p{N}_']/u;

interface Term {
  text: string;
  /** A * after: starts a word. */
  prefix: boolean;
  /** A * before: ends a word. */
  suffix: boolean;
}

function parseTerm(w: string): Term | null {
  const trimmed = w.trim();
  const text = trimmed.replace(/^\*+|\*+$/g, "").toLowerCase();
  if (!text) return null;
  return { text, prefix: trimmed.endsWith("*"), suffix: trimmed.startsWith("*") };
}

/** Where a term occurs in text as a whole word or phrase, unless a * lets it be part of one. */
function findTerm(t: Term, text: string): [number, number] | null {
  let from = 0;
  for (;;) {
    const start = text.indexOf(t.text, from);
    if (start < 0) return null;
    const end = start + t.text.length;
    const before = start > 0 ? Array.from(text.slice(0, start)).pop() : undefined;
    const after = end < text.length ? Array.from(text.slice(end))[0] : undefined;
    const startOK = t.suffix || start === 0 || !WORD_CHAR.test(before ?? "");
    const endOK = t.prefix || end === text.length || !WORD_CHAR.test(after ?? "");
    if (startOK && endOK) return [start, end];
    from = start + 1;
  }
}

function escape(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** A term as a pattern over folded text, letters free to be stretched; bare leaves out the word edges. */
function fuzzyPattern(t: Term, bare: boolean): string {
  let p = !t.suffix && !bare ? "(?:^|[^\\p{L}\\p{N}_'])" : "";
  p += "(";
  for (const c of t.text) {
    if (/\s/u.test(c)) p += "[\\s\\p{P}]+";
    else if (/\p{L}/u.test(c)) p += escape(c) + "+";
    else p += escape(c);
  }
  p += ")";
  if (!t.prefix && !bare) p += "(?:$|[^\\p{L}\\p{N}_'])";
  return p;
}

function wildcardForm(t: Term): string {
  return (t.suffix ? "*" : "") + t.text + (t.prefix ? "*" : "");
}

/** A rule's words, patterns and allowed words, ready to match. */
export class Matcher {
  private terms: Term[] = [];
  private allow: Term[] = [];
  private fuzzy: RegExp | null = null;
  private fuzzyEach: (RegExp | null)[] = [];
  private bareEach: (RegExp | null)[] = [];
  private regexes: RegExp[] = [];

  constructor(words: readonly string[], patterns: readonly string[], allow: readonly string[], evasion: boolean) {
    const alts: string[] = [];
    for (const w of words) {
      const t = parseTerm(w);
      if (!t) continue;
      this.terms.push(t);
      if (evasion) {
        const ft: Term = { text: fold(t.text), prefix: t.prefix, suffix: t.suffix };
        const p = fuzzyPattern(ft, false);
        try {
          this.fuzzyEach.push(new RegExp(p, "u"));
          alts.push(p);
        } catch {
          this.fuzzyEach.push(null);
        }
        try {
          this.bareEach.push(new RegExp(fuzzyPattern(ft, true), "u"));
        } catch {
          this.bareEach.push(null);
        }
      }
    }
    if (alts.length) {
      try {
        this.fuzzy = new RegExp(alts.join("|"), "u");
      } catch {
        this.fuzzy = null;
      }
    }
    for (const w of allow) {
      const t = parseTerm(w);
      if (t) this.allow.push(t);
    }
    for (const p of patterns) {
      try {
        this.regexes.push(new RegExp(p, "iu"));
      } catch {
        // written for the server's matcher: left out where this one cannot read it
      }
    }
  }

  private withoutAllowed(text: string): string {
    for (const a of this.allow) {
      for (;;) {
        const at = findTerm(a, text);
        if (!at) break;
        text = text.slice(0, at[0]) + " ".repeat(at[1] - at[0]) + text.slice(at[1]);
      }
    }
    return text;
  }

  /** The first of the rule's words or patterns in text, as the rule wrote it (or what a pattern matched); null for none. */
  match(text: string): string | null {
    if (!text.trim()) return null;
    const low = this.withoutAllowed(text.toLowerCase());
    for (const t of this.terms) if (findTerm(t, low)) return wildcardForm(t);
    if (this.fuzzy) {
      const f = foldWithRuns(text);
      const folded = this.withoutAllowed(f.text);
      if (this.fuzzy.test(folded)) {
        for (let i = 0; i < this.fuzzyEach.length; i++) if (this.fuzzyEach[i]?.test(folded)) return wildcardForm(this.terms[i]!);
      }
      for (const run of f.runs) {
        if (!this.withoutAllowed(run).trim()) continue;
        for (let i = 0; i < this.bareEach.length; i++) if (this.bareEach[i]?.test(run)) return wildcardForm(this.terms[i]!);
      }
    }
    for (const re of this.regexes) {
      const m = re.exec(text);
      if (m && m[0]) return m[0];
    }
    return null;
  }
}
