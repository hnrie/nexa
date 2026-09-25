import { create } from "zustand";
import { fetchMissingUsers } from "./users";
import { messages as messagesApi } from "@/api/messages";
import type { Message, ReactionSummary } from "@/api/types";
import type { MessagePayload } from "@/crypto/message";
import { decryptForStore, type DecryptedMessage, type DecryptError } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";

/** Authors of loaded history may no longer be members or friends; fetch the ones the users store lacks. */
function resolveAuthors(msgs: { author_id: string; mentions?: string[] }[]): void {
  fetchMissingUsers(msgs.flatMap((m) => [m.author_id, ...(m.mentions ?? [])]));
}

export type { DecryptedMessage };

/** A message's files on their way up, shown in its place in the list until it is sent. */
export interface PendingUpload {
  files: { id: string; name: string; size: number; type: string; preview: string | null }[];
  /** Bytes of the files up so far, of `total`. */
  loaded: number;
  total: number;
  /** Bytes a second, smoothed. */
  speed: number;
  /** Every file is up; the message itself is on its way. */
  done: boolean;
  /** Why the files could not go up. */
  error: string | null;
}

export interface PendingMessage {
  tmpId: string;
  nonce: string;
  channelId: string;
  authorId: string;
  payload: MessagePayload;
  createdAt: number;
  status: "sending" | "failed";
  replyToId?: string;
  /** The reply's ping choice and the message flags, so a retry sends what was chosen. */
  ping?: boolean;
  flags?: number;
  /** Files still going up with it. */
  upload?: PendingUpload;
}

export interface ChannelMessages {
  ids: string[];
  byId: Record<string, DecryptedMessage>;
  hasOlder: boolean;
  /** The list stops short of the newest message, after a jump far back into history. */
  hasNewer: boolean;
  loading: boolean;
  loaded: boolean;
  /** First-page loads that failed in a row, so the list can back off instead of asking again at once. */
  failed: number;
  pending: PendingMessage[];
}

const PAGE = 50;
// Pages of already-loaded history read again after a reconnect. Past this the
// older end of a very long reading session is left as it was.
const REFRESH_PAGES = 10;

const emptyChannel = (): ChannelMessages => ({ ids: [], byId: {}, hasOlder: true, hasNewer: false, loading: false, loaded: false, failed: 0, pending: [] });

// A load started before its channel was cleared or sent back to the present
// must not write its page into the fresh list, or the list would show two
// unrelated stretches of history as if they were one.
const generations = new Map<string, number>();
const generation = (channelId: string): number => generations.get(channelId) ?? 0;
const nextGeneration = (channelId: string): void => {
  generations.set(channelId, generation(channelId) + 1);
};

interface MessagesState {
  channels: Record<string, ChannelMessages>;
  ensure: (channelId: string) => ChannelMessages;
  insert: (channelId: string, msgs: DecryptedMessage[]) => void;
  /**
   * Puts a message in and takes its unsent copy out together. Two steps would
   * leave one frame showing both, or neither, which reads as a flicker.
   */
  settle: (channelId: string, msgs: DecryptedMessage[], drop: { tmpId?: string; nonce?: string }) => void;
  update: (channelId: string, msg: DecryptedMessage) => void;
  remove: (channelId: string, id: string) => void;
  removeMany: (channelId: string, ids: string[]) => void;
  setReaction: (channelId: string, messageId: string, emoji: string, userId: string, add: boolean, isMe: boolean) => void;
  setDecryption: (channelId: string, id: string, payload: MessagePayload | undefined, error: DecryptError | undefined) => void;
  setFlags: (channelId: string, id: string, flags: number) => void;
  setLoading: (channelId: string, loading: boolean) => void;
  setHasOlder: (channelId: string, hasOlder: boolean) => void;
  addPending: (p: PendingMessage) => void;
  removePending: (channelId: string, tmpId: string) => void;
  failPending: (channelId: string, tmpId: string) => void;
  updatePending: (channelId: string, tmpId: string, patch: Partial<PendingMessage>) => void;
  resolvePendingByNonce: (channelId: string, nonce: string) => void;
  clearChannel: (channelId: string) => void;
  /** Forgets every conversation's messages but those of the channels in `keep`. */
  clearAll: (keep?: Iterable<string>) => void;
  loadInitial: (channelId: string) => Promise<void>;
  /** Fills in whatever arrived while the socket was down, keeping what is on screen. */
  syncGap: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  loadAround: (channelId: string, messageId: string) => Promise<void>;
  loadNewer: (channelId: string) => Promise<void>;
  /** Drops a list that stops short of the newest message so the newest page loads again. Unsent messages stay. */
  returnToPresent: (channelId: string) => void;
  redecrypt: (predicate: (m: DecryptedMessage) => boolean) => Promise<void>;
}

