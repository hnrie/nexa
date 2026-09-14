import { callFullscreenWay, streamFullscreenWay } from "./fullscreen";

const doc = (over: Record<string, unknown>) => over as unknown as Document;
const videoProto = (native: boolean) => (native ? { webkitEnterFullscreen() {} } : {}) as unknown as HTMLVideoElement;

describe("how things go full screen", () => {
  it("uses the Fullscreen API wherever it is on, prefixed or not", () => {
    expect(callFullscreenWay(doc({ fullscreenEnabled: true }))).toBe("element");
    expect(callFullscreenWay(doc({ webkitFullscreenEnabled: true }))).toBe("element");
    expect(streamFullscreenWay(doc({ fullscreenEnabled: true }), videoProto(true))).toBe("element");
  });

  it("covers the app instead on a phone that has none (iPhone)", () => {
    expect(callFullscreenWay(doc({}))).toBe("page");
    expect(callFullscreenWay(doc({ fullscreenEnabled: false, webkitFullscreenEnabled: false }))).toBe("page");
  });

  it("hands a single stream to the system video player there", () => {
    expect(streamFullscreenWay(doc({}), videoProto(true))).toBe("video");
  });

  it("falls back to covering the app when not even a video can go full screen", () => {
    expect(streamFullscreenWay(doc({}), videoProto(false))).toBe("page");
  });
});
