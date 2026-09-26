import { create } from "zustand";
import { storage } from "@/lib/storage";
import { useAuth } from "./auth";

/**
 * Tabs, the way a browser has them: each one holds a conversation (or
 * Friends), and one of them is open.
 *
 * The open tab is not rendered from here. It is rendered by the router,
 * exactly as the app without tabs always was, so deep links, jumping to a
 * message, the back button and everything else that reads the address keep
 * working untouched. The address is the open tab's conversation: switching tab
 * moves the address, and moving the address changes what the open tab holds.
 * See `AppShell`.
 */

export interface Tab {
  id: string;
  serverId: string | null;
  /** null only for a tab sitting on Friends, which has no channel. */
  channelId: string | null;
}

interface TabsState {
  tabs: Tab[];
  active: string;

  openTab: (serverId: string | null, channelId: string | null, opts?: { background?: boolean }) => string;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  moveTab: (from: number, to: number) => void;
  setTabChannel: (tabId: string, serverId: string | null, channelId: string | null) => void;
  /** Sign-out: the next account on this browser starts from one empty tab. */
  reset: () => void;
  /** Brings back an account's own tabs (sign-in). */
  restore: (userId: string) => void;
}

let counter = 0;
const newId = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Each account's tabs are its own: kept under its id, and brought back when it
 * signs in, so the next person on a shared browser never starts in the last
 * one's tabs.
 */
const keyFor = (userId: string): string => `ec:tabs:${userId}`;
/** Where tabs were kept while they could hold split panes, per account. */
const panesKeyFor = (userId: string): string => `ec:panes:${userId}`;
/** Where one layout for everybody was kept before that; taken over by the first account to sign in. */
const LEGACY_KEY = "ec:panes";

/** The account whose tabs these are; null while nobody is signed in, when nothing is saved. */
let owner: string | null = null;

// --- what is remembered between visits -----------------------------------

interface Saved {
  tabs: Tab[];
  active: string;
}

const ID = /^\d+$/;
const idOrNull = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

/** The pane ids in a tile tree of the old layout, in the order they were drawn. */
function panesIn(tile: unknown): string[] {
  if (!tile || typeof tile !== "object") return [];
  const t = tile as { kind?: unknown; id?: unknown; children?: unknown };
  if (t.kind === "pane") return typeof t.id === "string" ? [t.id] : [];
  return Array.isArray(t.children) ? t.children.flatMap(panesIn) : [];
}

/**
 * One saved tab, in either shape: a tab of its own, or a tab from when a tab
 * could be split into panes. A split tab keeps the pane that had focus, which
 * is the one its label named and the one the address pointed at.
 */
function readTab(raw: unknown, panes: unknown): Tab | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { id?: unknown; serverId?: unknown; channelId?: unknown; root?: unknown; focus?: unknown };
  if (typeof t.id !== "string" || !t.id) return null;
  if (t.root === undefined) return { id: t.id, serverId: idOrNull(t.serverId), channelId: idOrNull(t.channelId) };
  const byId = panes && typeof panes === "object" ? (panes as Record<string, unknown>) : {};
  const inTab = panesIn(t.root).filter((id) => byId[id] && typeof byId[id] === "object");
  const kept = typeof t.focus === "string" && inTab.includes(t.focus) ? t.focus : inTab[0];
  if (!kept) return null;
  const pane = byId[kept] as { serverId?: unknown; channelId?: unknown };
  return { id: t.id, serverId: idOrNull(pane.serverId), channelId: idOrNull(pane.channelId) };
}

/**
 * Reads saved tabs. Tabs written by another build, or cut short by a full
 * disk, must not take the app down on the next visit: what cannot be read is
 * left out, and nothing readable at all starts the account afresh.
 */
