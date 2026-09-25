// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyRememberedAppearance, rememberAppearance, rememberedAppearance } from "./theme";

describe("the appearance remembered on this device", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset["theme"];
  });

  it("comes back as it was kept", () => {
    rememberAppearance({ theme: "light", accent: "#3366ff", fontScale: 1.25, reducedMotion: true, underlineLinks: false });
    expect(rememberedAppearance()).toEqual({ theme: "light", accent: "#3366ff", fontScale: 1.25, reducedMotion: true, underlineLinks: false });
  });

  it("is nothing at all when none was kept, or when what was kept cannot be read", () => {
    expect(rememberedAppearance()).toBeNull();
    for (const bad of ["{", "null", "42", JSON.stringify({ theme: "neon" }), JSON.stringify({ accent: "#fff" })]) {
      localStorage.setItem("ec:appearance", bad);
      expect(rememberedAppearance()).toBeNull();
    }
  });

  it("keeps a readable theme and drops only the parts that are not", () => {
    localStorage.setItem("ec:appearance", JSON.stringify({ theme: "ash", accent: "url(x)", fontScale: "big", reducedMotion: "yes" }));
    expect(rememberedAppearance()).toEqual({ theme: "ash", accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false });
  });

  it("is on the page before anything renders", () => {
    rememberAppearance({ theme: "light", accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false });
    applyRememberedAppearance();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });
});
