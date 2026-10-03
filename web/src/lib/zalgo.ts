/**
 * Zalgo: letters buried under stacks of combining marks, which climb out of
 * their line and over everything near it. Only the general-purpose marks
 * count (the blocks any letter can take), so the marks of a script of its own
 * (Hebrew points, Arabic vowels, Indic signs, Thai tones) never do, and
 * Vietnamese or any accented letter needs at most two of them. The server
 * keeps the same limit (internal/textutil MaxStackedMarks).
 */
const MARK = "[\\u0300-\\u036F\\u0483-\\u0489\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F]";
/** How many of those marks one letter may carry. */
export const MOST_STACKED_MARKS = 3;
const TOO_MANY = new RegExp(`${MARK}{${MOST_STACKED_MARKS + 1},}`);
const EXTRA = new RegExp(`(${MARK}{${MOST_STACKED_MARKS}})${MARK}+`, "g");

/** Whether any letter in `text` carries more marks than one ever needs. */
export function hasZalgo(text: string): boolean {
  return TOO_MANY.test(text);
}

/** `text` with each letter's marks cut back to as many as one ever needs. */
export function clampZalgo(text: string): string {
  return hasZalgo(text) ? text.replace(EXTRA, "$1") : text;
}

/** What is about to go in front of the caret, and the few characters already before it. */
function aroundCaret(target: EventTarget | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const at = target.selectionStart ?? target.value.length;
    return target.value.slice(Math.max(0, at - MOST_STACKED_MARKS - 1), at);
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      return text.slice(Math.max(0, (sel?.anchorOffset ?? 0) - MOST_STACKED_MARKS - 1), sel?.anchorOffset ?? 0);
    }
  }
  return "";
}

/**
 * Refuses zalgo in every text box in the app: typed, pasted or dropped, the
 * input that would pile more marks onto a letter than it ever needs does not
 * go in, and `onRefused` says why. A mark added to a letter that already has
 * its fill counts too, so it cannot be built up one at a time.
 */
export function installZalgoGuard(onRefused: () => void): () => void {
  const handler = (e: Event) => {
    const ev = e as InputEvent;
    if (!ev.inputType || !ev.inputType.startsWith("insert")) return;
    const data = ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "";
    if (!data || !hasZalgo(aroundCaret(ev.target) + data)) return;
    if (!ev.cancelable) return;
    ev.preventDefault();
    onRefused();
  };
  document.addEventListener("beforeinput", handler, true);
  return () => document.removeEventListener("beforeinput", handler, true);
}
