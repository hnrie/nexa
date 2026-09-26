/**
 * The motion of a status too long for its line, planned as legs: a rest at
 * the start, out to where the end shows, a rest there, and back. Positions
 * are pixels along the reading direction, 0 being the start of the text.
 *
 * The rests are short and fixed. They used to be a share of the whole cycle,
 * so the longer the status, the longer it sat still before moving; a long one
 * waited several seconds and looked stuck.
 *
 * When the line changes width part way through (a close button appearing on
 * hover narrows it), the motion is planned again from wherever the text is at
 * that moment, rather than started over: see `resumePlan`.
 */

/** How long the text rests at its start before it moves. */
export const REST_START_MS = 900;
/** How long it rests with its end showing before it goes back. */
export const REST_END_MS = 1000;
/** How fast it travels, in pixels per second. */
export const SPEED = 26;
/** A whole trip out or back, eased at both ends. */
export const EASE_IN_OUT = "cubic-bezier(0.37, 0, 0.63, 1)";
/** A trip that starts while the text is already moving: no easing in, and no faster at first than a whole trip at its quickest. */
export const EASE_OUT = "cubic-bezier(0.33, 0.52, 0.5, 1)";

export type LegKind = "rest-start" | "out" | "rest-end" | "back";

export interface Leg {
  kind: LegKind;
  from: number;
  to: number;
  ms: number;
  easing: string;
}

/** Where the text is in its motion: how far along, which way it is going, and how much of a rest is left. */
export interface MarqueeState {
  kind: LegKind;
  at: number;
  restLeft: number;
}

/** How long a trip of this many pixels takes; never so short that it snaps. */
export function travelMs(px: number): number {
  return Math.max(250, Math.round((Math.abs(px) / SPEED) * 1000));
}

/** One full cycle for text that overflows by `over` pixels, starting at rest at its start. */
export function loopLegs(over: number): Leg[] {
  const travel = travelMs(over);
  return [
    { kind: "rest-start", from: 0, to: 0, ms: REST_START_MS, easing: "linear" },
    { kind: "out", from: 0, to: over, ms: travel, easing: EASE_IN_OUT },
    { kind: "rest-end", from: over, to: over, ms: REST_END_MS, easing: "linear" },
    { kind: "back", from: over, to: 0, ms: travel, easing: EASE_IN_OUT },
  ];
}

export function totalMs(legs: Leg[]): number {
  return legs.reduce((sum, l) => sum + l.ms, 0);
}

/** Which leg a moment falls in, and how far into it. Past the end is the end of the last leg. */
export function legAt(legs: Leg[], t: number): { index: number; into: number } {
  let start = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    if (t < start + leg.ms) return { index: i, into: Math.max(0, t - start) };
    start += leg.ms;
  }
  const last = Math.max(0, legs.length - 1);
  return { index: last, into: legs[last]?.ms ?? 0 };
}

/**
 * The motion from `state` on, for text that now overflows by `over` pixels,
 * ending back at rest at its start (where the ordinary loop takes over). It
 * begins exactly where the text is, so nothing jumps.
 */
export function resumeLegs(state: MarqueeState, over: number): Leg[] {
  const legs: Leg[] = [];
  const back = (from: number, easing: string) => legs.push({ kind: "back", from, to: 0, ms: travelMs(from), easing });
  switch (state.kind) {
    case "rest-start":
      if (state.restLeft > 0) legs.push({ kind: "rest-start", from: 0, to: 0, ms: state.restLeft, easing: "linear" });
      legs.push({ kind: "out", from: 0, to: over, ms: travelMs(over), easing: EASE_IN_OUT });
      legs.push({ kind: "rest-end", from: over, to: over, ms: REST_END_MS, easing: "linear" });
      back(over, EASE_IN_OUT);
      break;
    case "out":
      legs.push({ kind: "out", from: state.at, to: over, ms: travelMs(over - state.at), easing: EASE_OUT });
      legs.push({ kind: "rest-end", from: over, to: over, ms: REST_END_MS, easing: "linear" });
      back(over, EASE_IN_OUT);
      break;
    case "rest-end":
      // the end moved while it was showing: follow it there, then finish the rest
      if (Math.abs(over - state.at) >= 1) legs.push({ kind: "out", from: state.at, to: over, ms: travelMs(over - state.at), easing: EASE_IN_OUT });
      legs.push({ kind: "rest-end", from: over, to: over, ms: Math.max(state.restLeft, 300), easing: "linear" });
      back(over, EASE_IN_OUT);
      break;
    case "back":
      if (state.at > 0) back(state.at, EASE_OUT);
      break;
  }
  return legs.filter((l) => l.ms > 0);
}

