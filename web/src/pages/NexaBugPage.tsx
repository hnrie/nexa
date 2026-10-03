import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { BugReportCard, BugStatusChip } from "@/components/bugs/BugReportCard";
import { CaseThread } from "@/components/nexa/CaseThread";
import { NexaAvatar } from "@/components/nexa/NexaBits";
import { bugFinished, bugNumber, bugStatusLabel } from "@/lib/bugs";
import { useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";

/**
 * One bug report, as the member who sent it sees it: the report at the top,
 * and the thread with the Nexa team below, where the team answers and the
 * member can add anything that helps.
 */
export default function NexaBugPage() {
  const { reportId = "" } = useParams();
  const nav = useNavigate();
  const thread = useNexa((n) => n.bugThreads[reportId]);
  const people = useNexa((n) => n.people);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thread || !reportId) return;
    let alive = true;
    setFailed(false);
    useNexa
      .getState()
      .loadBugThread(reportId)
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [reportId, thread]);

  const back = () => nav("/channels/@me/nexa");
  const report = thread?.report;

  return (
    <div className={s.page} data-testid="nexa-bug-page">
      <header className={s.header}>
        <button className={s.back} onClick={back} aria-label={t("nexa.backToNexa")}>
          <ChevronLeft size={22} className={s.flip} />
        </button>
        <NexaAvatar size={24} />
        <span className={s.headerText}>
          <span className={s.headerName}>{report ? t("bugs.page.title", { number: bugNumber(report.number) }) : t("bugs.page.titleLoading")}</span>
          {report ? (
            <span className={s.headerSub} dir="auto">
              {report.subject}
            </span>
          ) : null}
        </span>
        <span className={s.spacer} />
        {report ? <BugStatusChip status={report.status} /> : null}
      </header>
      {thread && report ? (
        <CaseThread
          messages={thread.messages}
          people={people}
          perspective="member"
          header={<BugReportCard report={report} people={people} />}
          emptyNote={t("bugs.thread.emptyMember")}
          placeholder={t("bugs.thread.placeholder")}
          onSend={(body) => useNexa.getState().replyBug(reportId, body)}
          composerNote={
            <>
              <ShieldAlert size={14} aria-hidden="true" />
              {t("bugs.thread.notEncrypted")}
              {bugFinished(report.status) ? ` ${t("bugs.thread.finishedNote", { status: bugStatusLabel(report.status) })}` : ""}
            </>
          }
          onSeen={() => useNexa.getState().markBugRead(reportId)}
        />
      ) : failed ? (
        <div className={s.empty}>
          <p>{t("bugs.page.missing")}</p>
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
