import { CALL_PANEL_DEFAULT, CALL_PANEL_MIN_PX, CHAT_MIN_PX, clampCallPanel, readCallPanel } from "./callPanel";

describe("the call panel above a conversation", () => {
  it("keeps the share it was dragged to when that fits", () => {
    expect(clampCallPanel(0.4, 1000)).toBeCloseTo(0.4);
  });

  it("never gets too small to hold the call's controls", () => {
    expect(clampCallPanel(0.01, 1000)).toBeCloseTo(CALL_PANEL_MIN_PX / 1000);
  });

  it("always leaves the conversation room below it", () => {
    expect(clampCallPanel(0.99, 1000)).toBeCloseTo((1000 - CHAT_MIN_PX) / 1000);
  });

  it("keeps the call's minimum when the space cannot fit both", () => {
    expect(clampCallPanel(0.5, 250)).toBeCloseTo(CALL_PANEL_MIN_PX / 250);
  });

  it("starts from the default when nothing sensible was saved", () => {
    expect(readCallPanel(null)).toBe(CALL_PANEL_DEFAULT);
    expect(readCallPanel("banana")).toBe(CALL_PANEL_DEFAULT);
    expect(readCallPanel("7")).toBe(CALL_PANEL_DEFAULT);
    expect(readCallPanel("0.3")).toBeCloseTo(0.3);
  });
});
