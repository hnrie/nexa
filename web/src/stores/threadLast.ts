import { create } from "zustand";
import type { Message } from "@/api/types";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";
import { pollWords } from "@/lib/poll";
import { parse, plainText } from "@/markdown";
import { t } from "@/i18n";

/**
 * The newest thing said in each thread this app has seen, for the card under
 * the message a thread hangs from: who said it, a line of it, and when. It
 * comes with the message's page (sealed, opened here) and follows the thread
 * as messages arrive in it.
 */
export interface ThreadLast {
  id: string;
  author_id: string;
  /** One line of what it says: its words, or what it carries. */
  text: string;
  created_at: number;
}

interface ThreadLastStore {
  byThread: Record<string, ThreadLast>;
  /** Keeps the newer of what is here and `last`. */
  note: (threadId: string, last: ThreadLast) => void;
  forget: (threadId: string, messageId?: string) => void;
  clear: () => void;
}

export const useThreadLast = create<ThreadLastStore>()((set) => ({
  byThread: {},
  note: (threadId, last) =>
    set((s) => {
      const cur = s.byThread[threadId];
      if (cur && compareIds(cur.id, last.id) > 0) return s;
      return { byThread: { ...s.byThread, [threadId]: last } };
    }),
  forget: (threadId, messageId) =>
    set((s) => {
      const cur = s.byThread[threadId];
      if (!cur || (messageId && cur.id !== messageId)) return s;
      const byThread = { ...s.byThread };
      delete byThread[threadId];
      return { byThread };
    }),
  clear: () => set({ byThread: {} }),
}));

/** One line of a message, as the card under a thread's message shows it. */
export function lastLine(d: DecryptedMessage): string {
  const p = d.payload;
  if (!p) return d.decryptError ? t("chat.messageItem.encryptedMessage") : "";
  if (p.t) return plainText(parse(p.t)).replace(/\s+/g, " ").trim().slice(0, 140);
  if (p.poll) return pollWords(p.poll).slice(0, 140);
  if (p.att?.length) return p.att.length === 1 ? t("notify.sentFile", { name: p.att[0]!.name }) : t("notify.sentFiles", { count: p.att.length });
  if (p.sticker) return t("notify.sentASticker");
  return "";
}

/** Keeps a message said in a thread as the thread's newest, once opened. */
export function noteThreadMessage(threadId: string, d: DecryptedMessage): void {
  if (d.type !== "default" && d.type !== "reply") return;
  useThreadLast.getState().note(threadId, { id: d.id, author_id: d.author_id, text: lastLine(d), created_at: d.created_at });
}

/** Opens the newest message a thread's summary came with, sealed, and keeps it. */
export async function openSummaryLast(threadId: string, m: Message): Promise<void> {
  const have = useThreadLast.getState().byThread[threadId];
  if (have && have.id === m.id) return;
  noteThreadMessage(threadId, await decryptForStore(m));
}
