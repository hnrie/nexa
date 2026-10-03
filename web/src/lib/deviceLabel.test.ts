import { describeDevice } from "./deviceLabel";

describe("describeDevice", () => {
  it("names the Android app by the phone it runs on", () => {
    expect(describeDevice("NexaAndroid/1.0.0 (Linux; Android 15; Pixel 9)")).toEqual({ label: "Android App on Pixel 9", kind: "phone" });
    expect(describeDevice("NexaAndroid/1.2.0 (Linux; Android 14; SM-S918B)").label).toBe("Android App on SM-S918B");
    // with no model, the release
    expect(describeDevice("NexaAndroid/1.0.0 (Linux; Android 13)").label).toBe("Android App on Android 13");
    expect(describeDevice("NexaAndroid/1.0.0").label).toBe("Android App on Android");
  });

  it("names browsers and the desktop app by their system", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")).toEqual({ label: "Chrome on Windows", kind: "computer" });
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Nexa/1.2.1 Chrome/140.0.0.0 Electron/44.3.0 Safari/537.36")).toEqual({ label: "Desktop App on macOS", kind: "computer" });
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1")).toEqual({ label: "Safari on iOS", kind: "phone" });
    expect(describeDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36")).toEqual({ label: "Chrome on Android", kind: "phone" });
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36").kind).toBe("tablet");
  });

  it("says when it cannot tell", () => {
    expect(describeDevice("")).toEqual({ label: "Unknown Device", kind: "unknown" });
    expect(describeDevice("curl/8.7.1")).toEqual({ label: "Browser", kind: "unknown" });
  });
});
