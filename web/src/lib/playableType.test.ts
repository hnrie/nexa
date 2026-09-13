import { playableType } from "./mediaCache";

describe("playableType", () => {
  it("hands QuickTime and M4V files to the player as the MP4 they are", () => {
    expect(playableType("video/quicktime")).toBe("video/mp4");
    expect(playableType("VIDEO/QuickTime")).toBe("video/mp4");
    expect(playableType("video/x-m4v")).toBe("video/mp4");
    expect(playableType("audio/x-m4a")).toBe("audio/mp4");
  });

  it("never lets a file become a page in the app's origin", () => {
    expect(playableType("text/html")).toBe("application/octet-stream");
    expect(playableType("Text/HTML; charset=utf-8")).toBe("application/octet-stream");
    expect(playableType("application/xhtml+xml")).toBe("application/octet-stream");
    expect(playableType("application/xml")).toBe("application/octet-stream");
    // still typed, so <img> shows it; the lightbox offers no way to open it on its own
    expect(playableType("image/svg+xml")).toBe("image/svg+xml");
  });

  it("leaves every other type alone", () => {
    expect(playableType("video/webm")).toBe("video/webm");
    expect(playableType("image/png")).toBe("image/png");
    expect(playableType("")).toBe("application/octet-stream");
    expect(playableType(undefined)).toBe("application/octet-stream");
  });
});
