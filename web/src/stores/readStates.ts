import { create } from "zustand";
import { ApiError } from "@/api/client";
import { messages as messagesApi } from "@/api/messages";
import type { ReadState } from "@/api/types";
import { compareIds } from "@/lib/ids";
import { useChannels } from "./channels";

export interface ChannelRead {
  lastReadId: string | null;
  mentions: number;
  /** Unread messages from others; kept for DMs and group DMs only. */
  unread: number;
}

interface ReadStatesState {
  byChannel: Record<string, ChannelRead>;
  set: (rs: ReadState) => void;
  setMany: (list: ReadState[]) => void;
  bumpMentions: (channelId: string) => void;
  /** Counts a message someone else sent to a conversation that is not being read. */
  bumpUnread: (channelId: string) => void;
  /** Takes back the count of an unread message that was deleted. */
  dropUnread: (channelId: string, messageId: string) => void;
  /** The same for a mention: the two are counted together, so they have to be taken back together. */
  dropMention: (channelId: string, messageId: string) => void;
  /** Counts a mention an edit added to an unread message. */
  addMention: (channelId: string, messageId: string) => void;
  markRead: (channelId: string, messageId: string) => void;
  ack: (channelId: string, messageId: string) => Promise<void>;
  clear: () => void;
}

/**
 * Acks that failed to reach the server, newest per channel. The channel already
 * shows as read here, so nothing would ack it again; the next ready would bring
 * back the server's older read state. setMany sends them again instead.
 */
const unsent = new Map<string, string>();

/** Sign-out: acks that never went belong to the account that made them. */
export function forgetUnsentAcks(): void {
  unsent.clear();
}

function send(channelId: string, messageId: string): Promise<void> {
  return messagesApi.ack(channelId, messageId).then(
    () => {
      const prev = unsent.get(channelId);
      if (prev && compareIds(messageId, prev) >= 0) unsent.delete(channelId);
    },
    (err: unknown) => {
      // a refusal (no access, message gone) would fail the same way again; only lost or failed requests are kept
      if (err instanceof ApiError && err.status < 500 && err.status !== 429) return;
      const prev = unsent.get(channelId);
      if (!prev || compareIds(messageId, prev) > 0) unsent.set(channelId, messageId);
    },
  );
}

/** The server stops counting a conversation's unread messages here. */
export const MAX_UNREAD = 100;

const EMPTY: ChannelRead = { lastReadId: null, mentions: 0, unread: 0 };

function fromServer(rs: ReadState): ChannelRead {
  return { lastReadId: rs.last_read_message_id, mentions: rs.mention_count, unread: rs.unread_count ?? 0 };
}

export const useReadStates = create<ReadStatesState>()((set, get) => ({
  byChannel: {},
  set: (rs) => {
    // Two acks sent close together can be answered out of order, and the
    // older answer arriving last put a conversation that was being read back
    // to unread, with nothing left to ack it again. Only Mark Unread moves
    // the marker back; any other state behind the one here is out of date.
    const cur = get().byChannel[rs.channel_id];
    if (!rs.manual && cur?.lastReadId && (!rs.last_read_message_id || compareIds(rs.last_read_message_id, cur.lastReadId) < 0)) return;
    // a state set on purpose (marked unread, or read on another device) replaces any ack still waiting
    unsent.delete(rs.channel_id);
    set((s) => ({ byChannel: { ...s.byChannel, [rs.channel_id]: fromServer(rs) } }));
  },
  setMany: (list) => {
    const retry: [string, string][] = [];
    set((s) => {
      const byChannel = { ...s.byChannel };
      for (const rs of list) byChannel[rs.channel_id] = fromServer(rs);
      for (const [channelId, messageId] of unsent) {
        const cur = byChannel[channelId];
        // only channels this account can still see; one the server already has read past needs nothing
        if (!useChannels.getState().byId[channelId] || (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0)) {
          unsent.delete(channelId);
          continue;
        }
        byChannel[channelId] = { lastReadId: messageId, mentions: 0, unread: 0 };
        retry.push([channelId, messageId]);
      }
      return { byChannel };
    });
    for (const [channelId, messageId] of retry) void send(channelId, messageId);
  },
  bumpMentions: (channelId) =>
    set((s) => {
      const cur = s.byChannel[channelId] ?? EMPTY;
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, mentions: cur.mentions + 1 } } };
    }),
  bumpUnread: (channelId) =>
    set((s) => {
      const cur = s.byChannel[channelId] ?? EMPTY;
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, unread: Math.min(MAX_UNREAD, cur.unread + 1) } } };
    }),
  dropUnread: (channelId, messageId) =>
    set((s) => {
      const cur = s.byChannel[channelId];
      // only a message after the read marker was counted; anything this account sent it had read
      if (!cur || cur.unread === 0 || (cur.lastReadId && compareIds(messageId, cur.lastReadId) <= 0)) return s;
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, unread: cur.unread - 1 } } };
    }),
  dropMention: (channelId, messageId) =>
    set((s) => {
      const cur = s.byChannel[channelId];
      if (!cur || cur.mentions === 0 || (cur.lastReadId && compareIds(messageId, cur.lastReadId) <= 0)) return s;
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, mentions: cur.mentions - 1 } } };
    }),
  addMention: (channelId, messageId) =>
    set((s) => {
      const cur = s.byChannel[channelId] ?? EMPTY;
      if (cur.lastReadId && compareIds(messageId, cur.lastReadId) <= 0) return s;
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, mentions: cur.mentions + 1 } } };
    }),
  markRead: (channelId, messageId) =>
    set((s) => {
      const cur = s.byChannel[channelId];
      if (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0 && cur.mentions === 0 && cur.unread === 0) return s;
      return { byChannel: { ...s.byChannel, [channelId]: { lastReadId: messageId, mentions: 0, unread: 0 } } };
    }),
  ack: async (channelId, messageId) => {
    const cur = get().byChannel[channelId];
    if (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0 && cur.mentions === 0 && cur.unread === 0) return;
    get().markRead(channelId, messageId);
    await send(channelId, messageId);
  },
  clear: () => set({ byChannel: {} }),
}));

/** Unread when the channel has a newer message than the last one read. */
export function isUnread(read: ChannelRead | undefined, lastMessageId: string | null): boolean {
  if (!lastMessageId) return false;
  if (!read || !read.lastReadId) return true;
  return compareIds(lastMessageId, read.lastReadId) > 0;
}
