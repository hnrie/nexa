import { describe, expect, it } from "vitest";
import { customEmoji, readTypingStyle, sameTypingStyle, surpriseStyle, typingWordsKey, TYPING_PRESETS } from "./typingStyle";

describe("typing styles", () => {
  it("are read defensively, and nothing chosen is the plain style", () => {
    expect(readTypingStyle({ emoji: ["🐸", 3, "✨", "🔥", "🎉"], motion: "spin", preset: "yapping" })).toEqual({ emoji: ["🐸", "✨", "🔥"], motion: "wave", preset: "yapping" });
    expect(readTypingStyle({ emoji: [], motion: "pulse" })).toBeNull();
    expect(readTypingStyle({ preset: "barking" })).toBeNull();
    expect(readTypingStyle(null)).toBeNull();
    // own words win over a preset
    expect(readTypingStyle({ emoji: [], words: " is cooking ", preset: "tea" })).toEqual({ emoji: [], motion: "wave", words: "is cooking" });
  });

  it("know a server emoji from one that is itself", () => {
    expect(customEmoji("<a:party:123>")).toEqual({ id: "123", name: "party", animated: true });
    expect(customEmoji("🐸")).toBeNull();
  });

  it("compare by what they show", () => {
    expect(sameTypingStyle({ emoji: ["🐸"], motion: "wave", preset: "tea" }, { emoji: ["🐸"], motion: "wave", preset: "tea" })).toBe(true);
    expect(sameTypingStyle({ emoji: ["🐸"], motion: "wave" }, { emoji: ["🐸"], motion: "pulse" })).toBe(false);
    expect(sameTypingStyle(null, null)).toBe(true);
  });

  it("put the right words after the name", () => {
    expect(typingWordsKey(null)).toEqual({ key: "chat.typingBar.oneTyping" });
    expect(typingWordsKey({ emoji: [], motion: "wave", preset: "tea" })).toEqual({ key: "typing.presets.tea" });
    expect(typingWordsKey({ emoji: [], motion: "wave", words: "is here" })).toEqual({ key: "typing.own", words: "is here" });
  });

  it("surprise with a whole set that moves and has words, never the same twice running", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let before = surpriseStyle(null, random);
    for (let i = 0; i < 20; i++) {
      const next = surpriseStyle(before, random);
      expect(next.emoji).toHaveLength(3);
      expect(next.motion).not.toBe("still");
      expect(TYPING_PRESETS).toContain(next.preset);
      expect(sameTypingStyle(next, before)).toBe(false);
      before = next;
    }
  });
});
