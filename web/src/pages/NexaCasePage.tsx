import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { nexa as nexaApi } from "@/api/moderation";
import { CaseThread, ClosedNote } from "@/components/nexa/CaseThread";
import { NexaAvatar } from "@/components/nexa/NexaBits";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { caseStanding, noticeTitle } from "@/lib/moderation";
import { useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";

/**
 * One case, as the member it is about sees it: the notice at the top, and the
 * thread with the moderation team below, where they can appeal or ask.
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
  const standing = thread ? caseStanding(thread.case) : null;

  return (
    <div className={s.page} data-testid="nexa-case-page">
      <header className={s.header}>
        <button className={s.back} onClick={back} aria-label={t("nexa.backToNexa")}>
          <ChevronLeft size={22} className={s.flip} />
        </button>
        <NexaAvatar size={24} />
        <span className={s.headerName}>{thread ? t("nexa.notice.caseNumber", { number: thread.case.number }) : t("nexa.caseTitle")}</span>
        {thread ? <span className={s.headerSub}>{noticeTitle(thread.case.action, thread.case.details)}</span> : null}
        <span className={s.spacer} />
        {standing ? (
          <span className={[s.chip, s.headerChip].join(" ")} data-tone={standing.tone}>
            {standing.label}
          </span>
        ) : null}
      </header>
      {thread ? (
        <CaseThread
          messages={thread.messages}
          people={people}
          perspective="member"
          action={thread.case.action}
          header={<NoticeCard c={thread.case} people={people} perspective="member" />}
          // a closed case is closed until the team opens it again: nothing can be written in it
          onSend={thread.case.action === "delete" || thread.case.status === "closed" ? undefined : (body, files) => useNexa.getState().reply(caseId, body, files)}
          upload={nexaApi.upload}
          closedNote={thread.case.status === "closed" ? <ClosedNote text={t("nexa.thread.closedMember")} /> : undefined}
          composerNote={
            <>
              <ShieldAlert size={14} aria-hidden="true" />
              {t("nexa.thread.notEncrypted")}
            </>
          }
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
