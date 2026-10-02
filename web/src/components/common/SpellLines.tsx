import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocale } from "@/i18n";
import { knownWrong, misspelled, onLearn, wordsOf, type Word } from "@/lib/spell";
import { useSettings } from "@/stores/settings";
import s from "./SpellLines.module.css";

const FINE = "(hover: hover) and (pointer: fine)";

/**
 * Whether Nexa's own spell checker runs (lib/spell), following the setting,
 * the language and the pointer as they change. While it does, a box it
 * checks turns the browser's checking off, or every word would be marked by
 * both.
 */
export function useSpellActive(): boolean {
  const on = useSettings((st) => st.settings.spellcheck !== false);
  const english = useLocale().startsWith("en");
  const [fine, setFine] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(FINE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(FINE);
    if (!mq) return;
    const change = () => setFine(mq.matches);
    mq.addEventListener?.("change", change);
    return () => mq.removeEventListener?.("change", change);
  }, []);
  return on && english && fine && typeof Worker !== "undefined";
}

/** What shapes a textarea's text, copied to the layer over it so its words land in the same places. */
const COPIED = [
  "direction",
  "unicode-bidi",
  "writing-mode",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-variant",
  "font-feature-settings",
  "font-variation-settings",
  "font-kerning",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "text-indent",
  "text-align",
  "text-rendering",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
];

/**
 * Wavy lines under the misspelled words of a textarea, from Nexa's own
 * checker, so a right click on one (lib/textMenu) has spellings to offer.
 * Drawn as a copy of the box's text laid over it, the same size and shape and
 * scrolled with it, where nothing shows but the lines. A word still being
 * typed waits until it is finished, as it does with the browser's checker.
 *
 * It goes right after the textarea, in the same parent.
 */
export function SpellLines({ target, text }: { target: RefObject<HTMLTextAreaElement | null>; text: string }) {
  const active = useSpellActive();
  const layer = useRef<HTMLDivElement>(null);
  const place = useRef<(() => void) | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /** Where the word being typed ends, or -1. */
  const [typing, setTyping] = useState(-1);
  const words = useMemo(() => (active ? wordsOf(text) : []), [active, text]);

  // words not asked about yet are asked about, and the lines drawn again when the answers come
  useEffect(() => {
    if (!words.length) return;
    let alive = true;
    void misspelled(words.map((w) => w.word)).then(() => {
      if (alive) redraw();
    });
    return () => {
      alive = false;
    };
  }, [words]);
  // a word added to the dictionary loses its line at once
  useEffect(() => (active ? onLearn(redraw) : undefined), [active]);

  useEffect(() => {
    const el = target.current;
    if (!el || !active) return;
    const onInput = (e: Event) => {
      const ie = e as InputEvent;
      const letter = (ie.inputType === "insertText" || ie.inputType === "insertCompositionText") && !!ie.data && /[\p{L}\p{M}'’]$/u.test(ie.data);
      setTyping(letter ? (el.selectionEnd ?? -1) : -1);
    };
    const done = () => setTyping(-1);
    const onKey = (e: KeyboardEvent) => {
      if (/^(Arrow|Home|End|Page)/.test(e.key)) done();
    };
    el.addEventListener("input", onInput);
    el.addEventListener("blur", done);
    el.addEventListener("mousedown", done);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", done);
      el.removeEventListener("mousedown", done);
      el.removeEventListener("keydown", onKey);
    };
  }, [active, target]);

  useLayoutEffect(() => {
    const el = target.current;
    const box = layer.current;
    if (!active || !el || !box) return;
    const sync = () => {
      const cs = getComputedStyle(el);
      for (const p of COPIED) box.style.setProperty(p, cs.getPropertyValue(p));
      // a scroll bar takes its width from the text
      const bar = el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      if (bar > 0) {
        const side = cs.direction === "rtl" ? "padding-left" : "padding-right";
        box.style.setProperty(side, `${(parseFloat(cs.getPropertyValue(side)) || 0) + bar}px`);
      }
      const host = (box.offsetParent as HTMLElement | null) ?? document.documentElement;
      const a = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      box.style.left = `${a.left - h.left - host.clientLeft + host.scrollLeft}px`;
      box.style.top = `${a.top - h.top - host.clientTop + host.scrollTop}px`;
      box.style.width = `${el.offsetWidth}px`;
      box.style.height = `${el.offsetHeight}px`;
      box.scrollTop = el.scrollTop;
      box.scrollLeft = el.scrollLeft;
    };
    sync();
    place.current = sync;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
    const onScroll = () => {
      box.scrollTop = el.scrollTop;
      box.scrollLeft = el.scrollLeft;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
      place.current = null;
    };
  }, [active, target]);
  // the text may have grown the box or scrolled it
  useLayoutEffect(() => place.current?.());

  if (!active) return null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const w of words) {
    if (!knownWrong(w.word) || w.end === typing) continue;
    if (w.start > at) parts.push(text.slice(at, w.start));
    parts.push(
      <span key={w.start} className={s.wrong}>
        {w.word}
      </span>,
    );
    at = w.end;
  }
  // a last line break holds a line of its own in a textarea, and needs something after it here to do the same
  if (parts.length) parts.push(text.slice(at) + "​");
  return (
    <div ref={layer} className={s.layer} aria-hidden="true" data-testid="spell-lines">
      {parts}
    </div>
  );
}

