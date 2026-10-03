import { detectAndroid, detectAndroidAbi, detectDesktop, pickAndroid, pickDownload } from "./platform";
import type { AndroidFile } from "@/api/android";
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
  it("finds Android phones and tablets, in any browser", () => {
    expect(detectAndroid(ANDROID)).toBe(true);
    expect(detectAndroid("Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0")).toBe(true);
    expect(detectAndroid("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")).toBe(true);
    // a tablet asking for the desktop site still says so through its hints
    expect(detectAndroid(LINUX, "Android")).toBe(true);
  });
  it("leaves out computers, iPhones, Chromebooks and the Android app itself", () => {
    for (const ua of [WIN, MAC_SAFARI, LINUX, IPHONE, CROS]) expect(detectAndroid(ua)).toBe(false);
    expect(detectAndroid("Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 NexaAndroid/1.0.0")).toBe(false);
  });
});

describe("detectAndroidAbi and pickAndroid", () => {
  const files: AndroidFile[] = [
    { abi: "arm64-v8a", name: "a64.apk", size: 1, sha256: "a" },
    { abi: "armeabi-v7a", name: "a32.apk", size: 1, sha256: "b" },
    { abi: "universal", name: "all.apk", size: 3, sha256: "c" },
  ];
  it("reads the processor from what the browser offers", () => {
    expect(detectAndroidAbi({ navPlatform: "Linux aarch64" })).toBe("arm64-v8a");
    // a 64-bit processor running a 32-bit browser is still a 64-bit phone
    expect(detectAndroidAbi({ navPlatform: "Linux armv8l" })).toBe("arm64-v8a");
    expect(detectAndroidAbi({ navPlatform: "Linux armv81" })).toBe("arm64-v8a");
    expect(detectAndroidAbi({ navPlatform: "Linux armv7l" })).toBe("armeabi-v7a");
    expect(detectAndroidAbi({ navPlatform: "Linux x86_64" })).toBe("x86_64");
    expect(detectAndroidAbi({ navPlatform: "Linux i686" })).toBe("x86");
    expect(detectAndroidAbi({ architecture: "arm", bitness: "32", navPlatform: "Linux armv8l" })).toBe("armeabi-v7a");
    // Chromium on Android answers its hints with empty strings
    expect(detectAndroidAbi({ architecture: "", bitness: "", navPlatform: "" })).toBeNull();
  });
  it("offers the 64-bit build unless the phone is plainly something else", () => {
    expect(pickAndroid(files, null)?.name).toBe("a64.apk");
    expect(pickAndroid(files, "arm64-v8a")?.name).toBe("a64.apk");
    expect(pickAndroid(files, "armeabi-v7a")?.name).toBe("a32.apk");
    expect(pickAndroid(files, "x86_64")?.name).toBe("all.apk");
    expect(pickAndroid(files, "x86")?.name).toBe("all.apk");
    expect(pickAndroid([files[2]!], null)?.name).toBe("all.apk");
    expect(pickAndroid([], null)).toBeNull();
  });
});
