import { create } from "zustand";
import { storage } from "@/lib/storage";

/**
 * Tabs, and the tiles inside them.
 *
 * A tab holds a tree: either one pane, or a split with children that are
 * themselves either panes or splits. That is the whole model — a window
 * manager's, in about forty lines — and it is what lets "split right" work on a
 * pane that is itself already half of a split without any special cases.
 *
 * The pane with focus is not rendered from here. It is rendered by the router,
 * exactly as the single-pane app always was, so deep links, jumping to a
 * message, the back button and everything else that reads the address keep
 * working untouched. The address is the focused pane's channel; the other panes
 * carry their own. Focus moves, the address follows, and the panes swap which
 * of them the router is drawing. See `AppShell`.
 */

export interface Pane {
  id: string;
  serverId: string | null;
  /** null only for the focused pane sitting on Friends, which has no channel. */
  channelId: string | null;
}

export type Tile =
  | { kind: "pane"; id: string }
  | { kind: "split"; id: string; dir: "row" | "column"; children: Tile[]; sizes: number[] };

export interface Tab {
  id: string;
  root: Tile;
  /** The pane inside this tab that the sidebar and the address bar point at. */
  focus: string;
}

/**
 * A chat narrower than this is not a chat any more: the composer wraps to
 * three lines, avatars and names collide, and every message becomes a column
 * of single words. A pane shorter than this shows about two messages.
 */
export const MIN_PANE_W = 380;
export const MIN_PANE_H = 300;
/** Beyond this, tiles are too small to read even on a large screen. */
export const MAX_PANES = 6;

interface PanesState {
  tabs: Tab[];
  active: string;
  panes: Record<string, Pane>;
  /** Kept per pane rather than globally, so one split can show members and the other not. */
  membersOpen: Record<string, boolean>;

  openTab: (serverId: string | null, channelId: string | null, opts?: { background?: boolean }) => string;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  moveTab: (from: number, to: number) => void;
  split: (dir: "row" | "column", serverId: string | null, channelId: string) => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  setPaneChannel: (paneId: string, serverId: string | null, channelId: string | null) => void;
  setSizes: (tileId: string, sizes: number[]) => void;
  setMembersOpen: (paneId: string, open: boolean) => void;
  /** Drops panes whose conversation has gone, and tabs left with none. */
  forgetChannel: (channelId: string) => void;
  /** Sign-out: the next account on this browser starts from one empty tab. */
  reset: () => void;
}

let counter = 0;
const newId = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const KEY = "ec:panes";

// --- the tile tree -------------------------------------------------------

export function panesIn(tile: Tile): string[] {
  if (tile.kind === "pane") return [tile.id];
  return tile.children.flatMap(panesIn);
}

