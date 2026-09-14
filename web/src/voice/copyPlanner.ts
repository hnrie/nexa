/**
 * How many copies a speaker's voice frames carry (see redundancy.ts), from
 * what its listeners report.
 *
 * Listeners that lose packets say so, with how much audio they had to
 * conceal and how long audio waits to play, over the stretch of time just
 * before. Losses call for copies, but copies add bitrate, and a link that
 * loses packets because it is full only gets fuller. The congestion
 * controller's estimate is no help: with only voice to send it stays near
 * what voice uses, whatever the link carries. So more copies are a trial,
 * judged by what they did, and copies that made things worse stop and are not
 * tried again for a while. Worse is:
 *
 * - a listener concealing more with them;
 * - a listener losing more while audio waits clearly longer: their link
 *   queueing up and dropping what does not fit;
 * - this device's uplink losing far more once they go out, as the SFU reports
 *   every second: too narrow for them.
 *
 * Listeners' losses alone do not count, and neither does a longer wait alone:
 * the losses that call for copies are often still growing when copies start,
 * and a path that changes (a phone moving onto mobile data) waits longer by
 * itself. Nor are copies tried on an uplink that is full already: losing much
 * of this device's voice while every reply is slow (a queue). Opus's own FEC
 * covers what such a link drops, and copies would only fill it more.
 */

export interface VoiceReport {
  /** The share of packets lost. */
  loss: number;
  /** The share of audio concealed. */
  conceal: number;
  /** How long audio waits to play: jitter buffer and round trip, in ms. */
  delay: number;
  /** The stretch of time the report covers, up to when it was sent, in ms. */
  span?: number;
}

/**
 * Losses from this share up call for one copy of each voice frame, from the
 * second share two. A clean link still drops the odd packet, and copies cost
 * bitrate and a frame of delay while they are used.
 */
export const LOSS_ONE_COPY = 0.02;
export const LOSS_TWO_COPIES = 0.05;
/** A listener's report counts this long: copies stay while any report this recent calls for them. */
export const REPORT_TTL_MS = 20_000;
/** A report says what a change did when its whole stretch began this long after it: copies take a moment to reach listeners. */
export const LAG_MS = 1_000;
/** The stretch a report covers when it does not say. */
const DEFAULT_SPAN_MS = 2_000;
/**
 * A trial stands once it has run this long and listeners have reported on it
 * for JUDGE_MS. A trial nobody reports on proves nothing: it waits for
 * reports, or for the losses that started it to be forgotten.
 */
export const TRIAL_MS = 12_000;
export const JUDGE_MS = 8_000;
/**
 * Worse, on average over a trial's reports, and at once in any one report:
 * concealing more (this many times as much as before, plus this share; one
 * report from before is a rough measure, and a little concealment is noise),
 */
const WORSE_CONCEAL = [1.5, 0.03] as const;
const FAR_WORSE_CONCEAL = [2, 0.1] as const;
/** or losses up by this share at least while audio waits this much longer. */
const MORE_LOSS = 0.03;
const WORSE_DELAY_MS = 150;
const FAR_WORSE_DELAY_MS = 300;
/** A listener with nothing reported from before a trial is only held to how much it conceals with the copies. */
const ALONE_WORSE_CONCEAL = 0.1;
const ALONE_FAR_CONCEAL = 0.25;
/**
 * The uplink before a trial loses what it lost at worst over this long before
 * (the worst, since losses often only just began); with the copies, what it
 * loses from this long after on.
 */
export const UPLINK_BEFORE_MS = 5_000;
export const UPLINK_LAG_MS = 2_000;
/** Far more: this many times as much plus this share, on average over two checks or more, or in one check. */
const UPLINK_JUMP = [1.5, 0.15] as const;
const UPLINK_FAR_JUMP = [2, 0.25] as const;
/** Copies that passed their trial stop when the uplink loses far more and this device's round trip grows this much: an upload filling it, say. */
const QUEUE_RTT_MS = 100;
/**
 * An uplink losing this much, while the latest round trip is this much over
 * the lowest in RTT_FLOOR_MS, is full: nothing is tried on it.
 */
const FULL_UPLINK_LOSS = 0.1;
const FULL_RTT_MS = 150;
const RTT_FLOOR_MS = 120_000;
/** After copies make things worse, none go out for this long, so the link drains before anything else is tried. */
export const COOLDOWN_MS = 20_000;
/**
 * The depth that made things worse is not tried again for this long. Failing
 * again soon after doubles the wait; failing long after is a new stretch of
 * trouble and starts over.
 */
export const BACKOFF_MS = 60_000;
const BACKOFF_MAX_MS = 8 * 60_000;
export const MAX_COPIES = 2;
/** Reports kept per listener. */
const KEEP = 4;

type Heard = Required<VoiceReport> & { at: number };
type Summary = { loss: number; conceal: number; delay: number };

/** When a report's stretch began. */
const began = (r: Heard) => r.at - r.span;
const average = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const jumped = (now: number, was: number, [times, plus]: readonly [number, number]) => now > was * times + plus;

