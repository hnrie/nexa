import { Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { servers as serversApi } from "@/api/servers";
import { ChatView } from "@/components/chat/ChatView";
import { Button } from "@/components/common/Button";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { channelTree, useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { rememberChannel } from "@/stores/serverNav";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./ServerPage.module.css";

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

  useEffect(() => {
    if (!channel || channel.type !== "text") {
      setActiveChannel(null);
      return;
    }
    setActiveChannel(channel.id);
    rememberChannel(serverId, channel.id);
    return () => setActiveChannel(null);
  }, [channel, serverId, setActiveChannel]);

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
  if (channel.type === "voice") return <VoiceLobby name={channel.name} />;
  if (channel.type === "category") return <Navigate to={`/channels/${serverId}`} replace />;
  return <ChatView channel={channel} />;
}

function NoChannels() {
  return (
    <div className={s.empty}>
      <header className={s.header}><PageHeaderButtons /></header>
      <div className={s.emptyBody}>
        <h2>No text channels</h2>
        <p>You find yourself in a strange place. You do not have access to any text channels, or there are none in this server.</p>
      </div>
    </div>
  );
}

function VoiceLobby({ name }: { name: string }) {
  const toast = useUI((u) => u.toast);
  return (
    <div className={s.empty}>
      <header className={s.header}><PageHeaderButtons /><Volume2 size={22} className={s.hIcon} /><span className={s.hName}>{name}</span></header>
      <div className={s.emptyBody}>
        <Volume2 size={48} />
        <h2>{name}</h2>
        <p>No one is currently in voice.</p>
        <Button onClick={() => toast("Voice channels arrive in the next update.", "info")}>Join Voice</Button>
      </div>
    </div>
  );
}
