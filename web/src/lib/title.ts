import { conversationCount } from "@/lib/unread";
import { useChannels } from "@/stores/channels";
import { useReadStates } from "@/stores/readStates";
import { useSettings } from "@/stores/settings";

const BASE = "Evilion Chat";

function compute(): string {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState().byChannel;
  const settings = useSettings.getState().settings;
  let n = 0;
  for (const ch of Object.values(channels)) {
    const rs = reads[ch.id];
    // a conversation counts its waiting messages; elsewhere only mentions do
    n += ch.type === "dm" || ch.type === "group_dm" ? conversationCount(ch, rs, settings) : (rs?.mentions ?? 0);
  }
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
  return () => {
    a();
    b();
    c();
    document.title = BASE;
  };
}
