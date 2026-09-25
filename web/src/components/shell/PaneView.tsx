import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { servers as serversApi } from "@/api/servers";
import { ChatView } from "@/components/chat/ChatView";
import { LoadError } from "@/components/common/LoadError";
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
  // Only a refusal or a not-found means the conversation is gone. Anything
  // else — offline on a train, a server restarting, a token being refreshed —
  // used to say so too, for the life of the tab, and the only button closed
  // the pane and lost the layout.
  const [state, setState] = useState<"loading" | "missing" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  const channelId = pane?.channelId ?? null;
  const serverId = pane?.serverId ?? null;
  const known = !!channel;

  useEffect(() => {
    if (!channelId || known) return;
    let alive = true;
    setState("loading");
    // A pane restored from a previous visit can name a channel in a server this
    // session has not loaded yet, so the server is asked for first and the
    // channel only as a fallback.
    const fetched = serverId
      ? serversApi.get(serverId).then((res) => {
          if (!alive) return;
          useUsers.getState().upsert(res.users);
          useChannels.getState().upsert(res.server.channels);
          useServers.getState().setFromView(res.server);
          // the server is there, but this channel is not among the ones it shows us
          if (!res.server.channels.some((c) => c.id === channelId)) setState("missing");
        })
      : channelsApi.get(channelId).then((ch) => alive && upsert(ch));
    fetched.catch((err: unknown) => {
      if (!alive) return;
      setState(err instanceof ApiError && (err.status === 403 || err.status === 404) ? "missing" : "failed");
    });
    return () => {
      alive = false;
    };
  }, [channelId, serverId, known, upsert, attempt]);

  // back online, a pane that failed tries again by itself
  useEffect(() => {
    if (state !== "failed") return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [state]);

  if (!pane) return null;
  if (!channelId || state === "missing") {
    return (
      <div className={s.gone}>
        <p>{channelId ? t("panes.thatConversationIsNoLongerHere") : t("panes.nothingOpenHere")}</p>
        <button className={s.goneBtn} onClick={() => closePane(paneId)}>{t("panes.closePane")}</button>
      </div>
    );
  }
  if (!channel) {
    return (
      <div className={s.gone}>
        {state === "failed" ? <LoadError message={t("dM.thatConversationCouldNotBeOpened")} onRetry={() => setAttempt((n) => n + 1)} center /> : <Spinner size={24} />}
      </div>
    );
  }
  return <ChatView channel={channel} />;
}
