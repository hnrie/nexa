import { useEffect, useState } from "react";
import { useUI } from "@/stores/ui";

/**
 * When a dialog nobody asked for (What's New, the update prompt) may open:
 * the page is in view, nothing else is open over it, and nobody is in the
 * middle of writing. Only one of them is up at a time; the other waits its
 * turn.
 */

/** A key pressed this recently means someone is still writing, even between words. */
const TYPING_MS = 4000;
/** How often a dialog that is waiting looks again. */
const RETRY_MS = 1000;

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

let lastKey = 0;
let listening = false;
/** Which dialog has the floor. */
let holder: string | null = null;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", () => (lastKey = Date.now()), { capture: true, passive: true });
}

/** Whether someone is writing: words in the box that has focus, or a key pressed a moment ago. */
export function writing(now = Date.now()): boolean {
  if (now - lastKey < TYPING_MS) return true;
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== "";
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) && el.value.trim() !== "";
  if (el instanceof HTMLElement && el.isContentEditable) return (el.textContent ?? "").trim() !== "";
  return false;
}

/** Whether the dialog called `who` may open now. */
export function mayInterrupt(who: string): boolean {
  if (typeof document === "undefined") return false;
  if (holder !== null && holder !== who) return false;
  if (document.visibilityState !== "visible") return false;
  const ui = useUI.getState();
  if (ui.modals.length > 0 || ui.contextMenu || ui.quickSwitcher) return false;
  // what the store does not know about: the Terms, a notice from Nexa, a popover
  if (document.querySelector("[data-modal-layer]")) return false;
  return !writing();
}

/**
 * True from the first moment `who` may open while it `wants` to, until it
 * no longer wants to. While it is true, no other dialog on this footing opens.
 */
export function useInterrupt(who: string, wants: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!wants) {
      setOpen(false);
      return;
    }
    if (open) return;
    listen();
    const attempt = () => {
      if (!mayInterrupt(who)) return;
      holder = who;
      setOpen(true);
    };
    attempt();
    const timer = setInterval(attempt, RETRY_MS);
    return () => clearInterval(timer);
  }, [who, wants, open]);
  // the floor is given back when this one closes or goes away
  useEffect(() => {
    if (open) return;
    if (holder === who) holder = null;
  }, [who, open]);
  useEffect(
    () => () => {
      if (holder === who) holder = null;
    },
    [who],
  );
  return open;
}

/** For tests: forgets who has the floor and when a key was last pressed. */
export function resetInterrupts(): void {
  holder = null;
  lastKey = 0;
}
