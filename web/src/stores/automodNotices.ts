import { create } from "zustand";

/**
 * What AutoMod said about a message this account tried to send, shown above
 * the box of the conversation it was meant for until it is dismissed or the
 * next message goes.
 */
export interface AutomodNotice {
  /** The rule's own words, or empty for the usual ones. */
  message: string;
  rule: string;
  /** The kind of rule, which says what it looks for. */
  kind: string;
  /** The word, link or sign it caught, when there is one to show. */
  matched?: string;
  /** What was typed, to put back in the box when it was emptied for the send. */
  text?: string;
  at: number;
}

interface NoticesState {
  byChannel: Record<string, AutomodNotice>;
  show: (channelId: string, notice: AutomodNotice) => void;
  /** The words were put back in the box. */
  restored: (channelId: string) => void;
  dismiss: (channelId: string) => void;
  clear: () => void;
}

export const useAutomodNotices = create<NoticesState>()((set) => ({
  byChannel: {},
  show: (channelId, notice) => set((s) => ({ byChannel: { ...s.byChannel, [channelId]: notice } })),
  restored: (channelId) =>
    set((s) => {
      const n = s.byChannel[channelId];
      if (!n || n.text === undefined) return s;
      const { text: _text, ...rest } = n;
      void _text;
      return { byChannel: { ...s.byChannel, [channelId]: rest } };
    }),
  dismiss: (channelId) =>
    set((s) => {
      if (!s.byChannel[channelId]) return s;
      const next = { ...s.byChannel };
      delete next[channelId];
      return { byChannel: next };
    }),
  clear: () => set({ byChannel: {} }),
}));
