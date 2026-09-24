import { useEffect } from "react";
import { create } from "zustand";

/**
 * Edits on screen that have not been saved. A settings page with unsaved
 * changes holds one while its save bar shows; leaving the page — closing the
 * settings, picking another page, another role — asks first, and while
 * anything is held the answer is no: the bar shakes instead, as it does in
 * Discord, and the edits stay.
 */
interface UnsavedState {
  holds: number;
  /** Counts refusals, so the bar can shake again each time. */
  nudge: number;
  hold: () => () => void;
  /** Whether something unsaved stands in the way; if so, the bar is shaken. */
  blocked: () => boolean;
}

export const useUnsaved = create<UnsavedState>()((set, get) => ({
  holds: 0,
  nudge: 0,
  hold: () => {
    set((s) => ({ holds: s.holds + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ holds: Math.max(0, s.holds - 1) }));
    };
  },
  blocked: () => {
    if (get().holds === 0) return false;
    set((s) => ({ nudge: s.nudge + 1 }));
    return true;
  },
}));

/** Holds while dirty is true. */
export function useHoldUnsaved(dirty: boolean): void {
  useEffect(() => (dirty ? useUnsaved.getState().hold() : undefined), [dirty]);
}

/** Runs fn unless unsaved edits stand in the way (which shakes their bar). */
export function unlessUnsaved(fn: () => void): () => void {
  return () => {
    if (!useUnsaved.getState().blocked()) fn();
  };
}
