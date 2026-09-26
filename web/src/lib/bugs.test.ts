import { describe, expect, it } from "vitest";
import { BUG_LIMITS, bugContext, bugFileProblem, bugFinished, bugStatusTone, contextRows, describeBrowser, describeSystem, staffWaiting, type DeviceFacts } from "./bugs";

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
};

describe("the browser and system a user agent names", () => {
  it("names the browser people would, whatever else the string claims", () => {
    expect(describeBrowser(UA.chrome)).toBe("Chrome 128");
    expect(describeBrowser(UA.edge)).toBe("Edge 128");
    expect(describeBrowser(UA.firefox)).toBe("Firefox 130");
    expect(describeBrowser(UA.safari)).toBe("Safari 17");
    expect(describeBrowser(UA.iphone)).toBe("Safari 17");
    expect(describeBrowser(UA.samsung)).toBe("Samsung Internet 25");
    expect(describeBrowser(UA.chromeIos)).toBe("Chrome 128");
    expect(describeBrowser("curl/8.0")).toBe("");
  });

  it("names the system, and an iPad that asks for desktop pages by its touch screen", () => {
    expect(describeSystem(UA.chrome)).toBe("Windows");
    expect(describeSystem(UA.firefox)).toBe("Linux");
    expect(describeSystem(UA.safari)).toBe("macOS");
    expect(describeSystem(UA.safari, true)).toBe("iPadOS");
    expect(describeSystem(UA.iphone)).toBe("iOS 17");
    expect(describeSystem(UA.android)).toBe("Android 14");
  });
});

function facts(over: Partial<DeviceFacts> = {}): DeviceFacts {
  return {
    ua: UA.chrome,
    touch: false,
    screen: { w: 1920, h: 1080, dpr: 1.25 },
    window: { w: 1440, h: 900 },
    language: "de",
    theme: "dark",
    customCss: false,
    plugins: 0,
    build: "abc123",
    desktop: null,
    openedFrom: "dm",
    ...over,
  };
}

describe("the context a report carries", () => {
  it("says what the app and device are, and nothing empty", () => {
    const c = bugContext(facts({ build: "" }));
    expect(c).toEqual({ app: "web", browser: "Chrome 128", os: "Windows", device: "computer", screen: "1920 × 1080, 1.25x", window: "1440 × 900", language: "de", theme: "dark", custom_css: "off", plugins: "0", opened_from: "dm" });
  });

  it("names the desktop app and its version, the system it runs on, and a phone or a tablet", () => {
    const c = bugContext(facts({ desktop: { version: "1.4.2", platform: "darwin" }, customCss: true, plugins: 2, theme: "custom-ab12cd34" }));
    expect(c.app).toBe("desktop");
    expect(c.app_version).toBe("1.4.2");
    expect(c.os).toBe("macOS");
    expect(c.custom_css).toBe("on");
    expect(c.plugins).toBe("2");
    // a theme of the person's own making is theirs, not the team's to read
    expect(c.theme).toBe("custom");
    expect(bugContext(facts({ touch: true, screen: { w: 390, h: 844, dpr: 3 } })).device).toBe("phone");
    expect(bugContext(facts({ touch: true, screen: { w: 820, h: 1180, dpr: 2 } })).device).toBe("tablet");
  });

  it("lists in reading order with labels, and puts codes into words", () => {
    const rows = contextRows({ plugins: "0", app: "web", server: "v1", device: "phone", custom_css: "on", opened_from: "friends" });
    expect(rows.map((r) => r.key)).toEqual(["app", "server", "device", "custom_css", "plugins", "opened_from"]);
    expect(rows.every((r) => r.label && r.value)).toBe(true);
    expect(rows.find((r) => r.key === "app")!.value).not.toBe("web");
    expect(rows.find((r) => r.key === "plugins")!.value).toBe("0");
  });
});

describe("what a report can take", () => {
  const none = { count: 0, bytes: 0 };
  it("takes pictures and short recordings, within their sizes", () => {
    expect(bugFileProblem({ type: "image/png", size: 1000 }, none)).toBeNull();
    expect(bugFileProblem({ type: "video/webm", size: 30 * 1024 * 1024 }, none)).toBeNull();
    expect(bugFileProblem({ type: "image/png", size: BUG_LIMITS.imageBytes + 1 }, none)).not.toBeNull();
    expect(bugFileProblem({ type: "video/mp4", size: BUG_LIMITS.videoBytes + 1 }, none)).not.toBeNull();
    expect(bugFileProblem({ type: "application/pdf", size: 10 }, none)).not.toBeNull();
    expect(bugFileProblem({ type: "image/svg+xml", size: 10 }, none)).not.toBeNull();
  });

  it("stops at five files and at the total", () => {
    expect(bugFileProblem({ type: "image/png", size: 10 }, { count: BUG_LIMITS.files, bytes: 0 })).not.toBeNull();
    expect(bugFileProblem({ type: "video/mp4", size: 40 * 1024 * 1024 }, { count: 2, bytes: 70 * 1024 * 1024 })).not.toBeNull();
  });
});

describe("statuses and counts", () => {
  it("colours and finishes the right ones", () => {
    expect(bugStatusTone("open")).toBe("info");
    expect(bugStatusTone("in_progress")).toBe("warn");
    expect(bugStatusTone("resolved")).toBe("done");
    expect(bugStatusTone("closed")).toBe("");
    expect(["open", "in_progress"].some((s) => bugFinished(s as "open"))).toBe(false);
    expect(["resolved", "wont_fix", "closed"].every((s) => bugFinished(s as "closed"))).toBe(true);
  });

  it("adds what waits on staff from cases and reports", () => {
    expect(staffWaiting({ needs_reply: 2, open: 0, in_effect: 0, closed: 0, all: 0 }, { waiting: 3, open: 0, in_progress: 0, resolved: 0, wont_fix: 0, closed: 0, all: 0 }).total).toBe(5);
    expect(staffWaiting(null, undefined).total).toBe(0);
  });
});
