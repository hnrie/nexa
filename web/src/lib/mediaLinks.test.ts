// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/api/client", () => ({ api: { request: (...args: unknown[]) => request(...args) } }));

import { mediaKey, mediaSrc, proxyDeadline, resetMediaLinks } from "./mediaLinks";

const now = Math.floor(Date.now() / 1000);
const target = "aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnBuZw"; // https://example.com/a.png
const fresh = `/media/proxy/${now + 86400}-abcdefghijklmnopqrstuv/${target}`;
const stale = `/media/proxy/${now - 3600}-abcdefghijklmnopqrstuv/${target}`;
const legacy = `/media/proxy/Zm9vYmFyLWJhei1xdXV4MTIz/${target}`;
const renewed = `/media/proxy/${now + 86400}-zyxwvutsrqponmlkjihgfe/${target}`;

/** Lets the batching timer fire and the request settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  resetMediaLinks();
  request.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("media links", () => {
  it("reads a link's deadline, and none from one signed before deadlines", () => {
    expect(proxyDeadline(fresh)).toBe((now + 86400) * 1000);
    expect(proxyDeadline(legacy)).toBeNull();
    expect(proxyDeadline("https://example.com/a.png")).toBeNull();
  });

  it("gives one key to every signing of the same address", () => {
    expect(mediaKey(fresh)).toBe(mediaKey(stale));
    expect(mediaKey(fresh)).toBe(mediaKey(legacy));
    expect(mediaKey(fresh)).toBe(target);
    expect(mediaKey("https://example.com/other.png")).toBe("https://example.com/other.png");
  });

  it("loads this server's own media and fresh proxy links as they are", () => {
    expect(mediaSrc(fresh)).toBe(fresh);
    expect(mediaSrc("/media/emoji/12")).toBe("/media/emoji/12");
    expect(mediaSrc(`${window.location.origin}/media/icon/9`)).toBe(`${window.location.origin}/media/icon/9`);
    expect(mediaSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(request).not.toHaveBeenCalled();
  });

  it("never loads another site's address, which would give it the reader's", () => {
    expect(mediaSrc("https://tracker.example/pixel.gif")).toBeNull();
    expect(mediaSrc("//tracker.example/pixel.gif")).toBeNull();
    expect(mediaSrc(undefined)).toBeNull();
  });

  it("signs stale and legacy links again, all in one request", async () => {
    request.mockResolvedValueOnce({ urls: { [stale]: renewed, [legacy]: renewed } });
    expect(mediaSrc(stale)).toBeUndefined();
    expect(mediaSrc(legacy)).toBeUndefined();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["POST", "/proxy/refresh", { urls: [stale, legacy] }]);
    expect(mediaSrc(stale)).toBe(renewed);
    expect(mediaSrc(legacy)).toBe(renewed);
  });

  it("leaves out a link the server would not sign, and does not ask again", async () => {
    request.mockResolvedValueOnce({ urls: {} });
    expect(mediaSrc(stale)).toBeUndefined();
    await settle();
    expect(mediaSrc(stale)).toBeNull();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting through a request that did not get through, then asks again", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    expect(mediaSrc(stale)).toBeUndefined();
    await settle();
    // still loading, not gone: gone would offer every favourite GIF for deletion
    expect(mediaSrc(stale)).toBeUndefined();
    request.mockResolvedValueOnce({ urls: { [stale]: renewed } });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mediaSrc(stale)).toBeUndefined();
    await settle();
    expect(mediaSrc(stale)).toBe(renewed);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