function withChannel(s: MessagesState, channelId: string, fn: (c: ChannelMessages) => ChannelMessages): Partial<MessagesState> {
  const cur = s.channels[channelId] ?? emptyChannel();
  const next = fn(cur);
  // Unchanged means unchanged. Writing the entry back anyway built a new map on
  // every no-op, waking everything that watches the whole of it, and put a
  // fresh empty record back for channels that had just been deleted — which
  // then read as channels the store has.
  if (next === cur) return { channels: s.channels };
  return { channels: { ...s.channels, [channelId]: next } };
}

/** Adds messages to a list, keeping ids ascending and unique. */
function put(c: ChannelMessages, msgs: DecryptedMessage[]): ChannelMessages {
  if (msgs.length === 0) return c;
  const byId = { ...c.byId };
  const fresh: string[] = [];
  for (const m of msgs) {
    if (!(m.id in byId)) fresh.push(m.id);
    byId[m.id] = m;
  }
  return { ...c, byId, ids: mergeIds(c.ids, fresh) };
}

/**
 * Adds messages that have just arrived. A list that stops short of the present
 * cannot take messages past its end, because the ones in between are missing;
 * they come with the newer pages instead.
 */
/**
 * How many live messages a conversation nobody has opened keeps. Every
 * message anywhere arrives over the gateway; kept in full, a device left
 * connected for days held every message of every busy channel, decrypted,
 * and walked all of them again on each key grant. The newest few are enough
 * for what reads them before the conversation is opened (a mention taken
 * back, a notification); opening it loads its first page as usual.
 */
const UNOPENED_KEEP = 50;

function keepNewest(c: ChannelMessages, n: number): ChannelMessages {
  if (c.ids.length <= n) return c;
  const drop = c.ids.slice(0, c.ids.length - n);
  const byId = { ...c.byId };
  for (const id of drop) delete byId[id];
  return { ...c, ids: c.ids.slice(-n), byId };
}

function arrived(c: ChannelMessages, msgs: DecryptedMessage[]): ChannelMessages {
  const newest = c.ids[c.ids.length - 1];
  if (!c.hasNewer || !newest) return put(c, msgs);
  return put(c, msgs.filter((m) => compareIds(m.id, newest) <= 0));
}

/** The server's copy of a loaded message, reusing the decryption, and the object itself when nothing changed. */
async function refreshed(prev: DecryptedMessage, m: Message): Promise<DecryptedMessage> {
  if (prev.edited_at !== m.edited_at || JSON.stringify(prev.ciphertext) !== JSON.stringify(m.ciphertext)) return decryptForStore(m);
  if (prev.flags === m.flags && JSON.stringify(prev.reactions) === JSON.stringify(m.reactions) && JSON.stringify(prev.attachments) === JSON.stringify(m.attachments)) return prev;
  const next: DecryptedMessage = { ...m };
  if (prev.payload !== undefined) next.payload = prev.payload;
  if (prev.decryptError !== undefined) next.decryptError = prev.decryptError;
  return next;
}

function mergeIds(existing: string[], added: string[]): string[] {
  if (added.length === 0) return existing;
  const last = existing[existing.length - 1];
  if (added.length === 1 && added[0] !== undefined && (last === undefined || compareIds(added[0], last) > 0)) {
    return [...existing, added[0]];
  }
  const set = new Set(existing);
  const out = existing.slice();
  for (const id of added) {
    if (!set.has(id)) {
      set.add(id);
      out.push(id);
    }
  }
  out.sort(compareIds);
  return out;
}

