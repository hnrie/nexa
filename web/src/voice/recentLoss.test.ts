import { describe, expect, it } from "vitest";
import { RecentLoss } from "./recentLoss";

describe("recent loss", () => {
  it("measures what was lost since the last reading, not over the whole call", () => {
    const l = new RecentLoss();
    expect(l.measure(new Map([["a", { lost: 0, received: 180_000 }]]))).toBe(0);
    // a bad patch after an hour: 30% of the next thousand packets
    expect(l.measure(new Map([["a", { lost: 300, received: 180_700 }]]))).toBeCloseTo(0.3);
    // and when it clears, it clears
    expect(l.measure(new Map([["a", { lost: 300, received: 181_700 }]]))).toBe(0);
  });

  it("ignores a stream until it has two readings, and one that was replaced", () => {
    const l = new RecentLoss();
    l.measure(new Map([["a", { lost: 5, received: 100 }]]));
    expect(l.measure(new Map([["a", { lost: 5, received: 200 }], ["b", { lost: 50, received: 10 }]]))).toBe(0);
    expect(l.measure(new Map([["a", { lost: 0, received: 10 }]]))).toBe(0);
  });
});