function mean(reports: Heard[]): Summary {
  return { loss: average(reports.map((r) => r.loss)), conceal: average(reports.map((r) => r.conceal)), delay: average(reports.map((r) => r.delay)) };
}

export class CopyPlanner {
  /** How many copies frames carry now. */
  depth = 0;
  /** Each listener's recent reports, oldest first. */
  private heard = new Map<string, Heard[]>();
  /** What the SFU said it lost of this device's voice at recent checks, oldest first. */
  private uplinks: { loss: number; at: number }[] = [];
  /** This device's round trip to the SFU at recent checks, oldest first. */
  private rtts: { ms: number; at: number }[] = [];
  private changedAt = Number.NEGATIVE_INFINITY;
  /** More copies being tried: how each listener was before, and what the uplink lost then. */
  private trial: { to: number; at: number; before: Map<string, Summary>; uplink: number | null } | null = null;
  /** Copies that passed their trial: since when, how each listener was, what the uplink lost, and this device's round trip. */
  private settled: { at: number; listeners: Map<string, Summary>; uplink: number | null; rtt: number | null } | null = null;
  /** Per depth: until when it is not tried, how long that wait was, and when it last failed. */
  private blocked: number[] = new Array<number>(MAX_COPIES + 1).fill(0);
  private backoff: number[] = new Array<number>(MAX_COPIES + 1).fill(0);
  private failedAt: number[] = new Array<number>(MAX_COPIES + 1).fill(Number.NEGATIVE_INFINITY);

  constructor(private readonly onChange: (depth: number) => void) {}

  /** A listener's report on this device's voice. */
  report(from: string, report: VoiceReport, now: number): void {
    const heard: Heard = { loss: report.loss, conceal: report.conceal, delay: report.delay, span: report.span ?? DEFAULT_SPAN_MS, at: now };
    this.heard.set(from, [...(this.heard.get(from) ?? []), heard].slice(-KEEP));
    this.update(now);
  }

  /** The share of this device's voice packets the SFU says it lost since the last check. */
  uplink(loss: number, now: number): void {
    this.uplinks = [...this.uplinks.filter((u) => now - u.at <= REPORT_TTL_MS), { loss, at: now }];
  }

  /** This device's round trip to the SFU, as measured now. */
  roundTrip(ms: number, now: number): void {
    this.rtts = [...this.rtts.filter((r) => now - r.at <= RTT_FLOOR_MS), { ms, at: now }];
  }

  /**
   * The round trip as the lowest of the last three measurements: a queue keeps
   * every reply slow, while jitter or one slow reply does not.
   */
  rtt(): number | null {
    return this.rtts.length > 0 ? Math.min(...this.rtts.slice(-3).map((r) => r.ms)) : null;
  }

  /** Whether this device's uplink is full already: losing much of its voice, with the latest reply slow for the path. */
  private uplinkFull(now: number): boolean {
    const latest = this.rtts.at(-1);
    const recent = this.uplinks.filter((u) => u.at >= now - UPLINK_BEFORE_MS).map((u) => u.loss);
    return latest !== undefined && recent.length > 0 && average(recent) >= FULL_UPLINK_LOSS && latest.ms >= Math.min(...this.rtts.map((r) => r.ms)) + FULL_RTT_MS;
  }

  update(now: number): void {
    let worst = 0;
    for (const [from, reports] of this.heard) {
      const fresh = reports.filter((r) => now - r.at <= REPORT_TTL_MS);
      if (fresh.length === 0) this.heard.delete(from);
      else this.heard.set(from, fresh);
      for (const r of fresh) worst = Math.max(worst, r.loss);
    }
    if (this.trial) this.judge(this.trial, now);
    else if (this.depth > 0 && this.settled && this.queueing(this.settled)) this.stop(1, now);
    let want = worst >= LOSS_TWO_COPIES ? 2 : worst >= LOSS_ONE_COPY ? 1 : 0;
    while (want > 0 && now < this.blocked[want]!) want--;
    if (want < this.depth) {
      this.trial = null;
      if (want === 0) this.settled = null;
      this.set(want, now);
    } else if (want > this.depth) {
      const uplink = this.worstUplinkSince(now - UPLINK_BEFORE_MS);
      if (this.trial) {
        // a trial still running goes on with more copies, against the same reports from before,
        // except for the losses that grew and called for them: those came before these copies
        for (const [from, was] of this.trial.before) {
          const latest = this.heard.get(from)?.at(-1);
          if (latest) was.loss = Math.max(was.loss, latest.loss);
        }
        if (uplink !== null) this.trial.uplink = Math.max(this.trial.uplink ?? 0, uplink);
        this.trial.to = want;
        this.trial.at = now;
      } else {
        // only reports that began after the last change say how things are at this depth;
        // with none yet, the next one says it before anything is tried
        const before = new Map<string, Summary>();
        for (const [from, reports] of this.heard) {
          const current = reports.filter((r) => began(r) >= this.changedAt + LAG_MS);
          if (current.length > 0) before.set(from, mean(current));
        }
        if (before.size === 0 || this.uplinkFull(now)) return;
        this.trial = { to: want, at: now, before, uplink };
      }
      this.set(want, now);
    }
  }

