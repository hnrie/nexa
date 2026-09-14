import { conversationCount } from "@/lib/unread";
import { useChannels } from "@/stores/channels";
import { useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";

const BASE = "Evilion Chat";

/** Friend requests waiting for an answer. */
export function pendingFriendRequests(): number {
  let n = 0;
  for (const r of Object.values(useRelationships.getState().byUser)) if (r.type === "incoming") n += 1;
  return n;
}

/** Everything waiting for this user: messages in conversations, mentions elsewhere, and friend requests. */
export function unreadTotal(): number {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState().byChannel;
  const settings = useSettings.getState().settings;
  let n = 0;
  for (const ch of Object.values(channels)) {
    const rs = reads[ch.id];
    // a conversation counts its waiting messages; elsewhere only mentions do
    n += ch.type === "dm" || ch.type === "group_dm" ? conversationCount(ch, rs, settings) : (rs?.mentions ?? 0);
  }
  return n + pendingFriendRequests();
}

function compute(): string {
  const n = unreadTotal();
  return n > 0 ? `(${n > 99 ? "99+" : n}) ${BASE}` : BASE;
}

/** Keeps the tab title's unread count in sync with the stores. */
export function installTitleBadge(): () => void {
  const apply = () => {
    if (typeof document !== "undefined") document.title = compute();
  };
  apply();
  const a = useChannels.subscribe(apply);
  const b = useReadStates.subscribe(apply);
  const c = useSettings.subscribe(apply);
  const d = useRelationships.subscribe(apply);
  return () => {
    a();
    b();
    c();
    d();
    document.title = BASE;
  };
}
