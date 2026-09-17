/**
 * Screen share size and frame rate, picked before each share: what to ask the
 * browser's capture for, and how many bits the share may use.
 */
import type { ShareFps, ShareResolution } from "@/stores/settings";

import { t } from "@/i18n";
export function shareResolutions(): { value: ShareResolution; label: string; box?: { width: number; height: number } }[] {
  return [
  { value: "720p", label: "720p", box: { width: 1280, height: 720 } },
  { value: "1080p", label: "1080p", box: { width: 1920, height: 1080 } },
  { value: "1440p", label: "1440p", box: { width: 2560, height: 1440 } },
  { value: "source", label: t("shareQuality.source") },
];
}

export const SHARE_FRAME_RATES: ShareFps[] = [15, 30, 60];

/**
 * Capture constraints: a picture no bigger than the chosen size (a wide or tall
 * window keeps its shape inside it) at no more than the chosen frame rate.
 */
export function shareVideoConstraints(res: ShareResolution, fps: ShareFps): MediaTrackConstraints {
  const box = shareResolutions().find((r) => r.value === res)?.box;
  const c: MediaTrackConstraints = {};
  if (box) {
    c.width = { max: box.width };
    c.height = { max: box.height };
  }
  c.frameRate = { ideal: fps, max: fps };
  return c;
}

/** The bounds internal/realtime.ClampScreenBps holds a share's declared rate to. */
export const MIN_SHARE_BPS = 1_000_000;
export const MAX_SHARE_BPS = 12_000_000;

const BPS_AT_30: Record<ShareResolution, number> = { "720p": 2_500_000, "1080p": 5_000_000, "1440p": 8_000_000, source: 10_000_000 };
const FPS_SCALE: Record<ShareFps, number> = { 15: 0.6, 30: 1, 60: 1.5 };

/** The bitrate cap for a share, which the SFU meter also charges it at. */
export function shareBitrate(res: ShareResolution, fps: ShareFps): number {
  return Math.min(MAX_SHARE_BPS, Math.max(MIN_SHARE_BPS, Math.round(BPS_AT_30[res] * FPS_SCALE[fps])));
}

/** Reads the single "stream quality" that older versions saved. */
export function fromStreamQuality(q: unknown): { shareResolution: ShareResolution; shareFps: ShareFps } | null {
  switch (q) {
    case "720p30":
      return { shareResolution: "720p", shareFps: 30 };
    case "1080p30":
      return { shareResolution: "1080p", shareFps: 30 };
    case "1080p60":
      return { shareResolution: "1080p", shareFps: 60 };
    case "source":
      return { shareResolution: "source", shareFps: 60 };
    default:
      return null;
  }
}
