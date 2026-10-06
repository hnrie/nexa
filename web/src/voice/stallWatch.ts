/**
 * Telling a watched screen share stuck on a frame that will never arrive from
 * one that is simply still (sfu.ts watchStalls).
 *
 * A packet the SFU could not resend leaves every frame after it waiting on it,
 * and the browser only asks the sender for a fresh keyframe after some three
 * seconds (measured through Cloudflare with tools/share_quality.py; the frames
 * after the gap are not even counted as received). What that looks like from
 * the receiver's counters is packets still coming in while nothing is decoded,
 * starting right after frames were. A picture that simply stopped changing
 * sends next to nothing, and is never asked about.
 */

/** How often the counters are read. */
export const STALL_CHECK_MS = 400;
/** How long a stall lasts before the keyframe is asked for, how long before asking again, and how many times at most. */
export const STALL_ASK_MS = 400;
export const STALL_REASK_MS = 1_500;
export const STALL_MAX_ASKS = 4;
/** How soon after the last decoded frame the packets-without-pictures must start, a check or two of slack included. */
const STALL_FRESH_MS = 3 * STALL_CHECK_MS;

/** One watched share's last counts, when its frames last moved, since when it has been stuck, and its asks. */
export interface StallWatch {
  packets: number;
  frames: number;
  moved: number;
  since: number | null;
  asked: number;
  asks: number;
}

/**
 * The watch after one more reading of a share's counters (`packets`
 * received, `frames` decoded), and whether to ask its sender for a keyframe
 * now. `was` is the previous watch, or null for a share seen the first time.
 */
export function watchStall(was: StallWatch | null, packets: number, frames: number, now: number): { watch: StallWatch; ask: boolean } {
  const watch: StallWatch = { packets, frames, moved: was?.moved ?? now, since: null, asked: was?.asked ?? 0, asks: 0 };
  if (!was || frames !== was.frames) {
    watch.moved = now;
    return { watch, ask: false };
  }
  // nothing coming in at all is a share that is still or gone, not a stuck one
  if (packets <= was.packets) return { watch, ask: false };
  watch.since = was.since ?? now;
  watch.asks = was.asks;
  const fresh = watch.since - watch.moved <= STALL_FRESH_MS;
  const ask = fresh && now - watch.since >= STALL_ASK_MS && now - watch.asked >= STALL_REASK_MS && watch.asks < STALL_MAX_ASKS;
  if (ask) {
    watch.asked = now;
    watch.asks++;
  }
  return { watch, ask };
}
