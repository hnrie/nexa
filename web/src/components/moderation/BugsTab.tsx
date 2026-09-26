import { Bug, ChevronDown, ChevronLeft, CircleCheck, Inbox, Paperclip, RotateCcw, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BUG_STATUSES, staffBugs, type BugCounts, type BugMessage, type BugSort, type BugStatus, type BugView, type StaffBug } from "@/api/bugs";
import type { People } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { menuAnchor } from "@/components/common/ContextMenu";
import { LoadError } from "@/components/common/LoadError";
import { SearchBox } from "@/components/common/SearchBox";
import { Select } from "@/components/common/Select";
import { Spinner } from "@/components/common/Spinner";
import { BugReportCard, BugStatusChip, BugThumbStrip } from "@/components/bugs/BugReportCard";
import { CaseThread } from "@/components/nexa/CaseThread";
import { bugFinished, bugNumber, bugStatusHint, bugStatusLabel } from "@/lib/bugs";
import { describeError } from "@/lib/errors";
import { personName, systemLineText } from "@/lib/moderation";
import { formatRelative } from "@/lib/time";
import { parse, plainText } from "@/markdown";
import { useModEvents, useModeration } from "@/stores/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import m from "./Moderation.module.css";
import b from "./BugsTab.module.css";

const PAGE = 40;
const BASE = "/channels/@admin/bugs";

/** Whether a report belongs in a view of the list. */
function inView(r: StaffBug, view: BugView, files: boolean): boolean {
  if (files && r.attachments.length === 0) return false;
  switch (view) {
    case "waiting":
      return r.awaiting === "staff";
    case "active":
      return r.status === "open" || r.status === "in_progress";
    case "all":
      return true;
    default:
      return r.status === view;
  }
}

function order(sort: BugSort): (a: StaffBug, z: StaffBug) => number {
  const byId = (a: StaffBug, z: StaffBug) => (BigInt(z.id) > BigInt(a.id) ? 1 : BigInt(z.id) < BigInt(a.id) ? -1 : 0);
  if (sort === "newest") return byId;
  if (sort === "oldest") return (a, z) => byId(z, a);
  return (a, z) => z.last_activity_at - a.last_activity_at || byId(a, z);
}

/** The newest line of a report's thread, as the list previews it. */
function preview(r: StaffBug, people: People): string {
  const last = r.last_message;
  if (!last) return plainText(parse(r.description));
  if (last.kind === "system") return systemLineText(last, people, undefined, "staff");
  const who = personName(people[last.author_id]) || r.reporter_display_name;
  return `${who}: ${plainText(parse(last.body))}`;
}

/**
 * The Bug Reports tab: every report members sent, in the view picked, with
 * the one chosen open beside the list (on a phone, instead of it): the report
 * in full, its files, the device it came from, and the thread with its
 * reporter, where staff answer as Nexa and move it along.
 */
