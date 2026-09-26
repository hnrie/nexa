// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./stickerPosters", () => {
  class UnsupportedError extends Error {
    override name = "UnsupportedError";
  }
  return {
    UnsupportedError,
    tgsPoster: vi.fn(async () => new Blob(["tgs-frame"], { type: "image/webp" })),
    webmPoster: vi.fn(async () => new Blob(["webm-frame"], { type: "image/webp" })),
    warmLottie: vi.fn(async () => ({})),
    idle: vi.fn(async () => undefined),
  };
});

vi.mock("./stillStore", () => ({
  loadStill: vi.fn(async () => null),
  saveStill: vi.fn(async () => undefined),
}));

import { peekStill, resetStills, stillPlan, watchStill, type StillSource, type StillView } from "./stickerStills";
import { tgsPoster, UnsupportedError, webmPoster } from "./stickerPosters";
import { loadStill, saveStill } from "./stillStore";

const png = (id: string, animated = false): StillSource => ({ kind: "sticker", blobId: id, format: animated ? "gif" : "png", animated });

/** fetch answers the test controls: each call waits until the test says how it went. */
function network() {
  const calls: { url: string; answer: (status: number) => void }[] = [];
  const fetchMock = vi.fn(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        calls.push({ url, answer: (status) => resolve(new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, { status, headers: { "Content-Type": "image/png" } })) });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/** Lets pending promises settle, a few rounds deep. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let made = 0;
beforeEach(() => {
  made = 0;
  URL.createObjectURL = vi.fn(() => `blob:still-${++made}`);
  URL.revokeObjectURL = vi.fn();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  resetStills();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function follow(src: StillSource, px = 128) {
  const seen: StillView[] = [];
  const h = watchStill(src, px, (v) => seen.push(v));
  return { h, seen, last: () => seen[seen.length - 1]! };
}

describe("stillPlan", () => {
  it("asks the server for a small copy, and a moving picture's first frame", () => {
    expect(stillPlan(png("1"), 128).url).toMatch(/\/media\/sticker\/1\?size=128$/);
    expect(stillPlan(png("2", true), 256).url).toMatch(/\/media\/sticker\/2\?size=256&still=1$/);
    expect(stillPlan({ kind: "emoji", blobId: "3", format: "png", animated: false }, 128).url).toMatch(/\/media\/emoji\/3\?size=128$/);
    // Lottie and video are drawn here, from the sticker itself
    expect(stillPlan({ kind: "sticker", blobId: "4", format: "tgs", animated: true }, 128).draw).toBe("tgs");
    expect(stillPlan({ kind: "sticker", blobId: "5", format: "webm", animated: true }, 128).draw).toBe("webm");
  });
});

describe("stills", () => {
  it("loads when wanted, and shows at once to the next tile that wants it", async () => {
    const { calls } = network();
    const a = follow(png("1"));
    expect(a.last().status).toBe("idle");
    await settle();
    expect(calls).toHaveLength(0);
    a.h.want(0);
    await settle();
    expect(a.last().status).toBe("loading");
    calls[0]!.answer(200);
    await settle();
    expect(a.last()).toEqual({ status: "ready", url: "blob:still-1", permanent: false });
    a.h.release();
    // kept: a reopened picker has it before asking
    expect(peekStill(png("1"), 128).url).toBe("blob:still-1");
    const b = follow(png("1"));
    expect(b.seen[0]!.url).toBe("blob:still-1");
    expect(calls).toHaveLength(1);
  });

  it("says it failed, then tries again by itself after a growing wait", async () => {
    const { calls } = network();
    const a = follow(png("1"));
    a.h.want(0);
    await settle();
    calls[0]!.answer(500);
    await settle();
    expect(a.last()).toEqual({ status: "failed", url: null, permanent: false });
    // the first retry comes after about a second (0.8 to 1.2 s)
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(calls).toHaveLength(2);
    calls[1]!.answer(503);
    await settle();
    // the second after about two
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(calls).toHaveLength(3);
    calls[2]!.answer(200);
    await settle();
    expect(a.last().status).toBe("ready");
  });

  it("does not keep retrying what is gone, but a press tries again at once", async () => {
    const { calls } = network();
    const a = follow(png("1"));
    a.h.want(0);
    await settle();
    calls[0]!.answer(404);
    await settle();
    expect(a.last()).toEqual({ status: "failed", url: null, permanent: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    a.h.retry();
    await settle();
    expect(calls).toHaveLength(2);
    expect(a.last().status).toBe("loading");
    calls[1]!.answer(200);
    await settle();
    expect(a.last().status).toBe("ready");
  });

  it("a press skips the wait before an automatic retry", async () => {
    const { calls } = network();
    const a = follow(png("1"));
    a.h.want(0);
    await settle();
    calls[0]!.answer(500);
    await settle();
    a.h.retry();
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("tries failed stills again when the connection comes back", async () => {
    const { calls } = network();
    const a = follow(png("1"));
    a.h.want(0);
    await settle();
    calls[0]!.answer(500);
    await settle();
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("drops a load that has not started once nothing near the screen wants it", async () => {
    const { calls } = network();
    const tiles = Array.from({ length: 12 }, (_, i) => follow(png(String(i))));
    for (const t of tiles) t.h.want(1);
    await settle();
    const started = calls.length;
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThan(12);
    // the picker closes: everything still waiting is dropped
    for (const t of tiles) t.h.release();
    for (const c of calls) c.answer(200);
    await settle();
    expect(calls).toHaveLength(started);
    // what was already downloading was kept
    expect(peekStill(png("0"), 128).status).toBe("ready");
    expect(peekStill(png("11"), 128).status).toBe("idle");
  });

  it("puts what is on screen before what is about to be", async () => {
    const { calls } = network();
    const near = Array.from({ length: 10 }, (_, i) => follow(png(`near${i}`)));
    for (const t of near) t.h.want(1);
    await settle();
    const busy = calls.length;
    const seen = follow(png("seen"));
    seen.h.want(0);
    calls[0]!.answer(200);
    await settle();
    // the first free slot goes to the one on screen
    expect(calls[busy]!.url).toContain("/sticker/seen?");
  });

  it("draws Lottie from its download and video from its address, one frame each", async () => {
    const { calls } = network();
    const tgs = follow({ kind: "sticker", blobId: "t", format: "tgs", animated: true });
    const webm = follow({ kind: "sticker", blobId: "w", format: "webm", animated: true });
    tgs.h.want(0);
    webm.h.want(0);
    await settle();
    // the video's player fetches for itself; only the Lottie file comes through fetch
    expect(calls).toHaveLength(1);
    expect(webmPoster).toHaveBeenCalledWith(expect.stringContaining("/media/sticker/w"), 128, expect.anything(), expect.any(Number));
    calls[0]!.answer(200);
    await settle();
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(tgsPoster).toHaveBeenCalledTimes(1);
    expect(tgs.last().status).toBe("ready");
    expect(webm.last().status).toBe("ready");
  });

  it("keeps drawn stills for the next visit, and uses one kept from before without downloading", async () => {
    const { calls } = network();
    const tgs = follow({ kind: "sticker", blobId: "t1", format: "tgs", animated: true });
    tgs.h.want(0);
    await settle();
    calls[0]!.answer(200);
    await settle();
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(tgs.last().status).toBe("ready");
    expect(saveStill).toHaveBeenCalledWith("sticker:t1:128", expect.any(Blob));
    // a later visit: the store has it
    vi.mocked(loadStill).mockResolvedValueOnce(new Blob(["kept"], { type: "image/webp" }));
    const webm = follow({ kind: "sticker", blobId: "w9", format: "webm", animated: true });
    webm.h.want(0);
    await settle();
    expect(webm.last().status).toBe("ready");
    expect(webmPoster).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("marks a video this browser cannot play as failed for good", async () => {
    network();
    vi.mocked(webmPoster).mockRejectedValueOnce(new UnsupportedError("webm"));
    const a = follow({ kind: "sticker", blobId: "w2", format: "webm", animated: true });
    a.h.want(0);
    await settle();
    expect(a.last()).toEqual({ status: "failed", url: null, permanent: true });
  });
});
