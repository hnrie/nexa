// @vitest-environment jsdom
import { installNoZoom } from "./noZoom";

function fire(type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
}

describe("installNoZoom", () => {
  afterEach(() => {
    delete (window as { ongesturestart?: unknown }).ongesturestart;
  });

  it("cancels Safari's pinch gestures on a touch screen", () => {
    Object.defineProperty(window, "ongesturestart", { value: null, configurable: true });
    const uninstall = installNoZoom(document, true);
    expect(fire("gesturestart").defaultPrevented).toBe(true);
    expect(fire("gesturechange").defaultPrevented).toBe(true);
    expect(fire("touchmove").defaultPrevented).toBe(false);
    uninstall();
    expect(fire("gesturestart").defaultPrevented).toBe(false);
  });

  it("stays out of the way where it is not needed", () => {
    // a touch screen whose browser honours the page's own zoom settings
    let uninstall = installNoZoom(document, true);
    expect(fire("gesturestart").defaultPrevented).toBe(false);
    uninstall();
    // Safari with a mouse or trackpad
    Object.defineProperty(window, "ongesturestart", { value: null, configurable: true });
    uninstall = installNoZoom(document, false);
    expect(fire("gesturestart").defaultPrevented).toBe(false);
    uninstall();
  });
});
