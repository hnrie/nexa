import { playableType } from "./mediaCache";

describe("playableType", () => {
  it("hands QuickTime and M4V files to the player as the MP4 they are", () => {
    expect(playableType("video/quicktime")).toBe("video/mp4");
    expect(playableType("VIDEO/QuickTime")).toBe("video/mp4");
    expect(playableType("video/x-m4v")).toBe("video/mp4");
    expect(playableType("audio/x-m4a")).toBe("audio/mp4");
  });

  it("leaves every other type alone", () => {
    expect(playableType("video/webm")).toBe("video/webm");
    expect(playableType("image/png")).toBe("image/png");
    expect(playableType("")).toBe("application/octet-stream");
    expect(playableType(undefined)).toBe("application/octet-stream");
  });
});
