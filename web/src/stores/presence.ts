import { create } from "zustand";
import type { Activity, Presence } from "@/api/types";

export type StatusKind = "online" | "idle" | "dnd" | "offline" | "invisible";

interface PresenceState {
  byUser: Record<string, Presence>;
  set: (p: Presence) => void;
  setMany: (list: Presence[]) => void;
  clear: () => void;
}

export const usePresence = create<PresenceState>()((set) => ({
  byUser: {},
  set: (p) => set((s) => ({ byUser: { ...s.byUser, [p.user_id]: p } })),
  setMany: (list) =>
    set((s) => {
      const byUser = { ...s.byUser };
      for (const p of list) byUser[p.user_id] = p;
      return { byUser };
    }),
  clear: () => set({ byUser: {} }),
}));

export function statusOf(p: Presence | undefined): StatusKind {
  if (!p) return "offline";
  return p.status;
}

/** Whether a presence is one other people can see anything of. */
function shown(p: Presence | undefined): p is Presence {
  // invisible is offline as far as anyone else is concerned, and your own
  // screen should agree: otherwise you sit there reading a status nobody else
  // can see, wondering whether invisible worked.
  return !!p && p.status !== "offline" && p.status !== "invisible";
}

/** The status someone set, if it is theirs to show right now. */
export function customStatus(p: Presence | undefined): { text: string; emoji: string } | null {
  if (!shown(p)) return null;
  if (p.status_expires_at !== null && p.status_expires_at < Date.now()) return null;
  if (!p.status_text && !p.status_emoji) return null;
  return { text: p.status_text, emoji: p.status_emoji };
}

/** What someone is doing right now; nothing while they show as offline. */
export function activitiesOf(p: Presence | undefined): Activity[] {
  if (!shown(p)) return [];
  return p.activities ?? [];
}

/** The status text as it was set, even while hidden — for the box you edit it in. */
export function ownStatusDraft(p: Presence | undefined): { text: string; emoji: string; expiresAt: number | null } {
  return { text: p?.status_text ?? "", emoji: p?.status_emoji ?? "", expiresAt: p?.status_expires_at ?? null };
}
