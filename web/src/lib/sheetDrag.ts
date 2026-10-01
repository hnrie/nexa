/**
 * Sheets that follow the finger, on a phone: a dialog, the emoji picker, a
 * menu or a profile that rises from the bottom of the screen can be pulled up
 * to take the whole screen and pushed down to put it away, the way a phone's
 * own sheets go.
 *
 * - Its top (the handle bar and the title under it) can be dragged either way.
 * - Anything in it that scrolls hands over to the sheet once it is at its top
 *   and the finger keeps pulling down; while it can still scroll, it scrolls.
 * - Let go past a third of the way down, or with a flick, and the sheet goes;
 *   short of that it settles back. Pulled up far enough, or flicked up, a sheet
 *   that has more to show grows to the full height of the screen, and from
 *   there a pull down brings it back before a second one puts it away.
 *
 * Touch events rather than pointer events: a pointer is taken away from the
 * page as soon as the browser starts scrolling, which is exactly the moment a
 * pull on a list at its top has to become a pull on the sheet. A touch can be
 * kept from scrolling by the page as it goes.
 */

export interface SheetDragOptions {
  /** What moves: the sheet itself. */
  sheet: HTMLElement;
  /** Puts it away; called once it has slid off the screen. A close that is refused leaves the sheet where it was. */
  onClose: () => void;
  /**
   * Dims what is behind it as the sheet goes: 1 is the full dim, 0 none, and
   * null back to its own. `ms` is how long the change takes.
   */
  fade?: (level: number | null, ms: number) => void;
  /** Whether the sheet has more to show than it does now, and so can grow. Read as each drag starts. */
  expandable?: () => boolean;
  /** The sheet grew to the full height or went back down; the sheet carries `data-expanded` meanwhile. */
  onExpand?: (expanded: boolean) => void;
  /** How much of the sheet's top takes a drag in either direction, in pixels. */
  handle?: number;
}

/** Past this far a finger is dragging rather than tapping. */
const SLOP = 7;
/** A flick: this fast, in pixels per millisecond, decides on its own. */
const FLICK = 0.55;
const SETTLE_MS = 240;
const AWAY_MS = 200;

/** Where a touch belongs to something else: typing, a slider, a row that scrolls sideways, a picture being zoomed. */
const NOT_OURS = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-swipe], [data-zoom-pan]";

function scrollerIn(target: Element | null, sheet: HTMLElement): HTMLElement | null {
  for (let el = target instanceof HTMLElement ? target : target?.parentElement ?? null; el && el !== sheet.parentElement; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
    if (el === sheet) break;
  }
  return null;
}

