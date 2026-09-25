import { storage } from "@/lib/storage";
import { useAuth } from "./auth";

/**
 * Where the last channel opened in a server is kept, per account: two people
 * on one browser who share a server each come back to their own place in it.
 */
function keyFor(serverId: string): string | null {
  const me = useAuth.getState().me?.id;
  return me ? `lastChannel:${me}:${serverId}` : null;
}

/** The last channel opened per server, so the rail returns you where you were. */
export function lastChannelOf(serverId: string): string | null {
  const key = keyFor(serverId);
  return key ? storage.get(key) : null;
}

export function rememberChannel(serverId: string, channelId: string): void {
  const key = keyFor(serverId);
  if (key) storage.set(key, channelId);
}
