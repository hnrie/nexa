import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { Announcement, CaseCounts, CaseMessage, ModLogEntry, People, StaffCase } from "@/api/moderation";
import type { BugCounts, BugMessage, StaffBug } from "@/api/bugs";

/**
 * The staff's side: how much is waiting on them (the rail and sidebar show
 * it) and the people the panel has loaded. The panel's views keep their own
 * lists and hear about changes through `useModEvents`, so an open case, the
 * Active Cases list and the log all move the moment anything happens.
 */

export type ModEvent =
  | { type: "case"; case: StaffCase; messages: CaseMessage[]; people: People }
  | { type: "log"; entry: ModLogEntry; people: People }
  | { type: "announcement"; announcement: Announcement; people: People }
  | { type: "announcement_gone"; id: string }
  | { type: "bug"; report: StaffBug; messages: BugMessage[]; people: People };

interface ModerationStore {
  counts: CaseCounts | null;
  /** How many bug reports each view of the Bug Reports tab holds; `waiting` is what the badges count. */
  bugCounts: BugCounts | null;
  ownerId: string | null;
  people: People;
  setCounts: (c: CaseCounts | undefined) => void;
  setBugCounts: (c: BugCounts | null | undefined) => void;
  setOwner: (id: string | undefined) => void;
  mergePeople: (p: People | undefined) => void;
  reset: () => void;
}

export const useModeration = create<ModerationStore>()((set) => ({
  counts: null,
  bugCounts: null,
  ownerId: null,
  people: {},
  setCounts: (counts) => counts && set({ counts }),
  setBugCounts: (bugCounts) => bugCounts && set({ bugCounts }),
  setOwner: (id) => id && set({ ownerId: id }),
  mergePeople: (p) => p && set((s) => ({ people: { ...s.people, ...p } })),
  reset: () => set({ counts: null, bugCounts: null, ownerId: null, people: {} }),
}));

const listeners = new Set<(e: ModEvent) => void>();

/** Hands a moderation event to every open view that listens. */
export function emitModEvent(e: ModEvent): void {
  if (e.type !== "announcement_gone") useModeration.getState().mergePeople(e.people);
  for (const l of [...listeners]) l(e);
}

/** Calls `handler` with every moderation event while the component is mounted. */
export function useModEvents(handler: (e: ModEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l = (e: ModEvent) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}
