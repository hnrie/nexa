/**
 * Every language ships the same strings.
 *
 * A catalogue that has drifted — a missing key, a placeholder that got
 * translated along with the words around it, a plural form the language never
 * selects — shows up as English in the middle of a sentence, or as a literal
 * `{count}` on screen. Cheaper to catch here than to read about later.
 */
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import { LANGUAGES, type Catalog, type Message } from "./core";

const files = import.meta.glob<{ default: Catalog }>("./locales/*.json", { eager: true });
const english = en as Catalog;
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(m: Message): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const hit of s.matchAll(PLACEHOLDER)) out.add(hit[1]!);
  };
  if (typeof m === "string") add(m);
  else for (const form of Object.values(m)) if (form) add(form);
  return out;
}

const translations = LANGUAGES.filter((l) => l.tag !== "en");

describe("locales", () => {
  it("ships a catalogue for every language the picker offers", () => {
    for (const l of translations) expect(files[`./locales/${l.tag}.json`], l.tag).toBeDefined();
  });

  for (const { tag } of translations) {
    const catalog = files[`./locales/${tag}.json`]!.default;
    // The categories this language actually selects, so no form sits unused.
    // The big round numbers matter: Spanish, French and Portuguese only reach
    // `many` up in the millions, and a loop over small integers never sees it.
    const rules = new Intl.PluralRules(tag);
    const allowed = new Set<string>(["other"]);
    for (let n = 0; n < 200; n++) allowed.add(rules.select(n));
    for (const n of [1.5, 1e3, 1e6, 1e9, 2e6, 1.000001e6]) allowed.add(rules.select(n));

    it(`${tag} has every key, and no key English does not`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
    });

    it(`${tag} keeps every placeholder`, () => {
      for (const [key, value] of Object.entries(catalog)) {
        expect([key, [...placeholders(value)].sort()]).toEqual([key, [...placeholders(english[key]!)].sort()]);
      }
    });

    it(`${tag} counts in the forms its language uses`, () => {
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof english[key] === "string") {
          expect(typeof value, key).toBe("string");
          continue;
        }
        expect(typeof value, key).toBe("object");
        const forms = value as Exclude<Message, string>;
        expect(forms.other, key).toBeTruthy();
        for (const form of Object.keys(forms)) expect([key, form, allowed.has(form)]).toEqual([key, form, true]);
      }
    });
  }
});
