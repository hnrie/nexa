import { create } from "zustand";
import type { Relationship } from "@/api/types";

interface RelationshipsState {
  byUser: Record<string, Relationship>;
  set: (r: Relationship) => void;
  setMany: (list: Relationship[]) => void;
  remove: (userId: string) => void;
  clear: () => void;
}

export const useRelationships = create<RelationshipsState>()((set) => ({
  byUser: {},
  set: (r) => set((s) => ({ byUser: { ...s.byUser, [r.user.id]: r } })),
  setMany: (list) =>
    set(() => {
      const byUser: Record<string, Relationship> = {};
      for (const r of list) byUser[r.user.id] = r;
      return { byUser };
    }),
  remove: (userId) =>
    set((s) => {
      if (!(userId in s.byUser)) return s;
      const byUser = { ...s.byUser };
      delete byUser[userId];
      return { byUser };
    }),
  clear: () => set({ byUser: {} }),
}));

export function isFriend(byUser: Record<string, Relationship>, userId: string): boolean {
  return byUser[userId]?.type === "friend";
}