export function findTile(tile: Tile, id: string): Tile | null {
  if (tile.id === id) return tile;
  if (tile.kind === "pane") return null;
  for (const child of tile.children) {
    const hit = findTile(child, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Puts `next` beside `paneId`, splitting along `dir`.
 *
 * A pane inside a split that already runs the same way joins it as another
 * child instead of nesting a second split in it, which is what keeps three
 * chats side by side from becoming one chat beside two stacked ones.
 */
function splitAt(tile: Tile, paneId: string, dir: "row" | "column", next: string): Tile {
  if (tile.kind === "pane") {
    if (tile.id !== paneId) return tile;
    return { kind: "split", id: newId(), dir, children: [tile, { kind: "pane", id: next }], sizes: [0.5, 0.5] };
  }
  const at = tile.children.findIndex((c) => c.kind === "pane" && c.id === paneId);
  if (at >= 0 && tile.dir === dir) {
    const children = [...tile.children];
    children.splice(at + 1, 0, { kind: "pane", id: next });
    // the new one takes half of what its neighbour had, so nothing else moves
    const sizes = [...tile.sizes];
    const half = sizes[at]! / 2;
    sizes[at] = half;
    sizes.splice(at + 1, 0, half);
    return { ...tile, children, sizes };
  }
  return { ...tile, children: tile.children.map((c) => splitAt(c, paneId, dir, next)) };
}

/** Removes a pane, collapsing a split that is left with one child. */
function removePane(tile: Tile, paneId: string): Tile | null {
  if (tile.kind === "pane") return tile.id === paneId ? null : tile;
  const kept: Tile[] = [];
  const sizes: number[] = [];
  tile.children.forEach((child, i) => {
    const left = removePane(child, paneId);
    if (left) {
      kept.push(left);
      sizes.push(tile.sizes[i] ?? 1 / tile.children.length);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...tile, children: kept, sizes: sizes.map((s) => s / total) };
}

function setTileSizes(tile: Tile, id: string, sizes: number[]): Tile {
  if (tile.kind === "pane") return tile;
  if (tile.id === id) return { ...tile, sizes };
  return { ...tile, children: tile.children.map((c) => setTileSizes(c, id, sizes)) };
}

// --- what is remembered between visits -----------------------------------

interface Saved {
  tabs: Tab[];
  active: string;
  panes: Record<string, Pane>;
}

function load(): Saved | null {
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Saved;
    if (!Array.isArray(saved.tabs) || saved.tabs.length === 0 || !saved.panes) return null;
    // A layout written by a newer build, or one truncated by a full disk, must
    // not take the app down on the next visit.
    for (const tab of saved.tabs) {
      if (!tab.root || !tab.id) return null;
      const ids = panesIn(tab.root);
      if (ids.length === 0 || ids.some((id) => !saved.panes[id])) return null;
      if (!ids.includes(tab.focus)) tab.focus = ids[0]!;
    }
    if (!saved.tabs.some((t) => t.id === saved.active)) saved.active = saved.tabs[0]!.id;
    return saved;
  } catch {
    return null;
  }
}

function fresh(): Saved {
  const pane: Pane = { id: newId(), serverId: null, channelId: null };
  const tab: Tab = { id: newId(), root: { kind: "pane", id: pane.id }, focus: pane.id };
  return { tabs: [tab], active: tab.id, panes: { [pane.id]: pane } };
}

export const usePanes = create<PanesState>((set, get) => ({
  ...(load() ?? fresh()),
  membersOpen: {},

  openTab(serverId, channelId, opts) {
    const pane: Pane = { id: newId(), serverId, channelId };
    const tab: Tab = { id: newId(), root: { kind: "pane", id: pane.id }, focus: pane.id };
    set((s) => ({
      tabs: [...s.tabs, tab],
      panes: { ...s.panes, [pane.id]: pane },
      active: opts?.background ? s.active : tab.id,
    }));
    return tab.id;
  },

  closeTab(tabId) {
    set((s) => {
      if (s.tabs.length <= 1) return s;
      const at = s.tabs.findIndex((t) => t.id === tabId);
      if (at < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      const panes = { ...s.panes };
      for (const id of panesIn(s.tabs[at]!.root)) delete panes[id];
      // Chrome hands focus to the tab on the right, and to the left only when
      // the one that closed was last.
      const active = s.active === tabId ? (tabs[Math.min(at, tabs.length - 1)]!.id) : s.active;
      return { tabs, panes, active };
    });
  },

  selectTab(tabId) {
    set({ active: tabId });
  },

  moveTab(from, to) {
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved!);
      return { tabs };
    });
  },

  split(dir, serverId, channelId) {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === s.active);
      if (!tab) return s;
      if (panesIn(tab.root).length >= MAX_PANES) return s;
      const pane: Pane = { id: newId(), serverId, channelId };
      const root = splitAt(tab.root, tab.focus, dir, pane.id);
      return {
        panes: { ...s.panes, [pane.id]: pane },
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focus: pane.id } : t)),
      };
    });
  },

  closePane(paneId) {
    const s = get();
    const tab = s.tabs.find((t) => panesIn(t.root).includes(paneId));
    if (!tab) return;
    const root = removePane(tab.root, paneId);
    // Closing the only pane in a tab closes the tab; the only pane of the only
    // tab is the app itself, and there is nothing behind it to show.
    if (!root) {
      get().closeTab(tab.id);
      return;
    }
    const panes = { ...s.panes };
    delete panes[paneId];
    const left = panesIn(root);
    set({
      panes,
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focus: left.includes(t.focus) ? t.focus : left[0]! } : t)),
    });
  },

  focusPane(paneId) {
    set((s) => {
      // Returning the state untouched is how zustand is told nothing happened.
      // Rebuilding the array regardless woke every listener on every click.
      const tab = s.tabs.find((t) => panesIn(t.root).includes(paneId));
      if (!tab || tab.focus === paneId) return s;
      return { tabs: s.tabs.map((t) => (t === tab ? { ...t, focus: paneId } : t)) };
    });
  },

  setPaneChannel(paneId, serverId, channelId) {
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane || (pane.serverId === serverId && pane.channelId === channelId)) return s;
      return { panes: { ...s.panes, [paneId]: { ...pane, serverId, channelId } } };
    });
  },

  setSizes(tileId, sizes) {
    set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, root: setTileSizes(t.root, tileId, sizes) })) }));
  },

  setMembersOpen(paneId, open) {
    set((s) => ({ membersOpen: { ...s.membersOpen, [paneId]: open } }));
  },

  reset() {
    set({ ...fresh(), membersOpen: {} });
    storage.remove(KEY);
  },

  forgetChannel(channelId) {
    const s = get();
    for (const pane of Object.values(s.panes)) {
      if (pane.channelId !== channelId) continue;
      const tab = s.tabs.find((t) => panesIn(t.root).includes(pane.id));
      // the focused pane follows the address bar, which the caller is about to move
      if (tab && tab.focus === pane.id) continue;
      get().closePane(pane.id);
    }
  },
}));

export function activeTab(s: PanesState): Tab {
  return s.tabs.find((t) => t.id === s.active) ?? s.tabs[0]!;
}

/** The pane the sidebar and the address bar are pointing at. */
export function focusedPane(s: PanesState): Pane | undefined {
  return s.panes[activeTab(s).focus];
}

// Remember the layout, but not on every divider drag: a resize fires these by
// the hundred and localStorage writes are synchronous.
let writing: ReturnType<typeof setTimeout> | null = null;
usePanes.subscribe(() => {
  if (writing) clearTimeout(writing);
  // Reads the store when it writes rather than closing over the state it was
  // told about: a debounce that carries its own copy writes whichever change
  // happened to be last to schedule, which is not the same thing as the last
  // change.
  writing = setTimeout(() => {
    writing = null;
    const s = usePanes.getState();
    storage.set(KEY, JSON.stringify({ tabs: s.tabs, active: s.active, panes: s.panes }));
  }, 400);
});

/** Where the address bar should be for a pane. */
export function paneAddress(pane: Pane | undefined): string {
  if (!pane?.channelId) return "/channels/@me";
  return pane.serverId ? `/channels/${pane.serverId}/${pane.channelId}` : `/channels/@me/${pane.channelId}`;
}
