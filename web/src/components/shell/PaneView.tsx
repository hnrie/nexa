import { useEffect, useState } from "react";
import { channels as channelsApi } from "@/api/channels";
import { servers as serversApi } from "@/api/servers";
import { ChatView } from "@/components/chat/ChatView";
import { Spinner } from "@/components/common/Spinner";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import { usePanes } from "@/stores/panes";
import { t } from "@/i18n";
import s from "./Panes.module.css";

/**
 * A pane that the router is not drawing.
 *
 * It does for one channel what `DMPage` and `ServerPage` do for the one in the
 * address bar: find it, fetch it if this session has not seen it, and hand it
 * to `ChatView`. What it deliberately does not do is any of the things that
 * belong to the page you are *on* — setting the active channel, honouring a
 * `?jump=` message, sending you home when a channel turns out to be gone. Those
 * belong to the focused pane, which is still the routed one.
 */
export function PaneView({ paneId }: { paneId: string }) {
  const pane = usePanes((p) => p.panes[paneId]);
  const channel = useChannels((c) => (pane?.channelId ? c.byId[pane.channelId] : undefined));
  const upsert = useChannels((c) => c.upsert);
  const closePane = usePanes((p) => p.closePane);
  const [missing, setMissing] = useState(false);

  const channelId = pane?.channelId ?? null;
  const serverId = pane?.serverId ?? null;
  const known = !!channel;

  useEffect(() => {
    if (!channelId || known) return;
    let alive = true;
    setMissing(false);
    // A pane restored from a previous visit can name a channel in a server this
    // session has not loaded yet, so the server is asked for first and the
    // channel only as a fallback.
    const fetched = serverId
      ? serversApi.get(serverId).then((res) => {
          if (!alive) return;
          useUsers.getState().upsert(res.users);
          useChannels.getState().upsert(res.server.channels);
          useServers.getState().setFromView(res.server);
        })
      : channelsApi.get(channelId).then((ch) => alive && upsert(ch));
    fetched.catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [channelId, serverId, known, upsert]);

  if (!pane) return null;
  if (!channelId || missing) {
    return (
      <div className={s.gone}>
        <p>{missing ? t("panes.thatConversationIsNoLongerHere") : t("panes.nothingOpenHere")}</p>
        <button className={s.goneBtn} onClick={() => closePane(paneId)}>{t("panes.closePane")}</button>
      </div>
    );
  }
  if (!channel) {
    return (
      <div className={s.gone}>
        <Spinner size={24} />
      </div>
    );
  }
  return <ChatView channel={channel} />;
}
