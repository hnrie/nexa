import { luminance, profileThemeOf } from "./avatarColor";

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