/** Every contenteditable box's misspelled words, in the one highlight the page styles (`::highlight(nexa-spelling)`). */
let shared: Highlight | null = null;
function spellingHighlight(): Highlight {
  if (!shared) {
    shared = new Highlight();
    CSS.highlights.set("nexa-spelling", shared);
  }
  return shared;
}

/**
 * The same lines in a contenteditable box, drawn with the CSS highlight API
 * over the box's own text, code left out. Returns whether they are drawn: in
 * a browser without highlights the box keeps the browser's own checking.
 */
export function useSpellHighlights(ref: RefObject<HTMLElement | null>): boolean {
  const active = useSpellActive() && typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    const mine = new Set<Range>();
    let frame = 0;
    let alive = true;
    /** The end of the word being typed, which is left alone until it is finished. */
    let typing: { node: Node; offset: number } | null = null;
    const draw = async () => {
      const found: { node: Text; w: Word }[] = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const node = n as Text;
        if (node.parentElement?.closest("code, pre, [data-b='code']")) continue;
        for (const w of wordsOf(node.data)) found.push({ node, w });
      }
      await misspelled(found.map((f) => f.w.word));
      if (!alive) return;
      const hl = spellingHighlight();
      for (const r of mine) hl.delete(r);
      mine.clear();
      for (const { node, w } of found) {
        if (!knownWrong(w.word) || (typing?.node === node && typing.offset === w.end)) continue;
        const r = document.createRange();
        r.setStart(node, w.start);
        r.setEnd(node, w.end);
        mine.add(r);
        hl.add(r);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void draw());
    };
    const onInput = (e: Event) => {
      const ie = e as InputEvent;
      const sel = document.getSelection();
      const letter = (ie.inputType === "insertText" || ie.inputType === "insertCompositionText") && !!ie.data && /[\p{L}\p{M}'’]$/u.test(ie.data);
      typing = letter && sel?.focusNode ? { node: sel.focusNode, offset: sel.focusOffset } : null;
    };
    const done = () => {
      if (!typing) return;
      typing = null;
      schedule();
    };
    const onKey = (e: KeyboardEvent) => {
      if (/^(Arrow|Home|End|Page)/.test(e.key)) done();
    };
    const mo = new MutationObserver(schedule);
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("input", onInput);
    root.addEventListener("blur", done);
    root.addEventListener("mousedown", done);
    root.addEventListener("keydown", onKey);
    const off = onLearn(schedule);
    schedule();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      mo.disconnect();
      root.removeEventListener("input", onInput);
      root.removeEventListener("blur", done);
      root.removeEventListener("mousedown", done);
      root.removeEventListener("keydown", onKey);
      off();
      const hl = spellingHighlight();
      for (const r of mine) hl.delete(r);
    };
  }, [active, ref]);
  return active;
}
