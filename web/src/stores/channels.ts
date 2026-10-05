import { create } from "zustand";
import type { Channel, Snowflake } from "@/api/types";
import { compareIds } from "@/lib/ids";

interface ChannelsState {
  byId: Record<string, Channel>;
  upsert: (c: Channel | Channel[]) => void;
  remove: (id: string) => void;
  setLastMessage: (channelId: string, messageId: string) => void;
  /** Where the newest message is after some were deleted, which can be further back, or none. */
  resetLastMessage: (channelId: string, messageId: string | null) => void;
  applyPositions: (list: { id: string; position: number; parent_id: Snowflake | null }[]) => void;
  clear: () => void;
}

export const useChannels = create<ChannelsState>()((set) => ({
  byId: {},
  upsert: (c) => {
    const list = Array.isArray(c) ? c : [c];
    set((s) => {
      const byId = { ...s.byId };
      for (const ch of list) byId[ch.id] = ch;
      return { byId };
    });
  },
  remove: (id) =>
    set((s) => {
      if (!(id in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[id];
      return { byId };
    }),
  setLastMessage: (channelId, messageId) =>
    set((s) => {
      const ch = s.byId[channelId];
      if (!ch) return s;
      if (ch.last_message_id && compareIds(ch.last_message_id, messageId) >= 0) return s;
      return { byId: { ...s.byId, [channelId]: { ...ch, last_message_id: messageId } } };
    }),
  resetLastMessage: (channelId, messageId) =>
    set((s) => {
      const ch = s.byId[channelId];
      if (!ch || ch.last_message_id === messageId) return s;
      return { byId: { ...s.byId, [channelId]: { ...ch, last_message_id: messageId } } };
    }),
  applyPositions: (list) =>
    set((s) => {
      const byId = { ...s.byId };
      for (const p of list) {
        const ch = byId[p.id];
        if (ch) byId[p.id] = { ...ch, position: p.position, parent_id: p.parent_id };
      }
      return { byId };
    }),
  clear: () => set({ byId: {} }),
}));

/** Channels of a server in display order: position, then id. Threads are listed apart (selectThreads). */
export function selectServerChannels(byId: Record<string, Channel>, serverId: string): Channel[] {
  return Object.values(byId)
    .filter((c) => c.server_id === serverId && c.type !== "thread" && c.type !== "private_thread")
    .sort((a, b) => a.position - b.position || compareIds(a.id, b.id));
}

/** The threads of one channel this device knows of, most recent activity first. */
export function selectThreads(byId: Record<string, Channel>, parentId: string): Channel[] {
  return Object.values(byId)
    .filter((c) => (c.type === "thread" || c.type === "private_thread") && c.parent_id === parentId)
    .sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

export interface ChannelTree {
  /** Channels with no category, in order. */
  loose: Channel[];
  categories: { category: Channel; children: Channel[] }[];
}

/** Groups a server's channels into categories the way the sidebar draws them. */
export function channelTree(byId: Record<string, Channel>, serverId: string): ChannelTree {
  const all = selectServerChannels(byId, serverId);
  const cats = all.filter((c) => c.type === "category");
  const catIds = new Set(cats.map((c) => c.id));
  const loose = all.filter((c) => c.type !== "category" && (!c.parent_id || !catIds.has(c.parent_id)));
  const categories = cats.map((category) => ({ category, children: all.filter((c) => c.type !== "category" && c.parent_id === category.id) }));
  return { loose, categories };
}

/** DM and group DM channels, most recent activity first. */
export function selectDMs(byId: Record<string, Channel>): Channel[] {
  // subchats are listed under the conversation they belong to, not beside it
  return Object.values(byId)
    .filter((c) => c.type === "dm" || c.type === "group_dm")
    .sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

/** The side conversations inside one DM or group, newest activity first. */
export function selectSubchats(byId: Record<string, Channel>, parentId: string | undefined): Channel[] {
  if (!parentId) return [];
  return Object.values(byId)
    .filter((c) => c.type === "subchat" && c.parent_id === parentId)
    .sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

/** The conversation a channel belongs to: itself, or a subchat's parent. */
export function conversationOf(byId: Record<string, Channel>, ch: Channel | undefined): Channel | undefined {
  if (!ch) return undefined;
  return ch.type === "subchat" && ch.parent_id ? byId[ch.parent_id] : ch;
}

/** The other participant of a 1:1 DM. */
export function dmPartner(ch: Channel, meId: string | undefined): string | undefined {
  if (ch.type !== "dm") return undefined;
  return ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0];
}
