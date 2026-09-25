import { storage } from "@/lib/storage";

/**
 * Volume, mute and speed for voice notes and videos, remembered on this
 * device. Each player used to start at full volume and 1×, so someone who
 * keeps media quiet re-muted every clip, and again after scrolling away and
 * back.
 */
export interface MediaPrefs {
  volume: number;
  muted: boolean;
  speed: number;
}

const KEY = "ec:mediaPrefs";
const DEFAULTS: MediaPrefs = { volume: 1, muted: false, speed: 1 };

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function mediaPrefs(): MediaPrefs {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "null") as Partial<MediaPrefs> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    return { volume: clamp(raw.volume, 0, 1, 1), muted: raw.muted === true, speed: clamp(raw.speed, 0.5, 2, 1) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMediaPrefs(patch: Partial<MediaPrefs>): void {
  storage.set(KEY, JSON.stringify({ ...mediaPrefs(), ...patch }));
}
