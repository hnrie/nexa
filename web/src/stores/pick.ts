import { create } from "zustand";

/**
 * Picking several rows of a list to act on them together: conversations in
 * the DM list, servers in the rail, people in the friends list. One list is
 * picked from at a time; starting in another starts over.
 *
 * With a mouse, Ctrl (⌘ on a Mac) and a click picks a row, Shift and a click
 * picks every row between it and the last one picked, and a right click on a
 * picked row acts on all of them. On a touch screen a row's menu has Select,
 * which turns the list's rows into things a tap picks (`mode`), each with a
 * circle that fills with a tick.
 */
export type PickList = "dms" | "servers" | "friends" | `members:${string}`;

interface PickState {
  /** The list being picked from; null while nothing is. */
  list: PickList | null;
  /** The rows picked, in the order they were. */
  ids: string[];
  /** Where a Shift-click range starts: the row picked last. */
  anchor: string | null;
  /** Picking by tapping: every row shows its circle and a tap picks it. */
  mode: boolean;
  /** Picks a row, or lets it go; picking in another list starts over. */
  toggle: (list: PickList, id: string) => void;
  /** Picks every row from the last one picked to `to`, in the order the list shows them. */
  range: (list: PickList, order: string[], to: string) => void;
  /** Starts picking by tapping, with `first` picked. */
  start: (list: PickList, first?: string) => void;
  /** Picks exactly these. */
  set: (list: PickList, ids: string[]) => void;
  /** Forgets rows that are gone from the list. */
  drop: (ids: string[]) => void;
  clear: () => void;
}

export const usePick = create<PickState>()((set) => ({
  list: null,
  ids: [],
  anchor: null,
  mode: false,
  toggle: (list, id) =>
    set((s) => {
      const ids = s.list === list ? s.ids : [];
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      // with a mouse, letting the last one go is the end of picking; tapping stays in it
      const mode = s.list === list && s.mode;
      if (next.length === 0 && !mode) return { list: null, ids: [], anchor: null, mode: false };
      return { list, ids: next, anchor: id, mode };
    }),
  range: (list, order, to) =>
    set((s) => {
      const from = s.list === list ? s.anchor : null;
      const a = from ? order.indexOf(from) : -1;
      const b = order.indexOf(to);
      if (b < 0) return s;
      const span = a < 0 ? [to] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
      const ids = s.list === list ? s.ids : [];
      return { list, ids: [...ids, ...span.filter((x) => !ids.includes(x))], anchor: s.list === list && s.anchor ? s.anchor : to, mode: s.list === list && s.mode };
    }),
  start: (list, first) => set({ list, ids: first ? [first] : [], anchor: first ?? null, mode: true }),
  set: (list, ids) => set((s) => ({ list, ids: [...new Set(ids)], anchor: ids[ids.length - 1] ?? null, mode: s.list === list && s.mode })),
  drop: (gone) =>
    set((s) => {
      if (!s.ids.some((id) => gone.includes(id))) return s;
      const ids = s.ids.filter((id) => !gone.includes(id));
      return ids.length || s.mode ? { ids } : { list: null, ids: [], anchor: null, mode: false };
    }),
  clear: () => set({ list: null, ids: [], anchor: null, mode: false }),
}));

/** Whether the rows of `list` show their circles: picking in it, by mouse or by tap. */
export function picking(st: Pick<PickState, "list" | "ids" | "mode">, list: PickList): boolean {
  return st.list === list && (st.mode || st.ids.length > 0);
}

/**
 * What a click on a row of `list` does about picking, before the row's own
 * action: true when it picked (or let go of) the row, and the row should do
 * nothing else. Ctrl or ⌘ picks one, Shift picks a run; a plain click while
 * picking by tap picks too, and while picking by mouse it ends the picking
 * and does what the row does.
 */
export function pickClick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, list: PickList, id: string, order: string[]): boolean {
  const st = usePick.getState();
  // a Mac turns Ctrl and a click into a right click, so there it is ⌘
  if (e.ctrlKey || e.metaKey) {
    st.toggle(list, id);
    return true;
  }
  if (e.shiftKey && st.list === list && st.ids.length > 0) {
    st.range(list, order, id);
    return true;
  }
  if (st.list === list && st.mode) {
    st.toggle(list, id);
    return true;
  }
  if (st.list === list && st.ids.length > 0) st.clear();
  return false;
}
