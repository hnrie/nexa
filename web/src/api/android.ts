import { api, ApiError } from "./client";

/**
 * One published APK. `abi` is "universal" for the build that runs anywhere, or
 * the one processor it carries code for — about a third of the size, which is
 * also what every future update costs.
 */
export interface AndroidFile {
  abi: string;
  name: string;
  size: number;
  sha256: string;
}

/** The published Android app, as /api/v1/android/latest describes it. */
export interface AndroidRelease {
  version: string;
  version_code: number;
  released_at: number;
  /** The universal build: the flat fields are always that one. */
  name: string;
  size: number;
  sha256: string;
  min_sdk: number;
  /**
   * Every build published for this version, universal first. Absent on
   * releases published before the split, which is why `builds()` exists.
   */
  files?: AndroidFile[];
  abis?: string[];
  signing_sha256?: string;
}

/**
 * Every build there is to offer, with the universal one guaranteed present.
 * A release published before per-processor builds existed carries no `files`
 * at all, and its flat fields are the universal APK.
 */
export function builds(rel: AndroidRelease): AndroidFile[] {
  const list = rel.files ?? [];
  if (list.some((f) => f.abi === "universal")) return list;
  return [{ abi: "universal", name: rel.name, size: rel.size, sha256: rel.sha256 }, ...list];
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
