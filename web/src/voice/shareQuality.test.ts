import type { ShareFps, ShareResolution } from "@/stores/settings";
import { MAX_SHARE_BPS, MIN_SHARE_BPS, PERFORMANCE_PLAN, fromStreamQuality, isShareFps, isShareResolution, shareBitrate, shareModeOf, sharePlan, shareQuality, shareVideoConstraints } from "./shareQuality";

describe("screen share quality", () => {
  it("caps the picture at the chosen size, keeping its shape, and the frame rate at the chosen one", () => {
    expect(shareVideoConstraints("720p", 30)).toEqual({ width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } });
    expect(shareVideoConstraints("1440p", 60)).toEqual({ width: { max: 2560 }, height: { max: 1440 }, frameRate: { ideal: 60, max: 60 } });
  });

  it("holds source resolution to the longest side a call carries, keeping the shape", () => {
    expect(shareVideoConstraints("source", 15)).toEqual({ width: { max: 8192 }, height: { max: 8192 }, frameRate: { ideal: 15, max: 15 } });
  });

  it("asks for the usual size and frame rate when given ones it does not offer", () => {
    const odd = shareVideoConstraints("16k" as ShareResolution, 100000 as ShareFps);
    expect(odd).toEqual({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } });
    expect(shareVideoConstraints("source", NaN as ShareFps).frameRate).toEqual({ ideal: 30, max: 30 });
    const bps = shareBitrate("nonsense" as ShareResolution, Infinity as ShareFps);
    expect(Number.isFinite(bps)).toBe(true);
    expect(bps).toBe(shareBitrate("1080p", 30));
  });

  it("knows the sizes and frame rates it offers", () => {
    for (const r of ["720p", "1080p", "1440p", "source"]) expect(isShareResolution(r)).toBe(true);
    for (const r of ["4320p", "", null, 1080, {}]) expect(isShareResolution(r)).toBe(false);
    for (const f of [15, 30, 60]) expect(isShareFps(f)).toBe(true);
    for (const f of [0, 59.9, 120, 1e9, NaN, "60"]) expect(isShareFps(f)).toBe(false);
    expect(shareQuality("1440p", 60)).toEqual({ res: "1440p", fps: 60 });
    expect(shareQuality(undefined, 240)).toEqual({ res: "1080p", fps: 30 });
  });

  it("gives bigger and smoother shares more bits, within what the SFU meter accepts", () => {
    expect(shareBitrate("720p", 30)).toBe(3_000_000);
    expect(shareBitrate("1080p", 30)).toBe(6_000_000);
    // 1080p in motion gets what it was measured to need (shareAdapt.ts MOTION_BITS_PER_PIXEL)
    expect(shareBitrate("1080p", 60)).toBe(9_900_000);
    expect(shareBitrate("1080p", 60)).toBeGreaterThan(shareBitrate("1080p", 30));
    expect(shareBitrate("1080p", 15)).toBeLessThan(shareBitrate("1080p", 30));
    for (const res of ["720p", "1080p", "1440p", "source"] as const) {
      for (const fps of [15, 30, 60] as const) {
        const bps = shareBitrate(res, fps);
        expect(bps).toBeGreaterThanOrEqual(MIN_SHARE_BPS);
        expect(bps).toBeLessThanOrEqual(MAX_SHARE_BPS);
      }
    }
  });

  it("reads the single stream quality older versions saved", () => {
    expect(fromStreamQuality("720p30")).toEqual({ shareResolution: "720p", shareFps: 30 });
    expect(fromStreamQuality("1080p60")).toEqual({ shareResolution: "1080p", shareFps: 60 });
    expect(fromStreamQuality("source")).toEqual({ shareResolution: "source", shareFps: 60 });
    expect(fromStreamQuality("nonsense")).toBeNull();
  });
});

describe("stream modes", () => {
  it("sends Performance smooth at 1080p60 within 6 Mbit/s, and Quality sharp at the screen's own size at the most a share may use", () => {
    expect(sharePlan({ shareMode: "performance" })).toEqual({ res: "1080p", fps: 60, bitrate: 6_000_000, smooth: true });
    expect(sharePlan({ shareMode: "quality" })).toEqual({ res: "source", fps: 60, bitrate: MAX_SHARE_BPS, smooth: false });
    // anything not understood is Performance
    expect(sharePlan({ shareMode: "turbo" })).toEqual(PERFORMANCE_PLAN);
  });

  it("sends Custom as chosen, its bitrate following the size and frame rate until one is set", () => {
    const custom = { shareMode: "custom", shareResolution: "1440p", shareFps: 30, shareBitrate: null, shareKeep: "smooth" };
    expect(sharePlan(custom)).toEqual({ res: "1440p", fps: 30, bitrate: shareBitrate("1440p", 30), smooth: true });
    expect(sharePlan({ ...custom, shareBitrate: 4_500_000, shareKeep: "sharp" })).toEqual({ res: "1440p", fps: 30, bitrate: 4_500_000, smooth: false });
    // a limit out of bounds is held to them, and nonsense is no limit
    expect(sharePlan({ ...custom, shareBitrate: 99e9 }).bitrate).toBe(MAX_SHARE_BPS);
    expect(sharePlan({ ...custom, shareBitrate: 10 }).bitrate).toBe(MIN_SHARE_BPS);
    expect(sharePlan({ ...custom, shareBitrate: "fast" }).bitrate).toBe(shareBitrate("1440p", 30));
  });

  it("turns settings from before modes into one: the usual 1080p30 becomes Performance, a choice stays as Custom", () => {
    expect(shareModeOf({}, { shareResolution: "1080p", shareFps: 30 })).toEqual({ shareMode: "performance", shareBitrate: null, shareKeep: "sharp" });
    expect(shareModeOf({}, { shareResolution: "1080p", shareFps: 60 })).toEqual({ shareMode: "custom", shareBitrate: null, shareKeep: "smooth" });
    expect(shareModeOf({}, { shareResolution: "source", shareFps: 15 })).toEqual({ shareMode: "custom", shareBitrate: null, shareKeep: "sharp" });
    expect(shareModeOf({ shareMode: "quality", shareBitrate: 3e6, shareKeep: "smooth" }, { shareResolution: "720p", shareFps: 30 })).toEqual({ shareMode: "quality", shareBitrate: 3e6, shareKeep: "smooth" });
  });
});
