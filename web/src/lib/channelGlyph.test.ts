import { describe, expect, it } from "vitest";
import { channelLabel, glyphString, parseGlyph } from "./channelGlyph";

describe("channel glyphs", () => {
  it("reads the three kinds and writes them back", () => {
    for (const raw of ["icon:megaphone", "icon:gamepad", "emoji:🎉", "emoji:👩🏽‍💻", "custom:123456789012345678"]) {
      expect(glyphString(parseGlyph(raw))).toBe(raw);
    }
    expect(parseGlyph("icon:megaphone")).toEqual({ kind: "icon", name: "megaphone" });
    expect(parseGlyph("emoji:🎉")).toEqual({ kind: "emoji", text: "🎉" });
    expect(parseGlyph("custom:42")).toEqual({ kind: "custom", id: "42" });
  });

  it("treats none, and anything it cannot read, as the default", () => {
    for (const raw of [undefined, null, "", "megaphone", ":x", "icon:", "icon:Mega", "icon:a b", "custom:abc", "custom:", "url:https://x", "emoji:"]) {
      expect(parseGlyph(raw)).toBeNull();
    }
    expect(glyphString(null)).toBe("");
  });

  it("names a channel in plain text with its emoji, or its #", () => {
    expect(channelLabel({ name: "general" })).toBe("#general");
    expect(channelLabel({ name: "news", glyph: "icon:megaphone" })).toBe("#news");
    expect(channelLabel({ name: "party", glyph: "emoji:🎉" })).toBe("🎉 party");
    expect(channelLabel({ name: "memes", glyph: "custom:42" })).toBe("#memes");
  });
});
