import { describe, expect, it } from "vitest";
import { contrastIssues, fixContrast } from "./contrast";
import { exportTheme, importTheme, isCustomId, newThemeId, resolveCustom, sanitizeThemes } from "./customTheme";
import { presetTokens } from "./presets";
import { CLASSIC } from "./tokens";
import type { CustomTheme } from "./types";

const simple: CustomTheme = { id: "custom-abcd1234", name: "Dusk", source: { kind: "simple", background: "#211a30", accent: "#e0537f", text: null, scheme: "dark" }, overrides: {} };

describe("custom themes", () => {
  it("get ids of their own", () => {
    const id = newThemeId();
    expect(isCustomId(id)).toBe(true);
    expect(newThemeId()).not.toBe(id);
  });

  it("lay colours set by hand over what their source gives", () => {
    const t: CustomTheme = { ...simple, source: { kind: "preset", id: "forest" }, overrides: { link: "#ff00ff" } };
    const r = resolveCustom(t);
    expect(r.tokens.link).toBe("#ff00ff");
    expect(r.tokens["bg-raised"]).toBe(presetTokens("forest")!["bg-raised"]);
    expect(r.scheme).toBe("dark");
  });

  it("turn light when their background is made light", () => {
    const t: CustomTheme = { ...simple, source: { kind: "preset", id: "dark" }, overrides: { "bg-raised": "#ffffff" } };
    expect(resolveCustom(t).scheme).toBe("light");
  });

  it("keep only what can be drawn when read from another device", () => {
    const list = sanitizeThemes([
      simple,
      simple, // the same id twice
      { ...simple, id: "not-an-id" },
      { ...simple, id: "custom-zzzz0000", source: { kind: "preset", id: "no-such-preset" } },
      { ...simple, id: "custom-yyyy0000", overrides: { text: "url(javascript:alert(1))", link: "#123456", "bg-base": "#11223380", nonsense: "#fff" } },
      "a string",
      null,
    ]);
    expect(list.map((t) => t.id)).toEqual(["custom-abcd1234", "custom-yyyy0000"]);
    // a panel may not be see-through; a tint may
    expect(list[1]!.overrides).toEqual({ link: "#123456", "bg-base": "#112233" });
  });
});

describe("sharing a theme as a file", () => {
  it("comes back the same", () => {
    const t: CustomTheme = { ...simple, overrides: { "code-string": "#a0e0a0" } };
    const back = importTheme(exportTheme(t), "Imported");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.theme.name).toBe("Dusk");
    expect(back.theme.source).toEqual(t.source);
    expect(back.theme.overrides).toEqual(t.overrides);
    expect(back.theme.id).not.toBe(t.id);
    expect(resolveCustom(back.theme).tokens).toEqual(resolveCustom(t).tokens);
  });

  it("takes a bare list of colours, keeping what differs from the classic theme", () => {
    const back = importTheme(JSON.stringify({ name: "Plain", colors: { "--bg-raised": "#fefefe", text: "#101010", "bg-surface": "#ebeced" } }), "Imported");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.theme.source).toEqual({ kind: "preset", id: "light" });
    expect(back.theme.overrides).toEqual({ "bg-raised": "#fefefe", text: "#101010" });
  });

  it("says why a file is not a theme", () => {
    expect(importTheme("{not json", "x")).toEqual({ ok: false, error: "notJson" });
    expect(importTheme("[]", "x")).toEqual({ ok: false, error: "notTheme" });
    expect(importTheme(JSON.stringify({ colors: { fish: 1 } }), "x")).toEqual({ ok: false, error: "notTheme" });
    expect(importTheme(JSON.stringify({ nexaTheme: 99, colors: { text: "#fff" } }), "x")).toEqual({ ok: false, error: "newer" });
  });
});

describe("contrast warnings", () => {
  it("find a colour that does not read, and mend it without touching the rest", () => {
    const broken = { ...CLASSIC.dark, text: "#3a3b42", "code-string": "#262630" };
    const issues = contrastIssues(broken);
    expect(issues.map((i) => i.token).sort()).toEqual(expect.arrayContaining(["code-string", "text"]));
    const fixed = fixContrast(broken);
    expect(contrastIssues(fixed).find((i) => i.token === "text" || i.token === "code-string")).toBeUndefined();
    expect(fixed["bg-raised"]).toBe(broken["bg-raised"]);
  });

  it("mend every issue of any preset made unreadable", () => {
    for (const id of ["forest", "rose-light", "contrast"]) {
      const t = presetTokens(id)!;
      const broken = { ...t, "text-muted": t["bg-raised"], "on-brand": t.brand, link: t["bg-surface"] };
      expect(contrastIssues(fixContrast(broken)), id).toEqual([]);
    }
  });
});
