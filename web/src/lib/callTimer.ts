import type { VoiceState } from "@/api/types";

/**
 * When the call in a channel began (server ms), or null when nobody is in it.
 * The server says so on every voice state (`call_since`, the same for all of
 * them); a server from before that said nothing, and then the earliest
 * `joined_at` of the people still there stands in for it.
 */
export function callSince(byChannel: Record<string, Record<string, VoiceState>>, channelId: string): number | null {
  const states = Object.values(byChannel[channelId] ?? {});
  if (states.length === 0) return null;
  let since = 0;
  let earliest = Infinity;
  for (const st of states) {
    if (st.call_since && st.call_since > since) since = st.call_since;
    if (st.joined_at > 0 && st.joined_at < earliest) earliest = st.joined_at;
  }
  if (since > 0) return since;
  return Number.isFinite(earliest) ? earliest : null;
}

/** Whole seconds a call has run at `now` (server ms), never below zero. */
export function callSeconds(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}
