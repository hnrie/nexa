import { create } from "zustand";

const TYPING_TTL = 10_000;
/** How often what has run out is cleared while anyone is typing anywhere. */
const SWEEP_MS = 1_000;

interface TypingState {
  byChannel: Record<string, Record<string, number>>;
  add: (channelId: string, userId: string, ts?: number) => void;
  remove: (channelId: string, userId: string) => void;
  sweep: (now?: number) => void;
  clear: () => void;
}

/**
 * Who is typing where, each until the time their typing runs out. Shown in
 * the open conversation's typing line, on the presence dots of the DM list and
 * member lists, and on channels in the server sidebar, so it is swept here
 * rather than by whichever of those happens to be on screen.
 */
export const useTyping = create<TypingState>()((set) => ({
  byChannel: {},
  add: (channelId, userId, ts = Date.now()) => {
    set((s) => ({ byChannel: { ...s.byChannel, [channelId]: { ...(s.byChannel[channelId] ?? {}), [userId]: ts + TYPING_TTL } } }));
    keepSweeping();
  },
  remove: (channelId, userId) =>
    set((s) => {
      const ch = s.byChannel[channelId];
      if (!ch || !(userId in ch)) return s;
      const next = { ...ch };
      delete next[userId];
      return { byChannel: { ...s.byChannel, [channelId]: next } };
    }),
  // A channel whose typing has not changed keeps its object, so whatever
  // shows only that channel (a row of the DM list) is not drawn again.
  sweep: (now = Date.now()) =>
    set((s) => {
      let changed = false;
      const byChannel: Record<string, Record<string, number>> = {};
      for (const [ch, users] of Object.entries(s.byChannel)) {
        const live = Object.entries(users).filter(([, exp]) => exp > now);
        if (live.length === Object.keys(users).length) {
          if (live.length) byChannel[ch] = users;
          else changed = true;
          continue;
        }
        changed = true;
        if (live.length) byChannel[ch] = Object.fromEntries(live);
      }
      return changed ? { byChannel } : s;
    }),
  clear: () => set({ byChannel: {} }),
}));

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Clears what has run out every second, for as long as anyone is typing anywhere. */
function keepSweeping(): void {
  if (sweeper || typeof window === "undefined") return;
  sweeper = setInterval(() => {
    const st = useTyping.getState();
    st.sweep();
    if (Object.keys(useTyping.getState().byChannel).length === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, SWEEP_MS);
}

export function typingUsers(byChannel: Record<string, Record<string, number>>, channelId: string, exclude: string | undefined, now = Date.now()): string[] {
  const ch = byChannel[channelId];
  if (!ch) return [];
  return Object.entries(ch)
    .filter(([u, exp]) => exp > now && u !== exclude)
    .map(([u]) => u);
}

/** Who is typing in one channel, apart from `exclude`; drawn again only when that channel's typing changes. */
export function useTypingIn(channelId: string | null | undefined, exclude: string | undefined): string[] {
  const users = useTyping((t) => (channelId ? t.byChannel[channelId] : undefined));
  if (!users) return [];
  const now = Date.now();
  return Object.entries(users)
    .filter(([u, exp]) => exp > now && u !== exclude)
    .map(([u]) => u);
}
