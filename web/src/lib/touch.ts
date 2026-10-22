/** Whether the main pointer is a finger, so hints say "tap" rather than "click". */
export function touchFirst(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}
