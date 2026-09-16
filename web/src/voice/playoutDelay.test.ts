import { describe, expect, it } from "vitest";
import { FLOOR_MS, PlayoutDelay } from "./playoutDelay";

function fakeReceiver() {
  return { jitterBufferTarget: null as number | null } as unknown as RTCRtpReceiver;
}
const clean = { loss: 0, conceal: 0 };
const bad = { loss: 0.05, conceal: 0.04 };

describe("PlayoutDelay", () => {
  it("shortens a receiver's buffer only after a clean stretch", () => {
    const d = new PlayoutDelay();
    const r = fakeReceiver();
    expect(d.observe("a", r, clean, 0)).toBeNull();
    expect(d.observe("a", r, clean, 3000)).toBeNull();
    expect(d.observe("a", r, clean, 5000)).toBe(FLOOR_MS);
    expect((r as unknown as { jitterBufferTarget: number | null }).jitterBufferTarget).toBe(FLOOR_MS);
  });

  it("hands the buffer straight back the moment packets go missing", () => {
    const d = new PlayoutDelay();
    const r = fakeReceiver();
    d.observe("a", r, clean, 0);
    d.observe("a", r, clean, 5000);
    expect(d.observe("a", r, bad, 6000)).toBeNull();
    expect((r as unknown as { jitterBufferTarget: number | null }).jitterBufferTarget).toBeNull();
  });

  it("waits out a back-off before asking again, so it cannot flap", () => {
    const d = new PlayoutDelay();
    const r = fakeReceiver();
    d.observe("a", r, bad, 0);
    // clean again, but too soon after the trouble
    for (let t = 1000; t <= 14_000; t += 1000) expect(d.observe("a", r, clean, t)).toBeNull();
    expect(d.observe("a", r, clean, 16_000)).toBe(FLOOR_MS);
  });

  it("keeps each receiver's own history", () => {
    const d = new PlayoutDelay();
    const a = fakeReceiver();
    const b = fakeReceiver();
    d.observe("a", a, clean, 0);
    d.observe("b", b, bad, 0);
    d.observe("a", a, clean, 5000);
    expect(d.observe("a", a, clean, 5000)).toBe(FLOOR_MS);
    expect(d.observe("b", b, clean, 5000)).toBeNull();
  });
});
