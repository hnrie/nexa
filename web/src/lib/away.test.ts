import { describe, expect, it } from "vitest";
import { AWAY_AFTER, isAway } from "./away";

describe("going idle by itself", () => {
  const now = 1_000_000_000;
  it("counts a device as away only after a while with nothing done", () => {
    expect(isAway(now, now - AWAY_AFTER + 1, true, false)).toBe(false);
    expect(isAway(now, now - AWAY_AFTER, true, false)).toBe(true);
  });

  it("never while in a call, or with the setting off", () => {
    expect(isAway(now, now - 2 * AWAY_AFTER, true, true)).toBe(false);
    expect(isAway(now, now - 2 * AWAY_AFTER, false, false)).toBe(false);
  });
});
