import { SPEAKING_HOLD_MS, SpeakingGate } from "./speaking";

describe("SpeakingGate", () => {
  it("lights up on the first loud reading", () => {
    const g = new SpeakingGate();
    expect(g.update(false, 0)).toBe(false);
    expect(g.update(true, 80)).toBe(true);
  });

  it("stays lit through the short gaps between words", () => {
    const g = new SpeakingGate();
    g.update(true, 0);
    // speech: loud, a 200 ms gap, loud again
    expect(g.update(false, 100)).toBe(true);
    expect(g.update(false, 200)).toBe(true);
    expect(g.update(true, 300)).toBe(true);
    expect(g.update(false, 300 + SPEAKING_HOLD_MS - 1)).toBe(true);
  });

  it("goes out once it has been quiet for the hold", () => {
    const g = new SpeakingGate();
    g.update(true, 0);
    expect(g.update(false, SPEAKING_HOLD_MS)).toBe(false);
  });

  it("goes out at once when reset", () => {
    const g = new SpeakingGate();
    g.update(true, 0);
    g.reset();
    expect(g.update(false, 1)).toBe(false);
  });
});
