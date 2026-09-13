// @vitest-environment jsdom
import { HOLD_MS, installLongPress } from "./longPress";

function touch(type: string, target: EventTarget, points: Array<[number, number]>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(e, "touches", { value: type === "touchend" || type === "touchcancel" ? [] : list });
  Object.defineProperty(e, "changedTouches", { value: list });
  target.dispatchEvent(e);
  return e;
}

/** Events standing in for ones the browser itself sent; tests cannot forge isTrusted. */
const fromBrowser = new WeakSet<Event>();

function nativeMenu(target: EventTarget): MouseEvent {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  fromBrowser.add(e);
  target.dispatchEvent(e);
  return e;
}

describe("long press", () => {
  let uninstall: () => void;
  let item: HTMLDivElement;
  let menus: MouseEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="item"><span id="label">Channel</span></div><input id="box" />`;
    item = document.getElementById("item") as HTMLDivElement;
    menus = [];
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menus.push(e);
    });
    uninstall = installLongPress(document, (e) => fromBrowser.has(e));
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it("opens the menu at the finger once held still", () => {
    const label = document.getElementById("label")!;
    touch("touchstart", label, [[30, 40]]);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(menus).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(menus).toHaveLength(1);
    expect([menus[0]!.clientX, menus[0]!.clientY]).toEqual([30, 40]);
  });

  it("keeps the lift after a long press from tapping what was underneath", () => {
    touch("touchstart", item, [[5, 5]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(touch("touchend", item, [[5, 5]]).defaultPrevented).toBe(true);
  });

  it("leaves a tap alone", () => {
    touch("touchstart", item, [[5, 5]]);
    vi.advanceTimersByTime(100);
    expect(touch("touchend", item, [[5, 5]]).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(0);
  });

  it("gives way to a scroll or a swipe, but not to a finger's natural wobble", () => {
    touch("touchstart", item, [[50, 50]]);
    touch("touchmove", item, [[54, 53]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(1);
    touch("touchend", item, []);

    touch("touchstart", item, [[50, 50]]);
    touch("touchmove", item, [[50, 80]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(1);
    touch("touchend", item, []);

    touch("touchstart", item, [[50, 50]]);
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(1);
  });

  it("stays out of text fields and multi-finger gestures", () => {
    const box = document.getElementById("box")!;
    let fromBox = 0;
    box.addEventListener("contextmenu", () => fromBox++);
    touch("touchstart", box, [[1, 1]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(fromBox).toBe(0);
    touch("touchend", box, []);

    touch("touchstart", item, [[1, 1], [40, 40]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(0);
  });

  it("opens one menu when the browser sends its own as well", () => {
    // ours first: the browser's late one is swallowed
    touch("touchstart", item, [[5, 5]]);
    vi.advanceTimersByTime(HOLD_MS);
    const late = nativeMenu(item);
    expect(menus).toHaveLength(1);
    expect(late.defaultPrevented).toBe(true);
    touch("touchend", item, []);

    // the browser's first: ours never fires, and the lift still does not tap
    touch("touchstart", item, [[5, 5]]);
    vi.advanceTimersByTime(300);
    nativeMenu(item);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(2);
    expect(touch("touchend", item, []).defaultPrevented).toBe(true);
  });

  it("does not get in the way of a right click", () => {
    const e = nativeMenu(item);
    expect(menus).toHaveLength(1);
    expect(e.defaultPrevented).toBe(true); // by the item's own handler
  });

  it("stops listening once removed", () => {
    uninstall();
    touch("touchstart", item, [[5, 5]]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toHaveLength(0);
    uninstall = () => undefined;
  });
});
