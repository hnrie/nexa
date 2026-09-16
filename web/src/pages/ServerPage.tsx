import { Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { servers as serversApi } from "@/api/servers";
import { ChatView } from "@/components/chat/ChatView";
import { VoiceView } from "@/components/voice/VoiceView";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { channelTree, useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { rememberChannel } from "@/stores/serverNav";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./ServerPage.module.css";

import { t as tr_ } from "@/i18n";
export default function ServerPage() {
  const { serverId = "", channelId, messageId } = useParams();
  const nav = useNavigate();
  const st = useServers((x) => x.byId[serverId]);
  const setFromView = useServers((x) => x.setFromView);
  const channels = useChannels((c) => c.byId);
  const upsert = useChannels((c) => c.upsert);
  const upsertUsers = useUsers((u) => u.upsert);
  const setActiveChannel = useUI((u) => u.setActiveChannel);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const [missing, setMissing] = useState(false);
  const seen = useRef(false);
  const channel = channelId ? channels[channelId] : undefined;

  // an unknown server (deep link before ready, or one we were just added to) is fetched once;
  // one that vanishes after being seen was left, deleted or kicked from: go home without asking
  useEffect(() => {
    if (st) {
      seen.current = true;
      return;
    }
    if (!serverId) return;
    if (seen.current) {
      setMissing(true);
      return;
    }
    let alive = true;
    serversApi
      .get(serverId)
      .then((res) => {
        if (!alive) return;
        upsertUsers(res.users);
        upsert(res.server.channels);
        setFromView(res.server);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [st, serverId, setFromView, upsert, upsertUsers]);

  const firstText = useMemo(() => {
    const tree = channelTree(channels, serverId);
    const loose = tree.loose.find((c) => c.type === "text");
    if (loose) return loose.id;
    for (const cat of tree.categories) {
      const t = cat.children.find((c) => c.type === "text");
      if (t) return t.id;
    }
    return null;
  }, [channels, serverId]);

  // Keyed on the id and type, not the channel object: every new message
  // replaces that object, and re-running this would cancel a reply or edit.
  const chId = channel?.id;
  const chType = channel?.type;
  useEffect(() => {
    if (!chId || chType !== "text") {
      setActiveChannel(null);
      return;
    }
    setActiveChannel(chId);
    rememberChannel(serverId, chId);
    return () => setActiveChannel(null);
  }, [chId, chType, serverId, setActiveChannel]);

  useEffect(() => {
    if (channelId && messageId) setJumpTo({ channelId, messageId });
  }, [channelId, messageId, setJumpTo]);

  useEffect(() => {
    if (missing) nav("/channels/@me", { replace: true });
  }, [missing, nav]);

  if (!st) return <FullScreenSpinner text="Opening server…" />;
  if (!channelId || (channelId && !channel && firstText)) {
    if (firstText) return <Navigate to={`/channels/${serverId}/${firstText}`} replace />;
    if (!channelId) return <NoChannels />;
  }
  if (!channel || channel.server_id !== serverId) return <NoChannels />;
  if (channel.type === "voice") return <VoiceRoom channel={channel} />;
  if (channel.type === "category") return <Navigate to={`/channels/${serverId}`} replace />;
  return <ChatView channel={channel} />;
}

function NoChannels() {
  return (
    <div className={s.empty}>
      <header className={s.header}><PageHeaderButtons /></header>
      <div className={s.emptyBody}>
        <h2>{tr_("server.noTextChannels")}</h2>
        <p>{tr_("server.youFindYourselfInAStrange")}</p>
      </div>
    </div>
  );
}

function VoiceRoom({ channel }: { channel: import("@/api/types").Channel }) {
  return (
    <div className={s.empty}>
      <header className={s.header}><PageHeaderButtons /><Volume2 size={22} className={s.hIcon} /><span className={s.hName}>{channel.name}</span></header>
      <VoiceView channel={channel} />
    </div>
  );
}