export const useMessages = create<MessagesState>()((set, get) => ({
  channels: {},
  ensure: (channelId) => get().channels[channelId] ?? emptyChannel(),
  insert: (channelId, msgs) => {
    if (msgs.length === 0) return;
    resolveAuthors(msgs);
    set((s) => withChannel(s, channelId, (c) => (c.loaded ? arrived(c, msgs) : keepNewest(arrived(c, msgs), UNOPENED_KEEP))));
  },
  settle: (channelId, msgs, drop) => {
    resolveAuthors(msgs);
    set((s) =>
      withChannel(s, channelId, (c) => {
        const kept = c.pending.filter((p) => (drop.tmpId ? p.tmpId !== drop.tmpId : true) && (drop.nonce ? p.nonce !== drop.nonce : true));
        const next = arrived(c, msgs);
        return kept.length === c.pending.length ? next : { ...next, pending: kept };
      }),
    );
  },

  update: (channelId, msg) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        const prev = c.byId[msg.id];
        if (!prev) return c;
        // The edited copy carries the editor's own "me" flags on its reactions,
        // so the reactions already here stay; their own events keep them current.
        return { ...c, byId: { ...c.byId, [msg.id]: { ...msg, reactions: prev.reactions } } };
      }),
    ),
  remove: (channelId, id) => get().removeMany(channelId, [id]),
  removeMany: (channelId, ids) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        const drop = new Set(ids);
        if (!c.ids.some((id) => drop.has(id))) return c;
        const byId = { ...c.byId };
        for (const id of ids) delete byId[id];
        return { ...c, byId, ids: c.ids.filter((id) => !drop.has(id)) };
      }),
    ),
  setReaction: (channelId, messageId, emoji, _userId, add, isMe) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        const m = c.byId[messageId];
        if (!m) return c;
        const reactions: ReactionSummary[] = m.reactions.map((r) => ({ ...r }));
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        // your own add arrives twice: once optimistically, once as the echo,
        // so the "me" flag decides whether it has already been counted
        if (add) {
          if (idx >= 0) {
            const r = reactions[idx]!;
            if (isMe && r.me) return c;
            r.count += 1;
            if (isMe) r.me = true;
          } else {
            reactions.push({ emoji, count: 1, me: isMe });
          }
        } else if (idx >= 0) {
          const r = reactions[idx]!;
          if (isMe && !r.me) return c;
          r.count -= 1;
          if (isMe) r.me = false;
          if (r.count <= 0) reactions.splice(idx, 1);
        }
        return { ...c, byId: { ...c.byId, [messageId]: { ...m, reactions } } };
      }),
    ),
  setDecryption: (channelId, id, payload, error) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        const m = c.byId[id];
        if (!m) return c;
        const next: DecryptedMessage = { ...m };
        if (payload !== undefined) next.payload = payload;
        else delete next.payload;
        if (error !== undefined) next.decryptError = error;
        else delete next.decryptError;
        return { ...c, byId: { ...c.byId, [id]: next } };
      }),
    ),
  setFlags: (channelId, id, flags) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        const m = c.byId[id];
        if (!m) return c;
        return { ...c, byId: { ...c.byId, [id]: { ...m, flags } } };
      }),
    ),
  setLoading: (channelId, loading) => set((s) => withChannel(s, channelId, (c) => ({ ...c, loading }))),
  setHasOlder: (channelId, hasOlder) => set((s) => withChannel(s, channelId, (c) => ({ ...c, hasOlder }))),
  addPending: (p) => set((s) => withChannel(s, p.channelId, (c) => ({ ...c, pending: [...c.pending, p] }))),
  removePending: (channelId, tmpId) =>
    set((s) => withChannel(s, channelId, (c) => ({ ...c, pending: c.pending.filter((p) => p.tmpId !== tmpId) }))),
  failPending: (channelId, tmpId) =>
    set((s) =>
      withChannel(s, channelId, (c) => ({ ...c, pending: c.pending.map((p) => (p.tmpId === tmpId ? { ...p, status: "failed" } : p)) })),
    ),
  updatePending: (channelId, tmpId, patch) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        if (!c.pending.some((p) => p.tmpId === tmpId)) return c;
        return { ...c, pending: c.pending.map((p) => (p.tmpId === tmpId ? { ...p, ...patch } : p)) };
      }),
    ),
  resolvePendingByNonce: (channelId, nonce) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        if (!c.pending.some((p) => p.nonce === nonce)) return c;
        return { ...c, pending: c.pending.filter((p) => p.nonce !== nonce) };
      }),
    ),
  clearChannel: (channelId) => {
    nextGeneration(channelId);
    set((s) => {
      const channels = { ...s.channels };
      delete channels[channelId];
      return { channels };
    });
  },
  clearAll: (keep) =>
    set((s) => {
      const spared = new Set(keep ?? []);
      for (const id of Object.keys(s.channels)) if (!spared.has(id)) nextGeneration(id);
      // The channels on screen can be spared, so a reconnect does not throw
      // away the reader's place in them. Messages still being sent stay
      // everywhere, with their uploads, however long the reconnect took.
      const channels: Record<string, ChannelMessages> = {};
      for (const [id, c] of Object.entries(s.channels)) {
        if (spared.has(id)) channels[id] = c;
        else if (c.pending.length) channels[id] = { ...emptyChannel(), pending: c.pending };
      }
      return { channels };
    }),
  returnToPresent: (channelId) => {
    nextGeneration(channelId);
    set((s) => withChannel(s, channelId, (c) => ({ ...emptyChannel(), pending: c.pending })));
  },
  loadInitial: async (channelId) => {
    const cur = get().channels[channelId];
    if (cur?.loaded || cur?.loading) return;
    const gen = generation(channelId);
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      if (generation(channelId) !== gen) return;
      resolveAuthors(decrypted);
      set((s) => withChannel(s, channelId, (c) => ({ ...put(c, decrypted), loaded: true, loading: false, failed: 0, hasOlder: page.length >= PAGE, hasNewer: false })));
    } catch {
      // Counted rather than thrown: the list shows the failure and tries again
      // after a growing pause, instead of asking again the moment loading ends.
      if (generation(channelId) === gen) set((s) => withChannel(s, channelId, (c) => ({ ...c, loading: false, failed: c.failed + 1 })));
    }
  },
  syncGap: async (channelId) => {
    const cur = get().channels[channelId];
    const newest = cur?.ids[cur.ids.length - 1];
    const oldest = cur?.ids[0];
    if (!cur?.loaded || !newest || !oldest) {
      await get().loadInitial(channelId);
      return;
    }
    const gen = generation(channelId);
    try {
      // A list that stops short of the present has no gap at its end to fill;
      // scrolling down brings the newer pages.
      if (!cur.hasNewer) {
        let after = newest;
        let filled = false;
        // Five pages is more than any short disconnect produces; past that it is
        // cheaper to start again from the newest page than to walk the gap.
        for (let i = 0; i < 5 && !filled; i++) {
          const page = await messagesApi.list(channelId, { after, limit: PAGE });
          const decrypted = await Promise.all(page.map(decryptForStore));
          if (generation(channelId) !== gen) return;
          get().insert(channelId, decrypted);
          filled = page.length < PAGE;
          if (!filled) after = page[page.length - 1]!.id;
        }
        if (!filled) {
          // back to the newest page, keeping what is still being sent: its
          // upload goes on, and the only copy of a failed message's text is here
          get().returnToPresent(channelId);
          await get().loadInitial(channelId);
          return;
        }
      }
      // Messages already on screen may have been edited, deleted or reacted to
      // while the socket was down, and those events are lost. Read the kept
      // stretch again, newest first, and bring it in line with the server.
      let before = (BigInt(newest) + 1n).toString();
      for (let i = 0; i < REFRESH_PAGES; i++) {
        const page = await messagesApi.list(channelId, { before, limit: PAGE });
        if (generation(channelId) !== gen) return;
        const known = get().channels[channelId]?.byId ?? {};
        const fresh = await Promise.all(page.filter((m) => known[m.id]).map((m) => refreshed(known[m.id]!, m)));
        if (generation(channelId) !== gen) return;
        const upto = before;
        // A short page reaches the start of the channel, so everything below it is covered too.
        const floor = page.length >= PAGE ? page[0]!.id : null;
        const returned = new Set(page.map((m) => m.id));
        set((s) =>
          withChannel(s, channelId, (c) => {
            const gone = c.ids.filter((id) => compareIds(id, upto) < 0 && (floor === null || compareIds(id, floor) >= 0) && !returned.has(id));
            // A copy changed by a live event since the page was read is newer than the page.
            const changed = fresh.filter((m) => m !== known[m.id] && c.byId[m.id] === known[m.id]);
            if (gone.length === 0 && changed.length === 0) return c;
            const byId = { ...c.byId };
            for (const m of changed) byId[m.id] = m;
            for (const id of gone) delete byId[id];
            const drop = new Set(gone);
            return { ...c, byId, ids: gone.length > 0 ? c.ids.filter((id) => !drop.has(id)) : c.ids };
          }),
        );
        if (floor === null || compareIds(floor, oldest) <= 0) return;
        before = floor;
      }
    } catch {
      // A request that fails part-way down the walk leaves a hole between what
      // was on screen and what arrived after it, with nothing to say so. The
      // newest page again is the same fallback a gap too wide to walk takes.
      if (generation(channelId) !== gen) return;
      get().returnToPresent(channelId);
      await get().loadInitial(channelId);
    }
  },
  loadOlder: async (channelId) => {
    const cur = get().channels[channelId];
    if (!cur || cur.loading || !cur.hasOlder) return;
    const oldest = cur.ids[0];
    if (!oldest) return get().loadInitial(channelId);
    const gen = generation(channelId);
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { before: oldest, limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      if (generation(channelId) !== gen) return;
      get().setHasOlder(channelId, page.length >= PAGE);
      get().insert(channelId, decrypted);
    } finally {
      if (generation(channelId) === gen) get().setLoading(channelId, false);
    }
  },
  loadNewer: async (channelId) => {
    const cur = get().channels[channelId];
    const newest = cur?.ids[cur.ids.length - 1];
    if (!cur || cur.loading || !cur.hasNewer || !newest) return;
    const gen = generation(channelId);
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { after: newest, limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      if (generation(channelId) !== gen) return;
      resolveAuthors(decrypted);
      set((s) => withChannel(s, channelId, (c) => ({ ...put(c, decrypted), hasNewer: page.length >= PAGE })));
    } finally {
      if (generation(channelId) === gen) get().setLoading(channelId, false);
    }
  },
  loadAround: async (channelId, messageId) => {
    const gen = generation(channelId);
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { around: messageId, limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      if (generation(channelId) !== gen) return;
      resolveAuthors(decrypted);
      // The server sends up to half a page from before the target and the rest
      // from the target on; a short side means that end of the channel is in the page.
      const from = page.filter((m) => compareIds(m.id, messageId) >= 0).length;
      const reachesPresent = from < PAGE - PAGE / 2;
      const reachesStart = page.length - from < PAGE / 2;
      set((s) =>
        withChannel(s, channelId, (c) => {
          const first = decrypted[0];
          const last = decrypted[decrypted.length - 1];
          const oldest = c.ids[0];
          const newest = c.ids[c.ids.length - 1];
          if (!first || !last) return { ...c, loaded: true };
          const overlaps = !!oldest && !!newest && compareIds(first.id, newest) <= 0 && compareIds(last.id, oldest) >= 0;
          if (overlaps || (reachesPresent && !c.hasNewer)) {
            return {
              ...put(c, decrypted),
              loaded: true,
              hasOlder: !oldest || compareIds(first.id, oldest) <= 0 ? !reachesStart : c.hasOlder,
              hasNewer: c.hasNewer && !reachesPresent,
            };
          }
          // The page is not next to what is loaded. Joining the two would hide
          // everything in between, so the page replaces the list and the rest
          // loads as the reader scrolls either way.
          return { ...put({ ...c, ids: [], byId: {} }, decrypted), loaded: true, hasOlder: !reachesStart, hasNewer: !reachesPresent };
        }),
      );
    } finally {
      if (generation(channelId) === gen) get().setLoading(channelId, false);
    }
  },
  redecrypt: async (predicate) => {
    const jobs: Promise<{ channelId: string; id: string; payload?: MessagePayload; error?: DecryptError }>[] = [];
    for (const [channelId, c] of Object.entries(get().channels)) {
      for (const id of c.ids) {
        const m = c.byId[id];
        if (!m || !predicate(m)) continue;
        jobs.push(decryptForStore(m).then((d) => ({ channelId, id, ...(d.payload !== undefined ? { payload: d.payload } : {}), ...(d.decryptError !== undefined ? { error: d.decryptError } : {}) })));
      }
    }
    if (jobs.length === 0) return;
    const done = await Promise.all(jobs);
    // One write for all of them. A grant arriving for a conversation with a
    // couple of thousand loaded messages used to be a couple of thousand store
    // writes, each waking every subscriber, and the tab stopped for seconds.
    set((s) => {
      const rebuilt = new Map<string, Record<string, DecryptedMessage>>();
      for (const r of done) {
        const c = s.channels[r.channelId];
        if (!c) continue;
        let byId = rebuilt.get(r.channelId);
        if (!byId) {
          byId = { ...c.byId };
          rebuilt.set(r.channelId, byId);
        }
        const m = byId[r.id];
        if (!m) continue;
        const next: DecryptedMessage = { ...m };
        if (r.payload !== undefined) next.payload = r.payload;
        else delete next.payload;
        if (r.error !== undefined) next.decryptError = r.error;
        else delete next.decryptError;
        byId[r.id] = next;
      }
      if (rebuilt.size === 0) return s;
      const channels = { ...s.channels };
      for (const [channelId, byId] of rebuilt) channels[channelId] = { ...channels[channelId]!, byId };
      return { channels };
    });
  },
}));

export function convOf(msg: Message): string | null {
  return msg.key_conv_id;
}
