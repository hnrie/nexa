import { ChevronLeft, CircleCheck, FolderOpen, Gavel, Inbox, LockOpen, RotateCcw, UserRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { moderation as modApi, type CaseCounts, type CaseMessage, type CaseView, type ModUser, type People, type StaffCase } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { promptText } from "@/components/modals/PromptModal";
import { LockNote, ThreadChat } from "@/components/nexa/ThreadChat";
import { ThreadIntro } from "@/components/nexa/ThreadParts";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { describeError } from "@/lib/errors";
import { actionIcon, actionLabel, caseStanding, FLAG_ADMIN, FLAG_DELETED, personName, previewText, relativeTo, severity, systemLineText } from "@/lib/moderation";
import { formatRelative } from "@/lib/time";
import { useModEvents, useModeration } from "@/stores/moderation";
import { usePresence } from "@/stores/presence";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { ModerateModal } from "./ModerateModal";
import { modStatus, StatusSummary } from "./ModStatus";
import m from "./Moderation.module.css";
import { LoadError } from "@/components/common/LoadError";

/** Whether a case belongs in a view of the Active Cases tab. */
function inView(c: StaffCase, view: CaseView): boolean {
  switch (view) {
    case "needs_reply":
      return c.status === "open" && c.awaiting === "staff";
    case "open":
      return c.status === "open";
    case "in_effect":
      return c.in_effect;
    case "closed":
      return c.status === "closed";
    default:
      return true;
  }
}

function byActivity(a: StaffCase, b: StaffCase): number {
  return b.last_activity_at - a.last_activity_at || (BigInt(b.id) > BigInt(a.id) ? 1 : -1);
}

/** One line of the thread as a preview in a list: plain words, whatever formatting it had. */
function preview(c: StaffCase, people: People): string {
  const last = c.last_message;
  if (!last) return previewText(c.reason);
  if (last.kind === "system") return systemLineText(last, people, c.action, "staff");
  const who = personName(people[last.author_id]) || c.target_display_name;
  return `${who}: ${previewText(last.body, last.files?.length ?? 0)}`;
}

export function CaseList({ cases, people, selected, onPick, showTarget }: { cases: StaffCase[]; people: People; selected?: string; onPick: (id: string) => void; showTarget: boolean }) {
  const unread = useModeration((st) => st.unread.cases);
  return (
    <ul className={m.caseList} data-testid="case-list">
      {cases.map((c) => {
        const Icon = actionIcon(c.action);
        const standing = caseStanding(c);
        const target = people[c.user_id];
        const fresh = unread.includes(c.id);
        return (
          <li key={c.id}>
            <button type="button" className={m.caseItem} data-selected={selected === c.id} data-unread={fresh || undefined} onClick={() => onPick(c.id)} data-case={c.id}>
              {showTarget ? (
                <Avatar id={c.user_id} avatarId={target?.avatar_id ?? null} name={target?.display_name ?? c.target_display_name} size={34} />
              ) : (
                <span className={m.caseIcon} data-tone={severity(c.action)} aria-hidden="true">
                  <Icon size={17} />
                </span>
              )}
              <span className={m.caseText}>
                <span className={m.caseTop}>
                  <span className={m.caseTitle}>{showTarget ? personName(target) || c.target_display_name : t("moderation.case.titled", { number: c.number, action: actionLabel(c.action) })}</span>
                  {fresh ? (
                    <span className={m.unreadDot}>
                      <span className="visually-hidden">{t("sidebar.serverSidebar.unread")}</span>
                    </span>
                  ) : null}
                  <span className={m.caseTime}>{formatRelative(c.last_activity_at)}</span>
                </span>
                {showTarget ? <span className={m.caseSub}>{t("moderation.case.titled", { number: c.number, action: actionLabel(c.action) })}</span> : null}
                <span className={m.casePreview}>{preview(c, people)}</span>
                <span className={m.caseTags}>
                  {c.status === "open" && c.awaiting === "staff" ? (
                    <span className={m.tag} data-tone="danger">
                      {t("moderation.case.needsReply")}
                    </span>
                  ) : null}
                  {standing ? (
                    <span className={m.tag} data-tone={standing.tone}>
                      {standing.label}
                    </span>
                  ) : null}
                  {c.status === "closed" ? <span className={m.tag}>{t("moderation.case.closed")}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A case for the staff: the notice as the member got it (with what a reset
 * took away), its thread, and what can be done about it — reply as Nexa, lift
 * the mute or ban, close it or open it again.
 */
export function StaffCasePane({ caseId, onBack, onChanged, showMember = true }: { caseId: string; onBack: () => void; onChanged: (c: StaffCase) => void; showMember?: boolean }) {
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const mergePeople = useModeration((s) => s.mergePeople);
  const [data, setData] = useState<{ case: StaffCase; messages: CaseMessage[]; people: People } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    modApi
      .thread(caseId)
      .then((r) => {
        if (!alive) return;
        setData(r);
        mergePeople(r.people);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [caseId, mergePeople]);

  useModEvents((e) => {
    if (e.type !== "case" || e.case.id !== caseId) return;
    setData((cur) => {
      if (!cur) return cur;
      const seen = new Set(cur.messages.map((x) => x.id));
      return { case: e.case, messages: [...cur.messages, ...e.messages.filter((x) => !seen.has(x.id))], people: { ...cur.people, ...e.people } };
    });
  });

  const apply = (c: StaffCase, lines: CaseMessage[] = []) => {
    setData((cur) => (cur ? { ...cur, case: c, messages: [...cur.messages, ...lines.filter((x) => !cur.messages.some((y) => y.id === x.id))] } : cur));
    onChanged(c);
  };

  const lift = async () => {
    if (!data) return;
    const what = data.case.action === "ban" ? t("moderation.case.liftBan") : t("moderation.case.liftMute");
    const reason = await promptText(what, { label: t("moderation.case.liftReason"), placeholder: t("moderation.case.liftPlaceholder"), maxLength: 1000, hint: t("moderation.case.liftHint") }, what);
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await modApi.lift(caseId, reason);
      apply(r.case);
      toast(t("moderation.case.lifted"), "success");
    } catch (err) {
      toast(describeError(err, t("moderation.failed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const setClosed = async (closed: boolean) => {
    setBusy(true);
    try {
      const r = await modApi.setClosed(caseId, closed);
      apply(r.case);
    } catch (err) {
      toast(describeError(err, t("moderation.failed")), "error");
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className={m.paneEmpty}>
        <p>{t("moderation.case.missing")}</p>
        <Button size="sm" variant="secondary" onClick={onBack}>
          {t("moderation.back")}
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={m.paneEmpty}>
        <Spinner label={t("chat.pins.loading")} />
      </div>
    );
  }
  const c = data.case;
  const target = data.people[c.user_id];
  const gone = !target || target.deleted;
  const Icon = actionIcon(c.action);
  return (
    <>
      <div className={m.paneHeader}>
        <button type="button" className={[m.iconBtn, m.mobileBack].join(" ")} onClick={onBack} aria-label={t("moderation.back")}>
          <ChevronLeft size={18} className={m.flip} />
        </button>
        <span className={m.paneTitle}>
          <span className={m.caseIcon} data-tone={severity(c.action)} aria-hidden="true">
            <Icon size={16} />
          </span>
          <span>{t("moderation.case.titled", { number: c.number, action: actionLabel(c.action) })}</span>
        </span>
        <span className={m.paneActions}>
          {/* on the member's own page the way to it goes nowhere */}
          {!gone && showMember ? (
            <Button size="sm" variant="ghost" onClick={() => nav(`/channels/@admin/users/${c.user_id}`)} aria-label={t("moderation.case.openPerson", { name: personName(target) })} title={personName(target)}>
              <UserRound size={15} aria-hidden="true" /> <span className={m.btnLabel}>{personName(target)}</span>
            </Button>
          ) : null}
          {c.in_effect ? (
            <Button size="sm" variant="positive" disabled={busy} onClick={() => void lift()} data-testid="case-lift" aria-label={c.action === "ban" ? t("moderation.case.liftBan") : t("moderation.case.liftMute")}>
              <LockOpen size={15} aria-hidden="true" /> <span className={m.btnLabel}>{c.action === "ban" ? t("moderation.case.liftBan") : t("moderation.case.liftMute")}</span>
            </Button>
          ) : null}
          {c.status === "open" ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setClosed(true)} data-testid="case-close" aria-label={t("moderation.case.close")}>
              <CircleCheck size={15} aria-hidden="true" /> <span className={m.btnLabel}>{t("moderation.case.close")}</span>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setClosed(false)} data-testid="case-reopen" aria-label={t("moderation.case.reopen")}>
              <RotateCcw size={15} aria-hidden="true" /> <span className={m.btnLabel}>{t("moderation.case.reopen")}</span>
            </Button>
          )}
        </span>
      </div>
      <ThreadChat
        lines={data.messages}
        people={data.people}
        perspective="staff"
        fileKind="cases"
        action={c.action}
        intro={
          <ThreadIntro avatar={<Avatar id={c.user_id} avatarId={target?.avatar_id ?? null} name={personName(target) || c.target_display_name} size={80} />} title={t("nexa.notice.caseNumber", { number: c.number })} sub={target && !target.deleted ? `@${target.username}` : c.target_username}>
            {t("moderation.chat.caseStart", { name: personName(target) || c.target_display_name })}
          </ThreadIntro>
        }
        opener={{ from: "nexa", at: c.created_at, body: <NoticeCard c={c} people={data.people} perspective="staff" /> }}
        // a closed case is closed to staff too, until one of them opens it again
        onSend={
          gone || c.status === "closed"
            ? undefined
            : async (body, files) => {
                const r = await modApi.reply(caseId, body, files);
                apply(r.case, r.messages);
              }
        }
        upload={modApi.upload}
        placeholder={t("moderation.case.replyPlaceholder")}
        note={gone || c.status === "closed" ? undefined : t("moderation.case.replyNote", { name: personName(target) })}
        dropName={t("nexa.notice.caseNumber", { number: c.number })}
        onSeen={(lastId) => useModeration.getState().readThread("case", caseId, lastId)}
        locked={
          gone ? (
            <LockNote text={t("moderation.case.goneNote")} />
          ) : (
            <LockNote
              text={t("moderation.case.closedNote")}
              action={
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setClosed(false)} data-testid="case-reopen-locked">
                  <RotateCcw size={15} aria-hidden="true" /> {t("moderation.case.reopen")}
                </Button>
              }
            />
          )
        }
      />
    </>
  );
}

/** The Active Cases tab: every case, in the view picked, most recently active first. */
export function CasesTab() {
  const { caseId } = useParams();
  const nav = useNavigate();
  const mergePeople = useModeration((s) => s.mergePeople);
  const [view, setView] = useState<CaseView>("needs_reply");
  const [cases, setCases] = useState<StaffCase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [counts, setCounts] = useState<CaseCounts | null>(null);
  const [people, setPeople] = useState<People>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (after?: StaffCase) => {
      setLoading(true);
      setFailed(false);
      try {
        const r = await modApi.cases({ view, before_at: after?.last_activity_at, before_id: after?.id, limit: 50 });
        setCases((cur) => (after ? [...(cur ?? []), ...r.cases] : r.cases));
        setCounts(r.counts);
        setPeople((p) => ({ ...p, ...r.people }));
        mergePeople(r.people);
        setMore(r.cases.length === 50);
      } catch {
        // said as a failure, never as an empty queue: "all caught up" during
        // an outage tells staff nobody is waiting when somebody is
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [view, mergePeople],
  );

  useEffect(() => {
    setCases(null);
    void load();
  }, [load]);

  const counts$ = useModeration((s) => s.counts);
  useEffect(() => {
    if (counts$) setCounts(counts$);
  }, [counts$]);

  const upsert = (c: StaffCase, p?: People) => {
    if (p) setPeople((cur) => ({ ...cur, ...p }));
    setCases((cur) => {
      if (!cur) return cur;
      const rest = cur.filter((x) => x.id !== c.id);
      return inView(c, view) || c.id === caseId ? [c, ...rest].sort(byActivity) : rest;
    });
  };
  useModEvents((e) => {
    if (e.type === "case") upsert(e.case, e.people);
  });

  const views: { id: CaseView; label: string; n?: number }[] = [
    { id: "needs_reply", label: t("moderation.view.needsReply"), n: counts?.needs_reply },
    { id: "open", label: t("moderation.view.open"), n: counts?.open },
    { id: "in_effect", label: t("moderation.view.inEffect"), n: counts?.in_effect },
    { id: "closed", label: t("moderation.view.closed"), n: counts?.closed },
    { id: "all", label: t("moderation.view.all"), n: counts?.all },
  ];

  return (
    <div className={m.workspace} data-open={!!caseId} data-testid="cases-tab">
      <div className={m.listCol}>
        <div className={m.listTools} role="radiogroup" aria-label={t("moderation.view.label")}>
          {views.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={m.chip} data-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`view-${v.id}`}>
              {v.label}
              {v.n !== undefined ? <span className={m.chipCount}>{v.n}</span> : null}
            </button>
          ))}
        </div>
        {failed && !cases?.length ? (
          <LoadError message={t("moderation.loadFailed")} onRetry={() => void load()} busy={loading} center />
        ) : cases === null ? (
          <div className={m.loadingRow}>
            <Spinner size={24} label={t("chat.pins.loading")} />
          </div>
        ) : cases.length === 0 ? (
          <div className={m.empty}>
            <Inbox size={36} aria-hidden="true" />
            <span className={m.emptyTitle}>{view === "needs_reply" ? t("moderation.view.caughtUp") : t("moderation.view.none")}</span>
          </div>
        ) : (
          <>
            <CaseList cases={cases} people={people} selected={caseId} onPick={(id) => nav(`/channels/@admin/cases/${id}`)} showTarget />
            {more ? (
              <div className={m.loadingRow}>
                <Button size="sm" variant="ghost" loading={loading} onClick={() => void load(cases[cases.length - 1])}>
                  {t("moderation.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className={m.pane}>
        {caseId ? (
          <StaffCasePane key={caseId} caseId={caseId} onBack={() => nav("/channels/@admin/cases")} onChanged={(c) => upsert(c)} />
        ) : (
          <div className={m.paneEmpty}>
            <FolderOpen size={40} aria-hidden="true" />
            <span className={m.emptyTitle}>{t("moderation.case.pick")}</span>
            <span>{t("moderation.case.pickHint")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
