/**
 * Where the on-screen keyboard is, and making room for it.
 *
 * Chrome on Android makes the page itself shorter when the keyboard comes up
 * (the viewport asks it to: interactive-widget=resizes-content), and there is
 * little to do here. iOS Safari lays the keyboard over the page and leaves the
 * page its full height: what can still be seen is the visual viewport, shorter
 * than the layout by the keyboard and by the bars Safari floats above it. Two
 * measurements are kept on the document root for whatever sits at the bottom
 * of the screen (sheets, menus, pickers): --kb-inset, how much of the page's
 * bottom is covered, and --vvh, the height still in view.
 *
 * In the app itself (while something marked data-keyboard-fit is on the page)
 * the layout is fitted to what is left: the root gets data-keyboard and
 * --app-h, the app shell takes that height, and so the header stays where it
 * is, the lists get shorter and the box being typed in sits just above the
 * keyboard. While the height is changing the root also carries
 * data-keyboard-moving, and the shell eases to its new height at about the
 * keyboard's own pace.
 *
 * Left alone Safari does something else. It slides the whole page up until the
 * focused field is in the middle of what is left, header off the top, and it
 * does so for a field that was in plain view too. Most of this file is about
 * that slide, which cannot be switched off, only avoided:
 *
 * - A focus that says preventScroll is not slid to. Script can say so and a
 *   tap cannot, so every focus made by script says it (`focus` is wrapped),
 *   and a tap's focus is said again with it (`quiet`), which Safari 27 takes.
 * - Safari 26 decides from where the field was at the moment of focus, before
 *   any of this has run. There the tap itself is taken over: the page focuses
 *   the field and puts the caret under the finger (`takeTap`). It is only done
 *   once a slide has been seen after a tap, and that is remembered.
 * - A field that takes focus from another while the keyboard is up is first
 *   scrolled into the upper half of its own list, where Safari wants it.
 * - If the page slides anyway it is put back (`hold`), and where Safari will
 *   not let it be put back (26, once it has slid between two fields) the app
 *   goes to where the screen is (`follow`).
 *
 * With Safari told to keep still, a field the fitting does not bring above
 * the keyboard would stay behind it (one in something laid over the app that
 * knows nothing of the keyboard). For that field the page is slid from here,
 * to where Safari would have put it (`place`).
 *
 * None of it is done where it would get in the way: on a page that scrolls,
 * while the view is pinched in, or on a phone lying down, where the keyboard
 * leaves a strip too small to fit anything in. There the page is Safari's to
 * slide, as it always was.
 *
 * The page's height is read from documentElement.clientHeight and never from
 * window.innerHeight: with a keyboard up Safari gives innerHeight as the page's
 * height less however far the page has been slid, which reads as "no keyboard"
 * the moment the page is back at the top.
 */

/** Less than this covered is a toolbar coming and going, not a keyboard. */
const KEYBOARD_MIN = 120;
/** How far from the edge of its list a field being typed in is kept. */
const MARGIN = 12;
/** How much of a field may be behind the keyboard before the page is slid to show it: a hair of its edge is not worth moving everything for. */
const HIDDEN_MIN = 4;
/**
 * The least room the app is fitted into. A phone lying down has a strip left
 * above its keyboard, and the app squeezed into that shows nothing at all:
 * there the page is left to Safari, which slides it to the field.
 */
const ROOM_MIN = 180;
/** About how tall a keyboard stands, for deciding that before one has been seen. */
const KEYBOARD_GUESS = 300;
/** How long after a tap a field taking focus still counts as tapped. */
const TAP_MS = 400;
/** A finger down longer than this is a long press (lib/longPress.ts), and further than this a drag. */
const PRESS_MS = 400;
const PRESS_SLOP = 10;
/** How long a keyboard is waited for before deciding none is coming (one with real keys is attached). */
const EXPECT_MS = 2000;
/** How long after a field was tapped a slide of the page is the keyboard's doing. */
const OPEN_MS = 1500;
/** How long a keyboard takes to leave; what the viewport says meanwhile is about a keyboard on its way out. */
const LEAVE_MS = 700;
/** How long the app takes to reach its new height (AppShell.module.css), and a little over. */
const MOVE_MS = 320;
/** How long Safari takes to finish sliding the page, after which where it says the page is can be believed. */
const SETTLE_MS = 350;
/** Where what is known of this device's keyboard is kept, so that the first tap after opening the app already knows it. */
const STORE = "ec:keyboard";

