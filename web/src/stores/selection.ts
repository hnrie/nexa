import { create } from "zustand";

/**
 * Picking several messages of one channel to delete at once. Only one channel
 * is picked from at a time: starting in another starts over.
 */
interface SelectionState {
  /** The channel being picked from; null while nobody is selecting. */
  channelId: string | null;
  picked: Record<string, true>;
  /** Where a Shift-click range starts: the message toggled last. */
  anchor: string | null;
  /** Starts selecting, with `first` picked when it can be deleted. */
  start: (channelId: string, first?: string) => void;
  toggle: (id: string) => void;
  /** Picks every id of a range (already narrowed to deletable messages). */
  addRange: (ids: string[], anchor: string) => void;
  /** Forgets messages that are gone. */
  drop: (ids: string[]) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>()((set) => ({
  channelId: null,
  picked: {},
  anchor: null,
  start: (channelId, first) => set({ channelId, picked: first ? { [first]: true } : {}, anchor: first ?? null }),
  toggle: (id) =>
    set((s) => {
      const picked = { ...s.picked };
      if (picked[id]) delete picked[id];
      else picked[id] = true;
      return { picked, anchor: id };
    }),
  addRange: (ids, anchor) =>
    set((s) => {
      const picked = { ...s.picked };
      for (const id of ids) picked[id] = true;
      return { picked, anchor };
    }),
  drop: (ids) =>
    set((s) => {
      if (!ids.some((id) => s.picked[id])) return s;
      const picked = { ...s.picked };
      for (const id of ids) delete picked[id];
      return { picked };
    }),
  clear: () => set({ channelId: null, picked: {}, anchor: null }),
}));

/** The ids from one message to another in list order, both included. */
export function rangeBetween(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
