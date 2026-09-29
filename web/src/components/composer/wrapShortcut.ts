/**
 * Ctrl/Cmd+B, I and U in a plain message box: the selection gets the markdown
 * for bold, italics or underline, or loses it when it already has it.
 */

/**
 * The markdown a selection can be wrapped in: bold, italics, underline,
 * strikethrough, a spoiler, inline code. The shortcuts take the first three;
 * a text box's right-click menu offers them all (lib/textMenu).
 */
export type WrapMarker = "**" | "*" | "__" | "~~" | "||" | "`";

/** The marker each shortcut wraps with; italics take `*` so that `snake_case` never matters. */
const MARKERS: Record<string, "**" | "*" | "__"> = { b: "**", i: "*", u: "__" };

/** The marker for a formatting shortcut, or null for any other key. */
export function formatShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): "**" | "*" | "__" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  return MARKERS[e.key.toLowerCase()] ?? null;
}

export interface Wrapped {
  /** The span of the original text to replace, and what replaces it. */
  from: number;
  to: number;
  insert: string;
  /** The selection afterwards, in the new text. */
  start: number;
  end: number;
}

function runBefore(text: string, at: number, ch: string): number {
  let n = 0;
  while (at - n - 1 >= 0 && text.charAt(at - n - 1) === ch) n += 1;
  return n;
}

function runAfter(text: string, at: number, ch: string): number {
  let n = 0;
  while (at + n < text.length && text.charAt(at + n) === ch) n += 1;
  return n;
}

/** Whether `run` markers of `marker`'s kind around the words already mean this format. */
function has(marker: string, run: number): boolean {
  // a run of three stars is bold and italic at once; two is bold alone
  if (marker === "*") return run === 1 || run >= 3;
  // one backtick is inline code; three would be a code block
  if (marker.length === 1) return run === 1;
  return run >= 2;
}

/**
 * What toggling `marker` does to the selection from `start` to `end` of
 * `text`. Spaces at the edges of the selection stay outside the markers
 * (markdown ignores markers that hug a space), each line of a selection over
 * several lines is wrapped on its own (markers cannot reach across a line),
 * and with nothing selected the markers go around the caret, ready to type
 * between.
 */
export function toggleWrap(text: string, start: number, end: number, marker: WrapMarker): Wrapped {
  const ch = marker.charAt(0);
  const m = marker.length;
  if (start === end) {
    // between markers already there, with nothing between them: take them away again
    const before = runBefore(text, start, ch);
    const after = runAfter(text, start, ch);
    if (before === after && has(marker, before)) return { from: start - m, to: start + m, insert: "", start: start - m, end: start - m };
    return { from: start, to: end, insert: marker + marker, start: start + m, end: start + m };
  }
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text.charAt(s))) s += 1;
  while (e > s && /\s/.test(text.charAt(e - 1))) e -= 1;
  if (s === e) return { from: start, to: end, insert: text.slice(start, end), start, end };
  const selected = text.slice(s, e);
  // the markers are around the selection: unwrap
  const before = runBefore(text, s, ch);
  const after = runAfter(text, e, ch);
  if (Math.min(before, after) >= m && has(marker, Math.min(before, after))) {
    return { from: s - m, to: e + m, insert: selected, start: s - m, end: e - m };
  }
  // the selection includes its own markers: unwrap
  const innerBefore = runAfter(selected, 0, ch);
  const innerAfter = runBefore(selected, selected.length, ch);
  if (selected.length > 2 * m && Math.min(innerBefore, innerAfter) >= m && has(marker, Math.min(innerBefore, innerAfter))) {
    const inner = selected.slice(m, selected.length - m);
    return { from: s, to: e, insert: inner, start: s, end: s + inner.length };
  }
  // wrap, keeping the words selected
  if (!selected.includes("\n")) return { from: s, to: e, insert: marker + selected + marker, start: s + m, end: e + m };
  // over several lines, a line at a time
  const lines = selected.split("\n");
  const wrapped = lines
    .map((line) => {
      const lead = /^\s*/.exec(line)?.[0] ?? "";
      const trail = /\s*$/.exec(line.slice(lead.length))?.[0] ?? "";
      const words = line.slice(lead.length, line.length - trail.length);
      return words ? lead + marker + words + marker + trail : line;
    })
    .join("\n");
  return { from: s, to: e, insert: wrapped, start: s, end: s + wrapped.length };
}

/**
 * Applies a toggle to a textarea through the browser's own editing, so that
 * Ctrl+Z takes it back like any typing. Returns the new value; the caller's
 * onChange also sees it, from the input event the edit fires.
 */
export function applyWrap(el: HTMLTextAreaElement, marker: WrapMarker): string {
  const w = toggleWrap(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, marker);
  el.focus();
  el.setSelectionRange(w.from, w.to);
  let done = false;
  try {
    // deprecated, but the one way to change a field that its undo history keeps
    done = typeof document.execCommand === "function" && document.execCommand("insertText", false, w.insert);
  } catch {
    done = false;
  }
  if (!done || el.value.slice(w.from, w.from + w.insert.length) !== w.insert) {
    el.setRangeText(w.insert, w.from, w.to, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(w.start, w.end);
  return el.value;
}
