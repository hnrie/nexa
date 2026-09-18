import { detectAndroid, detectAndroidAbi, detectDesktop, pickAndroid, pickDownload } from "./platform";
import { builds, type AndroidRelease } from "@/api/android";
import type { DesktopRelease } from "@/api/desktop";

const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const CROS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("detectDesktop", () => {
  it("finds Windows, macOS and Linux computers", () => {
    expect(detectDesktop({ ua: WIN })).toEqual({ os: "windows", arch: "x64" });
    expect(detectDesktop({ ua: LINUX })).toEqual({ os: "linux", arch: "x64" });
    expect(detectDesktop({ ua: MAC_SAFARI }).os).toBe("mac");
  });

  it("tells Apple Silicon from Intel where the browser lets it", () => {
    expect(detectDesktop({ ua: MAC_SAFARI, architecture: "arm" })).toEqual({ os: "mac", arch: "arm64" });
    expect(detectDesktop({ ua: MAC_SAFARI, architecture: "x86" })).toEqual({ os: "mac", arch: "x64" });
    // Safari says Intel either way; its graphics chip does not
    expect(detectDesktop({ ua: MAC_SAFARI, gpu: "Apple M2" })).toEqual({ os: "mac", arch: "arm64" });
    expect(detectDesktop({ ua: MAC_SAFARI, gpu: "Intel(R) Iris(TM) Plus Graphics" })).toEqual({ os: "mac", arch: "x64" });
    // "Apple GPU" can be any Mac; ASTC textures come only with Apple's chips
    expect(detectDesktop({ ua: MAC_SAFARI, gpu: "Apple GPU" })).toEqual({ os: "mac", arch: null });
    expect(detectDesktop({ ua: MAC_SAFARI, gpu: "Apple GPU", astc: true })).toEqual({ os: "mac", arch: "arm64" });
    expect(detectDesktop({ ua: MAC_SAFARI, gpu: "Apple GPU", astc: false })).toEqual({ os: "mac", arch: "x64" });
    expect(detectDesktop({ ua: MAC_SAFARI })).toEqual({ os: "mac", arch: null });
  });

  it("offers nothing to phones, tablets and Chromebooks", () => {
    expect(detectDesktop({ ua: IPHONE }).os).toBeNull();
    expect(detectDesktop({ ua: ANDROID }).os).toBeNull();
    expect(detectDesktop({ ua: CROS }).os).toBeNull();
    // an iPad asks for the desktop site but has a touch screen
    expect(detectDesktop({ ua: MAC_SAFARI, touchPoints: 5 }).os).toBeNull();
    expect(detectDesktop({ ua: WIN, mobile: true }).os).toBeNull();
  });
});

describe("pickDownload", () => {
  const rel: DesktopRelease = {
    version: "1.0.0",
    released_at: 0,
    files: [
      { os: "windows", arch: "x64", kind: "installer", name: "win.exe", size: 1, sha256: "a" },
      { os: "mac", arch: "arm64", kind: "installer", name: "arm.dmg", size: 1, sha256: "b" },
      { os: "mac", arch: "x64", kind: "installer", name: "intel.dmg", size: 1, sha256: "c" },
      { os: "mac", arch: "x64", kind: "zip", name: "intel.zip", size: 1, sha256: "c" },
      { os: "linux", arch: "x64", kind: "appimage", name: "app.AppImage", size: 1, sha256: "d" },
      { os: "linux", arch: "x64", kind: "deb", name: "app.deb", size: 1, sha256: "e" },
    ],
  };
  it("picks the installer for the computer", () => {
    expect(pickDownload(rel, { os: "windows", arch: "x64" })?.name).toBe("win.exe");
    expect(pickDownload(rel, { os: "mac", arch: "arm64" })?.name).toBe("arm.dmg");
    expect(pickDownload(rel, { os: "linux", arch: "x64" })?.name).toBe("app.AppImage");
  });
  it("prefers Apple Silicon for a Mac it cannot tell apart, and has nothing for no computer", () => {
    expect(pickDownload(rel, { os: "mac", arch: null })?.name).toBe("arm.dmg");
    expect(pickDownload(rel, { os: null, arch: null })).toBeNull();
    expect(pickDownload({ ...rel, files: [] }, { os: "windows", arch: "x64" })).toBeNull();
  });
});

