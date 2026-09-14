import { MAX_SHARE_BPS, MIN_SHARE_BPS, fromStreamQuality, shareBitrate, shareVideoConstraints } from "./shareQuality";

describe("screen share quality", () => {
  it("caps the picture at the chosen size, keeping its shape, and the frame rate at the chosen one", () => {
    expect(shareVideoConstraints("720p", 30)).toEqual({ width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } });
    expect(shareVideoConstraints("1440p", 60)).toEqual({ width: { max: 2560 }, height: { max: 1440 }, frameRate: { ideal: 60, max: 60 } });
  });

  it("leaves the size alone at source resolution", () => {
    expect(shareVideoConstraints("source", 15)).toEqual({ frameRate: { ideal: 15, max: 15 } });
  });

  it("gives bigger and smoother shares more bits, within what the SFU meter accepts", () => {
    expect(shareBitrate("720p", 30)).toBe(2_500_000);
    expect(shareBitrate("1080p", 30)).toBe(5_000_000);
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
