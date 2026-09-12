import { create } from "zustand";
import { messages as messagesApi } from "@/api/messages";
import type { Message, ReactionSummary } from "@/api/types";
import type { MessagePayload } from "@/crypto/message";
import { decryptForStore, type DecryptedMessage, type DecryptError } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";

export type { DecryptedMessage };

export interface PendingMessage {
  tmpId: string;
  nonce: string;
  channelId: string;
  authorId: string;
  payload: MessagePayload;
  createdAt: number;
  status: "sending" | "failed";
  replyToId?: string;
}

export interface ChannelMessages {
  ids: string[];
  byId: Record<string, DecryptedMessage>;
  hasOlder: boolean;
  loading: boolean;
  loaded: boolean;
  pending: PendingMessage[];
}

const PAGE = 50;

const emptyChannel = (): ChannelMessages => ({ ids: [], byId: {}, hasOlder: true, loading: false, loaded: false, pending: [] });

interface MessagesState {
  channels: Record<string, ChannelMessages>;
  ensure: (channelId: string) => ChannelMessages;
  insert: (channelId: string, msgs: DecryptedMessage[]) => void;
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
  resolvePendingByNonce: (channelId: string, nonce: string) => void;
  clearChannel: (channelId: string) => void;
  clearAll: () => void;
  loadInitial: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  loadAround: (channelId: string, messageId: string) => Promise<void>;
  redecrypt: (predicate: (m: DecryptedMessage) => boolean) => Promise<void>;
}

function withChannel(s: MessagesState, channelId: string, fn: (c: ChannelMessages) => ChannelMessages): Partial<MessagesState> {
  const cur = s.channels[channelId] ?? emptyChannel();
  return { channels: { ...s.channels, [channelId]: fn(cur) } };
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
    set((s) =>
      withChannel(s, channelId, (c) => {
        const byId = { ...c.byId };
        const fresh: string[] = [];
        for (const m of msgs) {
          if (!(m.id in byId)) fresh.push(m.id);
          byId[m.id] = m;
        }
        return { ...c, byId, ids: mergeIds(c.ids, fresh) };
      }),
    );
  },
  update: (channelId, msg) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        if (!(msg.id in c.byId)) return c;
        return { ...c, byId: { ...c.byId, [msg.id]: msg } };
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
        if (add) {
          if (idx >= 0) {
            const r = reactions[idx]!;
            r.count += 1;
            if (isMe) r.me = true;
          } else {
            reactions.push({ emoji, count: 1, me: isMe });
          }
        } else if (idx >= 0) {
          const r = reactions[idx]!;
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
  resolvePendingByNonce: (channelId, nonce) =>
    set((s) =>
      withChannel(s, channelId, (c) => {
        if (!c.pending.some((p) => p.nonce === nonce)) return c;
        return { ...c, pending: c.pending.filter((p) => p.nonce !== nonce) };
      }),
    ),
  clearChannel: (channelId) =>
    set((s) => {
      const channels = { ...s.channels };
      delete channels[channelId];
      return { channels };
    }),
  clearAll: () => set({ channels: {} }),
  loadInitial: async (channelId) => {
    const cur = get().channels[channelId];
    if (cur?.loaded || cur?.loading) return;
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      set((s) => withChannel(s, channelId, (c) => ({ ...c, loaded: true, hasOlder: page.length >= PAGE })));
      get().insert(channelId, decrypted);
    } finally {
      get().setLoading(channelId, false);
    }
  },
  loadOlder: async (channelId) => {
    const cur = get().channels[channelId];
    if (!cur || cur.loading || !cur.hasOlder) return;
    const oldest = cur.ids[0];
    if (!oldest) return get().loadInitial(channelId);
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { before: oldest, limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      get().setHasOlder(channelId, page.length >= PAGE);
      get().insert(channelId, decrypted);
    } finally {
      get().setLoading(channelId, false);
    }
  },
  loadAround: async (channelId, messageId) => {
    get().setLoading(channelId, true);
    try {
      const page = await messagesApi.list(channelId, { around: messageId, limit: PAGE });
      const decrypted = await Promise.all(page.map(decryptForStore));
      set((s) => withChannel(s, channelId, (c) => ({ ...c, loaded: true })));
      get().insert(channelId, decrypted);
    } finally {
      get().setLoading(channelId, false);
    }
  },
  redecrypt: async (predicate) => {
    const jobs: Promise<void>[] = [];
    for (const [channelId, c] of Object.entries(get().channels)) {
      for (const id of c.ids) {
        const m = c.byId[id];
        if (!m || !predicate(m)) continue;
        jobs.push(
          decryptForStore(m).then((d) => {
            get().setDecryption(channelId, id, d.payload, d.decryptError);
          }),
        );
      }
    }
    await Promise.all(jobs);
  },
}));

export function convOf(msg: Message): string | null {
  return msg.key_conv_id;
}
