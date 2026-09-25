import { useUI } from "@/stores/ui";

/**
 * The back gesture closes what is open over the page instead of leaving it.
 *
 * On a phone or tablet, back — the edge swipe, the system button — is how
 * anything on top is put away: a dialog, the settings, the navigation drawer.
 * The browser only knows about pages, though, so back used to take the router
 * to the previous address behind the dialog and leave the dialog where it was.
 *
 * While anything is open, one extra history entry sits on top of the current
 * one: the same address, with a mark in its state. Back pops it, and instead
 * of a page changing the topmost layer closes. If more are open underneath,
 * the entry goes back on for the next one. When the last layer closes some
 * other way (its ✕, Escape, a tap outside) the entry is taken off again.
 *
 * Closing goes through Escape, which every layer already answers — and only
 * the topmost one does, including the settings' refusal to close over unsaved
 * changes. A refused close shakes the save bar as Escape does, and the entry
 * is put back, so the next back asks again rather than leaving the page.
 *
 * The router is left in charge of real navigation. Going somewhere from inside
 * a layer (a channel picked in the drawer, a new server opened from its dialog)
 * replaces the extra entry rather than stacking on it, so it never ends up
 * buried in the history where a later back would land on it for nothing.
 *
 * Only for touch screens: that is where back is a gesture people use to close
 * things. With a mouse, back is the browser's own button and means a page.
 */

const MARK = "nexaLayer";
/** How long a change is left to settle (a dialog swapped for another, a close followed by a navigation) before history follows it. */
const SETTLE_MS = 60;

/** Whether the current history entry is the extra one. */
function onLayerEntry(): boolean {
  const state: unknown = window.history.state;
  return !!state && typeof state === "object" && (state as Record<string, unknown>)[MARK] === true;
}

/** How many things are open over the page that back should close. */
export function openLayers(): number {
  const ui = useUI.getState();
  const drawer = ui.leftOpen && window.matchMedia("(max-width: 767px)").matches ? 1 : 0;
  const members = ui.rightOpen && window.matchMedia("(max-width: 1099px)").matches ? 1 : 0;
  return document.querySelectorAll("[data-modal-layer]").length + drawer + members;
}

/** Closes the topmost layer, the way Escape does. */
function closeTop(): void {
  if (document.querySelector("[data-modal-layer]")) {
    // Dispatched on the document, so only the listeners layers keep there
    // hear it — not the text field or button that happens to have focus.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    return;
  }
  const ui = useUI.getState();
  if (ui.rightOpen) ui.setRightOpen(false);
  else if (ui.leftOpen) ui.setLeftOpen(false);
}

/** Starts following the layers; returns the undo. Does nothing without a touch screen. */
export function installBackLayers(): () => void {
  if (typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)").matches) return () => undefined;
  const history = window.history;
  const nativePush = History.prototype.pushState;
  const nativeReplace = History.prototype.replaceState;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // a traversal of our own is under way: its popstate is not the user's back
  let travelling = false;
  let travelTimer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (): void => {
    if (!timer) timer = setTimeout(sync, SETTLE_MS);
  };

  function sync(): void {
    timer = null;
    if (travelling) return;
    const want = openLayers() > 0;
    const have = onLayerEntry();
    if (want && !have) {
      const state: unknown = history.state;
      nativePush.call(history, { ...(state && typeof state === "object" ? state : {}), [MARK]: true }, "", window.location.href);
    } else if (!want && have) {
      travelling = true;
      travelTimer = setTimeout(() => {
        travelling = false;
        schedule();
      }, 1000);
      history.back();
    }
  }

  const onPop = (): void => {
    if (travelling) {
      travelling = false;
      if (travelTimer) clearTimeout(travelTimer);
      schedule();
      return;
    }
    // Back from the extra entry lands on the page's own: close one layer.
    // Forward onto an extra entry with nothing open is undone by the sync.
    if (!onLayerEntry() && openLayers() > 0) closeTop();
    schedule();
  };

  // The router's navigation from the extra entry replaces it (see above).
  history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null): void {
    if (onLayerEntry()) nativeReplace.call(history, data, unused, url);
    else nativePush.call(history, data, unused, url);
  };
  // A replace takes the mark off the extra entry; the sync puts one back on top.
  history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null): void {
    nativeReplace.call(history, data, unused, url);
    schedule();
  };

  window.addEventListener("popstate", onPop);
  const stopUI = useUI.subscribe((s, prev) => {
    if (s.modals !== prev.modals || s.contextMenu !== prev.contextMenu || s.quickSwitcher !== prev.quickSwitcher || s.leftOpen !== prev.leftOpen || s.rightOpen !== prev.rightOpen) schedule();
  });
  // Dialogs that are not in the store (a crop dialog, a pack editor's) still
  // portal into the body, so a change of the body's children is a change of layers.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true });
  // an extra entry left from before a reload is taken off again
  schedule();

  return () => {
    window.removeEventListener("popstate", onPop);
    stopUI();
    observer.disconnect();
    if (timer) clearTimeout(timer);
    if (travelTimer) clearTimeout(travelTimer);
    // back to the History prototype's own methods
    delete (history as { pushState?: unknown }).pushState;
    delete (history as { replaceState?: unknown }).replaceState;
  };
}
