import { describe, expect, it } from "vitest";
import { REST_END_MS, REST_START_MS, SPEED, keyframesOf, legAt, loopLegs, positionAt, resumeLegs, resumePlan, stateAt, totalMs, translateXOf, travelMs } from "./marquee";

describe("the marquee's loop", () => {
  it("rests for the same short time however long the text is", () => {
    for (const over of [20, 300, 2000]) {
      const legs = loopLegs(over);
      expect(legs[0]).toMatchObject({ kind: "rest-start", ms: REST_START_MS });
      expect(legs[2]).toMatchObject({ kind: "rest-end", ms: REST_END_MS });
    }
    // the old keyframes rested for 22% of the whole cycle: seconds, for a long status
    expect(REST_START_MS).toBeLessThanOrEqual(1000);
    expect(REST_START_MS).toBeGreaterThanOrEqual(800);
  });

  it("travels at a steady speed, out and back", () => {
    const legs = loopLegs(260);
    expect(legs[1]).toMatchObject({ kind: "out", from: 0, to: 260, ms: (260 / SPEED) * 1000 });
    expect(legs[3]).toMatchObject({ kind: "back", from: 260, to: 0 });
    expect(totalMs(legs)).toBe(REST_START_MS + REST_END_MS + 2 * travelMs(260));
  });

  it("never makes a trip so short that it snaps", () => {
    expect(travelMs(1)).toBe(250);
  });
});

describe("where a moment falls", () => {
  const legs = loopLegs(260);
  it("finds the leg and how far into it", () => {
    expect(legAt(legs, 0)).toEqual({ index: 0, into: 0 });
    expect(legAt(legs, REST_START_MS + 5)).toEqual({ index: 1, into: 5 });
    expect(legAt(legs, totalMs(legs) + 10)).toEqual({ index: 3, into: legs[3]!.ms });
  });

  it("says how much of a rest is left, and where a trip really is", () => {
    expect(stateAt(legs, 300, 0)).toEqual({ kind: "rest-start", at: 0, restLeft: REST_START_MS - 300 });
    expect(stateAt(legs, REST_START_MS + 1000, 37)).toEqual({ kind: "out", at: 37, restLeft: 0 });
    const endRest = REST_START_MS + legs[1]!.ms + 250;
    expect(stateAt(legs, endRest, 260)).toEqual({ kind: "rest-end", at: 260, restLeft: REST_END_MS - 250 });
  });
});

describe("carrying on after the line changes width", () => {
  it("starts exactly where the text is, whichever way it was going", () => {
    for (const state of [
      { kind: "rest-start" as const, at: 0, restLeft: 400 },
      { kind: "out" as const, at: 120, restLeft: 0 },
      { kind: "rest-end" as const, at: 260, restLeft: 500 },
      { kind: "back" as const, at: 90, restLeft: 0 },
    ]) {
      for (const over of [200, 260, 300]) {
        const legs = resumeLegs(state, over);
        expect(legs[0]!.from).toBe(state.at);
        // and ends at rest at the start, where the ordinary loop picks up
        expect(legs[legs.length - 1]!.to).toBe(0);
        // each leg begins where the one before it ended
        for (let i = 1; i < legs.length; i++) expect(legs[i]!.from).toBe(legs[i - 1]!.to);
      }
    }
  });

  it("finishes a rest rather than taking a new one from the top", () => {
    const legs = resumeLegs({ kind: "rest-start", at: 0, restLeft: 400 }, 300);
    expect(legs[0]).toMatchObject({ kind: "rest-start", ms: 400 });
    expect(legs[1]).toMatchObject({ kind: "out", to: 300 });
  });

  it("follows the end when it moves while it is showing", () => {
    // narrower: the end is further away now, so the text goes on to it
    const further = resumeLegs({ kind: "rest-end", at: 260, restLeft: 500 }, 292);
    expect(further[0]).toMatchObject({ kind: "out", from: 260, to: 292 });
    expect(further[1]).toMatchObject({ kind: "rest-end", from: 292, ms: 500 });
    // wider (the pointer left): it comes back a little instead of leaving a gap
    const nearer = resumeLegs({ kind: "rest-end", at: 292, restLeft: 500 }, 260);
    expect(nearer[0]).toMatchObject({ from: 292, to: 260 });
  });

  it("heads home when it was on its way back", () => {
    expect(resumeLegs({ kind: "back", at: 90, restLeft: 0 }, 300)).toEqual([expect.objectContaining({ kind: "back", from: 90, to: 0 })]);
    // already home: nothing to finish, the loop takes over
    expect(resumeLegs({ kind: "back", at: 0, restLeft: 0 }, 300)).toEqual([]);
  });
});

