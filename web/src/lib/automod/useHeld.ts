import { useSyncExternalStore } from "react";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { automodVersion, heldBy, onAutomodChange, type Catch } from "./rules";

/**
 * The rule that keeps a message hidden, kept current: worked out again when
 * the rules change, or when its author's roles come in.
 */
export function useAutomodHeld(msg: DecryptedMessage): Catch | null {
  useSyncExternalStore(onAutomodChange, automodVersion, automodVersion);
  const meId = useAuth((a) => a.me?.id);
  const serverId = useChannels((c) => c.byId[msg.channel_id]?.server_id ?? null);
  // whether the author's roles are known, which says whether a rule holds them
  useServers((st) => (serverId ? !!st.byId[serverId]?.members[msg.author_id] : false));
  if (!serverId) return null;
  return heldBy(msg, meId);
}
