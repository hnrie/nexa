import { describe, expect, it } from "vitest";
import { STALL_CHECK_MS, STALL_MAX_ASKS, type StallWatch, watchStall } from "./stallWatch";

/** Feeds readings one check apart, from `t0`, and says at which checks a keyframe was asked for. */
function run(readings: [packets: number, frames: number][], t0 = 10_000): { asks: number[]; last: StallWatch | null } {
  let w: StallWatch | null = null;
  const asks: number[] = [];
  readings.forEach(([packets, frames], i) => {
    const r = watchStall(w, packets, frames, t0 + i * STALL_CHECK_MS);
    if (r.ask) asks.push(i);
    w = r.watch;
  });
  return { asks, last: w };
}

describe("telling a stuck share from a still one", () => {
  it("leaves a share alone while its frames move", () => {
    expect(run([[100, 20], [200, 44], [300, 68], [400, 92]]).asks).toEqual([]);
  });

  it("asks for a keyframe soon after packets keep coming with nothing decoded, then waits before asking again", () => {
    // frames stop at the second reading while packets keep arriving
    const readings: [number, number][] = [[100, 20], [200, 44]];
    for (let i = 1; i <= 8; i++) readings.push([200 + i * 100, 44]);
    const { asks } = run(readings);
    // the stall shows at reading 2 and has lasted long enough at reading 3
    expect(asks[0]).toBe(3);
    // again no sooner than 1.5 s later: four checks on
    expect(asks[1]).toBe(7);
  });

  it("stops asking after a few tries, and starts over once frames move again", () => {
    const readings: [number, number][] = [[100, 20], [200, 44]];
    for (let i = 1; i <= 40; i++) readings.push([200 + i * 100, 44]);
    const { asks, last } = run(readings);
    expect(asks.length).toBe(STALL_MAX_ASKS);
    const next = watchStall(last, 99_999, 45, 10_000 + 43 * STALL_CHECK_MS);
    expect(next.ask).toBe(false);
    expect(next.watch.asks).toBe(0);
    expect(next.watch.since).toBeNull();
  });

  it("never asks about a picture that went still long before packets came", () => {
    // frames stop, nothing arrives for a while, then padding trickles in
    const readings: [number, number][] = [[100, 20], [200, 44], [200, 44], [200, 44], [200, 44], [200, 44]];
    for (let i = 1; i <= 10; i++) readings.push([200 + i * 5, 44]);
    expect(run(readings).asks).toEqual([]);
  });

  it("asks nothing of a share seen for the first time or of one with nothing coming in", () => {
    expect(watchStall(null, 500, 10, 1_000).ask).toBe(false);
    expect(run([[100, 20], [100, 20], [100, 20], [100, 20]]).asks).toEqual([]);
  });
});
