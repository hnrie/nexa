/**
 * Whether an element is on screen, or about to be, inside the box that
 * scrolls it (or the window). Long grids mount their costly contents only
 * while this holds: a picker of a thousand animated stickers then costs what
 * the few dozen in view cost, and scrolling away gives the memory back.
 */
import { useEffect, useState, type RefObject } from "react";

type Watch = (near: boolean) => void;

/** One observer per scrolling box, shared by everything inside it. */
const observers = new Map<Element | null, { io: IntersectionObserver; watching: Map<Element, Watch> }>();

function observerFor(root: Element | null) {
  let o = observers.get(root);
  if (!o) {
    const watching = new Map<Element, Watch>();
    // a screen ahead in either direction, so what scrolls in is already there
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) watching.get(e.target)?.(e.isIntersecting);
    }, { root, rootMargin: "100% 0px" });
    o = { io, watching };
    observers.set(root, o);
  }
  return o;
}

export function useNearScreen(ref: RefObject<Element | null>, rootRef?: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // nothing to watch with: show it, as a page without the observer always did
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const root = rootRef?.current ?? null;
    const o = observerFor(root);
    o.watching.set(el, setNear);
    o.io.observe(el);
    return () => {
      o.io.unobserve(el);
      o.watching.delete(el);
      if (o.watching.size === 0) {
        o.io.disconnect();
        observers.delete(root);
      }
    };
  }, [ref, rootRef]);
  return near;
}
