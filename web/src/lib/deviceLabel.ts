import { t } from "@/i18n";

/** What a signed-in device is, for the icon beside its name. */
export type DeviceKind = "phone" | "tablet" | "computer" | "unknown";

export interface DeviceInfo {
  label: string;
  kind: DeviceKind;
}

/**
 * A session's user agent as a person names the device: "Chrome on Windows",
 * "Desktop App on macOS", "Android App on Pixel 9".
 */
export function describeDevice(ua: string): DeviceInfo {
  if (!ua) return { label: t("settings.devices.unknownDevice"), kind: "unknown" };
  // The Android app says so first: "NexaAndroid/1.0.0 (Linux; Android 15; Pixel 9)".
  // The phone's model is what its owner recognises, and the release is the fallback.
  if (/NexaAndroid\//.test(ua)) {
    const parts = (/NexaAndroid\/[^\s(]*\s*\(([^)]*)\)/.exec(ua)?.[1] ?? "").split(";").map((p) => p.trim()).filter(Boolean);
    const release = parts.find((p) => /^Android\b/i.test(p));
    const model = parts.find((p) => p !== release && !/^(Linux|U|wv|K)$/i.test(p));
    return { label: t("settings.devices.androidAppOn", { device: model || release || "Android" }), kind: "phone" };
  }
  // the desktop app is a browser inside, but nobody thinks of it as Chrome
  const browser = /Electron\//.test(ua) ? t("settings.desktop.desktopApp") : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : t("settings.devices.browser");
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  // an Android tablet's browser leaves "Mobile" out of its user agent
  const kind: DeviceKind = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : /iPhone|iPod|Android|Mobi/.test(ua) ? "phone" : os ? "computer" : "unknown";
  return { label: os ? t("settings.devices.browserOnSystem", { browser, system: os }) : browser, kind };
}
