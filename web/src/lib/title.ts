import { useChannels } from "@/stores/channels";
import { isUnread, useReadStates } from "@/stores/readStates";

const BASE = "Evilion Chat";

function compute(): string {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState().byChannel;
  let mentions = 0;
  let unread = 0;
  for (const ch of Object.values(channels)) {
    const rs = reads[ch.id];
    mentions += rs?.mentions ?? 0;
    if ((ch.type === "dm" || ch.type === "group_dm") && isUnread(rs, ch.last_message_id)) unread += 1;
  }
  const n = mentions + unread;
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
  return () => {
    a();
    b();
    document.title = BASE;
  };
}
