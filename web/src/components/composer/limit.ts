import { t } from "@/i18n";

/**
 * The most a message can say, counted the way the box counts it (UTF-16 code
 * units, the same as `text.length`). Sending, editing and the formatting
 * editor all hold to this one number; the server only ever sees ciphertext,
 * so it is the client that keeps it.
 */
export const MAX_MESSAGE_LENGTH = 4000;

/** The counter shows once this few characters are left. */
const COUNTER_FROM = 200;

/** Characters left before the limit (a message's, or another's such as an About Me's); below zero once past it. */
export function charsLeft(text: string, max: number = MAX_MESSAGE_LENGTH): number {
  return max - text.length;
}

/** Whether the counter shows: near the limit or past it. */
export function counterShown(text: string, max: number = MAX_MESSAGE_LENGTH): boolean {
  return charsLeft(text, max) < COUNTER_FROM;
}

/** Whether a message is too long to send or save, leading and trailing space aside, as sending trims them. */
export function tooLong(text: string): boolean {
  return text.trim().length > MAX_MESSAGE_LENGTH;
}

/** What the box says when a message is refused for its length. */
export function tooLongMessage(): string {
  return t("composer.composer.messagesAreLimitedTo", { count: MAX_MESSAGE_LENGTH });
}

/** Whether pasting `pasted` over the selection from `start` to `end` of `value` would take it past the limit. */
export function pasteOverflows(value: string, start: number, end: number, pasted: string): boolean {
  return value.length - (end - start) + pasted.length > MAX_MESSAGE_LENGTH;
}
