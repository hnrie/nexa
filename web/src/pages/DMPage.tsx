import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { ChatView } from "@/components/chat/ChatView";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";

import { t } from "@/i18n";
export default function DMPage() {
  const { channelId, messageId } = useParams();
  const nav = useNavigate();
  const channel = useChannels((c) => (channelId ? c.byId[channelId] : undefined));
  const upsert = useChannels((c) => c.upsert);
  const setActiveChannel = useUI((u) => u.setActiveChannel);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  useEffect(() => {
    if (!channelId || channel) return;
    let alive = true;
    channelsApi
      .get(channelId)
      .then((ch) => alive && upsert(ch))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [channelId, channel, upsert]);

  useEffect(() => {
    if (channelId && messageId) setJumpTo({ channelId, messageId });
  }, [channelId, messageId, setJumpTo]);

  useEffect(() => {
    if (missing) nav("/channels/@me", { replace: true });
  }, [missing, nav]);

  if (!channel) return <FullScreenSpinner text={t("dM.openingConversation")} />;
  return <ChatView channel={channel} />;
}
