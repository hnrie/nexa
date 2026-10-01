/**
 * Keeps measurements of the on-screen keyboard on the document root:
 * --kb-inset, how much of the page's bottom it covers, and --vvh, the height
 * still visible above it. Bottom sheets use them to sit above the keyboard
 * instead of behind it. Chrome on Android already makes room for the keyboard
 * (the viewport asks it to resize the content), which leaves the inset at 0;
 * iOS Safari does not, and this is how the page learns where it went.
 *
 * While a keyboard is up on iOS, the app itself is sized to what is left
 * above it (--app-h) and the page is held where it was. Otherwise Safari only
 * slid the whole page up far enough to show the box being typed in: the
 * header went off the top, and anything typed into in the middle of the page
 * (a message being edited, a field in the settings) stayed behind the
 * keyboard, with the list it sat in still the height of the whole screen.
 */

/** Less than this covered is a toolbar coming and going, not a keyboard. */
const KEYBOARD_MIN = 120;
/** How far from the edge of its list a field being typed in is kept. */
const MARGIN = 12;

/** Somewhere to type, which brings up a keyboard. */
export function isTypingField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image", "hidden"].includes(el.type);
}

/** The nearest box that scrolls up and down around an element. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * Brings a field into view inside the list it sits in, and only that list:
 * scrollIntoView would also move the page itself, which on iOS is what slid
 * the app out from under the screen in the first place.
 */
export function revealField(el: HTMLElement, bottomLimit?: number): void {
  const box = scrollerOf(el);
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const bottom = Math.min(b.bottom, bottomLimit ?? Infinity);
  // a field taller than the room it has keeps its top in view, where the caret starts
  if (r.bottom > bottom - MARGIN && r.height < bottom - b.top - 2 * MARGIN) box.scrollTop += r.bottom - (bottom - MARGIN);
  else if (r.top < b.top + MARGIN) box.scrollTop -= b.top + MARGIN - r.top;
}

export function installKeyboardInset(): void {
  if (typeof window === "undefined") return;
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  // a mouse puts the caret where it clicks, and the browser shows that already
  const touch = window.matchMedia?.("(pointer: coarse)");
  let frame = 0;
  let open = false;
  const update = (): void => {
    frame = 0;
    const covered = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    root.style.setProperty("--kb-inset", `${Math.round(covered)}px`);
    root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    // A pinch-zoomed page also shows less than the whole layout: that is not a
    // keyboard, and the app must not shrink to the zoomed-in part of it.
    const typing = isTypingField(document.activeElement);
    const keyboard = typing && covered + vv.offsetTop > KEYBOARD_MIN && Math.abs((vv.scale ?? 1) - 1) < 0.01;
    if (keyboard) {
      // Safari slides the page up to show the field; the app is made to fit
      // above the keyboard instead, so the page is put back where it was.
      if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      root.setAttribute("data-keyboard", "");
    } else if (open) {
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--vv-top");
      root.removeAttribute("data-keyboard");
    }
    open = keyboard;
    // The lists have just become shorter: the field being typed in stays in
    // view (on Android, where the browser makes room itself, as much as here).
    const el = document.activeElement;
    if (isTypingField(el) && touch?.matches && (keyboard || covered === 0)) {
      requestAnimationFrame(() => {
        if (document.activeElement === el) revealField(el, vv.height + vv.offsetTop);
      });
    }
  };
  const soon = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  vv.addEventListener("resize", soon);
  vv.addEventListener("scroll", soon);
  // focus moving between fields while the keyboard stays up moves nothing else
  document.addEventListener("focusin", soon);
  document.addEventListener("focusout", () => setTimeout(soon, 50));
  update();
}