  private worstUplinkSince(from: number): number | null {
    const recent = this.uplinks.filter((u) => u.at >= from);
    return recent.length > 0 ? Math.max(...recent.map((u) => u.loss)) : null;
  }

  /** Stops a trial that made things worse, or lets it stand once listeners have reported on it long enough. */
  private judge(trial: NonNullable<CopyPlanner["trial"]>, now: number): void {
    let far = false;
    let worse = false;
    let firstAfter = Number.POSITIVE_INFINITY;
    const listeners = new Map<string, Summary>();
    for (const [from, reports] of this.heard) {
      const after = reports.filter((r) => began(r) >= trial.at + LAG_MS);
      if (after.length === 0) continue;
      firstAfter = Math.min(firstAfter, after[0]!.at);
      const avg = mean(after);
      listeners.set(from, avg);
      const was = trial.before.get(from);
      if (!was) {
        // nothing from before to compare with: only concealing a lot counts
        if (after.some((r) => r.conceal > ALONE_FAR_CONCEAL)) far = true;
        if (avg.conceal > ALONE_WORSE_CONCEAL) worse = true;
        continue;
      }
      if (after.some((r) => jumped(r.conceal, was.conceal, FAR_WORSE_CONCEAL) || (r.loss > was.loss + MORE_LOSS && r.delay > was.delay + FAR_WORSE_DELAY_MS))) far = true;
      if (jumped(avg.conceal, was.conceal, WORSE_CONCEAL) || (avg.loss > was.loss + MORE_LOSS && avg.delay > was.delay + WORSE_DELAY_MS)) worse = true;
    }
    const upAfter = this.uplinks.filter((u) => u.at >= trial.at + UPLINK_LAG_MS).map((u) => u.loss);
    if (trial.uplink !== null && ((upAfter.length >= 2 && jumped(average(upAfter), trial.uplink, UPLINK_JUMP)) || upAfter.some((loss) => jumped(loss, trial.uplink!, UPLINK_FAR_JUMP)))) far = true;
    if (far) {
      this.stop(trial.to, now);
    } else if (firstAfter !== Number.POSITIVE_INFINITY && now - trial.at >= TRIAL_MS && now - firstAfter >= JUDGE_MS) {
      this.trial = null;
      if (worse) {
        this.stop(trial.to, now);
      } else {
        this.backoff[trial.to] = 0;
        this.settled = { at: now, listeners, uplink: upAfter.length > 0 ? average(upAfter) : trial.uplink, rtt: this.rtt() };
      }
    }
  }

  /**
   * Whether a link has started queueing since the copies passed their trial:
   * a listener losing more and waiting clearly longer, or this device's uplink
   * losing far more while its round trip grows.
   */
  private queueing(settled: NonNullable<CopyPlanner["settled"]>): boolean {
    const up = this.uplinks.filter((u) => u.at > settled.at).slice(-2);
    const rtt = this.rtt();
    if (settled.uplink !== null && settled.rtt !== null && rtt !== null && up.length === 2 && jumped(average(up.map((u) => u.loss)), settled.uplink, UPLINK_JUMP) && rtt > settled.rtt + QUEUE_RTT_MS) return true;
    for (const [from, reports] of this.heard) {
      const was = settled.listeners.get(from);
      if (!was) continue;
      const since = reports.filter((r) => r.at > settled.at);
      const queued = (r: Heard, by: number) => r.loss > was.loss + MORE_LOSS && r.delay > was.delay + by;
      const last2 = since.slice(-2);
      if (since.some((r) => queued(r, FAR_WORSE_DELAY_MS)) || (last2.length === 2 && last2.every((r) => queued(r, WORSE_DELAY_MS)))) return true;
    }
    return false;
  }

  /** Copies made things worse: none go out for a while, and this depth or more for longer. */
  private stop(depth: number, now: number): void {
    const again = now - this.failedAt[depth]! < 2 * Math.max(BACKOFF_MS, this.backoff[depth]!) + COOLDOWN_MS;
    const wait = again && this.backoff[depth]! > 0 ? Math.min(BACKOFF_MAX_MS, this.backoff[depth]! * 2) : BACKOFF_MS;
    for (let d = 1; d <= MAX_COPIES; d++) {
      if (d >= depth) {
        this.backoff[d] = wait;
        this.failedAt[d] = now;
      }
      this.blocked[d] = Math.max(this.blocked[d]!, now + (d >= depth ? wait : COOLDOWN_MS));
    }
    this.trial = null;
    this.settled = null;
    this.set(0, now);
  }

  private set(depth: number, now: number): void {
    if (depth === this.depth) return;
    this.depth = depth;
    this.changedAt = now;
    this.onChange(depth);
  }
}
