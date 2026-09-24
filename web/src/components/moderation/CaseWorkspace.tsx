import { ChevronLeft, CircleCheck, FolderOpen, Gavel, Inbox, LockOpen, RotateCcw, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { moderation as modApi, type CaseCounts, type CaseMessage, type CaseView, type ModUser, type People, type StaffCase } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { promptText } from "@/components/modals/PromptModal";
import { CaseThread } from "@/components/nexa/CaseThread";
import { NoticeCard } from "@/components/nexa/NoticeCard";
import { describeError } from "@/lib/errors";
import { actionIcon, actionLabel, caseStanding, FLAG_ADMIN, personName, relativeTo, severity, systemLineText } from "@/lib/moderation";
import { formatRelative } from "@/lib/time";
import { useModEvents, useModeration } from "@/stores/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { ModerateModal } from "./ModerateModal";
import m from "./Moderation.module.css";

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

/** One line of the thread as a preview in a list. */
function preview(c: StaffCase, people: People): string {
  const last = c.last_message;
  if (!last) return c.reason;
  if (last.kind === "system") return systemLineText(last, people, c.action, "staff");
  const who = last.kind === "staff" ? personName(people[last.author_id]) : personName(people[last.author_id]) || c.target_display_name;
  return `${who}: ${last.body}`;
}

function CaseList({ cases, people, selected, onPick, showTarget }: { cases: StaffCase[]; people: People; selected?: string; onPick: (id: string) => void; showTarget: boolean }) {
  return (
    <ul className={m.caseList} data-testid="case-list">
      {cases.map((c) => {
        const Icon = actionIcon(c.action);
        const standing = caseStanding(c);
        const target = people[c.user_id];
        return (
          <li key={c.id}>
            <button type="button" className={m.caseItem} data-selected={selected === c.id} onClick={() => onPick(c.id)} data-case={c.id}>
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
function StaffCasePane({ caseId, onBack, onChanged }: { caseId: string; onBack: () => void; onChanged: (c: StaffCase) => void }) {
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
          <ChevronLeft size={18} />
        </button>
        <span className={m.paneTitle}>
          <span className={m.caseIcon} data-tone={severity(c.action)} aria-hidden="true">
            <Icon size={16} />
          </span>
          <span>{t("moderation.case.titled", { number: c.number, action: actionLabel(c.action) })}</span>
        </span>
        <span className={m.paneActions}>
          {!gone ? (
            <Button size="sm" variant="ghost" onClick={() => nav(`/channels/@admin/users/${c.user_id}`)}>
              <UserRound size={15} aria-hidden="true" /> {personName(target)}
            </Button>
          ) : null}
          {c.in_effect ? (
            <Button size="sm" variant="positive" disabled={busy} onClick={() => void lift()} data-testid="case-lift">
              <LockOpen size={15} aria-hidden="true" /> {c.action === "ban" ? t("moderation.case.liftBan") : t("moderation.case.liftMute")}
            </Button>
          ) : null}
          {c.status === "open" ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setClosed(true)} data-testid="case-close">
              <CircleCheck size={15} aria-hidden="true" /> {t("moderation.case.close")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setClosed(false)} data-testid="case-reopen">
              <RotateCcw size={15} aria-hidden="true" /> {t("moderation.case.reopen")}
            </Button>
          )}
        </span>
      </div>
      <CaseThread
        messages={data.messages}
        people={data.people}
        perspective="staff"
        action={c.action}
        header={<NoticeCard c={c} people={data.people} perspective="staff" />}
        onSend={
          gone
            ? undefined
            : async (body) => {
                const r = await modApi.reply(caseId, body);
                apply(r.case, r.messages);
              }
        }
        composerNote={t("moderation.case.replyNote", { name: personName(target) })}
        closedNote={gone ? t("moderation.case.goneNote") : undefined}
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
  const [counts, setCounts] = useState<CaseCounts | null>(null);
  const [people, setPeople] = useState<People>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (after?: StaffCase) => {
      setLoading(true);
      try {
        const r = await modApi.cases({ view, before_at: after?.last_activity_at, before_id: after?.id, limit: 50 });
        setCases((cur) => (after ? [...(cur ?? []), ...r.cases] : r.cases));
        setCounts(r.counts);
        setPeople((p) => ({ ...p, ...r.people }));
        mergePeople(r.people);
        setMore(r.cases.length === 50);
      } catch {
        setCases((cur) => cur ?? []);
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
        {cases === null ? (
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

/** One account's cases: who they are and where they stand, and every case about them. */
export function UserCasesView() {
  const { userId = "", caseId } = useParams();
  const nav = useNavigate();
  const openModal = useUI((u) => u.openModal);
  const mergePeople = useModeration((s) => s.mergePeople);
  const ownerId = useModeration((s) => s.ownerId);
  const [user, setUser] = useState<ModUser | null>(null);
  const [cases, setCases] = useState<StaffCase[] | null>(null);
  const [people, setPeople] = useState<People>({});
  const [failed, setFailed] = useState(false);
  const [moderating, setModerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await modApi.user(userId);
      setUser(r.user);
      setCases(r.cases);
      setPeople(r.people);
      mergePeople(r.people);
    } catch {
      setFailed(true);
    }
  }, [userId, mergePeople]);

  useEffect(() => {
    setUser(null);
    setCases(null);
    setFailed(false);
    void load();
  }, [load]);

  useModEvents((e) => {
    if (e.type === "case" && e.case.user_id === userId) void load();
  });

  // straight to the newest case on a wide screen, so the page is never empty
  const newest = cases?.[0]?.id;
  const selected = caseId ?? (typeof window !== "undefined" && window.innerWidth >= 768 ? newest : undefined);
  const standing = useMemo(() => {
    const out: string[] = [];
    if (user?.ban) out.push(user.ban.expires_at ? t("moderation.state.bannedUntil", { when: relativeTo(user.ban.expires_at) }) : t("moderation.state.bannedForever"));
    if (user?.mute) out.push(user.mute.expires_at ? t("moderation.state.mutedUntil", { when: relativeTo(user.mute.expires_at) }) : t("moderation.state.muted"));
    return out;
  }, [user]);

  if (failed) {
    return (
      <div className={m.empty}>
        <p>{t("moderation.user.missing")}</p>
        <Button size="sm" variant="secondary" onClick={() => nav("/channels/@admin/users")}>
          {t("moderation.backToUsers")}
        </Button>
      </div>
    );
  }
  if (!user || !cases) {
    return (
      <div className={m.loadingRow}>
        <Spinner label={t("chat.pins.loading")} />
      </div>
    );
  }
  const deleted = (user.admin_flags & 4) !== 0;
  return (
    <>
      <div className={m.userHeader} data-testid="user-cases-header">
        <button type="button" className={m.iconBtn} onClick={() => nav("/channels/@admin/users")} aria-label={t("moderation.backToUsers")}>
          <ChevronLeft size={18} />
        </button>
        <div className={m.userWho}>
          <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={48} />
          <div className={m.userNames}>
            <span className={m.userName}>
              <span>{deleted ? t("nexa.deletedUser") : user.display_name}</span>
              {user.id === ownerId ? <span className={m.staffBadge}>{t("profile.profileCard.owner")}</span> : (user.admin_flags & FLAG_ADMIN) !== 0 ? <span className={m.staffBadge}>{t("moderation.staff")}</span> : null}
            </span>
            <span className={m.userSub}>
              {deleted ? t("moderation.user.deleted") : `@${user.username}`} · {t("moderation.casesCount", { count: cases.length })}
              {standing.length ? ` · ${standing.join(" · ")}` : ""}
            </span>
          </div>
        </div>
        <div className={m.userActions}>
          {!deleted ? (
            <Button size="sm" variant="ghost" onClick={() => openModal("profile", { userId: user.id })}>
              <UserRound size={15} aria-hidden="true" /> {t("moderation.menu.profile")}
            </Button>
          ) : null}
          {!user.blocked && !deleted ? (
            <Button size="sm" onClick={() => setModerating(true)} data-testid="user-moderate">
              <Gavel size={15} aria-hidden="true" /> {t("moderation.moderate")}
            </Button>
          ) : null}
        </div>
      </div>
      {cases.length === 0 ? (
        <div className={m.empty}>
          <FolderOpen size={40} aria-hidden="true" />
          <span className={m.emptyTitle}>{t("moderation.user.noCases")}</span>
          <span>{t("moderation.user.noCasesHint")}</span>
        </div>
      ) : (
        <div className={m.workspace} data-open={!!caseId} style={{ flex: 1 }}>
          <div className={m.listCol}>
            <CaseList cases={cases} people={people} selected={selected} onPick={(id) => nav(`/channels/@admin/users/${userId}/cases/${id}`)} showTarget={false} />
          </div>
          <div className={m.pane}>
            {selected ? (
              <StaffCasePane key={selected} caseId={selected} onBack={() => nav(`/channels/@admin/users/${userId}`)} onChanged={(c) => setCases((cur) => cur?.map((x) => (x.id === c.id ? c : x)) ?? cur)} />
            ) : (
              <div className={m.paneEmpty}>
                <FolderOpen size={40} aria-hidden="true" />
                <span className={m.emptyTitle}>{t("moderation.case.pick")}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {moderating ? <ModerateModal user={user} onClose={() => setModerating(false)} onDone={(c) => (c.action === "delete" ? void load() : nav(`/channels/@admin/users/${userId}/cases/${c.id}`))} /> : null}
    </>
  );
}
