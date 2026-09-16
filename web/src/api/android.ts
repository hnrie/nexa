import { api, ApiError } from "./client";

/** The published Android app, as /api/v1/android/latest describes it. */
export interface AndroidRelease {
  version: string;
  version_code: number;
  released_at: number;
  name: string;
  size: number;
  sha256: string;
  min_sdk: number;
  abis?: string[];
  signing_sha256?: string;
}

export const android = {
  /** The newest published build, or null when there is none yet. */
  async latest(): Promise<AndroidRelease | null> {
    try {
      return await api.request<AndroidRelease>("GET", "/android/latest");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  /** Where the APK downloads from. */
  fileUrl(name: string): string {
    return `/android/${encodeURIComponent(name)}`;
  },
};

/** The lowest Android version a build runs on, from its minimum SDK level. */
export function androidVersionName(minSdk: number): string {
  const names: Record<number, string> = { 24: "7.0", 26: "8.0", 28: "9", 29: "10", 30: "11", 31: "12", 33: "13", 34: "14", 35: "15", 36: "16" };
  return names[minSdk] ?? `API ${minSdk}`;
}
