import { describe, expect, it } from "vitest";
import { twemojiCode, twemojiUrl } from "./twemoji";

describe("twemojiCode", () => {
  it("names a plain emoji after its code point", () => {
    expect(twemojiCode("😀")).toBe("1f600");
    expect(twemojiCode("🎉")).toBe("1f389");
  });

  it("drops the variation selector when nothing is joined", () => {
    // ❤️ is U+2764 U+FE0F, but the file is 2764.svg.
    expect(twemojiCode("❤️")).toBe("2764");
    expect(twemojiCode("❤")).toBe("2764");
  });

  it("keeps the variation selector inside a joined sequence", () => {
    // 👩‍❤️‍👨 keeps FE0F because the parts are joined with U+200D.
    expect(twemojiCode("\u{1f469}‍❤️‍\u{1f468}")).toBe("1f469-200d-2764-fe0f-200d-1f468");
  });

  it("handles skin tones and flags", () => {
    expect(twemojiCode("\u{1f44d}\u{1f3fd}")).toBe("1f44d-1f3fd");
    expect(twemojiCode("\u{1f1ec}\u{1f1e7}")).toBe("1f1ec-1f1e7");
  });

  it("handles keycaps, which are three code points", () => {
    expect(twemojiCode("1️⃣")).toBe("31-20e3");
  });

  it("has nothing to say about an empty string", () => {
    expect(twemojiCode("")).toBeNull();
    expect(twemojiUrl("")).toBeNull();
  });

  it("builds a URL served by this instance, not a CDN", () => {
    const url = twemojiUrl("😀");
    expect(url).toBe("/twemoji/1f600.svg");
    expect(url).not.toMatch(/^https?:/);
  });
});
