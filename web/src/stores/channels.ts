import { create } from "zustand";
import type { Channel } from "@/api/types";
import { compareIds } from "@/lib/ids";

interface ChannelsState {
  byId: Record<string, Channel>;
  upsert: (c: Channel | Channel[]) => void;
  remove: (id: string) => void;
  setLastMessage: (channelId: string, messageId: string) => void;
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
  clear: () => set({ byId: {} }),
}));

/** DM and group DM channels, most recent activity first. */
export function selectDMs(byId: Record<string, Channel>): Channel[] {
  return Object.values(byId)
    .filter((c) => c.type === "dm" || c.type === "group_dm")
    .sort((a, b) => compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id));
}

/** The other participant of a 1:1 DM. */
export function dmPartner(ch: Channel, meId: string | undefined): string | undefined {
  if (ch.type !== "dm") return undefined;
  return ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0];
}