interface Remembered {
  /** The keyboard's height the last time it was up, by the screen's width: it is another height lying down. */
  heights: Map<number, number>;
  /** Safari here has slid the page for a tapped field in spite of being asked not to. */
  slides: boolean;
}

function remembered(): Remembered {
  const out: Remembered = { heights: new Map(), slides: false };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "{}") as { heights?: unknown; slides?: unknown } | null;
    if (raw && typeof raw.heights === "object" && raw.heights) {
      for (const [width, height] of Object.entries(raw.heights)) {
        if (Number(width) > 0 && typeof height === "number" && height > KEYBOARD_MIN && height < 2000) out.heights.set(Number(width), Math.round(height));
      }
    }
    out.slides = raw?.slides === true;
  } catch {
    // private browsing, or something else's idea of what belongs under this name
  }
  return out;
}

function remember(known: Remembered): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ heights: Object.fromEntries(known.heights), slides: known.slides }));
  } catch {
    // it is only a head start
  }
}

/** Somewhere to type, which brings up a keyboard. */
export function isTypingField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image", "hidden"].includes(el.type);
}

/**
 * Where the caret is in an editable area, which is the part of it that has to
 * be seen. A text box cannot say where its caret is.
 */
function caretRect(el: HTMLElement): DOMRect | null {
  if (!el.isContentEditable) return null;
  const selection = window.getSelection();
  const node = selection?.focusNode;
  if (!selection || !node || selection.rangeCount === 0 || !el.contains(node)) return null;
  const caret = selection.isCollapsed ? selection.getRangeAt(0).getClientRects?.()[0] : undefined;
  if (caret) return caret;
  // an empty line gives no place for its caret, and a selection has two ends: the line the caret is in
  const line = node instanceof Element ? node : node.parentElement;
  return line && line !== el ? line.getBoundingClientRect() : null;
}

/** The part of a field that has to be in view: its caret where that is known, or else all of it. */
function spotOf(el: HTMLElement): DOMRect {
  return caretRect(el) ?? el.getBoundingClientRect();
}

/**
 * Brings a field into view inside the lists it sits in, and only those:
 * scrollIntoView would also move the page itself, which on iOS is what slides
 * the app out from under the screen.
 *
 * `centre` puts a small field in the upper half of the room it has, as far as
 * its lists can scroll. That is where Safari wants a field that takes focus
 * while the keyboard is already up, and it slides the whole page to get it
 * there: with the field there already, it has nothing to slide.
 */
export function revealField(el: HTMLElement, bottomLimit?: number, centre = false): void {
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const oy = getComputedStyle(box).overflowY;
    if ((oy !== "auto" && oy !== "scroll") || box.scrollHeight <= box.clientHeight + 1) continue;
    const r = spotOf(el);
    const b = box.getBoundingClientRect();
    const bottom = Math.min(b.bottom, bottomLimit ?? Infinity);
    if (centre && bottomLimit !== undefined && r.height < bottomLimit / 2) {
      const below = r.top + r.height / 2 - (bottomLimit / 2 - 2);
      if (below > 0) {
        box.scrollTop += below;
        continue;
      }
    }
    // a field taller than the room it has keeps its top in view, where the caret starts
    if (r.bottom > bottom - MARGIN && r.height < bottom - b.top - 2 * MARGIN) box.scrollTop += Math.ceil(r.bottom - (bottom - MARGIN));
    else if (r.top < b.top + MARGIN) box.scrollTop -= Math.ceil(b.top + MARGIN - r.top);
  }
}

/** What the browser says about how much of the page can be seen. */
export interface Viewport {
  /** The page's own height (documentElement.clientHeight). */
  layout: number;
  /** The height still in view (visualViewport.height). */
  visual: number;
  /** How far down the page the part in view starts (visualViewport.offsetTop). */
  offsetTop: number;
  /** visualViewport.scale: above 1 while pinched in. */
  scale: number;
}

const zoomed = (v: Viewport): boolean => Math.abs(v.scale - 1) >= 0.01;

/**
 * How much of the page's height a keyboard has taken. A pinched-in view also
 * shows less than the whole page: that is not a keyboard, and reads as none.
 */
export function keyboardHeight(v: Viewport): number {
  if (zoomed(v)) return 0;
  const taken = Math.round(v.layout - v.visual);
  return taken > KEYBOARD_MIN ? taken : 0;
}

