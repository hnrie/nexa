import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { messages as messagesApi } from "@/api/messages";
import type { PollPayload } from "@/crypto/message";
import { decryptForStore } from "@/lib/decrypt";
import { useMessages } from "@/stores/messages";

/** Polls read from messages the list does not hold, by message id, each fetched once. */
const fetched = new Map<string, Promise<PollPayload | null>>();

async function fetchPoll(channelId: string, messageId: string): Promise<{ poll: PollPayload | null; final: boolean }> {
  try {
    const m = await decryptForStore(await messagesApi.get(channelId, messageId));
    // a key still on its way gets another try next time
    return { poll: m.payload?.poll ?? null, final: m.decryptError !== "no_key" };
  } catch (err) {
    // gone, or out of reach, stays so; a moment offline does not
    return { poll: null, final: err instanceof ApiError && (err.status === 404 || err.status === 403) };
  }
}

/** The poll in one message, fetched and opened on its own. Null when it cannot be read. */
export function loadPoll(channelId: string, messageId: string): Promise<PollPayload | null> {
  let p = fetched.get(messageId);
  if (!p) {
    const got = fetchPoll(channelId, messageId);
    p = got.then((r) => r.poll);
    fetched.set(messageId, p);
    void got.then((r) => {
      if (!r.final) fetched.delete(messageId);
    });
  }
  return p;
}

/** Forgets what was fetched (tests, and signing out). */
export function forgetFetchedPolls(): void {
  fetched.clear();
}

/**
 * The poll a closing line answers: from the message list when it holds the
 * poll's message, and fetched on its own when it does not, which is often (a
 * poll runs for up to two weeks, and only the newest page of a conversation
 * is loaded when it opens). Undefined while that is under way, null when the
 * poll cannot be read.
 */
export function usePollOf(channelId: string, messageId: string | null): PollPayload | null | undefined {
  const inList = useMessages((m) => (messageId ? m.channels[channelId]?.byId[messageId]?.payload?.poll : undefined));
  const [loaded, setLoaded] = useState<{ id: string; poll: PollPayload | null } | null>(null);
  useEffect(() => {
    if (!messageId || inList) return;
    let alive = true;
    void loadPoll(channelId, messageId).then((poll) => {
      if (alive) setLoaded({ id: messageId, poll });
    });
    return () => {
      alive = false;
    };
  }, [channelId, messageId, inList]);
  if (!messageId) return null;
  if (inList) return inList;
  return loaded?.id === messageId ? loaded.poll : undefined;
}
