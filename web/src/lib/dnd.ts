import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";

/**
 * Whether this account is on Do Not Disturb: then nothing makes a sound or a
 * notification — messages, mentions, friend requests, Nexa, and the ring of
 * an incoming call, which still shows so it can be answered.
 */
export function doNotDisturb(): boolean {
  const me = useAuth.getState().me;
  return !!me && usePresence.getState().byUser[me.id]?.status === "dnd";
}
