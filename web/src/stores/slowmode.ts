import { create } from "zustand";

interface SlowmodeState {
  /** When the current user last sent a message per channel (ms). */
  lastSent: Record<string, number>;
  /** A server-reported wait (Retry-After) per channel, as an absolute deadline. */
  until: Record<string, number>;
  markSent: (channelId: string) => void;
  setUntil: (channelId: string, until: number) => void;
  /** Sign-out: the next account's waits are its own. */
  reset: () => void;
}

export const useSlowmode = create<SlowmodeState>()((set) => ({
  lastSent: {},
  until: {},
  markSent: (channelId) => set((s) => ({ lastSent: { ...s.lastSent, [channelId]: Date.now() } })),
  setUntil: (channelId, until) => set((s) => ({ until: { ...s.until, [channelId]: until } })),
  reset: () => set({ lastSent: {}, until: {} }),
}));

/** Seconds left before the user may send again in a slowmode channel. */
export function slowmodeRemaining(st: SlowmodeState, channelId: string, slowmodeSeconds: number, now = Date.now()): number {
  const fromServer = st.until[channelId] ?? 0;
  const fromLocal = slowmodeSeconds > 0 ? (st.lastSent[channelId] ?? 0) + slowmodeSeconds * 1000 : 0;
  return Math.max(0, Math.ceil((Math.max(fromServer, fromLocal) - now) / 1000));
}