describe("keyframes", () => {
  it("run from the first leg to the last, moving against the reading direction", () => {
    const { frames, duration } = keyframesOf(loopLegs(100), -1);
    expect(duration).toBe(totalMs(loopLegs(100)));
    expect(frames[0]).toMatchObject({ offset: 0, transform: "translateX(0px)" });
    expect(frames[2]).toMatchObject({ transform: "translateX(-100px)" });
    expect(frames[frames.length - 1]).toMatchObject({ offset: 1, transform: "translateX(0px)" });
    const offsets = frames.map((f) => f.offset as number);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("move the other way for text read right to left", () => {
    expect(keyframesOf(loopLegs(100), 1).frames[2]).toMatchObject({ transform: "translateX(100px)" });
  });
});

describe("reading a transform back", () => {
  it("takes the x out of a matrix", () => {
    expect(translateXOf("matrix(1, 0, 0, 1, -42.5, 0)")).toBe(-42.5);
    expect(translateXOf("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 17, 0, 0, 1)")).toBe(17);
    expect(translateXOf("none")).toBe(0);
  });
});

describe("entering the loop where the text already is", () => {
  const speedAt = (legs: ReturnType<typeof loopLegs>, t: number) => (positionAt(legs, t + 20) - positionAt(legs, t)) / 20;

  it("keeps the place and the speed of a trip under way when the line narrows or widens", () => {
    const old = loopLegs(260);
    for (const t of [REST_START_MS + 1500, REST_START_MS + 5000, REST_START_MS + old[1]!.ms + REST_END_MS + 3000]) {
      const at = positionAt(old, t);
      const kind = t < REST_START_MS + old[1]!.ms ? "out" : "back";
      for (const over of [292, 240]) {
        if (at > over) continue;
        const plan = resumePlan({ kind, at, restLeft: 0 }, over);
        expect(plan.loop).toBe(true);
        expect(Math.abs(positionAt(plan.legs, plan.startAt) - at)).toBeLessThan(0.5);
        // the same way, at nearly the same speed
        const before = speedAt(old, t);
        const after = speedAt(plan.legs, plan.startAt);
        expect(Math.sign(after)).toBe(Math.sign(before));
        expect(Math.abs(after - before)).toBeLessThan(Math.abs(before) * 0.2 + 0.002);
      }
    }
  });

  it("finishes the rest at the start where it was", () => {
    const plan = resumePlan({ kind: "rest-start", at: 0, restLeft: 300 }, 300);
    expect(plan).toMatchObject({ loop: true, startAt: REST_START_MS - 300 });
    expect(positionAt(plan.legs, plan.startAt)).toBe(0);
  });

  it("leads in where the loop never has the text where it is", () => {
    // wider now, and the text was already past the new end
    const past = resumePlan({ kind: "out", at: 280, restLeft: 0 }, 250);
    expect(past.loop).toBe(false);
    expect(past.legs[0]).toMatchObject({ from: 280, to: 250 });
    // the end moved while it was showing
    const end = resumePlan({ kind: "rest-end", at: 260, restLeft: 400 }, 292);
    expect(end.loop).toBe(false);
    expect(positionAt(end.legs, 0)).toBe(260);
  });
});

describe("a loop shared with a longer text", () => {
  it("keeps its own speed but sets off, turns and comes home with the longest", () => {
    const long = loopLegs(520);
    const short = loopLegs(100, travelMs(520));
    expect(totalMs(short)).toBe(totalMs(long));
    // it turns when the long one does, and starts back when the long one does
    expect(short[1]!.ms + short[2]!.ms).toBe(long[1]!.ms + long[2]!.ms);
    expect(short[1]!.ms).toBe(travelMs(100));
  });
  it("is the plain loop when it is the longest", () => {
    expect(loopLegs(260, travelMs(260))).toEqual(loopLegs(260));
  });
});
