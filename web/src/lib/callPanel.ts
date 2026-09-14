/**
 * The call panel above a DM or group conversation takes a share of the
 * conversation's height that the person drags to, remembered on this device.
 * A share rather than pixels, so turning a phone or resizing a window keeps
 * the same balance between the call and the chat.
 */

export const CALL_PANEL_KEY = "ec:callPanel";
export const CALL_PANEL_DEFAULT = 0.5;
/** Enough for the control bar and a row of small tiles (Voice.module.css holds the same). */
export const CALL_PANEL_MIN_PX = 150;
/** Enough below it, header included, for a few messages and the composer (Voice.module.css holds the same). */
export const CHAT_MIN_PX = 240;

/** Holds a share inside what the space allows; the call's own minimum wins when both cannot fit. */
export function clampCallPanel(share: number, containerPx: number): number {
  if (!(containerPx > 0)) return share;
  const min = CALL_PANEL_MIN_PX / containerPx;
  const max = Math.max(min, (containerPx - CHAT_MIN_PX) / containerPx);
  return Math.min(max, Math.max(min, share));
}

/** A saved share, or the default when there is none or it makes no sense. */
export function readCallPanel(saved: string | null): number {
  const n = saved === null ? NaN : Number(saved);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : CALL_PANEL_DEFAULT;
}
