import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { nexa as nexaApi } from "@/api/moderation";
import { LockNote, ThreadChat } from "@/components/nexa/ThreadChat";
import { ThreadIntro } from "@/components/nexa/ThreadParts";
import { NexaAvatar } from "@/components/nexa/NexaBits";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { caseStanding, noticeTitle } from "@/lib/moderation";
import { useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";

/**
 * One case, as the member it is about sees it: a conversation with the Nexa
 * team that opens with the notice, where they can appeal or ask.
 */
export default function NexaCasePage() {
  const { caseId = "" } = useParams();
  const nav = useNavigate();
  const thread = useNexa((n) => n.threads[caseId]);
  const people = useNexa((n) => n.people);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thread || !caseId) return;
    let alive = true;
    setFailed(false);
    useNexa
      .getState()
      .loadThread(caseId)
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [caseId, thread]);

  // opening the case is reading its notice
  const acknowledged = thread?.case.acknowledged ?? true;
  useEffect(() => {
    if (!acknowledged) void useNexa.getState().ack(caseId).catch(() => undefined);
  }, [acknowledged, caseId]);

  const back = () => nav("/channels/@me/nexa");
  const c = thread?.case;
  const standing = c ? caseStanding(c) : null;
  // a deletion's case is read on the way out, and a closed one is closed until the team opens it again
  const closed = !!c && (c.action === "delete" || c.status === "closed");

  return (
    <div className={s.page} data-testid="nexa-case-page">
      <header className={s.header}>
        <button className={s.back} onClick={back} aria-label={t("nexa.backToNexa")}>
          <ChevronLeft size={22} className={s.flip} />
        </button>
        <NexaAvatar size={24} />
        <span className={s.headerText}>
          <span className={s.headerName}>{c ? t("nexa.notice.caseNumber", { number: c.number }) : t("nexa.caseTitle")}</span>
          {c ? <span className={s.headerSub}>{noticeTitle(c.action, c.details)}</span> : null}
        </span>
        <span className={s.spacer} />
        {standing ? (
          <span className={[s.chip, s.headerChip].join(" ")} data-tone={standing.tone}>
            {standing.label}
          </span>
        ) : null}
      </header>
      {thread && c ? (
        <ThreadChat
          lines={thread.messages}
          people={people}
          perspective="member"
          fileKind="cases"
          action={c.action}
          intro={
            <ThreadIntro avatar={<NexaAvatar size={80} />} title={t("nexa.notice.caseNumber", { number: c.number })} sub={noticeTitle(c.action, c.details)}>
              {t("nexa.chat.caseStart")}
            </ThreadIntro>
          }
          opener={{ from: "nexa", at: c.created_at, body: <NoticeCard c={c} people={people} perspective="member" /> }}
          onSend={closed ? undefined : (body, files) => useNexa.getState().reply(caseId, body, files)}
          upload={nexaApi.upload}
          locked={c.status === "closed" ? <LockNote text={t("nexa.thread.closedMember")} /> : undefined}
          note={
            closed ? undefined : (
              <>
                <ShieldAlert size={14} aria-hidden="true" />
                {t("nexa.chat.notE2E")}
              </>
            )
          }
          placeholder={t("nexa.thread.placeholder")}
          dropName={t("nexa.notice.caseNumber", { number: c.number })}
          onSeen={() => useNexa.getState().markThreadRead(caseId)}
        />
      ) : failed ? (
        <div className={s.empty}>
          <p>{t("nexa.caseMissing")}</p>
          <Button size="sm" variant="secondary" onClick={back}>
            {t("nexa.backToNexa")}
          </Button>
        </div>
      ) : (
        <div className={s.more}>
          <Spinner label={t("chat.pins.loading")} />
        </div>
      )}
    </div>
  );
}
