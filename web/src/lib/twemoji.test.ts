import { describe, expect, it, vi } from "vitest";
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

  it("builds a URL served by Nexa, not a CDN", () => {
    const url = twemojiUrl("😀");
    expect(url).toBe("/twemoji/1f600.svg");
    expect(url).not.toMatch(/^https?:/);
  });
});

describe("the list of pictures", () => {
  it("asks for nothing until it knows what exists, then only for what does", async () => {
    vi.resetModules();
    let answer: (names: string[]) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = (names) => resolve(new Response(JSON.stringify(names))))));
    vi.stubGlobal("fetch", fetchMock);
    const tw = await import("./twemoji");
    expect(tw.twemojiIndexSettled()).toBe(false);
    tw.ensureTwemojiIndex();
    const ready = new Promise<void>((r) => tw.onTwemojiIndexReady(r));
    answer(["1f600"]);
    await ready;
    expect(tw.twemojiIndexSettled()).toBe(true);
    expect(tw.twemojiCandidates("😀")).toHaveLength(1);
    expect(tw.twemojiCandidates("🫩")).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("finds a joined emoji sent without its U+FE0F under the name it is filed by", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(["1f3f3-fe0f-200d-1f308", "1f441-200d-1f5e8", "1f469-200d-2764-fe0f-200d-1f468"]))));
    const tw = await import("./twemoji");
    const ready = new Promise<void>((r) => tw.onTwemojiIndexReady(r));
    tw.ensureTwemojiIndex();
    await ready;
    // the rainbow flag is filed with its selector, the eye in a speech bubble without
    expect(tw.twemojiFiles("\u{1F3F3}\u200D\u{1F308}")).toEqual(["1f3f3-fe0f-200d-1f308"]);
    expect(tw.twemojiFiles("\u{1F3F3}\uFE0F\u200D\u{1F308}")).toEqual(["1f3f3-fe0f-200d-1f308"]);
    expect(tw.twemojiFiles("\u{1F441}\uFE0F\u200D\u{1F5E8}\uFE0F")).toEqual(["1f441-200d-1f5e8"]);
    expect(tw.twemojiFiles("\u{1F469}\u200D\u2764\u200D\u{1F468}")).toEqual(["1f469-200d-2764-fe0f-200d-1f468"]);
    vi.unstubAllGlobals();
  });

  it("tries the pictures anyway if the list cannot be had", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const tw = await import("./twemoji");
    const settled = new Promise<void>((r) => tw.onTwemojiIndexReady(r));
    tw.ensureTwemojiIndex();
    await settled;
    expect(tw.twemojiIndexReady()).toBe(false);
    expect(tw.twemojiIndexSettled()).toBe(true);
    expect(tw.twemojiCandidates("🫩")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("waits a while after a failed fetch instead of asking again at every emoji drawn", async () => {
    vi.resetModules();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const tw = await import("./twemoji");
      let settled = new Promise<void>((r) => tw.onTwemojiIndexReady(r));
      tw.ensureTwemojiIndex();
      await settled;
      // a screenful of emoji asking again straight away
      for (let i = 0; i < 20; i++) tw.ensureTwemojiIndex();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // a few seconds on it tries again, and succeeds
      now.mockReturnValue(1_000_000 + 6_000);
      fetchMock.mockImplementation(async () => new Response(JSON.stringify(["1f600"])));
      settled = new Promise<void>((r) => tw.onTwemojiIndexReady(r));
      tw.ensureTwemojiIndex();
      await settled;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(tw.twemojiIndexReady()).toBe(true);
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
