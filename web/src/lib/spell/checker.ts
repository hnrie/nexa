import nspell from "nspell";
import { pluralStems } from "./inflect";
import { rank } from "./rank";

/** A Hunspell dictionary: its affix rules and its word list. */
export interface Dictionary {
  aff: string;
  dic: string;
}

export interface Speller {
  /** Whether a word is spelled right. */
  correct(word: string): boolean;
  /** The likeliest spellings of a word, nearest first. */
  suggest(word: string): string[];
}

/** The dictionaries spell "don't" with a straight apostrophe; a phone or a Mac types a curly one. */
const straight = (word: string) => word.replace(/’/g, "'");

/**
 * Below this many letters a word is checked only as it is typed: given its
 * capitals, a slip of two letters too often turns into a name or a symbol
 * ("si" for "is" is silicon, "nd" for "and" neodymium).
 */
const MIN_RECASED = 3;

/**
 * Checks spelling against Hunspell dictionaries (a word any of them spells
 * right is right) and the words a person added themselves.
 *
 * The dictionaries list a name, a place, a day, a language or an acronym only
 * with its capitals, and Hunspell takes it no other way, while people chat in
 * lower case: "london", "monday", "i'm", "usa" and "iphone" are all right here.
 */
export function speller(dictionaries: Dictionary[], personal: ReadonlySet<string>): Speller {
  const lists = dictionaries.map((d) => nspell(d.aff, d.dic));
  // in lower case, the names the lists write with a capital inside (iPhone, McDonald, PowerPoint), which
  // no single change of case gives back, and the acronyms (PDF, CEO), most of which they give no plural
  const mixed = new Set<string>();
  const acronyms = new Set<string>();
  for (const d of dictionaries) {
    for (const line of d.dic.split("\n")) {
      const stem = line.split("/")[0]!.trim();
      if (!/\p{Lu}/u.test(stem.slice(1))) continue;
      if (stem === stem.toUpperCase()) acronyms.add(stem.toLowerCase());
      else if (stem.length >= MIN_RECASED) mixed.add(stem.toLowerCase());
    }
  }

  const listed = (w: string) => lists.some((l) => l.correct(w));
  /** As typed, and, for a word long enough, in whatever case the lists write it. */
  const known = (w: string): boolean => {
    if (listed(w)) return true;
    if (w.length < MIN_RECASED) return false;
    const lower = w.toLowerCase();
    if (lower.endsWith("'s")) return known(w.slice(0, -2));
    const upper = w.toUpperCase();
    return (
      // in capitals Hunspell takes a word the lists write any way but with a capital inside: london, i'm, usa
      listed(upper) ||
      // an acronym's plural, as the lists give it (tvs) or, as most have none, one of three letters or more (pdfs)
      (lower.endsWith("s") && (listed(upper.slice(0, -1) + "s") || (lower.length > MIN_RECASED && acronyms.has(lower.slice(0, -1))))) ||
      mixed.has(lower)
    );
  };

  return {
    correct(word) {
      if (personal.has(word.toLowerCase())) return true;
      const w = straight(word);
      if (known(w)) return true;
      // the word lists spell "café" as "cafe": an accented spelling of a word they know is right too
      const plain = w.normalize("NFD").replace(/\p{M}/gu, "");
      if (plain !== w && known(plain)) return true;
      // they give many nouns no plural ("detection" but not "detections"): a plural of a word they know is right
      return pluralStems(w).some((stem) => personal.has(stem) || known(stem));
    },
    suggest(word) {
      const curly = word.includes("’");
      const found: string[] = [];
      for (const l of lists) {
        for (const s of l.suggest(straight(word))) {
          const shown = curly ? s.replace(/'/g, "’") : s;
          if (!found.includes(shown)) found.push(shown);
        }
      }
      return rank(word, found).slice(0, 5);
    },
  };
}
