import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nspell from "nspell";
import { beforeAll, describe, expect, it } from "vitest";
import { type Speller, speller } from "./checker";

/** The dictionaries the app checks with, as the worker loads them. */
function dictionary(name: string) {
  const dir = resolve(__dirname, "../../../node_modules", name);
  return { aff: readFileSync(resolve(dir, "index.aff"), "utf8"), dic: readFileSync(resolve(dir, "index.dic"), "utf8") };
}

const personal = new Set<string>();
let spell: Speller;
/** Hunspell on its own, which takes a word only in the case its list writes it. */
let strict: (word: string) => boolean;
const wrong = (text: string) => text.split(" ").filter((w) => !spell.correct(w));

beforeAll(() => {
  const dictionaries = [dictionary("dictionary-en"), dictionary("dictionary-en-gb")];
  spell = speller(dictionaries, personal);
  const lists = dictionaries.map((d) => nspell(d.aff, d.dic));
  strict = (word) => lists.some((l) => l.correct(word));
}, 30_000);

/** The slips a word is most often typed with: two letters swapped, one dropped, one doubled, one hit beside it. */
function slipsOf(word: string): string[] {
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const beside = (ch: string) => {
    const r = rows.findIndex((row) => row.includes(ch));
    const i = rows[r]!.indexOf(ch);
    return [rows[r]![i - 1], rows[r]![i + 1], rows[r - 1]?.[i], rows[r - 1]?.[i + 1], rows[r + 1]?.[i], rows[r + 1]?.[i - 1]].filter((c): c is string => !!c);
  };
  const out = new Set<string>();
  for (let i = 0; i < word.length; i++) {
    const [head, ch, tail] = [word.slice(0, i), word[i]!, word.slice(i + 1)];
    if (tail) out.add(head + tail[0] + ch + tail.slice(1));
    out.add(head + tail);
    out.add(head + ch + ch + tail);
    for (const near of beside(ch)) out.add(head + near + tail);
  }
  out.delete(word);
  return [...out].filter((s) => s.length >= 2);
}

describe("speller", () => {
  it("takes names, places, days, months and languages typed in lower case", () => {
    expect(wrong("sarah emily jake nora london paris monday tuesday january christmas english spanish netflix nintendo")).toEqual([]);
  });

  it("takes I and its contractions in lower case, with either apostrophe", () => {
    expect(wrong("i'm i've i'll i'd i’m i’ve")).toEqual([]);
  });

  it("takes acronyms typed in lower case, with their plurals and possessives", () => {
    expect(wrong("usa nasa pdf pdfs ceos tvs bff nasa's")).toEqual([]);
  });

  it("takes names with a capital inside typed in lower case", () => {
    expect(wrong("mcdonalds mcdonald's powerpoint playstation ipad ipads ios javascript paypal ebay")).toEqual([]);
  });

  it("still finds misspellings, in lower case or with a capital", () => {
    const slips = "teh wrold recieve thier becuase definately seperate Teh Wrold Londno";
    expect(wrong(slips)).toEqual(slips.split(" "));
  });

  it("checks words of two letters only as typed, so slips such as si for is stay wrong", () => {
    expect(wrong("si ni ot nd")).toEqual(["si", "ni", "ot", "nd"]);
    expect(wrong("it is in to and of")).toEqual([]);
  });

  it("knows words written as the dictionaries write them, and either spelling of English", () => {
    expect(wrong("Hello London Monday colour color NASA iPhone McDonald's")).toEqual([]);
  });

  it("takes an accented spelling of a word the lists write plain, and plurals they leave out", () => {
    expect(wrong("café naïve detections")).toEqual([]);
  });

  it("takes the words a person added, in any case, with their plurals", () => {
    personal.add("kaden");
    try {
      expect(wrong("kaden Kaden kadens")).toEqual([]);
    } finally {
      personal.delete("kaden");
    }
    expect(wrong("kaden")).toEqual(["kaden"]);
  });

  it("still catches nearly all the slips of common words that Hunspell on its own catches", () => {
    const common = (
      "the be to of and in that have it for not on with he as you do at this but his by from they we say her she or an will my one " +
      "all would there their what so up out if about who get which go me when make can like time no just him know take people into " +
      "year your good some could them see other than then now look only come its over think also back after use two how our work " +
      "first well way even new want because any these give day most us is was are been has had were said did got made really yeah " +
      "thanks please sorry maybe something always never still here where why game play friend love right should going doing tomorrow " +
      "today tonight later again sure fine great nice cool funny weird thing stuff home school talk call voice message send server " +
      "channel join leave wait help need feel tired sleep food watch stream video music song hear read write fun hard easy best " +
      "better bad happy sad same different every before since until while done gone came went told tell ask try find keep let put " +
      "run thought through together around enough probably actually literally basically definitely honestly anyway whatever okay"
    ).split(" ");
    const caught = common.flatMap(slipsOf).filter((s) => !strict(s));
    // what gets through is a name or an acronym in lower case (jake for make, aws for was): about 1.5% of them
    const missed = caught.filter((s) => spell.correct(s));
    expect(caught.length).toBeGreaterThan(5000);
    expect(missed.length / caught.length).toBeLessThan(0.02);
  });

  it("suggests spellings for a misspelling, nearest first, with the apostrophe it was typed with", () => {
    expect(spell.suggest("wrold")[0]).toBe("world");
    expect(spell.suggest("doesnt’")).not.toContain("doesn't");
    expect(spell.suggest("dosen’t")).toContain("doesn’t");
  });
});
