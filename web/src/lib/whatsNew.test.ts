import { Sparkles } from "lucide-react";
import en from "@/i18n/locales/en.json";
import { MAX_SHOWN, RELEASES, compareReleases, laterRelease, parseRelease, releaseDate, releaseStart, unseenReleases, type Release } from "./whatsNew";

const release = (id: string): Release => ({ id, items: [{ icon: Sparkles, title: "t", body: "b" }] });
/** Three releases, newest first, as RELEASES keeps them. */
const list = [release("2026-10-02"), release("2026-09-26.2"), release("2026-09-26")];
const day = (iso: string) => Date.parse(iso);
const LONG_AGO = day("2026-01-02T00:00:00Z");
const ids = (rs: Release[]) => rs.map((r) => r.id);

describe("release ids", () => {
  it("reads the day and the number that day", () => {
    expect(parseRelease("2026-09-26")).toEqual({ day: day("2026-09-26T00:00:00Z"), n: 1 });
    expect(parseRelease("2026-09-26.2")).toEqual({ day: day("2026-09-26T00:00:00Z"), n: 2 });
    for (const bad of ["", "2026-9-26", "r20260926", "2026-09-26.", "2026-09-26.x", "yesterday"]) expect(parseRelease(bad)).toBeNull();
  });

  it("orders by day, then by the number that day, and puts anything unreadable first", () => {
    expect(compareReleases("2026-09-26", "2026-09-26.2")).toBeLessThan(0);
    expect(compareReleases("2026-09-26.10", "2026-09-26.9")).toBeGreaterThan(0);
    expect(compareReleases("2026-10-01", "2026-09-30.4")).toBeGreaterThan(0);
    expect(compareReleases("junk", "2026-09-26")).toBeLessThan(0);
    expect(compareReleases("2026-09-26", "2026-09-26")).toBe(0);
  });

  it("keeps the later seen marker, whichever device writes last", () => {
    expect(laterRelease("2026-09-26", "2026-10-02")).toBe("2026-10-02");
    expect(laterRelease("2026-10-02", "2026-09-26")).toBe("2026-10-02");
    expect(laterRelease(null, "2026-09-26")).toBe("2026-09-26");
    expect(laterRelease("junk", "2026-09-26")).toBe("2026-09-26");
    expect(laterRelease("2026-09-26", null)).toBe("2026-09-26");
  });

  it("says the day in the reader's language, whatever their time zone", () => {
    expect(releaseDate("2026-09-26.2", "en")).toBe("September 26, 2026");
    expect(releaseDate("2026-09-26", "de")).toBe("26. September 2026");
  });
});

describe("what an account has not seen", () => {
  const built = day("2026-10-02T20:00:00Z");

  it("shows an account that has seen nothing every release since it was made, newest first", () => {
    expect(ids(unseenReleases(null, LONG_AGO, list, built))).toEqual(["2026-10-02", "2026-09-26.2", "2026-09-26"]);
  });

  it("shows only what came after the last release it saw", () => {
    expect(ids(unseenReleases("2026-09-26", LONG_AGO, list, built))).toEqual(["2026-10-02", "2026-09-26.2"]);
    expect(ids(unseenReleases("2026-10-02", LONG_AGO, list, built))).toEqual([]);
    // seen on a device with a newer build than this one
    expect(ids(unseenReleases("2026-11-01", LONG_AGO, list, built))).toEqual([]);
    // a marker nobody can read hides nothing
    expect(ids(unseenReleases("junk", LONG_AGO, list, built))).toHaveLength(3);
  });

  it("shows an account nothing from before it was made", () => {
    // made on the first release's day: that day's releases are older than the account
    expect(ids(unseenReleases(null, day("2026-09-26T12:00:00Z"), list, built))).toEqual(["2026-10-02"]);
    expect(ids(unseenReleases(null, day("2026-10-05T00:00:00Z"), list, built))).toEqual([]);
  });

  it("never shows a release to an account made after the build it arrived in", () => {
    // the build of the newest release was made the evening before its day
    const early = day("2026-10-01T23:00:00Z");
    expect(releaseStart("2026-10-02", early)).toBe(early);
    expect(ids(unseenReleases(null, day("2026-10-01T23:30:00Z"), list, early))).toEqual([]);
    expect(ids(unseenReleases(null, day("2026-10-01T22:00:00Z"), list, early))).toEqual(["2026-10-02"]);
  });

  it("lists no more than a handful of releases at once", () => {
    const many = Array.from({ length: MAX_SHOWN + 4 }, (_, i) => release(`2026-09-${String(28 - i).padStart(2, "0")}`));
    const shown = unseenReleases(null, LONG_AGO, many, built);
    expect(shown).toHaveLength(MAX_SHOWN);
    expect(shown[0]!.id).toBe("2026-09-28");
  });
});

describe("the releases themselves", () => {
  it("are newest first, with ids that read", () => {
    for (const r of RELEASES) expect(parseRelease(r.id), r.id).not.toBeNull();
    for (let i = 1; i < RELEASES.length; i++) expect(compareReleases(RELEASES[i - 1]!.id, RELEASES[i]!.id)).toBeGreaterThan(0);
  });

  it("name their strings after the release, and every string exists", () => {
    const catalog = en as Record<string, unknown>;
    for (const r of RELEASES) {
      const prefix = `whatsNew.r${r.id.replace(/[-.]/g, "")}.`;
      expect(r.items.length, r.id).toBeGreaterThan(0);
      for (const item of r.items) {
        for (const key of [item.title, item.body]) {
          expect(key.startsWith(prefix), key).toBe(true);
          expect(typeof catalog[key], key).toBe("string");
        }
        expect(item.title.endsWith("Title") && item.body.endsWith("Body"), item.title).toBe(true);
      }
    }
  });
});
