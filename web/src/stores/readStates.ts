import { create } from "zustand";
import { messages as messagesApi } from "@/api/messages";
import type { ReadState } from "@/api/types";
import { compareIds } from "@/lib/ids";

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

export const useReadStates = create<ReadStatesState>()((set, get) => ({
  byChannel: {},
  set: (rs) =>
    set((s) => ({ byChannel: { ...s.byChannel, [rs.channel_id]: { lastReadId: rs.last_read_message_id, mentions: rs.mention_count } } })),
  setMany: (list) =>
    set((s) => {
      const byChannel = { ...s.byChannel };
      for (const rs of list) byChannel[rs.channel_id] = { lastReadId: rs.last_read_message_id, mentions: rs.mention_count };
      return { byChannel };
    }),
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
    try {
      await messagesApi.ack(channelId, messageId);
    } catch {
      /* the next ack will retry */
    }
  },
  clear: () => set({ byChannel: {} }),
}));

/** Unread when the channel has a newer message than the last one read. */
export function isUnread(read: ChannelRead | undefined, lastMessageId: string | null): boolean {
  if (!lastMessageId) return false;
  if (!read || !read.lastReadId) return true;
  return compareIds(lastMessageId, read.lastReadId) > 0;
}
