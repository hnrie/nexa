import { describe, expect, it, vi } from "vitest";
import type { UnfurlResult } from "@/api/types";
import { createLinkPreviews } from "./linkPreviews";

describe("link previews", () => {
  it("never sends an invite's key to the server, and puts it back on the card", async () => {
    const asked: string[] = [];
    const previews = createLinkPreviews(async (url) => {
      asked.push(url);
      return { url, type: "invite", invite_code: "abc" };
    });
    const link = "https://chat.example/invite/abc#k=3.AAAA";
    const got = await previews.embedsFor([link], 1000);
    expect(asked).toEqual(["https://chat.example/invite/abc"]);
    expect(got).toEqual([{ url: link, type: "invite", invite_code: "abc" }]);
  });

  it("waits a little for a preview still on its way, then sends without it", async () => {
    vi.useFakeTimers();
    try {
      let resolveSlow: (r: UnfurlResult) => void = () => undefined;
      const previews = createLinkPreviews((url) =>
        url.includes("slow") ? new Promise((r) => (resolveSlow = r)) : Promise.resolve({ url, type: "link", title: "Fast" }),
      );
      previews.start("https://fast.example/");
      const quick = previews.embedsFor(["https://fast.example/"], 1500);
      await vi.advanceTimersByTimeAsync(0);
      expect((await quick).map((e) => e.title)).toEqual(["Fast"]);

      const slow = previews.embedsFor(["https://slow.example/", "https://fast.example/"], 1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect((await slow).map((e) => e.title)).toEqual(["Fast"]);
      resolveSlow({ url: "https://slow.example/", type: "link", title: "Slow" });
      await vi.advanceTimersByTimeAsync(0);
      expect((await previews.embedsFor(["https://slow.example/"], 1500)).map((e) => e.title)).toEqual(["Slow"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
