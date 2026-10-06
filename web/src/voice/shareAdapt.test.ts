import { describe, expect, it } from "vitest";
import { MOTION_BITS_PER_PIXEL, SHARE_STEPS, START, ShareAdapter, motionScale, nextStep, readShareStats, stepFor } from "./shareAdapt";

const P1080 = 1920 * 1080;

describe("steering a share in motion", () => {
  it("asks for no scaling when the budget carries 1080p at 60 fps, and for more the less there is", () => {
    expect(motionScale(P1080, 60, 9_000_000)).toBe(1);
    const at4 = motionScale(P1080, 60, 4_000_000);
    expect(at4).toBeGreaterThan(1.3);
    expect(at4).toBeLessThan(1.45);
    expect(motionScale(P1080, 60, 1_000_000)).toBeGreaterThan(motionScale(P1080, 60, 2_000_000));
    // nothing to go on is no reason to shrink
    for (const bad of [0, -1, NaN, Infinity]) expect(motionScale(P1080, 60, bad)).toBe(1);
    expect(MOTION_BITS_PER_PIXEL * P1080 * 60).toBeLessThan(9_900_000);
  });

  it("rounds a wish up to the next step, and holds at the smallest picture", () => {
    expect(stepFor(1)).toBe(1);
    // a budget a little short of the full size keeps it
    expect(stepFor(1.04)).toBe(1);
    expect(stepFor(1.1)).toBe(1.25);
    expect(stepFor(1.6)).toBe(1.75);
    expect(stepFor(9)).toBe(SHARE_STEPS[SHARE_STEPS.length - 1]);
  });

  it("shrinks after two short checks in a row, not one", () => {
    let st = nextStep(START, 1.6);
    expect(st.scale).toBe(1);
    st = nextStep(st, 1.6);
    expect(st.scale).toBe(1.75);
    // a good check in between starts the count over
    st = nextStep(START, 1.6);
    st = nextStep(st, 1);
    st = nextStep(st, 1.6);
    expect(st.scale).toBe(1);
  });

  it("grows back one step at a time, after three checks that fit the next size up", () => {
    let st = { scale: 2, short: 0, room: 0 };
    st = nextStep(st, 1);
    st = nextStep(st, 1);
    expect(st.scale).toBe(2);
    st = nextStep(st, 1);
    expect(st.scale).toBe(1.75);
    // a budget held just under the full size by the share's own ceiling is room enough
    st = { scale: 1.25, short: 0, room: 0 };
    for (let i = 0; i < 3; i++) st = nextStep(st, 0.95);
    expect(st.scale).toBe(1);
    // between one size's tolerance and the next nothing changes, so the share does not flip
    st = { scale: 1.5, short: 0, room: 0 };
    for (let i = 0; i < 5; i++) st = nextStep(st, 1.3);
    expect(st.scale).toBe(1.5);
  });

  it("reads the source's size and the encoder's target, and sizes from what was sent when the source says nothing", () => {
    const stats = [
      { type: "media-source", kind: "video", width: 2560, height: 1440 },
      { type: "outbound-rtp", kind: "video", frameWidth: 1280, frameHeight: 720, targetBitrate: 5_000_000 },
      { type: "outbound-rtp", kind: "audio", targetBitrate: 64_000 },
    ];
    expect(readShareStats(stats, 2)).toEqual({ width: 2560, height: 1440, budgetBps: 5_000_000 });
    expect(readShareStats([stats[1]!], 1.5)).toEqual({ width: 1920, height: 1080, budgetBps: 5_000_000 });
    // Firefox says nothing of a target: the share is only held to the size cap
    expect(readShareStats([{ type: "outbound-rtp", kind: "video", frameWidth: 1920, frameHeight: 1080 }], 1)?.budgetBps).toBeNull();
    expect(readShareStats([], 1)).toBeNull();
  });

  it("steers only a share meant for motion, and never past the size cap", () => {
    const slides = new ShareAdapter(30);
    for (let i = 0; i < 4; i++) expect(slides.scaleFor({ width: 1920, height: 1080, budgetBps: 1_000_000 })).toBe(1);
    const game = new ShareAdapter(60);
    // the first seconds of a share are its budget climbing: no shrinking yet
    for (let i = 0; i < 3; i++) expect(game.scaleFor({ width: 1920, height: 1080, budgetBps: 2_000_000 })).toBe(1);
    game.scaleFor({ width: 1920, height: 1080, budgetBps: 2_000_000 });
    expect(game.scaleFor({ width: 1920, height: 1080, budgetBps: 2_000_000 })).toBe(2);
    // an 8K-wide picture is held to the cap whatever the budget
    const wide = new ShareAdapter(60);
    expect(wide.scaleFor({ width: 16384, height: 4320, budgetBps: null })).toBeGreaterThan(1.9);
  });
});
