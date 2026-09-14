import { api, ApiError } from "./client";

export interface DesktopFile {
  os: "windows" | "mac" | "linux";
  arch: "x64" | "arm64";
  /** installer (.exe, .dmg) | appimage | deb | zip (the Mac updater's) */
  kind: "installer" | "appimage" | "deb" | "zip";
  name: string;
  size: number;
  sha256: string;
}

export interface DesktopRelease {
  version: string;
  released_at: number;
  files: DesktopFile[];
}

export const desktop = {
  /** The newest published desktop app, or null when there is none yet. */
  async latest(): Promise<DesktopRelease | null> {
    try {
      return await api.request<DesktopRelease>("GET", "/desktop/latest");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  /** Where a published file downloads from. */
  fileUrl(name: string): string {
    return `/desktop/${encodeURIComponent(name)}`;
  },
};
