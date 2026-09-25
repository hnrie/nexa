import { useEffect, useState } from "react";
import { create } from "zustand";
import { nexa as nexaApi, type Announcement, type CaseMessage, type FeedItem, type MemberCase, type NexaState, type People, type Restriction } from "@/api/moderation";

/**
 * The account's side of Nexa: its standing (a mute or ban in force, notices
 * not dismissed yet), its Nexa conversation, and its case threads.
 *
 * The standing comes with the account — on sign-in, on reload and on every
 * reconnect — and changes by gateway event. The conversation and the threads
 * are fetched when they are opened and kept current by the same events.
 */

export interface Thread {
  case: MemberCase;
  messages: CaseMessage[];
}

/** A deletion notice, kept past sign-out so it can be read on the way out. */
export interface DeletedNotice {
  case: MemberCase;
  people: People;
}

interface NexaStore {
  state: NexaState | null;
  people: People;
  /** The conversation, oldest first; null until opened. */
  feed: FeedItem[] | null;
  feedMore: boolean;
  feedLoading: boolean;
  threads: Record<string, Thread>;
  /** Survives reset: shown over the sign-in page after a moderator deletes the account. */
  deleted: DeletedNotice | null;

  setState: (st: NexaState | null | undefined) => void;
  mergePeople: (p: People | undefined) => void;
  loadFeed: () => Promise<void>;
  loadOlder: () => Promise<void>;
  loadThread: (caseId: string) => Promise<Thread>;
  onNotice: (c: MemberCase, people: People, st: NexaState) => void;
  onCase: (c: MemberCase, messages: CaseMessage[], people: People, st: NexaState) => void;
  onAnnouncement: (a: Announcement, people: People) => void;
  onAnnouncementGone: (id: string) => void;
  reply: (caseId: string, body: string) => Promise<void>;
  markThreadRead: (caseId: string) => void;
  markSeen: () => void;
  ack: (caseId: string) => Promise<void>;
  dismissDeleted: () => void;
  /** Forgets the account's Nexa state on sign-out; a deletion notice stays. */
  reset: () => void;
}

/** Orders a feed oldest first; notices of the same moment keep their order. */
function sortFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => a.at - b.at);
}

function feedKey(it: FeedItem): string {
  return it.kind === "announcement" ? `a:${it.announcement.id}` : `${it.kind}:${it.case.id}`;
}

/** Puts items into a feed, replacing the ones already there. */
function mergeFeed(feed: FeedItem[], items: FeedItem[]): FeedItem[] {
  const byKey = new Map(feed.map((it) => [feedKey(it), it]));
  for (const it of items) byKey.set(feedKey(it), it);
  return sortFeed([...byKey.values()]);
}

/** A case changed: every feed item about it shows the new state, and a lift gets its own item. */
function caseIntoFeed(feed: FeedItem[] | null, c: MemberCase): FeedItem[] | null {
  if (!feed) return feed;
  const items: FeedItem[] = [{ kind: "notice", at: c.created_at, case: c }];
  if (c.lifted_at) items.push({ kind: "lift", at: c.lifted_at, case: c });
  return mergeFeed(feed, items);
}

function appendLines(existing: CaseMessage[], lines: CaseMessage[]): CaseMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const out = [...existing];
  for (const m of lines) if (!seen.has(m.id)) out.push(m);
  return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

let feedRequest: Promise<void> | null = null;
/** Moves on at sign-out, so an answer still on its way is not written into the next account's store. */
let generation = 0;

