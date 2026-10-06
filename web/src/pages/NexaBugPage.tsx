import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bugs as bugsApi } from "@/api/bugs";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { BugStatusChip } from "@/components/bugs/BugReportCard";
import { openReportBug } from "@/components/bugs/ReportBugButton";
import { LockNote, ThreadChat } from "@/components/nexa/ThreadChat";
import { ReportOpener, ThreadIntro } from "@/components/nexa/ThreadParts";
import { NexaAvatar } from "@/components/nexa/NexaBits";
import { bugFinished, bugNumber, bugStatusLabel } from "@/lib/bugs";
import { useAuth } from "@/stores/auth";
import { useNexa } from "@/stores/nexa";
import { t } from "@/i18n";
import s from "@/components/nexa/Nexa.module.css";

/**
 * One bug report, as the member who sent it sees it: a conversation with the
 * Nexa team that opens with the report, where the team answers and the member
 * can add anything that helps, pictures and recordings too, until the team
 * finishes it.
 */
export default function NexaBugPage() {
  const { reportId = "" } = useParams();
  const nav = useNavigate();
  const thread = useNexa((n) => n.bugThreads[reportId]);
  const people = useNexa((n) => n.people);
  const me = useAuth((a) => a.me);
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
  const finished = !!report && bugFinished(report.status);
  // the reporter is this account: the people the thread names may not include it yet
  const reporter = me && report ? (people[me.id] ?? { id: me.id, username: me.username, display_name: me.display_name, avatar_id: me.avatar_id, flags: 0 }) : undefined;

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
      {thread && report && me ? (
        <ThreadChat
          lines={thread.messages}
          people={reporter ? { ...people, [me.id]: reporter } : people}
          perspective="member"
          fileKind="bugs"
          intro={
            <ThreadIntro avatar={<NexaAvatar size={80} />} title={t("bugs.page.title", { number: bugNumber(report.number) })} sub={report.subject}>
              {t("nexa.chat.reportStart")}
            </ThreadIntro>
          }
          opener={{ from: me.id, at: report.created_at, body: <ReportOpener report={report} /> }}
          onSend={finished ? undefined : (body, files) => useNexa.getState().replyBug(reportId, body, files)}
          upload={bugsApi.upload}
          locked={
            <LockNote
              text={t("nexa.chat.reportFinished", { status: bugStatusLabel(report.status) })}
              action={
                <Button size="sm" variant="secondary" onClick={() => openReportBug("nexa")}>
                  {t("bugs.report")}
                </Button>
              }
            />
          }
          note={
            finished ? undefined : (
              <>
                <ShieldAlert size={14} aria-hidden="true" />
                {t("nexa.chat.notE2E")}
              </>
            )
          }
          placeholder={t("bugs.thread.placeholder")}
          dropName={t("bugs.page.title", { number: bugNumber(report.number) })}
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