export function BugsTab() {
  const { reportId } = useParams();
  const nav = useNavigate();
  const mergePeople = useModeration((s) => s.mergePeople);
  const counts$ = useModeration((s) => s.bugCounts);
  const [view, setView] = useState<BugView>("waiting");
  const [files, setFiles] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<BugSort>("activity");
  const [reports, setReports] = useState<StaffBug[] | null>(null);
  const [counts, setCounts] = useState<BugCounts | null>(counts$);
  const [people, setPeople] = useState<People>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // the search waits for a pause in typing
  useEffect(() => {
    const h = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(
    async (after?: StaffBug) => {
      setLoading(true);
      setFailed(false);
      try {
        const r = await staffBugs.list({ view, files, q, sort, before: after, limit: PAGE });
        setReports((cur) => (after ? [...(cur ?? []), ...r.reports] : r.reports));
        setCounts(r.counts);
        useModeration.getState().setBugCounts(r.counts);
        setPeople((p) => ({ ...p, ...r.people }));
        mergePeople(r.people);
        setMore(r.has_more);
      } catch {
        // said as a failure, never as an empty list: "nothing waiting" during
        // an outage tells staff nobody is waiting when somebody is
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [view, files, q, sort, mergePeople],
  );

  useEffect(() => {
    setReports(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (counts$) setCounts(counts$);
  }, [counts$]);

  const upsert = (r: StaffBug, p?: People) => {
    if (p) setPeople((cur) => ({ ...cur, ...p }));
    setReports((cur) => {
      if (!cur) return cur;
      const had = cur.some((x) => x.id === r.id);
      const rest = cur.filter((x) => x.id !== r.id);
      // a search is the server's to answer; a report that moves only updates where it is already listed
      const keep = q ? had : inView(r, view, files) || r.id === reportId;
      return keep ? [r, ...rest].sort(order(sort)) : rest;
    });
  };
  useModEvents((e) => {
    if (e.type === "bug") upsert(e.report, e.people);
  });

  const views: { id: BugView; label: string; n?: number }[] = [
    { id: "waiting", label: t("bugs.staff.viewWaiting"), n: counts?.waiting },
    { id: "open", label: bugStatusLabel("open"), n: counts?.open },
    { id: "in_progress", label: bugStatusLabel("in_progress"), n: counts?.in_progress },
    { id: "resolved", label: bugStatusLabel("resolved"), n: counts?.resolved },
    { id: "wont_fix", label: bugStatusLabel("wont_fix"), n: counts?.wont_fix },
    { id: "closed", label: bugStatusLabel("closed"), n: counts?.closed },
    { id: "all", label: t("bugs.staff.viewAll"), n: counts?.all },
  ];
  const filtered = !!q || files;

  return (
    <div className={[m.workspace, b.workspace].join(" ")} data-open={!!reportId} data-testid="bugs-tab">
      <div className={m.listCol}>
        <div className={b.tools}>
          <div className={b.toolRow}>
            <SearchBox className={b.search} value={query} onChange={setQuery} placeholder={t("bugs.staff.searchShort")} aria-label={t("bugs.staff.search")} title={t("bugs.staff.search")} data-testid="bugs-search" />
            <Select className={b.sort} value={sort} onChange={(e) => setSort(e.target.value as BugSort)} aria-label={t("bugs.staff.sort")} data-testid="bugs-sort">
              <option value="activity">{t("bugs.staff.sortActivity")}</option>
              <option value="newest">{t("bugs.staff.sortNewest")}</option>
              <option value="oldest">{t("bugs.staff.sortOldest")}</option>
            </Select>
          </div>
          <div className={b.chips} role="radiogroup" aria-label={t("bugs.staff.views")}>
            {views.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={m.chip} data-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`bugs-view-${v.id}`}>
                {v.label}
                {v.n !== undefined ? <span className={m.chipCount}>{v.n}</span> : null}
              </button>
            ))}
            <button type="button" className={[m.chip, b.filesChip].join(" ")} aria-pressed={files} data-selected={files} onClick={() => setFiles((f) => !f)} data-testid="bugs-files">
              <Paperclip size={14} aria-hidden="true" />
              {t("bugs.staff.withFiles")}
            </button>
          </div>
        </div>
        {failed && !reports?.length ? (
          <LoadError message={t("moderation.loadFailed")} onRetry={() => void load()} busy={loading} center />
        ) : reports === null ? (
          <div className={m.loadingRow}>
            <Spinner size={24} label={t("chat.pins.loading")} />
          </div>
        ) : reports.length === 0 ? (
          <div className={m.empty}>
            <Inbox size={36} aria-hidden="true" />
            <span className={m.emptyTitle}>{filtered ? t("bugs.staff.noMatches") : view === "waiting" ? t("bugs.staff.caughtUp") : t("bugs.staff.none")}</span>
            {filtered ? (
              <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setFiles(false); }}>
                {t("moderation.clearFilters")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className={b.list} data-testid="bugs-list">
            {reports.map((r) => (
              <BugRow key={r.id} r={r} people={people} selected={reportId === r.id} onPick={() => nav(`${BASE}/${r.id}`)} />
            ))}
            {more ? (
              <li className={m.loadingRow}>
                <Button size="sm" variant="ghost" loading={loading} onClick={() => void load(reports[reports.length - 1])}>
                  {t("moderation.loadMore")}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
      <div className={m.pane}>
        {reportId ? (
          <StaffBugPane key={reportId} reportId={reportId} onBack={() => nav(BASE)} onChanged={(r) => upsert(r)} />
        ) : (
          <div className={m.paneEmpty}>
            <Bug size={40} aria-hidden="true" />
            <span className={m.emptyTitle}>{t("bugs.staff.pick")}</span>
            <span>{t("bugs.staff.pickHint")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One report in the list: its number and subject, who sent it (a way to
 * their profile), whether it waits on staff and where it stands, the start of
 * what it says, and its files.
 */
function BugRow({ r, people, selected, onPick }: { r: StaffBug; people: People; selected: boolean; onPick: () => void }) {
  const openModal = useUI((u) => u.openModal);
  const who = people[r.user_id];
  const name = who ? personName(who) : r.reporter_display_name || r.reporter_username;
  const gone = !who || who.deleted;
  const openProfile = () => {
    if (!gone) openModal("profile", { userId: r.user_id });
  };
  return (
    <li className={b.row} data-selected={selected || undefined} data-waiting={r.awaiting === "staff" || undefined} data-report={r.id}>
      <span className={b.rowAvatar} onClick={openProfile} aria-hidden="true">
        <Avatar id={r.user_id} avatarId={who?.avatar_id ?? null} name={name} size={36} />
      </span>
      <button type="button" className={b.rowMain} onClick={onPick} aria-current={selected || undefined} data-testid="bug-row">
        <span className={b.rowNumber}>{bugNumber(r.number)}</span>
        <span className={b.rowSubject} dir="auto">
          {r.subject}
        </span>
        <time className={b.rowTime} dateTime={new Date(r.last_activity_at).toISOString()}>
          {formatRelative(r.last_activity_at)}
        </time>
      </button>
      <span className={b.rowWho}>
        <button type="button" className={b.reporter} onClick={openProfile} disabled={gone} dir="auto" title={t("nexa.viewProfile")}>
          {name}
        </button>
        {r.awaiting === "staff" ? (
          <span className={m.tag} data-tone="danger">
            {t("bugs.staff.waiting")}
          </span>
        ) : null}
        <BugStatusChip status={r.status} className={b.rowStatus} />
      </span>
      <span className={b.rowPreview} dir="auto">
        {preview(r, people)}
      </span>
      {r.attachments.length ? (
        <span className={b.rowFiles}>
          <BugThumbStrip files={r.attachments} />
        </span>
      ) : null}
    </li>
  );
}

/**
 * A report for the staff: the report in full, its thread, and what can be
 * done about it: answer as Nexa, move it to another status, or mark it
 * resolved in one step.
 */
function StaffBugPane({ reportId, onBack, onChanged }: { reportId: string; onBack: () => void; onChanged: (r: StaffBug) => void }) {
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const mergePeople = useModeration((s) => s.mergePeople);
  const [data, setData] = useState<{ report: StaffBug; messages: BugMessage[]; people: People } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    staffBugs
      .thread(reportId)
      .then((r) => {
        if (!alive) return;
        setData(r);
        mergePeople(r.people);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [reportId, mergePeople]);

  useModEvents((e) => {
    if (e.type !== "bug" || e.report.id !== reportId) return;
    setData((cur) => {
      if (!cur) return cur;
      const seen = new Set(cur.messages.map((x) => x.id));
      return { report: e.report, messages: [...cur.messages, ...e.messages.filter((x) => !seen.has(x.id))], people: { ...cur.people, ...e.people } };
    });
  });

  const apply = (r: StaffBug, lines: BugMessage[] = [], people?: People) => {
    setData((cur) => (cur ? { report: r, messages: [...cur.messages, ...lines.filter((x) => !cur.messages.some((y) => y.id === x.id))], people: { ...cur.people, ...people } } : cur));
    onChanged(r);
  };

  const setStatus = async (status: BugStatus) => {
    if (!data || status === data.report.status) return;
    setBusy(true);
    try {
      const r = await staffBugs.setStatus(reportId, status);
      apply(r.report, r.messages, r.people);
      toast(t("bugs.staff.statusSet", { status: bugStatusLabel(status) }), "success");
    } catch (err) {
      toast(describeError(err, t("moderation.failed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const statusMenu = (el: HTMLElement) => {
    if (!data) return;
    const anchor = menuAnchor(el);
    openContextMenu({
      x: anchor.left,
      y: anchor.bottom + 4,
      anchor,
      label: t("bugs.staff.setStatus"),
      items: BUG_STATUSES.map((st) => ({ id: st, label: bugStatusLabel(st), checked: st === data.report.status, onSelect: () => void setStatus(st) })),
    });
  };

  if (failed) {
    return (
      <div className={m.paneEmpty}>
        <p>{t("bugs.staff.missing")}</p>
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
  const r = data.report;
  const reporter = data.people[r.user_id];
  const gone = !reporter || reporter.deleted;
  const finished = bugFinished(r.status);
  return (
    <>
      <div className={m.paneHeader}>
        <button type="button" className={[m.iconBtn, m.mobileBack].join(" ")} onClick={onBack} aria-label={t("moderation.back")}>
          <ChevronLeft size={18} className={m.flip} />
        </button>
        <span className={m.paneTitle}>
          <span className={b.paneIcon} aria-hidden="true">
            <Bug size={16} />
          </span>
          <span dir="auto">{`${bugNumber(r.number)} ${r.subject}`}</span>
        </span>
        <span className={m.paneActions}>
          <Button size="sm" variant="secondary" disabled={busy} onClick={(e) => statusMenu(e.currentTarget)} aria-haspopup="menu" title={bugStatusHint(r.status)} data-testid="bug-status-menu">
            {t("bugs.staff.statusIs", { status: bugStatusLabel(r.status) })}
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
          {finished ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus("open")} data-testid="bug-reopen">
              <RotateCcw size={15} aria-hidden="true" /> {t("bugs.staff.reopen")}
            </Button>
          ) : (
            <Button size="sm" variant="positive" disabled={busy} onClick={() => void setStatus("resolved")} data-testid="bug-resolve">
              <CircleCheck size={15} aria-hidden="true" /> {t("bugs.staff.markResolved")}
            </Button>
          )}
          {!gone ? (
            <Button size="sm" variant="ghost" onClick={() => nav(`/channels/@admin/users/${r.user_id}`)} title={t("bugs.staff.openMember")}>
              <UserRound size={15} aria-hidden="true" /> {personName(reporter)}
            </Button>
          ) : null}
        </span>
      </div>
      <CaseThread
        messages={data.messages}
        people={data.people}
        perspective="staff"
        header={<BugReportCard report={r} people={data.people} />}
        emptyNote={t("bugs.thread.emptyStaff")}
        placeholder={t("bugs.thread.staffPlaceholder")}
        onSend={
          gone
            ? undefined
            : async (body) => {
                const res = await staffBugs.reply(reportId, body);
                apply(res.report, res.messages);
              }
        }
        composerNote={t("moderation.case.replyNote", { name: personName(reporter) })}
        closedNote={gone ? t("moderation.case.goneNote") : undefined}
      />
    </>
  );
}