/** How much of the page's bottom is out of sight where the page is now: what a sheet fixed to the bottom has to clear. */
export function coveredBottom(v: Viewport): number {
  if (zoomed(v)) return 0;
  return Math.max(0, Math.round(v.layout - (v.visual + v.offsetTop)));
}

/** The kinds of input a tap puts a caret in, rather than opening a picker. */
const TEXT_INPUTS = ["text", "search", "email", "url", "tel", "password", "number"];
/** Inside an editable area, what a tap is for in itself and not for putting the caret somewhere. */
const TAPPED_FOR_ITSELF =
  "a[href], button, input, textarea, select, label, summary, img, video, audio, canvas, [role=button], [role=checkbox], [role=link], [contenteditable=false], [draggable=true]";

/**
 * The field a tap on `target` would start typing in, when the tap is one the
 * page can stand in for: on a text box itself, or on the text of an editable
 * area. A tap on a button or a picture inside one stays the browser's.
 */
export function tapField(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLTextAreaElement) return isTypingField(target) ? target : null;
  if (target instanceof HTMLInputElement) return isTypingField(target) && TEXT_INPUTS.includes(target.type) ? target : null;
  const el = target instanceof HTMLElement ? target : target instanceof Element ? target.parentElement : null;
  if (!el?.isContentEditable) return null;
  let area = el;
  while (area.parentElement?.isContentEditable) area = area.parentElement;
  const inner = el.closest(TAPPED_FOR_ITSELF);
  return inner && inner !== area && area.contains(inner) ? null : area;
}

/** Where the keyboard's own tap leaves the caret: at the nearer end of the word tapped in. */
export function snapToWord(text: string, at: number): number {
  let start = at;
  while (start > 0 && !/\s/.test(text.charAt(start - 1))) start -= 1;
  let end = at;
  while (end < text.length && !/\s/.test(text.charAt(end))) end += 1;
  return at - start < end - at ? start : end;
}

/** What of a text box's style decides where each of its letters falls. */
const LAID_OUT_BY = [
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-feature-settings",
  "font-kerning",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "tab-size",
  "direction",
];

/**
 * How far into a text box's text a point falls. A text box cannot be asked, so
 * for a moment a copy of its text is laid over it, set the same way in the
 * same box, and the copy is asked. Nothing is drawn in between. A password is
 * never copied out of its box.
 */
function offsetAt(field: HTMLInputElement | HTMLTextAreaElement, x: number, y: number): number | null {
  const lines = field instanceof HTMLTextAreaElement;
  if (!document.caretRangeFromPoint || !field.value || (!lines && field.type !== "text" && field.type !== "search")) return null;
  const style = getComputedStyle(field);
  const box = field.getBoundingClientRect();
  const copy = document.createElement("div");
  for (const name of LAID_OUT_BY) copy.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(copy.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    overflow: "hidden",
    borderStyle: "solid",
    borderColor: "transparent",
    color: "transparent",
    background: "none",
    zIndex: "2147483647",
    whiteSpace: lines ? "pre-wrap" : "pre",
    overflowWrap: lines ? "break-word" : "normal",
    userSelect: "text",
    webkitUserSelect: "text",
  });
  if (!lines) {
    // a box of one line sets it in the middle of its height: the copy's one line is the whole height, so that a point anywhere in the box is on it
    Object.assign(copy.style, { boxSizing: "border-box", paddingTop: "0", paddingBottom: "0", borderTopWidth: "0", borderBottomWidth: "0", lineHeight: `${box.height}px` });
  }
  copy.textContent = field.value;
  document.body.appendChild(copy);
  // whatever has moved the page's fixed things (`follow`) has moved the copy with them
  const lies = copy.getBoundingClientRect();
  if (lies.left !== box.left || lies.top !== box.top) copy.style.transform = `translate(${box.left - lies.left}px, ${box.top - lies.top}px)`;
  copy.scrollTop = field.scrollTop;
  copy.scrollLeft = field.scrollLeft;
  const at = document.caretRangeFromPoint(x, y);
  // read before the copy goes: a range moves out of whatever is taken off the page
  const offset = at && at.startContainer.parentNode === copy ? Math.min(at.startOffset, field.value.length) : null;
  copy.remove();
  return offset;
}

/**
 * Puts the caret where a tap landed. In a text box that is the nearer end of
 * the word under the finger, as it is for the keyboard's own tap, or the end
 * of the text where the place cannot be found; in an editable area, the very
 * spot.
 */
