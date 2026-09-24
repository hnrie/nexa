import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { ApiError } from "@/api/client";
import { ChatView } from "@/components/chat/ChatView";
import { Button } from "@/components/common/Button";
import { PaneSpinner } from "@/components/common/Spinner";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import s from "./ServerPage.module.css";

import { t } from "@/i18n";
export default function DMPage() {
  const { channelId, messageId } = useParams();
  const nav = useNavigate();
  const channel = useChannels((c) => (channelId ? c.byId[channelId] : undefined));
  const upsert = useChannels((c) => c.upsert);
  const setActiveChannel = useUI((u) => u.setActiveChannel);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const [missing, setMissing] = useState(false);
  // a request that did not get through is not a conversation that is gone
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!channelId) return;
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  useEffect(() => {
    if (!channelId || channel) return;
    let alive = true;
    setFailed(false);
    channelsApi
      .get(channelId)
      .then((ch) => alive && upsert(ch))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          useUI.getState().toast(t("dM.thatConversationIsGone"), "error");
          setMissing(true);
          return;
        }
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [channelId, channel, upsert, attempt]);

  useEffect(() => {
    if (channelId && messageId && /^\d+$/.test(messageId)) setJumpTo({ channelId, messageId });
  }, [channelId, messageId, setJumpTo]);

  useEffect(() => {
    if (missing) nav("/channels/@me", { replace: true });
  }, [missing, nav]);

  if (!channel && failed) {
    return (
      <div className={s.empty}>
        <header className={s.header}><PageHeaderButtons /></header>
        <div className={s.emptyBody}>
          <h2>{t("dM.thatConversationCouldNotBeOpened")}</h2>
          <p>{t("server.theRequestDidNotGetThrough")}</p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>{t("chat.messageList.tryAgain")}</Button>
        </div>
      </div>
    );
  }
  if (!channel) return <PaneSpinner text={t("dM.openingConversation")} />;
  return <ChatView channel={channel} />;
}
