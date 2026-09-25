/**
 * Wraps text that carries its own direction (a channel name after its "#", a
 * handle after its "@", an emoji's ":name:") in Unicode isolates, for places
 * that take a plain string rather than an element: a nav heading, an
 * <option>. In an Arabic page, "#general" otherwise came out as "general#",
 * the "#" taking the page's direction instead of the name's.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}
