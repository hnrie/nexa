import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { resolveLook } from "@/lib/theme";
import { contrastIssues } from "./contrast";
import { presetById } from "./presets";
import { SEASONS, activeSeason, seasonCards, inSeason, seasonById, seasonEnd, seasonalOrDefault, seasonalTokens, seasonsOn } from "./seasonal";

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const ids = (date: Date) => seasonsOn(date).map((s) => s.id);
const look = (theme: string) => resolveLook({ theme, accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false });

describe("seasonal themes", () => {
  for (const s of SEASONS) {
    it(`${s.id}: every text colour reads at AA or better where it is drawn`, () => {
      const t = seasonalTokens(s.id)!;
      expect(contrastIssues(t)).toEqual([]);
      expect(contrast(t.text, t["bg-raised"])).toBeGreaterThanOrEqual(7);
    });
  }

  it("has ids of their own, apart from the gallery's", () => {
    expect(new Set(SEASONS.map((s) => s.id)).size).toBe(SEASONS.length);
    for (const s of SEASONS) expect(presetById(s.id)).toBeNull();
  });

  it("offers each in its season only", () => {
    expect(ids(on(2026, 10, 8))).toEqual(["season-halloween", "season-fall"]);
    expect(ids(on(2026, 11, 2))).toEqual(["season-halloween", "season-fall"]);
    expect(ids(on(2026, 11, 3))).toEqual(["season-fall"]);
    expect(ids(on(2026, 7, 4))).toEqual(["season-summer", "season-summer-night"]);
    expect(ids(on(2027, 2, 14))).toEqual(["season-valentines", "season-winter", "season-winter-night"]);
  });

  it("gives each light one a dark night version with the same days and picture, and snow only to Winter Night", () => {
    for (const s of SEASONS.filter((x) => x.scheme === "light")) {
      const night = seasonById(`${s.id}-night`)!;
      expect(night.scheme).toBe("dark");
      expect([night.from, night.to, night.art]).toEqual([s.from, s.to, s.id]);
    }
    expect(SEASONS.filter((x) => x.snow).map((x) => x.id)).toEqual(["season-winter-night"]);
  });

  it("shows a season and its night version as one card", () => {
    const cards = seasonCards(SEASONS).map((c) => [c.light.id, c.dark?.id ?? null]);
    expect(cards).toEqual([
      ["season-halloween", null],
      ["season-fall", null],
      ["season-winter", "season-winter-night"],
      ["season-holidays", null],
      ["season-valentines", null],
      ["season-spring", "season-spring-night"],
      ["season-summer", "season-summer-night"],
    ]);
    expect(seasonCards(seasonsOn(on(2026, 7, 4))).map((c) => [c.light.id, c.dark?.id])).toEqual([["season-summer", "season-summer-night"]]);
  });

  it("carries a season across the new year", () => {
    const winter = seasonById("season-winter")!;
    const holidays = seasonById("season-holidays")!;
    expect(inSeason(winter, on(2026, 12, 31))).toBe(true);
    expect(inSeason(winter, on(2027, 1, 15))).toBe(true);
    expect(inSeason(winter, on(2027, 3, 1))).toBe(false);
    expect(inSeason(holidays, on(2027, 1, 6))).toBe(true);
    expect(inSeason(holidays, on(2027, 1, 7))).toBe(false);
    expect(seasonEnd(holidays, on(2026, 12, 20))).toEqual(new Date(2027, 0, 6));
    expect(seasonEnd(holidays, on(2027, 1, 2))).toEqual(new Date(2027, 0, 6));
  });

  it("ends winter on the last day of February, leap year or not", () => {
    const winter = seasonById("season-winter")!;
    expect(seasonEnd(winter, on(2026, 12, 5))).toEqual(new Date(2027, 1, 28));
    expect(seasonEnd(winter, on(2027, 12, 5))).toEqual(new Date(2028, 1, 29));
  });

  it("always has something in season", () => {
    for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      expect(seasonsOn(d).length, d.toDateString()).toBeGreaterThan(0);
    }
  });

  it("goes back to the default theme once the season is over, and leaves every other theme alone", () => {
    expect(seasonalOrDefault("season-halloween", on(2026, 10, 31))).toBe("season-halloween");
    expect(seasonalOrDefault("season-halloween", on(2026, 11, 3))).toBe("dark");
    expect(seasonalOrDefault("forest", on(2026, 11, 3))).toBe("forest");
    expect(seasonalOrDefault("custom-abcd1234", on(2026, 11, 3))).toBe("custom-abcd1234");
    expect(activeSeason("season-summer", on(2026, 10, 8))).toBeNull();
    expect(activeSeason("season-fall", on(2026, 10, 8))?.id).toBe("season-fall");
  });

  it("draws a seasonal theme out of season as Dark", () => {
    // today's date decides; one of these two is always out of season while the other is in
    const fallOn = inSeason(seasonById("season-fall")!, new Date());
    const springOn = inSeason(seasonById("season-spring")!, new Date());
    expect(fallOn && springOn).toBe(false);
    const out = fallOn ? "season-spring" : "season-fall";
    expect(look(out)).toMatchObject({ id: "dark", classic: "dark", tokens: null });
  });
});
