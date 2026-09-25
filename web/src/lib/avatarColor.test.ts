import { initials, luminance, profileThemeOf } from "./avatarColor";

describe("initials", () => {
  it("takes the first character as a reader sees it", () => {
    expect(initials("ana")).toBe("A");
    expect(initials("  émile")).toBe("É");
    // a flag and a family are one picture each, not their first code point
    expect(initials("🇩🇪 Berlin")).toBe("🇩🇪");
    expect(initials("👨‍👩‍👧 family")).toBe("👨‍👩‍👧");
    expect(initials("e\u0301cole")).toBe("E\u0301");
  });

  it("keeps a letter whose capital is two letters", () => {
    expect(initials("ßtraße")).toBe("ß");
  });

  it("has a stand-in for a blank name", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("profile themes", () => {
  it("needs both colours", () => {
    expect(profileThemeOf(0x5865f2, null)).toBeNull();
    expect(profileThemeOf(null, 0x5865f2)).toBeNull();
  });

  it("runs from the first colour to the second, with text that reads on them", () => {
    expect(profileThemeOf(0x1e1f22, 0x5865f2)).toEqual({ top: "#1e1f22", bottom: "#5865f2", text: "light" });
    expect(profileThemeOf(0xfff4c2, 0xffc9e0)).toEqual({ top: "#fff4c2", bottom: "#ffc9e0", text: "dark" });
  });

  it("measures luminance", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
  });
});
