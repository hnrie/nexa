// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPLY_AT_PX, installSwipeReply, rowSwipeActive } from "./swipeReply";

function touch(type: string, target: EventTarget, points: Array<[number, number]>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(e, "touches", { value: type === "touchend" || type === "touchcancel" ? [] : list });
  Object.defineProperty(e, "changedTouches", { value: list });
  target.dispatchEvent(e);
  return e;
}

/** A finger down at 200, 100 and dragged by dx, dy in steps, then lifted. */
function drag(target: Element, dx: number, dy: number): Event[] {
  const moves: Event[] = [];
  touch("touchstart", target, [[200, 100]]);
  for (let i = 1; i <= 4; i++) moves.push(touch("touchmove", target, [[200 + (dx * i) / 4, 100 + (dy * i) / 4]]));
  touch("touchend", target, [[200 + dx, 100 + dy]]);
  return moves;
}

describe("swipe a message to reply", () => {
  let list: HTMLDivElement;
  let row: HTMLElement;
  let replied: string[];
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="list"><div role="article" data-row="" data-id="42"><p id="words">hello</p></div><div role="article" data-row="" data-id="43" data-pending="true"><p id="sending">on its way</p></div></div>`;
    list = document.getElementById("list") as HTMLDivElement;
    row = list.querySelector("[data-id='42']") as HTMLElement;
    replied = [];
    uninstall = installSwipeReply(list, (r) => replied.push(r.dataset["id"]!), (r) => r.dataset["pending"] !== "true");
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it("replies when pulled past the line against the reading direction", () => {
    const moves = drag(document.getElementById("words")!, -(REPLY_AT_PX + 20), 4);
    expect(replied).toEqual(["42"]);
    // the list does not scroll under a swipe
    expect(moves.at(-1)!.defaultPrevented).toBe(true);
  });

  it("follows the finger, then goes back to its place", () => {
    const words = document.getElementById("words")!;
    touch("touchstart", words, [[200, 100]]);
    touch("touchmove", words, [[170, 101]]);
    expect(row.hasAttribute("data-swiping")).toBe(true);
    expect(row.style.getPropertyValue("--swipe")).toBe("-30px");
    expect(rowSwipeActive()).toBe(true);
    touch("touchend", words, [[170, 101]]);
    expect(replied).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(row.hasAttribute("data-swiping")).toBe(false);
    expect(rowSwipeActive()).toBe(false);
  });

  it("does nothing short of the line", () => {
    drag(document.getElementById("words")!, -(REPLY_AT_PX - 10), 0);
    expect(replied).toEqual([]);
  });

  it("leaves the other direction and up-and-down drags alone", () => {
    const right = drag(document.getElementById("words")!, 90, 0);
    expect(right.some((e) => e.defaultPrevented)).toBe(false);
    const down = drag(document.getElementById("words")!, -20, 90);
    expect(down.some((e) => e.defaultPrevented)).toBe(false);
    expect(replied).toEqual([]);
  });

  it("does not reply to a message still on its way", () => {
    drag(document.getElementById("sending")!, -120, 0);
    expect(replied).toEqual([]);
  });
});
