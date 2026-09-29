import { describe, expect, it } from "vitest";
import { wordAt, wordsOf } from "./index";

const words = (text: string) => wordsOf(text).map((w) => w.word);

describe("wordsOf", () => {
  it("finds the words of plain prose, with where each one is", () => {
    expect(wordsOf("hello wrold")).toEqual([
      { word: "hello", start: 0, end: 5 },
      { word: "wrold", start: 6, end: 11 },
    ]);
  });

  it("keeps apostrophes inside a word, straight or curly, and leaves quotes around one out", () => {
    expect(words("don't can’t 'quoted'")).toEqual(["don't", "can’t", "quoted"]);
  });

  it("leaves out what is not prose: code, links, addresses, mentions, channels, emoji and timestamps", () => {
    const text = "see `teh code` and ```\nblok\n``` at https://exmaple.com/pth or www.exmaple.com, mail me@exmaple.com, <@123> <#456> <:blob:789> :thumbsup: <t:1700000000:R> #genral @nroa";
    expect(words(text)).toEqual(["see", "and", "at", "or", "mail"]);
  });

  it("skips single letters, words in capitals, words with a capital inside and words glued to digits", () => {
    expect(words("a I HTML iPhone JavaScript abc123 x2 ok")).toEqual(["ok"]);
  });

  it("knows how people chat", () => {
    expect(words("lol ngl tbh idk that was gg")).toEqual(["that", "was"]);
  });

  it("leaves other scripts alone", () => {
    expect(words("привет こんにちは مرحبا hello")).toEqual(["hello"]);
  });

  it("keeps each word where it was around text it blanked out", () => {
    const text = "`x` teh";
    const [w] = wordsOf(text);
    expect(text.slice(w!.start, w!.end)).toBe("teh");
  });
});

describe("wordAt", () => {
  it("finds the word a caret is in or at the end of", () => {
    expect(wordAt("hello wrold", 8)?.word).toBe("wrold");
    expect(wordAt("hello wrold", 11)?.word).toBe("wrold");
    expect(wordAt("hello wrold", 6)?.word).toBe("wrold");
  });

  it("finds nothing on a word that is not checked", () => {
    expect(wordAt("see https://exmaple.com", 12)).toBeNull();
  });
});
