import { create } from "zustand";
import type { PublicUser } from "@/api/types";

interface UsersState {
  byId: Record<string, PublicUser>;
  upsert: (u: PublicUser | PublicUser[]) => void;
  get: (id: string) => PublicUser | undefined;
  clear: () => void;
}

export const useUsers = create<UsersState>()((set, get) => ({
  byId: {},
  upsert: (u) => {
    const list = Array.isArray(u) ? u : [u];
    if (list.length === 0) return;
    set((s) => {
      const byId = { ...s.byId };
      for (const user of list) byId[user.id] = user;
      return { byId };
    });
  },
  get: (id) => get().byId[id],
  clear: () => set({ byId: {} }),
}));

/** Display name with username fallback. */
export function displayName(u: PublicUser | undefined, fallback = "Unknown User"): string {
  if (!u) return fallback;
  return u.display_name || u.username || fallback;
}