/** The state at a moment of a plan, given where the text really is (read from the page while it moves). */
export function stateAt(legs: Leg[], t: number, measuredAt: number): MarqueeState {
  const { index, into } = legAt(legs, t);
  const leg = legs[index];
  if (!leg) return { kind: "rest-start", at: 0, restLeft: REST_START_MS };
  if (leg.kind === "rest-start" || leg.kind === "rest-end") return { kind: leg.kind, at: leg.from, restLeft: Math.max(0, leg.ms - into) };
  return { kind: leg.kind, at: Math.max(0, measuredAt), restLeft: 0 };
}

/**
 * Keyframes for a plan, the text moving by `sign` (-1 to the left for text
 * read left to right, 1 for right to left). Each keyframe's easing runs to the
 * next one.
 */
export function keyframesOf(legs: Leg[], sign: 1 | -1): { frames: Keyframe[]; duration: number } {
  const duration = totalMs(legs);
  const frames: Keyframe[] = [];
  const px = (d: number) => `translateX(${sign * d}px)`;
  let t = 0;
  for (const leg of legs) {
    frames.push({ offset: duration ? t / duration : 0, transform: px(leg.from), easing: leg.easing });
    t += leg.ms;
  }
  const last = legs[legs.length - 1];
  frames.push({ offset: 1, transform: px(last ? last.to : 0) });
  return { frames, duration };
}

/** The curves the legs use, as numbers, for the arithmetic done here rather than by the browser. */
const CURVES: Record<string, [number, number, number, number]> = {
  [EASE_IN_OUT]: [0.37, 0, 0.63, 1],
  [EASE_OUT]: [0.33, 0.52, 0.5, 1],
  linear: [0, 0, 1, 1],
};

/** A CSS cubic-bezier: how far along it is at a share of the time, and when it gets to a share of the way. */
function curve(easing: string): { at: (u: number) => number; when: (p: number) => number } {
  const [x1, y1, x2, y2] = CURVES[easing] ?? CURVES["linear"]!;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  // both run from 0 to 1 without turning back, so halving finds the parameter
  const solve = (f: (t: number) => number, v: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < v) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { at: (u) => y(solve(x, clamp(u))), when: (p) => x(solve(y, clamp(p))) };
}

/** Where the text is at a moment of a plan. */
export function positionAt(legs: Leg[], t: number): number {
  const { index, into } = legAt(legs, t);
  const leg = legs[index];
  if (!leg) return 0;
  if (leg.ms <= 0) return leg.to;
  return leg.from + (leg.to - leg.from) * curve(leg.easing).at(into / leg.ms);
}

/**
 * How to carry on from `state` once the text overflows by `over` pixels: the
 * ordinary loop, entered at the moment it has the text exactly where it is
 * (so both where it is and how fast it goes carry on), or, where the loop is
 * never there (the end moved while showing, or past where the text is), a
 * lead-in that takes it there first.
 */
export function resumePlan(state: MarqueeState, over: number): { legs: Leg[]; loop: boolean; startAt: number } {
  const loop = loopLegs(over);
  const [rest, out, restEnd, back] = loop as [Leg, Leg, Leg, Leg];
  if (state.kind === "rest-start") return { legs: loop, loop: true, startAt: Math.max(0, rest.ms - state.restLeft) };
  if ((state.kind === "out" || state.kind === "back") && state.at <= over && over > 0) {
    const p = state.at / over;
    if (state.kind === "out") return { legs: loop, loop: true, startAt: rest.ms + out.ms * curve(out.easing).when(p) };
    return { legs: loop, loop: true, startAt: rest.ms + out.ms + restEnd.ms + back.ms * curve(back.easing).when(1 - p) };
  }
  const legs = resumeLegs(state, over);
  return legs.length ? { legs, loop: false, startAt: 0 } : { legs: loop, loop: true, startAt: 0 };
}

/** The x a transform moved something by: `matrix(a, b, c, d, x, y)` or `none`. */
export function translateXOf(transform: string): number {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!m) return 0;
  const parts = m[2]!.split(",").map((p) => Number(p.trim()));
  const x = m[1] ? parts[12] : parts[4];
  return Number.isFinite(x) ? x! : 0;
}