export function readSaved(raw: string): Saved | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { tabs, active, panes } = data as { tabs?: unknown; active?: unknown; panes?: unknown };
  if (!Array.isArray(tabs)) return null;
  const out: Tab[] = [];
  for (const raw of tabs) {
    const tab = readTab(raw, panes);
    if (tab && !out.some((x) => x.id === tab.id)) out.push(tab);
  }
  if (out.length === 0) return null;
  return { tabs: out, active: typeof active === "string" && out.some((x) => x.id === active) ? active : out[0]!.id };
}

function load(userId: string): Saved | null {
  const raw = storage.get(keyFor(userId));
  if (raw) return readSaved(raw);
  // Tabs kept under an older name are moved to this one. The one layout for
  // everybody was removed at every sign-out, so one still there belongs to
  // the account signing in now.
  for (const old of [panesKeyFor(userId), LEGACY_KEY]) {
    const was = storage.get(old);
    if (!was) continue;
    storage.remove(old);
    const saved = readSaved(was);
    if (!saved) continue;
    storage.set(keyFor(userId), JSON.stringify(saved));
    return saved;
  }
  return null;
}

function fresh(): Saved {
  const tab: Tab = { id: newId(), serverId: null, channelId: null };
  return { tabs: [tab], active: tab.id };
}

/** The tabs to start from: the signed-in account's own, when there are some. */
function initial(): Saved {
  owner = useAuth.getState().me?.id ?? null;
  return (owner ? load(owner) : null) ?? fresh();
}

export const useTabs = create<TabsState>((set) => ({
  ...initial(),

  openTab(serverId, channelId, opts) {
    const tab: Tab = { id: newId(), serverId, channelId };
    set((s) => ({ tabs: [...s.tabs, tab], active: opts?.background ? s.active : tab.id }));
    return tab.id;
  },

  closeTab(tabId) {
    set((s) => {
      if (s.tabs.length <= 1) return s;
      const at = s.tabs.findIndex((t) => t.id === tabId);
      if (at < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      // Chrome hands focus to the tab on the right, and to the left only when
      // the one that closed was last.
      const active = s.active === tabId ? tabs[Math.min(at, tabs.length - 1)]!.id : s.active;
      return { tabs, active };
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

  setTabChannel(tabId, serverId, channelId) {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      // Returning the state untouched is how zustand is told nothing happened.
      if (!tab || (tab.serverId === serverId && tab.channelId === channelId)) return s;
      return { tabs: s.tabs.map((t) => (t === tab ? { ...t, serverId, channelId } : t)) };
    });
  },

  reset() {
    owner = null;
    set(fresh());
  },

  restore(userId) {
    owner = userId;
    set(load(userId) ?? fresh());
  },
}));

export function activeTab(s: Pick<TabsState, "tabs" | "active">): Tab {
  return s.tabs.find((t) => t.id === s.active) ?? s.tabs[0]!;
}

// Remember the tabs a moment after they change rather than on every step of
// one change: moving to a tab also moves the address, and localStorage writes
// are synchronous.
let writing: ReturnType<typeof setTimeout> | null = null;
useTabs.subscribe(() => {
  if (writing) clearTimeout(writing);
  // Reads the store when it writes rather than closing over the state it was
  // told about: a debounce that carries its own copy writes whichever change
  // happened to be last to schedule, which is not the same thing as the last
  // change.
  writing = setTimeout(() => {
    writing = null;
    if (!owner) return;
    const s = useTabs.getState();
    storage.set(keyFor(owner), JSON.stringify({ tabs: s.tabs, active: s.active }));
  }, 400);
});

// Signing in brings that account's tabs back before anything is drawn in it:
// the store changes in the same step as the account does.
useAuth.subscribe((a, prev) => {
  const id = a.me?.id ?? null;
  if (id && id !== (prev.me?.id ?? null) && id !== owner) useTabs.getState().restore(id);
});

/** Where the address bar should be for a tab. */
export function tabAddress(tab: Pick<Tab, "serverId" | "channelId"> | undefined): string {
  if (!tab?.channelId) return "/channels/@me";
  return tab.serverId ? `/channels/${tab.serverId}/${tab.channelId}` : `/channels/@me/${tab.channelId}`;
}