function placeCaret(field: HTMLElement, x: number, y: number): void {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const at = offsetAt(field, x, y);
    const index = at === null ? field.value.length : snapToWord(field.value, at);
    try {
      field.setSelectionRange(index, index);
    } catch {
      // a box for a number or an address has no caret to set
    }
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const at = document.caretRangeFromPoint?.(x, y) ?? null;
  let range = at && field.contains(at.startContainer) ? at : null;
  if (!range && field.contains(selection.anchorNode)) return;
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** iPhones and iPads, whose browsers are all Safari underneath. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // an iPad says it is a Mac; a Mac has no touch screen
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Starts keeping the measurements and fitting the app; the function returned stops it again. `ios` is only ever given by tests. */
export function installKeyboardInset(ios: boolean = isIOS()): () => void {
  if (typeof window === "undefined") return () => undefined;
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  const root = document.documentElement;
  // a mouse puts the caret where it clicks, and the browser shows that already
  const touch = window.matchMedia?.("(pointer: coarse)");
  const known = remembered();
  const off = new AbortController();
  const signal = off.signal;
  let frame = 0;
  /** The app is the height of what the keyboard leaves, which is `room`. */
  let fitted = false;
  let room = 0;
  /** The height of a keyboard on its way up: a field was tapped, and this is how tall the last one stood. */
  let expected = 0;
  let expectTimer = 0;
  let tappedAt = -Infinity;
  /** When a tap last brought a keyboard up from nothing. */
  let openedAt = -Infinity;
  let leftAt = -Infinity;
  let leaveTimer = 0;
  let moveTimer = 0;
  let settleTimer = 0;
  let placeTimer = 0;
  /** How far up the page is kept: not at all, unless the field being typed in can only be seen with the page slid (`place`). */
  let want = 0;
  /** Focus has just gone from one field to another under a keyboard that stays up. */
  let changed = false;
  /** The focus being made is the page's own stand-in for a tap. */
  let taking = false;

  const view = (): Viewport => ({ layout: root.clientHeight, visual: vv.height, offsetTop: vv.offsetTop, scale: vv.scale ?? 1 });
  /**
   * Whether this is the app with room enough left above a keyboard, which is
   * fitted there, or a page that scrolls (or a strip too small to fit anything
   * in), which is left to the browser.
   */
  const fits = (): boolean =>
    document.querySelector("[data-keyboard-fit]") !== null && root.clientHeight - (known.heights.get(root.clientWidth) ?? KEYBOARD_GUESS) >= ROOM_MIN;
  const setPx = (name: string, value: number): void => root.style.setProperty(name, `${Math.round(value)}px`);

  const stopExpecting = (): void => {
    expected = 0;
    window.clearTimeout(expectTimer);
  };

  /**
   * How far the screen is from where the page believes itself to be. Safari
   * 26, having slid the page between two fields, takes a scroll back to the
   * top and goes on showing the page where it was.
   */
  const astray = (): number => Math.max(0, Math.round(vv.pageTop - window.scrollY));

  /**
   * Where Safari will not let the page be put back, the app goes to where the
   * screen is instead: everything is moved down by as far as the page has
   * been slid up (base.css). Only what Safari says once it has stopped moving
   * is believed (`settle`). Until then it gives the place it is heading for,
   * or the one it has just left.
   */
  const follow = (): void => {
    const v = view();
    // a pinched-in view is wherever the fingers put it
    if (zoomed(v)) return;
    const following = root.hasAttribute("data-keyboard-slid");
    // once following, it goes on until the page is back, which with the keyboard leaving is a moment after the app has let go of its height
    let slid = (fitted && want === 0) || following ? astray() : 0;
    if (slid > 0 && !fitted && !keyboardHeight(v)) {
      // the keyboard has gone, and with it whatever kept the page from being put back
      window.scrollTo(0, 0);
      slid = 0;
    }
    if (slid > 0) {
      setPx("--vv-top", slid);
      root.setAttribute("data-keyboard-slid", "");
    } else if (following) {
      root.style.removeProperty("--vv-top");
      root.removeAttribute("data-keyboard-slid");
    }
  };
  const settle = (): void => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(follow, SETTLE_MS);
  };

  /** Keeps the page where it is wanted while the app is fitted, however Safari has just slid it. */
  const hold = (): void => {
    if (zoomed(view())) return;
    if (!fitted || (Math.abs(window.scrollY - want) < 1 && Math.abs(vv.pageTop - want) < 1)) return follow();
    if (ios && want === 0 && !known.slides && performance.now() - openedAt < OPEN_MS) {
      // asked not to, it slid the page for a tapped field all the same
      known.slides = true;
      remember(known);
    }
    window.scrollTo(0, want);
    if (root.hasAttribute("data-keyboard-slid")) follow();
    else settle();
  };

  /**
   * Decides where the page has to be for the field being typed in to be seen.
   * At the top, the fitting having brought the field above the keyboard. A
   * field it has not brought there is one the fitting does not reach, and for
   * that the page is slid up until the field is in the middle of what is
   * left, which is what Safari would have done had it not been told to keep
   * still. It is decided once things have come to rest: a sheet still on its
   * way up is not yet where its field will be.
   */
  const place = (): void => {
    const el = document.activeElement;
    const v = view();
    if (!fitted || zoomed(v) || !isTypingField(el)) return;
    const lead = astray();
    revealField(el, lead + room);
    const spot = spotOf(el);
    // where it lies on the page, wherever the page is just now
    const moved = Number.parseFloat(root.style.getPropertyValue("--vv-top")) || 0;
    const top = spot.top + window.scrollY - moved;
    // of something taller than the room, the top is what has to be seen
    const height = spot.height > room - 2 * MARGIN ? Math.min(spot.height, 44) : spot.height;
    want = top + height - room < HIDDEN_MIN ? 0 : Math.min(v.layout - room, Math.max(0, Math.round(top + height / 2 - room / 2)));
    hold();
  };
  const placeSoon = (): void => {
    window.clearTimeout(placeTimer);
    placeTimer = window.setTimeout(place, MOVE_MS);
  };

  /** The app is about to change height: it eases there rather than jumping. */
  const moving = (): void => {
    root.setAttribute("data-keyboard-moving", "");
    window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(() => root.removeAttribute("data-keyboard-moving"), MOVE_MS);
  };

  const update = (): void => {
    frame = 0;
    const v = view();
    const el = document.activeElement;
    const typing = isTypingField(el);
    // A pinched-in view measures nothing (Safari pinches in by itself on a
    // field set in small type). What was decided before it stands for as long
    // as the same thing is being typed in.
    if (typing && zoomed(v)) return;
    const leaving = !typing && performance.now() - leftAt < LEAVE_MS;
    let height = typing ? keyboardHeight(v) : 0;
    if (height) {
      if (known.heights.get(root.clientWidth) !== height) {
        known.heights.set(root.clientWidth, height);
        remember(known);
      }
      stopExpecting();
    } else if (typing && expected) height = expected;

    if (height && fits()) {
      if (!fitted || room !== v.layout - height) {
        moving();
        placeSoon();
      }
      room = v.layout - height;
      setPx("--app-h", room);
      setPx("--kb-inset", height);
      setPx("--vvh", room);
      root.setAttribute("data-keyboard", "");
      fitted = true;
      // the lists have just become shorter: the field being typed in stays in view
      if (typing) revealField(el, astray() + room, changed);
      changed = false;
      hold();
      return;
    }
    changed = false;
    if (fitted) {
      moving();
      root.style.removeProperty("--app-h");
      root.removeAttribute("data-keyboard");
      fitted = false;
      want = 0;
      window.clearTimeout(settleTimer);
      window.clearTimeout(placeTimer);
      follow();
    }
    setPx("--kb-inset", leaving ? 0 : coveredBottom(v));
    setPx("--vvh", leaving || zoomed(v) ? v.layout : v.visual);
    // Android has made the page shorter itself: the field stays in view there too
    if (typing && touch?.matches && coveredBottom(v) === 0) revealField(el, v.visual + v.offsetTop);
  };
  const soon = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  /**
   * A tap's focus, said again with preventScroll. It counts as long as it is
   * said before the page is next drawn and after the tap has placed the caret
   * (which focuses the field once more itself): on the tap's mouseup and
   * click. Safari 27 takes it; 26 has already made up its mind.
   */
  let fresh: HTMLElement | null = null;
  const quiet = (): void => {
    if (fresh && document.activeElement === fresh) fresh.focus({ preventScroll: true });
  };

  /**
   * Stands in for a tap on a field, where Safari slides the page for a tap's
   * own focus whatever is said afterwards: the field is focused from here,
   * with preventScroll, the caret is put where the finger was, and the mouse
   * events the tap would have ended in are sent on, for whatever listens for
   * a press outside itself.
   */
  let press: { x: number; y: number; at: number; target: EventTarget | null } | null = null;
  const takeTap = (e: TouchEvent): void => {
    const pressed = press;
    press = null;
    const lifted = e.changedTouches[0];
    if (!known.slides || !pressed || !lifted || e.touches.length > 0 || !e.cancelable || e.defaultPrevented) return;
    if (pressed.target !== e.target || performance.now() - pressed.at > PRESS_MS) return;
    if (Math.hypot(lifted.clientX - pressed.x, lifted.clientY - pressed.y) > PRESS_SLOP) return;
    const field = tapField(e.target);
    if (!field || field === document.activeElement || !fits()) return;
    e.preventDefault();
    const send = (type: string): boolean =>
      (e.target as Element).dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: lifted.clientX, clientY: lifted.clientY, button: 0, buttons: type === "mousedown" ? 1 : 0, detail: 1 }),
      );
    // whatever cancels a press on the field means it not to take focus
    if (send("mousedown")) {
      taking = true;
      try {
        field.focus({ preventScroll: true });
      } finally {
        taking = false;
      }
      if (document.activeElement === field) placeCaret(field, lifted.clientX, lifted.clientY);
    }
    send("mouseup");
    send("click");
  };

  vv.addEventListener(
    "resize",
    () => {
      if (root.hasAttribute("data-keyboard-slid")) follow();
      soon();
    },
    { signal },
  );
  vv.addEventListener(
    "scroll",
    () => {
      hold();
      soon();
    },
    { signal },
  );
  window.addEventListener("scroll", hold, { passive: true, signal });
  document.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      press = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, at: performance.now(), target: e.target } : null;
    },
    { capture: true, passive: true, signal },
  );
  document.addEventListener(
    "touchend",
    (e) => {
      tappedAt = performance.now();
      if (ios) takeTap(e);
    },
    { capture: true, passive: false, signal },
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!isTypingField(el as Element | null) || !fits()) return soon();
      const tapped = touch?.matches === true && performance.now() - tappedAt < TAP_MS;
      // a field the page focused for a tap is not slid to, and need not be moved out of Safari's way
      changed = fitted && !taking;
      if (fitted) {
        // a slide from here on is about focus moving, and says nothing of how taps are treated
        openedAt = -Infinity;
        placeSoon();
      }
      if (ios && !taking) {
        fresh = el as HTMLElement;
        window.setTimeout(() => {
          if (fresh === el) fresh = null;
        }, 0);
      }
      if (!fitted && tapped) {
        openedAt = performance.now();
        // The keyboard on its way is as tall as the last one: the app makes room
        // now, rather than a moment after the keyboard is over it.
        const height = known.heights.get(root.clientWidth);
        if (height) {
          expected = height;
          window.clearTimeout(expectTimer);
          expectTimer = window.setTimeout(() => {
            expected = 0;
            // a pinched-in view cannot say whether one came
            if (zoomed(view())) return;
            // none came: it is not expected again until one has been seen
            known.heights.delete(root.clientWidth);
            remember(known);
            update();
          }, EXPECT_MS);
        }
      }
      update();
    },
    { signal },
  );
  const focus = HTMLElement.prototype.focus;
  if (ios) {
    window.addEventListener("mouseup", quiet, { capture: true, signal });
    window.addEventListener("click", quiet, { capture: true, signal });
    // A focus made by script is not slid to either. Safari then leaves the
    // field wherever it is in its lists, and bringing it into view is done
    // here, on focusin.
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions): void {
      if (options?.preventScroll === undefined && isTypingField(this) && fits()) focus.call(this, { ...options, preventScroll: true });
      else focus.call(this, options);
    };
  }
  // focus moving between fields while the keyboard stays up moves nothing else
  document.addEventListener(
    "focusout",
    () => {
      window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => {
        if (isTypingField(document.activeElement)) return;
        stopExpecting();
        leftAt = performance.now();
        update();
        // and once it has gone, whatever the viewport says is believed again
        leaveTimer = window.setTimeout(soon, LEAVE_MS);
      }, 50);
    },
    { signal },
  );
  update();

  return () => {
    off.abort();
    if (ios) HTMLElement.prototype.focus = focus;
    for (const timer of [expectTimer, leaveTimer, moveTimer, settleTimer, placeTimer]) window.clearTimeout(timer);
    if (frame) cancelAnimationFrame(frame);
    for (const name of ["--app-h", "--kb-inset", "--vvh", "--vv-top"]) root.style.removeProperty(name);
    for (const name of ["data-keyboard", "data-keyboard-moving", "data-keyboard-slid"]) root.removeAttribute(name);
  };
}