export const useNexa = create<NexaStore>()((set, get) => ({
  state: null,
  people: {},
  feed: null,
  feedMore: false,
  feedLoading: false,
  threads: {},
  deleted: null,

  setState: (st) => {
    if (!st) return;
    set((s) => ({ state: st, people: { ...s.people, ...st.people } }));
  },

  mergePeople: (p) => {
    if (!p) return;
    set((s) => ({ people: { ...s.people, ...p } }));
  },

  loadFeed: async () => {
    if (feedRequest) return feedRequest;
    set({ feedLoading: true });
    const gen = generation;
    feedRequest = (async () => {
      try {
        const r = await nexaApi.feed();
        if (gen !== generation) return;
        set((s) => ({ feed: sortFeed(r.items), feedMore: r.has_more, people: { ...s.people, ...r.people } }));
      } finally {
        set({ feedLoading: false });
        feedRequest = null;
      }
    })();
    return feedRequest;
  },

  loadOlder: async () => {
    const { feed, feedMore, feedLoading } = get();
    if (!feed || !feedMore || feedLoading || feed.length === 0) return;
    set({ feedLoading: true });
    const gen = generation;
    try {
      const r = await nexaApi.feed(feed[0]!.at);
      if (gen !== generation) return;
      set((s) => ({ feed: mergeFeed(s.feed ?? [], r.items), feedMore: r.has_more, people: { ...s.people, ...r.people } }));
    } finally {
      set({ feedLoading: false });
    }
  },

  loadThread: async (caseId) => {
    const gen = generation;
    const r = await nexaApi.thread(caseId);
    const thread: Thread = { case: r.case, messages: r.messages };
    // an answer for an account that has since signed out is not the next one's to show
    if (gen !== generation) return thread;
    set((s) => ({ threads: { ...s.threads, [caseId]: thread }, people: { ...s.people, ...r.people }, feed: caseIntoFeed(s.feed, r.case) }));
    return thread;
  },

  onNotice: (c, people, st) => {
    set((s) => ({
      state: st,
      people: { ...s.people, ...people, ...st.people },
      feed: caseIntoFeed(s.feed, c),
      threads: s.threads[c.id] ? { ...s.threads, [c.id]: { ...s.threads[c.id]!, case: c } } : s.threads,
      deleted: c.action === "delete" ? { case: c, people: { ...s.people, ...people } } : s.deleted,
    }));
  },

  onCase: (c, messages, people, st) => {
    set((s) => {
      const open = s.threads[c.id];
      return {
        state: st,
        people: { ...s.people, ...people, ...st.people },
        feed: caseIntoFeed(s.feed, c),
        threads: open ? { ...s.threads, [c.id]: { case: c, messages: appendLines(open.messages, messages) } } : s.threads,
      };
    });
  },

  onAnnouncement: (a, people) => {
    set((s) => ({
      people: { ...s.people, ...people },
      feed: s.feed ? mergeFeed(s.feed, [{ kind: "announcement", at: a.created_at, announcement: a }]) : s.feed,
      state: s.state ? { ...s.state, unread: s.state.unread + 1, latest: Math.max(s.state.latest, a.created_at) } : s.state,
    }));
  },

  onAnnouncementGone: (id) => {
    set((s) => ({ feed: s.feed ? s.feed.filter((it) => !(it.kind === "announcement" && it.announcement.id === id)) : s.feed }));
  },

  reply: async (caseId, body) => {
    const r = await nexaApi.reply(caseId, body);
    set((s) => {
      const open = s.threads[caseId];
      return {
        threads: { ...s.threads, [caseId]: { case: r.case, messages: appendLines(open?.messages ?? [], r.messages) } },
        feed: caseIntoFeed(s.feed, r.case),
      };
    });
  },

  markThreadRead: (caseId) => {
    const t = get().threads[caseId];
    if (!t || t.case.unread === 0) return;
    const last = t.messages[t.messages.length - 1];
    if (!last) return;
    set((s) => ({ threads: { ...s.threads, [caseId]: { ...t, case: { ...t.case, unread: 0 } } } }));
    void nexaApi.read(caseId, last.id).catch(() => undefined);
  },

  markSeen: () => {
    const st = get().state;
    if (!st || st.unread === 0) return;
    void nexaApi.seen().catch(() => undefined);
  },

  ack: async (caseId) => {
    // gone from the queue at once; the server's answer comes back as nexa_state
    set((s) => (s.state ? { state: { ...s.state, pending: s.state.pending.filter((c) => c.id !== caseId) } } : s));
    await nexaApi.ack(caseId);
  },

  dismissDeleted: () => set({ deleted: null }),

  reset: () => {
    generation += 1;
    feedRequest = null;
    set({ state: null, people: {}, feed: null, feedMore: false, feedLoading: false, threads: {} });
  },
}));

/** The mute in force on this account, if its time has not run out. */
export function activeMute(st: NexaState | null, now = Date.now()): Restriction | null {
  const m = st?.mute;
  return m && (m.expires_at === null || m.expires_at > now) ? m : null;
}

/** The ban in force on this account, if its time has not run out. */
export function activeBan(st: NexaState | null, now = Date.now()): Restriction | null {
  const b = st?.ban;
  return b && (b.expires_at === null || b.expires_at > now) ? b : null;
}

/**
 * A restriction on this account, as a component should see it: gone the
 * moment its time runs out, without waiting for the server to say so.
 */
function useTimed(pick: (st: NexaState | null, now: number) => Restriction | null): Restriction | null {
  const st = useNexa((s) => s.state);
  const [now, setNow] = useState(() => Date.now());
  const r = pick(st, now);
  const until = r?.expires_at ?? null;
  useEffect(() => {
    if (until === null) return;
    // timers cannot wait longer than about 24 days; a longer one wakes and waits again
    const wait = Math.min(Math.max(0, until - Date.now()) + 250, 2 ** 31 - 1);
    const h = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(h);
  }, [until, now]);
  return r;
}

/** The mute in force on this account, or null. */
export function useMute(): Restriction | null {
  return useTimed(activeMute);
}

/** The ban in force on this account, or null. */
export function useBan(): Restriction | null {
  return useTimed(activeBan);
}
