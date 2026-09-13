/**
 * Keeps the app at its own size on a phone, the way a native app is.
 *
 * The viewport tag (maximum-scale=1, user-scalable=no) and `touch-action:
 * pan-x pan-y` on the page stop pinch and double-tap zoom wherever they are
 * honoured, and also stop iOS zooming in when a small text field is focused.
 * iOS Safari ignores both for a pinch, so on a touch screen its own gesture
 * events are cancelled too. Only WebKit sends those, which leaves every other
 * browser's scrolling untouched.
 */

const GESTURES = ["gesturestart", "gesturechange", "gestureend"] as const;

export function installNoZoom(doc: Document = document, touch = doc.defaultView?.matchMedia?.("(pointer: coarse)").matches ?? false): () => void {
  const win = doc.defaultView;
  if (!touch || !win || !("ongesturestart" in win)) return () => undefined;
  const cancel = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };
  for (const type of GESTURES) doc.addEventListener(type, cancel, { passive: false });
  return () => {
    for (const type of GESTURES) doc.removeEventListener(type, cancel);
  };
}