function reducedMotion(): boolean {
  return document.documentElement.dataset["reducedMotion"] === "true" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Attaches the gestures to a sheet; the returned function takes them off again. */
export function attachSheetDrag(opts: SheetDragOptions): () => void {
  const { sheet } = opts;
  const handle = opts.handle ?? 44;
  type Drag = {
    x: number;
    y: number;
    /** Started on the top of the sheet, which drags both ways. */
    onHandle: boolean;
    scroller: HTMLElement | null;
    state: "maybe" | "drag" | "no";
    /** "close": following the finger down; "grow": the sheet growing as it is pulled up. */
    mode: "close" | "grow" | null;
    height: number;
    canGrow: boolean;
    trail: { y: number; t: number }[];
  };
  let drag: Drag | null = null;
  let busy = false;

  const expanded = () => sheet.hasAttribute("data-expanded");
  const setExpanded = (on: boolean) => {
    if (on === expanded()) return;
    if (on) sheet.setAttribute("data-expanded", "");
    else sheet.removeAttribute("data-expanded");
    opts.onExpand?.(on);
  };
  const clearStyles = () => {
    sheet.style.transform = "";
    sheet.style.transition = "";
    sheet.style.height = "";
    sheet.style.maxHeight = "";
    opts.fade?.(null, 0);
  };
  const animate = (apply: () => void, ms: number, done?: () => void) => {
    if (reducedMotion()) ms = 0;
    sheet.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), height ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none";
    apply();
    window.setTimeout(() => done?.(), ms);
  };

  const onStart = (e: TouchEvent) => {
    if (busy || e.touches.length !== 1) {
      drag = null;
      return;
    }
    const t = e.touches[0]!;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(NOT_OURS)) {
      drag = null;
      return;
    }
    const top = sheet.getBoundingClientRect().top;
    const onHandle = t.clientY - top <= handle || !!target?.closest("[data-sheet-handle]");
    drag = { x: t.clientX, y: t.clientY, onHandle, scroller: onHandle ? null : scrollerIn(target, sheet), state: "maybe", mode: null, height: sheet.getBoundingClientRect().height, canGrow: false, trail: [{ y: t.clientY, t: e.timeStamp }] };
  };

  const onMove = (e: TouchEvent) => {
    const d = drag;
    if (!d || d.state === "no") return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (d.state === "maybe") {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // sideways is a swipe through tabs or pictures, not the sheet's
      if (Math.abs(dx) > Math.abs(dy)) {
        d.state = "no";
        return;
      }
      const atTop = !d.scroller || d.scroller.scrollTop <= 0;
      d.canGrow = !expanded() && !!opts.expandable?.();
      if (dy > 0) {
        // down: from the top, or from a list that has nothing more above
        if (!d.onHandle && !atTop) {
          d.state = "no";
          return;
        }
        d.mode = "close";
      } else {
        // up: the top grows a sheet that has more to show; a list scrolls as it would
        if (!d.onHandle && !(d.canGrow && atTop)) {
          d.state = "no";
          return;
        }
        d.mode = d.canGrow ? "grow" : "close";
      }
      d.state = "drag";
      d.y = t.clientY - Math.sign(dy) * SLOP;
      sheet.style.transition = "none";
    }
    if (e.cancelable) e.preventDefault();
    d.trail.push({ y: t.clientY, t: e.timeStamp });
    if (d.trail.length > 6) d.trail.shift();
    const off = t.clientY - d.y;
    if (d.mode === "grow") {
      const max = window.visualViewport?.height ?? window.innerHeight;
      const h = Math.min(max, Math.max(d.height, d.height - off));
      sheet.style.maxHeight = "none";
      sheet.style.height = `${h}px`;
      // pulled back down past where it started, it follows the finger away
      sheet.style.transform = off > 0 ? `translateY(${off}px)` : "";
    } else {
      // upwards there is nowhere to go: it gives a little, as a sheet held at its top does
      const y = off >= 0 ? off : -Math.sqrt(-off) * 2.5;
      sheet.style.transform = `translateY(${y}px)`;
      if (off > 0) opts.fade?.(Math.max(0.15, 1 - (off / Math.max(1, d.height)) * 0.9), 0);
    }
  };

  const speed = (d: Drag): number => {
    const first = d.trail[0]!;
    const last = d.trail[d.trail.length - 1]!;
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  };

  const onEnd = (e: TouchEvent) => {
    const d = drag;
    drag = null;
    if (!d || d.state !== "drag") return;
    const last = d.trail[d.trail.length - 1]!;
    const off = last.y - d.y;
    const v = speed(d);
    if (e.cancelable) e.preventDefault();
    if (d.mode === "grow") {
      const grew = -off > 60 || v < -FLICK;
      if (grew) {
        const max = window.visualViewport?.height ?? window.innerHeight;
        animate(() => (sheet.style.height = `${max}px`), SETTLE_MS, () => {
          setExpanded(true);
          clearStyles();
        });
        return;
      }
      if (off > d.height / 3 || v > FLICK) return away(d);
      animate(() => {
        sheet.style.height = `${d.height}px`;
        sheet.style.transform = "";
      }, SETTLE_MS, clearStyles);
      return;
    }
    // down from the full height: back to where it was before it grew, unless flung away
    if (expanded() && off > 0 && !(off > d.height * 0.6 || v > FLICK * 1.6)) {
      if (off > 60 || v > FLICK) {
        animate(() => (sheet.style.transform = `translateY(${off}px)`), 0);
        setExpanded(false);
        animate(() => (sheet.style.transform = ""), SETTLE_MS, clearStyles);
      } else animate(() => (sheet.style.transform = ""), SETTLE_MS, clearStyles);
      return;
    }
    if (off > Math.min(160, d.height / 3) || (v > FLICK && off > 24)) return away(d);
    animate(() => {
      sheet.style.transform = "";
      opts.fade?.(1, SETTLE_MS);
    }, SETTLE_MS, clearStyles);
  };

  /** Slides the sheet off the bottom and closes it; a close that is refused brings it back. */
  const away = (d: Drag) => {
    busy = true;
    animate(() => {
      sheet.style.transform = `translateY(${Math.max(d.height, sheet.getBoundingClientRect().height) + 24}px)`;
      opts.fade?.(0, AWAY_MS);
    }, AWAY_MS, () => {
      opts.onClose();
      requestAnimationFrame(() => {
        busy = false;
        if (!sheet.isConnected) return;
        animate(() => {
          sheet.style.transform = "";
          opts.fade?.(1, SETTLE_MS);
        }, SETTLE_MS, clearStyles);
      });
    });
  };

  const onCancel = () => {
    const d = drag;
    drag = null;
    if (d?.state === "drag") animate(() => {
      sheet.style.transform = "";
      opts.fade?.(1, SETTLE_MS);
    }, SETTLE_MS, clearStyles);
  };

  sheet.addEventListener("touchstart", onStart, { passive: true });
  sheet.addEventListener("touchmove", onMove, { passive: false });
  sheet.addEventListener("touchend", onEnd, { passive: false });
  sheet.addEventListener("touchcancel", onCancel);
  return () => {
    sheet.removeEventListener("touchstart", onStart);
    sheet.removeEventListener("touchmove", onMove);
    sheet.removeEventListener("touchend", onEnd);
    sheet.removeEventListener("touchcancel", onCancel);
  };
}

/** Whether sheets rise from the bottom here: a phone held either way. */
export function sheetsHere(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 767px)").matches;
}

/** A fade for an element of its own (a menu's backdrop): its opacity. */
export function fadeElement(el: HTMLElement | null): SheetDragOptions["fade"] {
  return (level, ms) => {
    if (!el) return;
    el.style.transition = ms ? `opacity ${ms}ms ease` : "none";
    el.style.opacity = level === null ? "" : String(level);
    if (level === null) el.style.transition = "";
  };
}

/**
 * A fade for the dim a sheet sits inside (a dialog's overlay): its colour and
 * blur through --sheet-dim, so the sheet in it keeps its own opacity.
 */
export function fadeOverlay(el: HTMLElement | null): SheetDragOptions["fade"] {
  return (level, ms) => {
    if (!el) return;
    el.style.transition = ms ? `--sheet-dim ${ms}ms ease, background-color ${ms}ms ease` : "none";
    if (level === null) {
      el.style.removeProperty("--sheet-dim");
      el.style.transition = "";
    } else el.style.setProperty("--sheet-dim", String(level));
  };
}
