/**
 * Screen share size and frame rate, picked before each share: what to ask the
 * browser's capture for, and how many bits the share may use.
 */
import type { ShareFps, ShareResolution } from "@/stores/settings";
import { VIDEO_CAP } from "./videoCap";

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

const SHARE_RESOLUTIONS: readonly string[] = ["720p", "1080p", "1440p", "source"];

/** Whether a value from settings, saved by this or another device, is one of the share sizes on offer. */
export function isShareResolution(v: unknown): v is ShareResolution {
  return typeof v === "string" && SHARE_RESOLUTIONS.includes(v);
}

/** Whether a value from settings is one of the share frame rates on offer. */
export function isShareFps(v: unknown): v is ShareFps {
  return typeof v === "number" && (SHARE_FRAME_RATES as number[]).includes(v);
}

/** A share's size and frame rate, each the usual one (1080p, 30) when it is not one on offer. */
export function shareQuality(res: unknown, fps: unknown): { res: ShareResolution; fps: ShareFps } {
  return { res: isShareResolution(res) ? res : "1080p", fps: isShareFps(fps) ? fps : 30 };
}

/**
 * Capture constraints: a picture no bigger than the chosen size (a wide or tall
 * window keeps its shape inside it) at no more than the chosen frame rate.
 * Source resolution is held to the longest side calls carry (videoCap.ts); a
 * larger screen is scaled down to it, and the sender scales down whatever is
 * still over the cap in pixels.
 */
export function shareVideoConstraints(res: ShareResolution, fps: ShareFps): MediaTrackConstraints {
  const q = shareQuality(res, fps);
  const box = shareResolutions().find((r) => r.value === q.res)?.box ?? { width: VIDEO_CAP.side, height: VIDEO_CAP.side };
  return { width: { max: box.width }, height: { max: box.height }, frameRate: { ideal: q.fps, max: q.fps } };
}

/** The bounds internal/realtime.ClampScreenBps holds a share's declared rate to. */
export const MIN_SHARE_BPS = 1_000_000;
export const MAX_SHARE_BPS = 12_000_000;

/**
 * What a share may use at 30 fps. Hard motion needs about 0.06 bits a pixel
 * a frame in VP8 to look clean (shareAdapt.ts), so 1080p at 60 fps gets just
 * under 10 Mbit/s, room to spare on a good link, and a 60 fps share is shrunk
 * when the link cannot carry it whole.
 */
const BPS_AT_30: Record<ShareResolution, number> = { "720p": 3_000_000, "1080p": 6_000_000, "1440p": 9_000_000, source: 10_000_000 };
const FPS_SCALE: Record<ShareFps, number> = { 15: 0.6, 30: 1, 60: 1.65 };

/** The bitrate cap for a share, which the SFU meter also charges it at. */
export function shareBitrate(res: ShareResolution, fps: ShareFps): number {
  const q = shareQuality(res, fps);
  return Math.min(MAX_SHARE_BPS, Math.max(MIN_SHARE_BPS, Math.round(BPS_AT_30[q.res] * FPS_SCALE[q.fps])));
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
