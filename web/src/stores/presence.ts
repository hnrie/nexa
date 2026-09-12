import { create } from "zustand";
import type { Presence } from "@/api/types";

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

export function customStatus(p: Presence | undefined): { text: string; emoji: string } | null {
  if (!p) return null;
  if (p.status_expires_at !== null && p.status_expires_at < Date.now()) return null;
  if (!p.status_text && !p.status_emoji) return null;
  return { text: p.status_text, emoji: p.status_emoji };
}
