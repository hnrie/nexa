import { describe, expect, it } from "vitest";
import { CHOSEN_MS, MENU_MS, PasteGate } from "../src/main/pasteGate";

function gate() {
  let t = 1_000_000;
  const g = new PasteGate(() => t);
  return { g, wait: (ms: number) => (t += ms) };
}

describe("PasteGate", () => {
  it("pastes after a right click and a click on Paste", () => {
    const { g, wait } = gate();
    g.mouse("mouseDown", "right");
    wait(800);
    g.mouse("mouseDown", "left");
    g.mouse("mouseUp", "left");
    wait(30);
    expect(g.allow()).toBe(true);
  });

  it("pastes after the menu key or Shift+F10 and Enter or Space", () => {
    const { g, wait } = gate();
    g.key("keyDown", "ContextMenu", false);
    wait(500);
    g.key("keyDown", "Enter", false);
    expect(g.allow()).toBe(true);
    g.key("keyDown", "F10", true);
    wait(500);
    g.key("keyDown", " ", false);
    expect(g.allow()).toBe(true);
  });

  it("never pastes on the page's say-so alone", () => {
    const { g } = gate();
    expect(g.allow()).toBe(false);
    g.mouse("mouseUp", "left");
    expect(g.allow()).toBe(false);
    g.key("keyDown", "Enter", false);
    expect(g.allow()).toBe(false);
  });

  it("pastes once for each right click and click", () => {
    const { g } = gate();
    g.mouse("mouseDown", "right");
    g.mouse("mouseUp", "left");
    expect(g.allow()).toBe(true);
    expect(g.allow()).toBe(false);
  });

  it("wants the click after the right click, and soon after both", () => {
    const { g, wait } = gate();
    g.mouse("mouseUp", "left");
    wait(10);
    g.mouse("mouseDown", "right");
    expect(g.allow()).toBe(false);
    g.mouse("mouseUp", "left");
    wait(CHOSEN_MS + 1);
    expect(g.allow()).toBe(false);
    g.mouse("mouseDown", "right");
    wait(MENU_MS + 1);
    g.mouse("mouseUp", "left");
    expect(g.allow()).toBe(false);
  });

  it("does not count F10 without Shift, key releases or other buttons", () => {
    const { g } = gate();
    g.key("keyDown", "F10", false);
    g.key("keyUp", "Enter", false);
    g.mouse("mouseUp", "middle");
    expect(g.allow()).toBe(false);
  });
});
