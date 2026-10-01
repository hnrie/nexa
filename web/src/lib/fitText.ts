import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Words that have to fit a box of their own width: a search box's
 * placeholder, a button's label. Cut off with an ellipsis they read as
 * "Find or Start a Conv…" and "Search Unnamed Grou", and in German or
 * Russian they were longer still. Each box offers its words from the longest
 * to the shortest, and shows the longest that fits.
 */

let canvas: CanvasRenderingContext2D | null | undefined;

/** How wide text is drawn in an element's font, in CSS pixels; null where nothing can be measured. */
export function textWidth(text: string, el: Element): number | null {
  if (canvas === undefined) {
    try {
      canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return null;
  const cs = getComputedStyle(el);
  // the shorthand alone leaves out letter spacing, which the measure has to add itself
  canvas.font = cs.font || `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = parseFloat(cs.letterSpacing) || 0;
  return canvas.measureText(text).width + spacing * text.length;
}

/** The room inside an element for its text: its width without its padding. */
function roomOf(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

/** The first of the words, longest first, that fits in `room` pixels of `el`'s font; the last one otherwise. */
export function fittingText(choices: readonly string[], el: Element, room: number): string {
  for (const text of choices) {
    const w = textWidth(text, el);
    // with nothing to measure with, the longest is shown as it always was
    if (w === null || w <= room + 0.5) return text;
  }
  return choices[choices.length - 1] ?? "";
}

/**
 * The longest of `choices` that fits inside the element `ref` points at,
 * measured again whenever the element changes size or a font finishes
 * loading. `room` can stand in for the element's own width, for a box whose
 * width the words themselves decide.
 */
export function useFittingText(ref: RefObject<HTMLElement | null>, choices: readonly string[], room?: (el: HTMLElement) => number): string {
  const key = choices.join("\u0000");
  const [text, setText] = useState(choices[0] ?? "");
  useLayoutEffect(() => {
    const el = ref.current;
    const list = key.split("\u0000");
    if (!el) {
      setText(list[0] ?? "");
      return;
    }
    const measure = () => {
      const width = room ? room(el) : roomOf(el);
      // not laid out yet (a hidden tab, jsdom): the longest, until there is a width to fit
      setText(width > 0 ? fittingText(list, el, width) : (list[0] ?? ""));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", measure);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", measure);
    };
    // `room` is read fresh on every measure; only the words and the element matter here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
  return text;
}
