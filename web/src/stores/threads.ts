import { create } from "zustand";
import type { Channel } from "@/api/types";
import { useChannels } from "./channels";

/**
 * Threads are channels (stores/channels holds them, so a thread opens like
 * any conversation); this keeps what is about this account and them: which
 * it is in, and how many people each holds where that is known.
 */
interface ThreadsState {
  joined: Record<string, true>;
  memberCounts: Record<string, number>;
  /** A server's threads still going, and the ones this account is in, from ready or a join. */
  setServer: (serverId: string, threads: Channel[], joined: string[]) => void;
  /** Someone came into or left threads; `me` is this account. */
  membersChanged: (threadId: string, added: string[], removed: string[], count: number, me: string | undefined) => void;
  setJoined: (threadId: string, on: boolean) => void;
  forget: (threadId: string) => void;
  clear: () => void;
}

export const useThreads = create<ThreadsState>()((set) => ({
  joined: {},
  memberCounts: {},
  setServer: (serverId, threads, joined) => {
    useChannels.getState().upsert(threads);
    set((s) => {
      const next: Record<string, true> = {};
      // threads of other servers are kept as they are
      const byId = useChannels.getState().byId;
      for (const id of Object.keys(s.joined)) if (byId[id]?.server_id !== serverId) next[id] = true;
      for (const id of joined) next[id] = true;
      const counts = { ...s.memberCounts };
      for (const th of threads) if (typeof th.member_count === "number") counts[th.id] = th.member_count;
      return { joined: next, memberCounts: counts };
    });
  },
  membersChanged: (threadId, added, removed, count, me) =>
    set((s) => {
      const joined = { ...s.joined };
      if (me && added.includes(me)) joined[threadId] = true;
      if (me && removed.includes(me)) delete joined[threadId];
      return { joined, memberCounts: { ...s.memberCounts, [threadId]: count } };
    }),
  setJoined: (threadId, on) =>
    set((s) => {
      if (!!s.joined[threadId] === on) return s;
      const joined = { ...s.joined };
      if (on) joined[threadId] = true;
      else delete joined[threadId];
      return { joined };
    }),
  forget: (threadId) =>
    set((s) => {
      if (!(threadId in s.joined) && !(threadId in s.memberCounts)) return s;
      const joined = { ...s.joined };
      const memberCounts = { ...s.memberCounts };
      delete joined[threadId];
      delete memberCounts[threadId];
      return { joined, memberCounts };
    }),
  clear: () => set({ joined: {}, memberCounts: {} }),
}));

/** Whether a channel type is a thread (a forum post is one too). */
export function isThread(ch: Pick<Channel, "type"> | undefined): boolean {
  return ch?.type === "thread" || ch?.type === "private_thread";
}