describe("detectAndroid", () => {
  const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36";
  const TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
  const CHROMEBOOK = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

  it("knows a phone and a tablet", () => {
    expect(detectAndroid({ ua: PIXEL })).toBe(true);
    expect(detectAndroid({ ua: TABLET })).toBe(true);
    expect(detectAndroid({ ua: WINDOWS, platform: "Android" })).toBe(true);
  });

  it("leaves everything else alone", () => {
    expect(detectAndroid({ ua: CHROMEBOOK })).toBe(false);
    expect(detectAndroid({ ua: IPHONE })).toBe(false);
    expect(detectAndroid({ ua: WINDOWS })).toBe(false);
  });

  it("offers a phone no desktop installer", () => {
    expect(detectDesktop({ ua: PIXEL })).toEqual({ os: null, arch: null });
  });
});

describe("Android builds", () => {
  const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  // The values Chromium really reports, checked against a UA-metadata override
  // in a headless Chrome rather than taken on trust.
  const split: AndroidRelease = {
    version: "1.0.3",
    version_code: 4,
    released_at: 0,
    name: "evilion-chat-1.0.3.apk",
    size: 41_000_000,
    sha256: "u".repeat(64),
    min_sdk: 26,
    files: [
      { abi: "universal", name: "evilion-chat-1.0.3.apk", size: 41_000_000, sha256: "u".repeat(64) },
      { abi: "arm64-v8a", name: "evilion-chat-1.0.3-arm64-v8a.apk", size: 16_900_000, sha256: "a".repeat(64) },
      { abi: "armeabi-v7a", name: "evilion-chat-1.0.3-armeabi-v7a.apk", size: 11_100_000, sha256: "b".repeat(64) },
      { abi: "x86_64", name: "evilion-chat-1.0.3-x86_64.apk", size: 20_700_000, sha256: "c".repeat(64) },
    ],
  };
  // What the server sent before the split, and still sends for 1.0.2.
  const flat: AndroidRelease = { version: "1.0.2", version_code: 3, released_at: 0, name: "evilion-chat-1.0.2.apk", size: 40_977_625, sha256: "d".repeat(64), min_sdk: 26 };

  it("reads the processor Chromium reports", () => {
    expect(detectAndroidAbi({ ua: PIXEL, architecture: "arm", bitness: "64" })).toBe("arm64-v8a");
    expect(detectAndroidAbi({ ua: PIXEL, architecture: "arm", bitness: "32" })).toBe("armeabi-v7a");
    expect(detectAndroidAbi({ ua: PIXEL, architecture: "x86", bitness: "64" })).toBe("x86_64");
    expect(detectAndroidAbi({ ua: PIXEL, architecture: "x86", bitness: "32" })).toBe("x86");
  });

  it("treats a browser that will not say as the ordinary case", () => {
    // Firefox and Safari offer no high-entropy hints at all
    expect(detectAndroidAbi({ ua: PIXEL })).toBeNull();
    expect(detectAndroidAbi({ ua: PIXEL, architecture: "arm" })).toBeNull();
    expect(detectAndroidAbi({ ua: WINDOWS, architecture: "arm", bitness: "64" })).toBeNull();
  });

  it("offers the build for the processor, and the universal one otherwise", () => {
    expect(pickAndroid(split, "arm64-v8a").name).toBe("evilion-chat-1.0.3-arm64-v8a.apk");
    expect(pickAndroid(split, "x86_64").size).toBe(20_700_000);
    expect(pickAndroid(split, null).abi).toBe("universal");
    // a processor with no build published falls back rather than offering nothing
    expect(pickAndroid(split, "x86").abi).toBe("universal");
  });

  it("still has something to offer for a release published before the split", () => {
    expect(builds(flat)).toEqual([{ abi: "universal", name: "evilion-chat-1.0.2.apk", size: 40_977_625, sha256: "d".repeat(64) }]);
    expect(pickAndroid(flat, "arm64-v8a").name).toBe("evilion-chat-1.0.2.apk");
  });
});
