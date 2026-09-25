/**
 * Whether this browser can send call audio to a chosen device at all: the
 * audio context itself can in Chromium, an element can in Firefox (see
 * playback.ts), and Safari plays calls on the system's output only. Kept apart
 * from playback so the settings and the device menus can ask without loading
 * the call engine.
 */
export function canChooseOutput(): boolean {
  return (typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype) || (typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype);
}
