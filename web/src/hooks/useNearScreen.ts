/**
 * Whether an element is on screen, about to be, or far away, inside the box
 * that scrolls it (or the window). Long grids mount their costly contents only
 * while it is near: a picker of a thousand animated stickers then costs what
 * the few dozen in view cost, and scrolling away gives the memory back. What
 * is on screen can also go first (see lib/loadQueue.ts).
 *
 * The box is looked up when the element starts being watched: the one the
 * caller names if it holds the element, else the nearest ancestor marked
 * `data-scroll-root`, else the window. It used to be read from a ref once,
 * which a replaced scroller would have left pointing at a box that no longer
 * scrolled anything, and its elements could then never come near.
 */
import { useEffect, useState, type RefObject } from "react";

export type ScreenPlace = "far" | "near" | "visible";

type Watch = (place: ScreenPlace) => void;

interface Target {
  near: boolean;
  visible: boolean;
  watch: Watch;
}

/** Two observers per scrolling box, shared by everything inside it: one a screen wider each way, one just the box. */
interface Pair {
  near: IntersectionObserver;
  visible: IntersectionObserver;
  targets: Map<Element, Target>;
}

const pairs = new Map<Element | null, Pair>();

function placeOf(t: Target): ScreenPlace {
  return t.visible ? "visible" : t.near ? "near" : "far";
}

function pairFor(root: Element | null): Pair {
  let pair = pairs.get(root);
  if (pair) return pair;
  const targets = new Map<Element, Target>();
  const report = (which: "near" | "visible") => (entries: IntersectionObserverEntry[]) => {
    for (const e of entries) {
      const t = targets.get(e.target);
      if (!t || t[which] === e.isIntersecting) continue;
      t[which] = e.isIntersecting;
      t.watch(placeOf(t));
    }
  };
  pair = {
    // a screen ahead in either direction, so what scrolls in is already there
    near: new IntersectionObserver(report("near"), { root, rootMargin: "100% 0px" }),
    visible: new IntersectionObserver(report("visible"), { root }),
    targets,
  };
  pairs.set(root, pair);
  return pair;
}

/** The box that scrolls el: the named one if it holds el, else a marked ancestor, else the window (null). */
export function scrollRootOf(el: Element, named?: Element | null): Element | null {
  if (named && named !== el && named.isConnected && named.contains(el)) return named;
  return el.parentElement?.closest("[data-scroll-root]") ?? null;
}

/** Starts watching el; returns the function that stops. */
export function watchPlace(el: Element, named: Element | null | undefined, watch: Watch): () => void {
  if (typeof IntersectionObserver === "undefined") {
    // nothing to watch with: show it, as a page without the observer always did
    watch("visible");
    return () => undefined;
  }
  const root = scrollRootOf(el, named);
  const pair = pairFor(root);
  pair.targets.set(el, { near: false, visible: false, watch });
  pair.near.observe(el);
  pair.visible.observe(el);
  return () => {
    pair.near.unobserve(el);
    pair.visible.unobserve(el);
    pair.targets.delete(el);
    if (pair.targets.size === 0) {
      pair.near.disconnect();
      pair.visible.disconnect();
      if (pairs.get(root) === pair) pairs.delete(root);
    }
  };
}

/** Where ref's element is: far, near (within a screen) or visible. */
export function useScreenPlace(ref: RefObject<Element | null>, rootRef?: RefObject<Element | null>): ScreenPlace {
  const [place, setPlace] = useState<ScreenPlace>("far");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watchPlace(el, rootRef?.current, setPlace);
  }, [ref, rootRef]);
  return place;
}

/** Whether ref's element is on screen or within a screen of it. */
export function useNearScreen(ref: RefObject<Element | null>, rootRef?: RefObject<Element | null>): boolean {
  return useScreenPlace(ref, rootRef) !== "far";
}
