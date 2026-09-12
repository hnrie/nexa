import { create } from "zustand";

const TYPING_TTL = 10_000;

interface TypingState {
  byChannel: Record<string, Record<string, number>>;
  add: (channelId: string, userId: string, ts?: number) => void;
  remove: (channelId: string, userId: string) => void;
  sweep: (now?: number) => void;
  clear: () => void;
}

export const useTyping = create<TypingState>()((set) => ({
  byChannel: {},
  add: (channelId, userId, ts = Date.now()) =>
    set((s) => ({ byChannel: { ...s.byChannel, [channelId]: { ...(s.byChannel[channelId] ?? {}), [userId]: ts + TYPING_TTL } } })),
  remove: (channelId, userId) =>
    set((s) => {
      const ch = s.byChannel[channelId];
      if (!ch || !(userId in ch)) return s;
      const next = { ...ch };
      delete next[userId];
      return { byChannel: { ...s.byChannel, [channelId]: next } };
    }),
  sweep: (now = Date.now()) =>
    set((s) => {
      let changed = false;
      const byChannel: Record<string, Record<string, number>> = {};
      for (const [ch, users] of Object.entries(s.byChannel)) {
        const kept: Record<string, number> = {};
        for (const [u, exp] of Object.entries(users)) {
          if (exp > now) kept[u] = exp;
          else changed = true;
        }
        byChannel[ch] = kept;
      }
      return changed ? { byChannel } : s;
    }),
  clear: () => set({ byChannel: {} }),
}));

export function typingUsers(byChannel: Record<string, Record<string, number>>, channelId: string, exclude: string | undefined, now = Date.now()): string[] {
  const ch = byChannel[channelId];
  if (!ch) return [];
  return Object.entries(ch)
    .filter(([u, exp]) => exp > now && u !== exclude)
    .map(([u]) => u);
}
