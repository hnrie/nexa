import { create } from "zustand";
import { ApiError } from "@/api/client";
import { messages as messagesApi } from "@/api/messages";
import type { ReadState } from "@/api/types";
import { compareIds } from "@/lib/ids";
import { useChannels } from "./channels";

export interface ChannelRead {
  lastReadId: string | null;
  mentions: number;
}

interface ReadStatesState {
  byChannel: Record<string, ChannelRead>;
  set: (rs: ReadState) => void;
  setMany: (list: ReadState[]) => void;
  bumpMentions: (channelId: string) => void;
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

export const useReadStates = create<ReadStatesState>()((set, get) => ({
  byChannel: {},
  set: (rs) => {
    // a state set on purpose (marked unread, or read on another device) replaces any ack still waiting
    unsent.delete(rs.channel_id);
    set((s) => ({ byChannel: { ...s.byChannel, [rs.channel_id]: { lastReadId: rs.last_read_message_id, mentions: rs.mention_count } } }));
  },
  setMany: (list) => {
    const retry: [string, string][] = [];
    set((s) => {
      const byChannel = { ...s.byChannel };
      for (const rs of list) byChannel[rs.channel_id] = { lastReadId: rs.last_read_message_id, mentions: rs.mention_count };
      for (const [channelId, messageId] of unsent) {
        const cur = byChannel[channelId];
        // only channels this account can still see; one the server already has read past needs nothing
        if (!useChannels.getState().byId[channelId] || (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0)) {
          unsent.delete(channelId);
          continue;
        }
        byChannel[channelId] = { lastReadId: messageId, mentions: 0 };
        retry.push([channelId, messageId]);
      }
      return { byChannel };
    });
    for (const [channelId, messageId] of retry) void send(channelId, messageId);
  },
  bumpMentions: (channelId) =>
    set((s) => {
      const cur = s.byChannel[channelId] ?? { lastReadId: null, mentions: 0 };
      return { byChannel: { ...s.byChannel, [channelId]: { ...cur, mentions: cur.mentions + 1 } } };
    }),
  markRead: (channelId, messageId) =>
    set((s) => {
      const cur = s.byChannel[channelId];
      if (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0 && cur.mentions === 0) return s;
      return { byChannel: { ...s.byChannel, [channelId]: { lastReadId: messageId, mentions: 0 } } };
    }),
  ack: async (channelId, messageId) => {
    const cur = get().byChannel[channelId];
    if (cur?.lastReadId && compareIds(cur.lastReadId, messageId) >= 0 && cur.mentions === 0) return;
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
