/**
 * Screen share size and frame rate, picked before each share: what to ask the
 * browser's capture for, and how many bits the share may use.
 */
import type { ShareFps, ShareKeep, ShareMode, ShareResolution } from "@/stores/settings";
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

/**
 * What a share is sent as: its size and frame rate, its bitrate limit, and
 * what it gives up first when the connection is short. `smooth` shares keep
 * their frames and are made smaller by what the link carries (shareAdapt.ts);
 * the others keep their size and give up frames, which keeps detail and text
 * sharp (media.ts sets the capture's content hint by it).
 */
export interface SharePlan {
  res: ShareResolution;
  fps: ShareFps;
  bitrate: number;
  smooth: boolean;
}

/**
 * Performance: smooth motion for games and video, light on both ends. 1080p
 * at 60 fps within 6 Mbit/s, which hard motion at 0.06 bits a pixel a frame
 * fills at about 1536x864, so the picture is a little softer than Quality's
 * and steps down further when the link is short, never the frame rate.
 */
export const PERFORMANCE_PLAN: SharePlan = { res: "1080p", fps: 60, bitrate: 6_000_000, smooth: true };
/**
 * Quality: the screen as it is, at its own resolution and up to 60 fps, at
 * the most a share may use. When the link is short it gives up frames, never
 * detail.
 */
export const QUALITY_PLAN: SharePlan = { res: "source", fps: 60, bitrate: MAX_SHARE_BPS, smooth: false };

const SHARE_MODES: readonly string[] = ["performance", "quality", "custom"];

/** A Custom bitrate limit from settings, in bits a second, held to what a share may use; null when there is none. */
export function customShareBitrate(bps: unknown): number | null {
  return typeof bps === "number" && Number.isFinite(bps) && bps > 0 ? Math.round(Math.min(MAX_SHARE_BPS, Math.max(MIN_SHARE_BPS, bps))) : null;
}

/** What a share is sent as, from the account's voice settings. */
export function sharePlan(v: { shareMode?: unknown; shareResolution?: unknown; shareFps?: unknown; shareBitrate?: unknown; shareKeep?: unknown }): SharePlan {
  if (v.shareMode === "quality") return QUALITY_PLAN;
  if (v.shareMode !== "custom") return PERFORMANCE_PLAN;
  const q = shareQuality(v.shareResolution, v.shareFps);
  return { res: q.res, fps: q.fps, bitrate: customShareBitrate(v.shareBitrate) ?? shareBitrate(q.res, q.fps), smooth: v.shareKeep === "smooth" };
}

/**
 * The mode, Custom bitrate and what a Custom share keeps, read from saved
 * settings (`incoming`, as stored) with `merged` holding the size and frame
 * rate already checked. Settings from before modes had only a size and frame
 * rate: one other than the usual 1080p at 30 fps was a choice, kept as
 * Custom with what that frame rate used to keep (60 fps stayed smooth, slower
 * ones sharp); the usual one becomes Performance.
 */
export function shareModeOf(incoming: { shareMode?: unknown; shareBitrate?: unknown; shareKeep?: unknown }, merged: { shareResolution: ShareResolution; shareFps: ShareFps }): { shareMode: ShareMode; shareBitrate: number | null; shareKeep: ShareKeep } {
  const keep: ShareKeep = incoming.shareKeep === "smooth" || incoming.shareKeep === "sharp" ? incoming.shareKeep : merged.shareFps >= 60 ? "smooth" : "sharp";
  const bitrate = customShareBitrate(incoming.shareBitrate);
  if (typeof incoming.shareMode === "string" && SHARE_MODES.includes(incoming.shareMode)) return { shareMode: incoming.shareMode as ShareMode, shareBitrate: bitrate, shareKeep: keep };
  const chosen = merged.shareResolution !== "1080p" || merged.shareFps !== 30;
  return { shareMode: chosen ? "custom" : "performance", shareBitrate: bitrate, shareKeep: keep };
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
