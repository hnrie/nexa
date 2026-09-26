// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollRootOf, watchPlace, type ScreenPlace } from "./useNearScreen";

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeObserver {
  static all: FakeObserver[] = [];
  targets = new Set<Element>();
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  /** Reports el as intersecting or not, the way the browser would. */
  fire(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const live = () => FakeObserver.all.filter((o) => !o.disconnected);
const nearFor = (root: Element | null) => live().find((o) => (o.options.root ?? null) === root && o.options.rootMargin)!;
const visibleFor = (root: Element | null) => live().find((o) => (o.options.root ?? null) === root && !o.options.rootMargin)!;

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  document.body.innerHTML = "";
});
afterEach(() => vi.unstubAllGlobals());

function grid() {
  const root = document.createElement("div");
  root.setAttribute("data-scroll-root", "");
  const cell = document.createElement("button");
  root.appendChild(cell);
  document.body.appendChild(root);
  return { root, cell };
}

describe("scrollRootOf", () => {
  it("takes the named box when it holds the element, else the nearest marked one, else the window", () => {
    const { root, cell } = grid();
    const other = document.createElement("div");
    document.body.appendChild(other);
    expect(scrollRootOf(cell, root)).toBe(root);
    // a named box that no longer holds it (replaced, or never did) is not trusted
    expect(scrollRootOf(cell, other)).toBe(root);
    expect(scrollRootOf(cell, null)).toBe(root);
    const loose = document.createElement("span");
    document.body.appendChild(loose);
    expect(scrollRootOf(loose, null)).toBeNull();
    // a detached box is never used, even one that still holds the element
    const gone = document.createElement("div");
    const inside = document.createElement("span");
    gone.appendChild(inside);
    expect(scrollRootOf(inside, gone)).toBeNull();
  });
});

describe("watchPlace", () => {
  it("reports far, near and visible as the observers see the element", () => {
    const { root, cell } = grid();
    const seen: ScreenPlace[] = [];
    watchPlace(cell, root, (p) => seen.push(p));
    nearFor(root).fire(cell, true);
    visibleFor(root).fire(cell, true);
    visibleFor(root).fire(cell, false);
    nearFor(root).fire(cell, false);
    expect(seen).toEqual(["near", "visible", "near", "far"]);
    // a margin a screen tall above and below
    expect(nearFor(root).options.rootMargin).toBe("100% 0px");
  });

  it("watches a replaced scroller's new cells against the new box, not the old one", () => {
    const first = grid();
    const seen: ScreenPlace[] = [];
    const stop = watchPlace(first.cell, first.root, (p) => seen.push(p));
    const oldNear = nearFor(first.root);
    // the grid is replaced (tab switched, picker reopened): its cells go with it
    stop();
    first.root.remove();
    expect(oldNear.disconnected).toBe(true);
    const second = grid();
    watchPlace(second.cell, second.root, (p) => seen.push(p));
    const newNear = nearFor(second.root);
    expect(newNear).not.toBe(oldNear);
    expect(newNear.targets.has(second.cell)).toBe(true);
    newNear.fire(second.cell, true);
    expect(seen).toEqual(["near"]);
  });

  it("finds the box itself when the ref it was given still points at a detached one", () => {
    const stale = grid();
    stale.root.remove();
    const fresh = grid();
    watchPlace(fresh.cell, stale.root, () => undefined);
    expect(nearFor(fresh.root).targets.has(fresh.cell)).toBe(true);
    expect(live().some((o) => o.options.root === stale.root)).toBe(false);
  });

  it("shares one pair of observers per box and lets them go with the last cell", () => {
    const { root, cell } = grid();
    const other = document.createElement("button");
    root.appendChild(other);
    const a = watchPlace(cell, root, () => undefined);
    const b = watchPlace(other, root, () => undefined);
    expect(live()).toHaveLength(2);
    a();
    expect(live()).toHaveLength(2);
    b();
    expect(live()).toHaveLength(0);
  });

  it("shows everything where there is no observer", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { cell } = grid();
    const seen: ScreenPlace[] = [];
    watchPlace(cell, null, (p) => seen.push(p));
    expect(seen).toEqual(["visible"]);
  });
});
