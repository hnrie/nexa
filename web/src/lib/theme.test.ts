// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { presetTokens } from "./look/presets";
import type { CustomTheme } from "./look/types";
import { applyRememberedAppearance, applyTheme, rememberAppearance, rememberedAppearance, resolveLook } from "./theme";

const base = { accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false };
const custom: CustomTheme = { id: "custom-abcd1234", name: "Dusk", source: { kind: "simple", background: "#211a30", accent: "#e0537f", text: null, scheme: "dark" }, overrides: { link: "#88ccff" } };
const themeCss = () => document.getElementById("nexa-theme")?.textContent ?? "";

describe("the appearance remembered on this device", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset["theme"];
    document.getElementById("nexa-theme")?.remove();
  });

  it("comes back as it was kept", () => {
    rememberAppearance({ theme: "light", accent: "#3366ff", fontScale: 1.25, reducedMotion: true, underlineLinks: false });
    expect(rememberedAppearance()).toEqual({ theme: "light", accent: "#3366ff", fontScale: 1.25, reducedMotion: true, underlineLinks: false });
  });

  it("is nothing at all when none was kept, or when what was kept cannot be read", () => {
    expect(rememberedAppearance()).toBeNull();
    for (const bad of ["{", "null", "42", JSON.stringify({ theme: "neon" }), JSON.stringify({ accent: "#fff" }), JSON.stringify({ theme: "custom-abcd1234" })]) {
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

  it("covers the gallery's themes, and a custom theme together with its colours", () => {
    rememberAppearance({ ...base, theme: "forest-light" });
    expect(rememberedAppearance()?.theme).toBe("forest-light");
    // only the custom theme in use is kept, not every one the account has
    const other = { ...custom, id: "custom-zzzz9999" };
    rememberAppearance({ ...base, theme: custom.id, customThemes: [custom, other] });
    const back = rememberedAppearance();
    expect(back?.theme).toBe(custom.id);
    expect(back?.customThemes?.map((c) => c.id)).toEqual([custom.id]);
    applyRememberedAppearance();
    expect(themeCss()).toContain("--link:#88ccff");
  });

  it("keeps the pair that Sync with system moves between", () => {
    rememberAppearance({ ...base, theme: "system", systemThemes: { dark: "midnight", light: custom.id }, customThemes: [custom] });
    const back = rememberedAppearance();
    expect(back?.systemThemes).toEqual({ dark: "midnight", light: custom.id });
    expect(back?.customThemes?.map((c) => c.id)).toEqual([custom.id]);
  });
});

describe("drawing a theme", () => {
  beforeEach(() => {
    delete document.documentElement.dataset["theme"];
    document.getElementById("nexa-theme")?.remove();
  });

  it("leaves a classic theme to the stylesheet", () => {
    applyTheme({ ...base, theme: "ash" });
    expect(document.documentElement.dataset["theme"]).toBe("ash");
    expect(themeCss()).toBe("");
  });

  it("writes a preset's whole palette over the classic theme of its scheme", () => {
    applyTheme({ ...base, theme: "rose-light" });
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.dataset["look"]).toBe("rose-light");
    expect(themeCss()).toContain(`--bg-raised:${presetTokens("rose-light")!["bg-raised"]}`);
    applyTheme({ ...base, theme: "midnight" });
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("puts a chosen accent over the theme's own", () => {
    applyTheme({ ...base, theme: "forest", accent: "#e91e63" });
    const css = themeCss();
    expect(css.lastIndexOf("--brand:#e91e63")).toBeGreaterThan(css.indexOf("--brand:"));
  });

  it("underlines links in the themes that ask for it", () => {
    applyTheme({ ...base, theme: "greyscale" });
    expect(document.documentElement.dataset["underlineLinks"]).toBe("true");
    applyTheme({ ...base, theme: "forest" });
    expect(document.documentElement.dataset["underlineLinks"]).toBe("false");
  });

  it("sets the classic typeface when it is chosen, and takes it off again", () => {
    applyTheme({ ...base, theme: "dark", fontFace: "classic" });
    expect(document.documentElement.dataset["font"]).toBe("classic");
    applyTheme({ ...base, theme: "dark", fontFace: "default" });
    expect(document.documentElement.dataset["font"]).toBeUndefined();
    applyTheme({ ...base, theme: "dark" });
    expect(document.documentElement.dataset["font"]).toBeUndefined();
  });

  it("remembers the classic typeface for the next first frame, and nothing for the default", () => {
    rememberAppearance({ ...base, theme: "dark", fontFace: "classic" });
    expect(rememberedAppearance()?.fontFace).toBe("classic");
    rememberAppearance({ ...base, theme: "dark", fontFace: "default" });
    expect(rememberedAppearance()?.fontFace).toBeUndefined();
  });

  it("draws a missing custom theme as Dark rather than as nothing", () => {
    expect(resolveLook({ ...base, theme: "custom-gone0000" }).id).toBe("dark");
    expect(resolveLook({ ...base, theme: custom.id, customThemes: [custom] }).tokens?.link).toBe("#88ccff");
  });

  it("draws a draft over whatever is saved", () => {
    const tokens = presetTokens("ocean-light")!;
    applyTheme({ ...base, theme: "dark" }, { tokens, scheme: "light" });
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(themeCss()).toContain(`--bg-base:${tokens["bg-base"]}`);
  });
});
