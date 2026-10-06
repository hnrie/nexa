/**
 * Keeping a 60 fps screen share moving when the link cannot carry it whole.
 *
 * A share at 60 fps is for motion: a game, a video. Measured through the SFU
 * (tools/share_quality.py), Chromium's own answer to too little bandwidth goes
 * wrong both ways for a screen. With the "motion" content hint it scales the
 * capture down when the share starts (the bandwidth estimate starts low) and
 * never scales it back up: 1080p at 60 fps reached people as 480x270 for the
 * whole share, with plenty of bandwidth to spare. Without the hint it keeps the
 * full size and drops frames instead, down to 35 a second on a 4 Mbit/s
 * upload, each of them blocky. So the share runs without the hint, and this
 * picks its size: every few seconds it reads what the browser gives the share
 * to spend (its targetBitrate) and scales the picture down just far enough for
 * that to carry 60 frames a second, then back up as soon as there is room.
 *
 * It only steers a share meant for motion. At 15 or 30 frames a second
 * (slides, text, a page) the share keeps its full size and gives up frames,
 * which keeps writing readable. Where the browser does not say what it may
 * spend (Firefox), it is left alone.
 */
import { capScale } from "./videoCap";

/**
 * Bits a frame of fast motion needs per pixel to look clean in VP8: 1080p at
 * 60 fps comes to about 7.5 Mbit/s, which a share was measured to carry
 * without its blocks showing.
 */
export const MOTION_BITS_PER_PIXEL = 0.06;
/** How far short of a size the budget may fall before the share steps down to the next one. */
const SHORT_TOLERANCE = 0.06;
/** The sizes a share steps through, as what the picture is divided by. */
export const SHARE_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
/** Checks in a row that say the share is short before it is made smaller, and that say there is room before it grows again. */
const SHRINK_AFTER = 2;
const GROW_AFTER = 3;
/**
 * How close to the next size up the budget has to come before growing: a
 * little closer than SHORT_TOLERANCE lets it fall before shrinking, so a
 * budget near one size does not flip the share between it and the next.
 */
const GROW_TOLERANCE = 0.02;
/**
 * Checks after a share starts in which it is never made smaller: the browser
 * starts a new share's budget low and raises it over the first seconds, and
 * shrinking for that would only mean growing back again.
 */
const START_GRACE = 3;

/** What a share at this many pixels and frames a second would have to be divided by to fit in the budget; 1 when it fits whole. */
export function motionScale(pixels: number, fps: number, budgetBps: number): number {
  if (!(pixels > 0 && fps > 0 && budgetBps > 0) || !Number.isFinite(pixels * fps * budgetBps)) return 1;
  return Math.max(1, Math.sqrt((pixels * fps * MOTION_BITS_PER_PIXEL) / budgetBps));
}

export interface AdaptState {
  /** The step the share is at. */
  scale: number;
  /** Checks in a row asking for a smaller picture, and for a larger one. */
  short: number;
  room: number;
}

export const START: AdaptState = { scale: 1, short: 0, room: 0 };

/** The smallest step that divides the picture at least `want` times (the last step when none does). */
export function stepFor(want: number): number {
  return SHARE_STEPS.find((s) => s >= want - SHORT_TOLERANCE) ?? SHARE_STEPS[SHARE_STEPS.length - 1]!;
}

/**
 * The next step, from what the latest check asks for (`want`, as
 * motionScale gives it). Down soon when the share is short, so motion keeps
 * going; up only after a few checks with room to spare, so the size does not
 * hunt back and forth.
 */
export function nextStep(state: AdaptState, want: number): AdaptState {
  const fit = stepFor(want);
  if (fit > state.scale + 1e-6) {
    const short = state.short + 1;
    return short >= SHRINK_AFTER ? { scale: fit, short: 0, room: 0 } : { scale: state.scale, short, room: 0 };
  }
  const at = SHARE_STEPS.findIndex((s) => s >= state.scale - 1e-6);
  const up = at > 0 ? SHARE_STEPS[at - 1]! : state.scale;
  if (up < state.scale && want <= up + GROW_TOLERANCE) {
    const room = state.room + 1;
    return room >= GROW_AFTER ? { scale: up, short: 0, room: 0 } : { scale: state.scale, short: 0, room };
  }
  return { scale: state.scale, short: 0, room: 0 };
}

/** What one look at a share sender's statistics says: the picture going in, and what it may spend. */
export interface ShareSample {
  width: number;
  height: number;
  budgetBps: number | null;
}

/** Reads a share sender's statistics: the source's size (or what was sent, scaled back up) and the encoder's target. */
export function readShareStats(stats: Iterable<Record<string, unknown>>, scale: number): ShareSample | null {
  let source: { w: number; h: number } | null = null;
  let sent: { w: number; h: number } | null = null;
  let budget: number | null = null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  for (const s of stats) {
    if (s.kind !== "video") continue;
    if (s.type === "media-source") {
      const w = num(s.width), h = num(s.height);
      if (w && h) source = { w, h };
    } else if (s.type === "outbound-rtp") {
      const w = num(s.frameWidth), h = num(s.frameHeight);
      if (w && h && !sent) sent = { w: w * scale, h: h * scale };
      budget = num(s.targetBitrate) ?? budget;
    }
  }
  const size = source ?? sent;
  return size ? { width: size.w, height: size.h, budgetBps: budget } : null;
}

/** One share sender's steering: the step it is at, and what it is for. */
export class ShareAdapter {
  private state: AdaptState = START;
  private checks = 0;

  /** `fps` is the share's chosen rate; only a share at 50 or more is steered. */
  constructor(readonly fps: number) {}

  get steering(): boolean {
    return this.fps >= 50;
  }

  /** The scale to send at for this look: whatever the size cap asks for, and for a share in motion whatever fits the budget. */
  scaleFor(sample: ShareSample): number {
    const cap = capScale(sample.width, sample.height);
    if (!this.steering || sample.budgetBps === null) return cap;
    const want = motionScale(sample.width * sample.height, this.fps, sample.budgetBps);
    this.checks++;
    // while the budget is still climbing at the start, the share keeps its size
    if (this.checks > START_GRACE || stepFor(want) <= this.state.scale) this.state = nextStep(this.state, want);
    return Math.max(cap, this.state.scale);
  }
}

/**
 * Looks at a screen share's sender and changes its scale when that calls for
 * it: smaller while the link cannot carry 60 frames a second of it, larger
 * again once it can, and always within the size cap. Called every few seconds
 * while a share runs, in place of recapSender.
 */
export async function retuneShare(sender: RTCRtpSender, adapter: ShareAdapter): Promise<void> {
  try {
    const track = sender.track;
    if (!track || track.kind !== "video" || track.readyState !== "live") return;
    const have = Math.max(1, sender.getParameters().encodings?.[0]?.scaleResolutionDownBy ?? 1);
    const report = await sender.getStats();
    const sample = readShareStats(report.values() as Iterable<Record<string, unknown>>, have);
    if (!sample) return;
    const want = adapter.scaleFor(sample);
    if (Math.abs(want - have) / have < 0.01) return;
    const params = sender.getParameters();
    const enc = params.encodings?.[0];
    if (!enc) return;
    enc.scaleResolutionDownBy = want;
    await sender.setParameters(params);
  } catch {
    /* the sender went away, or cannot say */
  }
}
