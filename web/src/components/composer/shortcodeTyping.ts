import { emojiByShortcode, emojiLoaded, withTone } from "@/components/pickers/emojiIndex";
import { ensureShortcodes, shortcodeToEmoji } from "@/lib/shortcodes";

/** A :name: just closed at the caret, by the rule the message's own markdown reads one (markdown/parse's RE_SHORTCODE). */
const RE_CLOSED = /(:([a-z0-9_+-]{1,60}):)$/;

/**
 * Whether the caret is inside code, where a :name: is only text: past an odd
 * number of ``` fences, or an odd number of backticks on its own line.
 */
export function inCode(before: string): boolean {
  const fences = before.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1).replace(/```/g, "");
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * A :name: typed out in full turns into its emoji as its closing colon goes
 * in, in the skin tone the picker uses, so the box shows what is sent rather
 * than the name. A name the server has its own custom emoji for is left as
 * it is: sending makes it that emoji, and a text box cannot draw it. Null
 * when there is nothing to turn.
 */
export function closeShortcode(value: string, caret: number, tone: number, ownEmoji: (name: string) => boolean = () => false): { value: string; caret: number } | null {
  const before = value.slice(0, caret);
  const m = RE_CLOSED.exec(before);
  if (!m || inCode(before)) return null;
  const typed = m[1]!;
  const name = m[2]!;
  if (ownEmoji(name)) return null;
  const entry = emojiLoaded() ? emojiByShortcode(name) : undefined;
  const emoji = entry ? withTone(entry, tone) : shortcodeToEmoji(name);
  if (!emoji) {
    // the names arrive when first needed; the next one typed finds them here
    ensureShortcodes();
    return null;
  }
  const start = caret - typed.length;
  return { value: value.slice(0, start) + emoji + value.slice(caret), caret: start + emoji.length };
}

/** Whether a change to a text box was the closing colon of a :name: being typed (not a paste, not an input method's). */
export function typedColon(e: Event): boolean {
  const input = e as InputEvent;
  return input.inputType === "insertText" && input.data === ":" && !input.isComposing;
}
