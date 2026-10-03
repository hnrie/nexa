import { api } from "./client";

/**
 * One published APK. `abi` is "universal" for the build that installs on any
 * phone, or the one processor a smaller build carries code for.
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
  min_sdk: number;
  /** The oldest Android it installs on, as people know it ("8.0"). */
  min_android: string;
  files: AndroidFile[];
  notes?: string;
}

// The banner and the download page can both ask on one page load; they share
// the one request, and a failed one is asked again next time.
let asked: Promise<AndroidRelease | null> | null = null;

export const android = {
  /** The published app, or null when nothing is published. */
  latest(): Promise<AndroidRelease | null> {
    if (!asked) {
      asked = api.request<AndroidRelease>("GET", "/android/latest").then((rel) => (rel.version && rel.files?.length ? rel : null));
      asked.catch(() => {
        asked = null;
      });
    }
    return asked;
  },
  /**
   * Where a build downloads from. Its name stays the same from version to
   * version; the hash in the address is what lets it be kept for good.
   */
  fileUrl(file: AndroidFile): string {
    return `/android/${encodeURIComponent(file.name)}?v=${file.sha256.slice(0, 12)}`;
  },
};
