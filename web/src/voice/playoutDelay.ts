/**
 * How long a voice waits before it plays.
 *
 * WebRTC's own buffer is built to survive a bad network: it grows when packets
 * arrive unevenly and comes back down slowly, so on a link that has nothing
 * wrong with it people still hear each other later than they need to. Talking
 * over a call is a conversation, and a tenth of a second either way is the
 * difference between talking and taking turns.
 *
 * So a receiver whose packets have been arriving cleanly is asked to keep its
 * buffer short. The moment losses or concealment show up the ask is dropped
 * and WebRTC goes back to deciding for itself, because a buffer that is too
 * short on a bad link is far worse than one that is too long: gaps, not delay.
 * Coming back down needs a clean stretch, so it cannot flap.
 */

/** The shortest buffer to ask for, in milliseconds. Opus frames are 20 ms. */
export const FLOOR_MS = 60;
/** Loss or concealment past this means the link is not clean. */
const DIRTY = 0.005;
/** How long a receiver has to be clean before its buffer is shortened. */
const CLEAN_FOR_MS = 4000;
/** How long after trouble before it may be asked again. */
const BACK_OFF_MS = 15_000;

/** What a receiver's counters said this second. */
export interface DelaySample {
  loss: number;
  conceal: number;
}

interface Track {
  cleanSince: number;
  troubleAt: number;
  asked: boolean;
}

/** Whether this browser lets a receiver be asked for a shorter buffer. */
export function canSetDelay(): boolean {
  if (typeof RTCRtpReceiver === "undefined") return false;
  const proto = RTCRtpReceiver.prototype as unknown as Record<string, unknown>;
  return "jitterBufferTarget" in proto || "playoutDelayHint" in proto;
}

function apply(receiver: RTCRtpReceiver, ms: number | null): void {
  const r = receiver as unknown as Record<string, unknown>;
  try {
    // jitterBufferTarget is the standard one, in milliseconds; Chromium's
    // older playoutDelayHint is in seconds and means the same thing.
    if ("jitterBufferTarget" in r) r["jitterBufferTarget"] = ms;
    else if ("playoutDelayHint" in r) r["playoutDelayHint"] = ms === null ? null : ms / 1000;
  } catch {
    /* a browser that lists it and refuses the value keeps its own */
  }
}

/** Keeps each voice receiver's buffer as short as its link allows. */
export class PlayoutDelay {
  private tracks = new Map<string, Track>();

  /** A receiver's counters for the last second. Returns what was asked for, for tests. */
  observe(id: string, receiver: RTCRtpReceiver, sample: DelaySample, now: number): number | null {
    let t = this.tracks.get(id);
    if (!t) {
      t = { cleanSince: now, troubleAt: Number.NEGATIVE_INFINITY, asked: false };
      this.tracks.set(id, t);
    }
    const dirty = sample.loss > DIRTY || sample.conceal > DIRTY;
    if (dirty) {
      t.troubleAt = now;
      t.cleanSince = now;
      if (t.asked) {
        t.asked = false;
        apply(receiver, null);
      }
      return null;
    }
    if (t.asked) return FLOOR_MS;
    if (now - t.cleanSince < CLEAN_FOR_MS || now - t.troubleAt < BACK_OFF_MS) return null;
    t.asked = true;
    apply(receiver, FLOOR_MS);
    return FLOOR_MS;
  }

  forget(id: string): void {
    this.tracks.delete(id);
  }

  clear(): void {
    this.tracks.clear();
  }
}
