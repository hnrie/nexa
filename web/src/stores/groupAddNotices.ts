import { create } from "zustand";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { GroupAddNotice } from "@/api/types";

/**
 * Nexa's notes to this account about being put in a group by a friend, one per
 * group, until they are dismissed. They come with ready and live from the
 * gateway, and only ever to the person added: they are not messages, so they
 * are never unread, searched or exported.
 */
interface GroupAddNoticesState {
  byChannel: Record<string, GroupAddNotice>;
  setAll: (list: GroupAddNotice[]) => void;
  add: (n: GroupAddNotice) => void;
  remove: (channelId: string) => void;
  /** Takes the note away here at once; the server tells the other devices. A failure puts it back. */
  dismiss: (channelId: string) => Promise<void>;
  clear: () => void;
}

export const useGroupAddNotices = create<GroupAddNoticesState>()((set, get) => ({
  byChannel: {},
  setAll: (list) => set({ byChannel: Object.fromEntries(list.map((n) => [n.channel_id, n])) }),
  add: (n) => set((s) => ({ byChannel: { ...s.byChannel, [n.channel_id]: n } })),
  remove: (channelId) =>
    set((s) => {
      if (!(channelId in s.byChannel)) return s;
      const byChannel = { ...s.byChannel };
      delete byChannel[channelId];
      return { byChannel };
    }),
  dismiss: async (channelId) => {
    const n = get().byChannel[channelId];
    if (!n) return;
    get().remove(channelId);
    try {
      await channelsApi.dismissAddNotice(channelId);
    } catch (err) {
      // out of the group already: there is nothing left to dismiss
      if (err instanceof ApiError && err.status === 404) return;
      if (!get().byChannel[channelId]) get().add(n);
      throw err;
    }
  },
  clear: () => set({ byChannel: {} }),
}));
