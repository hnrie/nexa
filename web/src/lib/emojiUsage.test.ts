import { describe, expect, it } from "vitest";
import { customKey, emojiKeysIn, HALF_LIFE_MS, KEEP, rankedKeys, reactionKey, sanitizeUsage, scoreOf, unicodeKey, withUse } from "./emojiUsage";

describe("emoji usage", () => {
  it("counts every skin tone of an emoji as the same one", () => {
    expect(unicodeKey("👍🏽")).toBe(unicodeKey("👍"));
    expect(unicodeKey("❤️")).toBe(unicodeKey("❤"));
    expect(reactionKey("a:party:123")).toBe(customKey("123"));
    expect(reactionKey(":blob:9")).toBe("c:9");
    expect(reactionKey("🔥")).toBe(unicodeKey("🔥"));
  });

  it("halves a score for every week it goes unused", () => {
    const now = 1_000_000_000_000;
    const u = withUse({}, ["a"], now);
    expect(scoreOf(u["a"], now)).toBe(1);
    expect(scoreOf(u["a"], now + HALF_LIFE_MS)).toBeCloseTo(0.5);
    const again = withUse(u, ["a"], now + HALF_LIFE_MS);
    expect(scoreOf(again["a"], now + HALF_LIFE_MS)).toBeCloseTo(1.5);
  });

  it("ranks by use, most first, and keeps only the highest", () => {
    const now = 5_000;
    let u = {};
    for (let i = 0; i < 3; i++) u = withUse(u, ["often"], now);
    u = withUse(u, ["once", "often"], now);
    expect(rankedKeys(u, now)).toEqual(["often", "once"]);
    for (let i = 0; i < KEEP + 10; i++) u = withUse(u, [`k${i}`], now);
    expect(Object.keys(u)).toHaveLength(KEEP);
    expect(Object.keys(u)).toContain("often");
  });

  it("finds each emoji a message uses once, custom ones by their picture, and none inside code", () => {
    const keys = emojiKeysIn("hi 😂😂 and <:party:77> **🔥** `🙃`\n```\n🙃\n```");
    expect(keys).toEqual([unicodeKey("😂"), customKey("77"), unicodeKey("🔥")]);
    expect(emojiKeysIn("")).toEqual([]);
  });

  it("reads a stored copy defensively", () => {
    expect(sanitizeUsage(null)).toEqual({});
    expect(sanitizeUsage([1])).toEqual({});
    expect(sanitizeUsage({ a: { s: 2, at: 1 }, b: { s: "x", at: 1 }, c: { s: -1, at: 1 }, d: null })).toEqual({ a: { s: 2, at: 1 } });
  });
});
