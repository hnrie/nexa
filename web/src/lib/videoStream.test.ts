// @vitest-environment jsdom
import { canStream } from "./videoStream";

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  desktopApp: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Nexa/1.2.1 Chrome/140.0.0.0 Electron/44.3.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
} as const;

function as(ua: string, touch = 0): void {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: touch, configurable: true });
}

beforeEach(() => {
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  localStorage.clear();
});

describe("canStream", () => {
  it("streams in Chromium and Firefox, the desktop app included", () => {
    for (const ua of [UA.chrome, UA.edge, UA.desktopApp, UA.android, UA.firefox]) {
      as(ua);
      expect(canStream()).toBe(true);
    }
  });

  it("leaves Safari and every iPhone browser on the whole download until it has been tried there", () => {
    for (const ua of [UA.safari, UA.iphone, UA.iphoneChrome]) {
      as(ua);
      expect(canStream()).toBe(false);
    }
    // an iPad asking for the desktop site says it is a Mac
    as(UA.safari, 5);
    expect(canStream()).toBe(false);
  });

  it("can be switched on in Safari to try it, or off everywhere", () => {
    as(UA.iphone);
    localStorage.setItem("ec:streamVideos", "on");
    expect(canStream()).toBe(true);
    as(UA.chrome);
    localStorage.setItem("ec:streamVideos", "off");
    expect(canStream()).toBe(false);
  });

  it("needs a service worker", () => {
    as(UA.chrome);
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    expect(canStream()).toBe(false);
  });
});
