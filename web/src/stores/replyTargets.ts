import { create } from "zustand";
import { messages as messagesApi } from "@/api/messages";
import type { Message } from "@/api/types";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { fetchMissingUsers } from "./users";

/**
 * The messages replies point at, kept apart from the stretch of conversation
 * that is loaded. A reply's original is usually somewhere the reader has not
 * scrolled to (or has scrolled past, and the list let go of), so quoting it
 * from the loaded messages alone said "deleted or not loaded" about most
 * replies. The server sends each reply's original along with it; anything it
 * did not is fetched, a few at a time.
 */
export type ReplyTarget = DecryptedMessage | "deleted" | "failed";

/** How many originals are kept. The ones looked at least recently go first. */
const MAX = 1000;

interface ReplyTargetsState {
  byId: Record<string, ReplyTarget>;
  /** Keeps these originals, as they are now. */
  seed: (msgs: DecryptedMessage[]) => void;
  /** These messages are gone: replies to them say so. */
  markDeleted: (ids: string[]) => void;
  /** A kept original changed (edited, re-decrypted): the new copy replaces it, where one is kept. */
  refresh: (msg: DecryptedMessage) => void;
  clear: () => void;
}

// Insertion order is recency: an entry used again is moved to the end.
const order = new Map<string, true>();

function touch(id: string): void {
  order.delete(id);
  order.set(id, true);
}

/** Drops the least recently used entries past MAX, from a copy of byId about to be written. */
function trim(byId: Record<string, ReplyTarget>): void {
  while (order.size > MAX) {
    const oldest = order.keys().next().value;
    if (oldest === undefined) break;
    order.delete(oldest);
    delete byId[oldest];
  }
}

export const useReplyTargets = create<ReplyTargetsState>()((set) => ({
  byId: {},
  seed: (msgs) => {
    if (msgs.length === 0) return;
    set((s) => {
      const byId = { ...s.byId };
      for (const m of msgs) {
        byId[m.id] = m;
        touch(m.id);
      }
      trim(byId);
      return { byId };
    });
  },
  markDeleted: (ids) => {
    if (ids.length === 0) return;
    set((s) => {
      const byId = { ...s.byId };
      for (const id of ids) {
        byId[id] = "deleted";
        touch(id);
      }
      trim(byId);
      return { byId };
    });
  },
  refresh: (msg) =>
    set((s) => {
      if (!(msg.id in s.byId)) return s;
      return { byId: { ...s.byId, [msg.id]: msg } };
    }),
  clear: () => {
    order.clear();
    pendingFetch.clear();
    set({ byId: {} });
  },
}));

/** Marks an original as read again, so it outlives ones nobody has looked at. */
export function usedReplyTarget(id: string): void {
  if (order.has(id)) touch(id);
}

/**
 * Takes the originals that came with messages from the server
 * (`referenced_message`): decrypted and kept, or noted as deleted. Messages
 * that came without one are left for `requestReplyTarget`.
 */
export async function ingestReferences(msgs: readonly Message[]): Promise<void> {
  const found: Message[] = [];
  const gone: string[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    const ref = m.referenced_message;
    if (!m.reply_to_id || ref === undefined || seen.has(m.reply_to_id)) continue;
    seen.add(m.reply_to_id);
    if (ref === null) gone.push(m.reply_to_id);
    else if (ref.id === m.reply_to_id && ref.channel_id === m.channel_id) found.push(ref);
  }
  const store = useReplyTargets.getState();
  if (gone.length) store.markDeleted(gone);
  if (found.length === 0) return;
  fetchMissingUsers(found.map((m) => m.author_id));
  store.seed(await Promise.all(found.map(decryptForStore)));
}

/** Originals still to fetch, by channel, and whether a fetch is already on its way for each. */
const pendingFetch = new Map<string, Set<string>>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Asks for an original nobody sent along: gathered for a moment so a screen of
 * replies is one request per channel, not one each.
 */
export function requestReplyTarget(channelId: string, messageId: string): void {
  const key = `${channelId}:${messageId}`;
  if (inFlight.has(key) || useReplyTargets.getState().byId[messageId] !== undefined) return;
  let set = pendingFetch.get(channelId);
  if (!set) {
    set = new Set();
    pendingFetch.set(channelId, set);
  }
  set.add(messageId);
  if (!flushTimer) flushTimer = setTimeout(flush, 40);
}

function flush(): void {
  flushTimer = null;
  const work = [...pendingFetch.entries()];
  pendingFetch.clear();
  for (const [channelId, ids] of work) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 100) void fetchBatch(channelId, list.slice(i, i + 100));
  }
}

async function fetchBatch(channelId: string, ids: string[]): Promise<void> {
  const keys = ids.map((id) => `${channelId}:${id}`);
  for (const k of keys) inFlight.add(k);
  try {
    const found = await messagesApi.byIds(channelId, ids);
    void ingestReferences(found);
    const decrypted = await Promise.all(found.map(decryptForStore));
    fetchMissingUsers(decrypted.map((m) => m.author_id));
    const store = useReplyTargets.getState();
    store.seed(decrypted);
    const have = new Set(found.map((m) => m.id));
    store.markDeleted(ids.filter((id) => !have.has(id)));
  } catch {
    // Said as "could not be loaded", not as deleted: it may well be there.
    // Pointing at the reply again (or opening it) tries once more.
    useReplyTargets.setState((s) => {
      const byId = { ...s.byId };
      for (const id of ids) if (byId[id] === undefined) byId[id] = "failed";
      return { byId };
    });
  } finally {
    for (const k of keys) inFlight.delete(k);
  }
}

/** Forgets a failure, so the next look tries again. */
export function retryReplyTarget(channelId: string, messageId: string): void {
  useReplyTargets.setState((s) => {
    if (s.byId[messageId] !== "failed") return s;
    const byId = { ...s.byId };
    delete byId[messageId];
    return { byId };
  });
  requestReplyTarget(channelId, messageId);
}

/** Opens again the kept originals a key has just arrived for. */
export async function redecryptReplyTargets(predicate: (m: DecryptedMessage) => boolean): Promise<void> {
  const waiting = Object.values(useReplyTargets.getState().byId).filter((m): m is DecryptedMessage => typeof m === "object" && predicate(m));
  if (waiting.length === 0) return;
  const done = await Promise.all(waiting.map(decryptForStore));
  useReplyTargets.setState((s) => {
    const byId = { ...s.byId };
    for (const m of done) if (m.id in byId) byId[m.id] = m;
    return { byId };
  });
}
