import { ReportSnapshot } from "./ReportSnapshot";
import { ThreadFiles } from "@/components/nexa/ThreadFiles";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  REPORT_KINDS,
  REPORT_STATUSES,
  reports,
  type ReportDetail,
  type ReportStatus,
  type SafetyReport,
} from "@/api/reports";
import { moderation, type ModUser } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { PersonName } from "@/components/common/PersonName";
import { ModerateModal } from "@/components/moderation/ModerateModal";
import { describeError } from "@/lib/errors";
import { fullDate } from "@/lib/moderation";
import { atLeast, useMyRank } from "@/lib/staffRank";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import s from "./Reports.module.css";
const BASE = "/channels/@admin/reports";
export function ReportsTab() {
  const { reportId } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [list, setList] = useState<SafetyReport[]>([]);
  const [more, setMore] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(
    async (before?: string) => {
      const ticket = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const r = await reports.list({
          status,
          kind,
          q: query,
          mine: mine ? "1" : undefined,
          before,
        });
        if (ticket !== generation.current) return;
        setList((old) => (before ? [...old, ...r.reports] : r.reports));
        setCounts(r.counts);
        setMore(r.has_more);
      } catch (err) {
        if (ticket === generation.current)
          setError(describeError(err, t("reports.failed")));
      } finally {
        if (ticket === generation.current) setLoading(false);
      }
    },
    [status, kind, query, mine],
  );
  useEffect(() => {
    setList([]);
    setMore(false);
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [load, refresh]);
  return (
    <div
      className={s.workspace}
      data-open={!!reportId}
      data-testid="reports-workspace"
    >
      <aside className={s.queue} aria-label={t("reports.title")}>
        <div className={s.filters}>
          <strong>
            {t("reports.title")} ({(counts.open ?? 0) + (counts.in_review ?? 0)}
            )
          </strong>
          <TextInput
            aria-label={t("reports.search")}
            placeholder={t("reports.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          <Select
            aria-label={t("reports.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">{t("reports.active")}</option>
            <option value="">{t("reports.all")}</option>
            {REPORT_STATUSES.map((k) => (
              <option key={k} value={k}>
                {t(`reports.status.${k}`)} ({counts[k] ?? 0})
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("reports.target")}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t("reports.allKinds")}</option>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`reports.kind.${k}`)}
              </option>
            ))}
          </Select>
          <label className={s.actions}>
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />
            {t("reports.mine")}
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {t("reports.refresh")}
          </Button>
        </div>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        <div className={s.list} aria-busy={loading}>
          {!loading && !list.length && (
            <p className={s.empty}>{t("reports.empty")}</p>
          )}
          {list.map((v) => (
            <button
              key={v.id}
              className={s.row}
              aria-current={v.id === reportId}
              onClick={() => nav(`${BASE}/${v.id}`)}
            >
              <strong>
                {t(`reports.kind.${v.target_kind}`)}:{" "}
                {v.part === "custom"
                  ? v.custom_part
                  : t(`reports.part.${v.part}`)}
              </strong>
              <span>{v.description}</span>
              <span className={s.meta}>
                {t(`reports.reason.${v.reason}`)} /{" "}
                {t(`reports.status.${v.status}`)}
              </span>
              <time className={s.meta}>{fullDate(v.created_at)}</time>
            </button>
          ))}
          {loading && (
            <p role="status" className={s.empty}>
              {t("reports.loading")}
            </p>
          )}
          {more && (
            <Button
              variant="secondary"
              block
              disabled={loading}
              onClick={() => void load(list.at(-1)?.id)}
            >
              {t("reports.more")}
            </Button>
          )}
        </div>
      </aside>
      <main className={s.detail}>
        {reportId ? (
          <ReportWorkspace
            key={reportId}
            id={reportId}
            onBack={() => nav(BASE)}
            changed={() => setRefresh((n) => n + 1)}
          />
        ) : (
          <p className={s.empty}>{t("reports.select")}</p>
        )}
      </main>
    </div>
  );
}
function ReportWorkspace({
  id,
  onBack,
  changed,
}: {
  id: string;
  onBack: () => void;
  changed: () => void;
}) {
  const nav = useNavigate();
  const rank = useMyRank();
  const me = useAuth((st) => st.me?.id);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ReportStatus>("open");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [moderating, setModerating] = useState<ModUser | null>(null);
  const reviewLock = useRef(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await reports.detail(id);
      setDetail(r);
      setStatus(r.report.status);
    } catch (err) {
      setError(describeError(err, t("reports.failed")));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const review = async (assigned: string) => {
    if (!detail || reviewLock.current) return;
    reviewLock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await reports.review(id, {
        version: detail.report.version,
        status,
        note,
        assigned_to: assigned,
      });
      setDetail(r);
      setStatus(r.report.status);
      setNote("");
      changed();
    } catch (err) {
      setError(describeError(err, t("reports.failed")));
    } finally {
      reviewLock.current = false;
      setBusy(false);
    }
  };
  const v = detail?.report;
  const person = (uid: string) => {
    const p = detail?.people[uid];
    return (
      <PersonName userId={uid}>
        {p?.display_name || p?.username || uid}
      </PersonName>
    );
  };
  const moderate = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const r = await moderation.user(v.subject_id);
      setModerating(r.user);
    } catch (err) {
      setError(describeError(err, t("reports.failed")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.detailInner}>
      <Button variant="ghost" className={s.back} onClick={onBack}>
        {t("reports.back")}
      </Button>
      {error && (
        <div role="alert" className={s.error}>
          {error}
          <Button variant="link" onClick={() => void load()} disabled={busy}>
            {t("reports.refresh")}
          </Button>
        </div>
      )}
      {!detail && !error && <p role="status">{t("reports.loading")}</p>}
      {v && detail && (
        <>
          <section className={s.section}>
            <h2>
              {t(`reports.kind.${v.target_kind}`)}:{" "}
              {v.part === "custom"
                ? v.custom_part
                : t(`reports.part.${v.part}`)}
            </h2>
            <div className={s.meta}>
              {v.id} / {fullDate(v.created_at)}
            </div>
            <strong>{t(`reports.reason.${v.reason}`)}</strong>
            <p className={s.preview}>{v.description}</p>
          </section>
          <dl className={s.snapshot}>
            <dt>{t("reports.reporter")}</dt>
            <dd>{person(v.reporter_id)}</dd>
            <dt>{t("reports.subject")}</dt>
            <dd>
              {v.subject_id !== "0"
                ? person(v.subject_id)
                : t("reports.unspecified")}
            </dd>
            <dt>{t("reports.assignment")}</dt>
            <dd>
              {v.assigned_to !== "0"
                ? person(v.assigned_to)
                : t("reports.unassigned")}
            </dd>
            <dt>{t("reports.targetId")}</dt>
            <dd>{v.target_id}</dd>
          </dl>
          <section className={s.section}>
            <h3>{t("reports.evidence")}</h3>
            <p className={s.notice}>{t("reports.unverified")}</p>
            {v.excerpt ? (
              <pre className={s.preview}>{v.excerpt}</pre>
            ) : (
              <p className={s.meta}>{t("reports.noExcerpt")}</p>
            )}
            <ThreadFiles files={detail.files} kind="reports" />
          </section>
          <section className={s.section}>
            <h3>{t("reports.sharedDetails")}</h3>
            <p className={s.meta}>{t("reports.snapshotHint")}</p>
            <ReportSnapshot snapshot={v.snapshot} kind={v.target_kind} saved />
          </section>
          <section className={s.section}>
            <h3>{t("reports.actions")}</h3>
            <p className={s.meta}>{t("reports.actionHint")}</p>
            <div className={s.actions}>
              {v.subject_id !== "0" && (
                <>
                  <Button onClick={() => void moderate()} disabled={busy}>
                    {t("reports.moderateAccount")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      nav(`/channels/@admin/users/${v.subject_id}`)
                    }
                  >
                    {t("reports.openAccount")}
                  </Button>
                </>
              )}
              {atLeast(rank, "admin") && v.server_id !== "0" && (
                <Button
                  variant="secondary"
                  onClick={() => nav(`/channels/@admin/servers/${v.server_id}`)}
                >
                  {t("reports.openServer")}
                </Button>
              )}
              {atLeast(rank, "admin") &&
                (v.target_kind === "pack" || v.target_kind === "sticker") && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      nav(
                        `/channels/@admin/expressions/packs/${v.target_kind === "pack" ? v.target_id : String(v.snapshot.pack_id)}`,
                      )
                    }
                  >
                    {t("reports.openPack")}
                  </Button>
                )}
            </div>
          </section>
          <section className={s.section}>
            <h3>{t("reports.review")}</h3>
            <Field label={t("reports.status")}>
              <Select
                value={status}
                disabled={busy}
                onChange={(e) => setStatus(e.target.value as ReportStatus)}
              >
                {REPORT_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {t(`reports.status.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("reports.staffNote")} hint={t("reports.noteHint")}>
              <TextArea
                value={note}
                rows={3}
                maxLength={2000}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className={s.actions}>
              {atLeast(rank, "admin") && v.target_kind === "message" && (
                <div className={s.section}>
                  <Field
                    label={t("moderation.form.reason")}
                    hint={t("moderation.form.reasonVisible")}
                  >
                    <TextArea
                      value={removeReason}
                      onChange={(e) => setRemoveReason(e.target.value)}
                      maxLength={1000}
                      rows={2}
                      disabled={busy}
                    />
                  </Field>
                  <Button
                    variant="danger"
                    disabled={busy || removeReason.trim().length < 3}
                    onClick={() =>
                      useUI.getState().openModal("confirm", {
                        title: t("chat.messageMenu.deleteMessage"),
                        body: t("reports.actionHint"),
                        confirmLabel: t("chat.messageMenu.deleteMessage"),
                        danger: true,
                        onConfirm: async () => {
                          try {
                            await reports.removeMessage(
                              v.id,
                              v.version,
                              removeReason.trim(),
                            );
                            await load();
                            changed();
                          } catch (err) {
                            setError(describeError(err, t("reports.failed")));
                          }
                        },
                      })
                    }
                  >
                    {t("chat.messageMenu.deleteMessage")}
                  </Button>
                </div>
              )}
              <Button
                loading={busy}
                disabled={
                  (status === "actioned" || status === "dismissed") &&
                  note.trim().length < 3
                }
                onClick={() => void review(v.assigned_to)}
              >
                {t("reports.save")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !me || v.assigned_to === me}
                onClick={() => void review(me ?? "0")}
              >
                {t("reports.claim")}
              </Button>
              {v.assigned_to !== "0" && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void review("0")}
                >
                  {t("reports.unassign")}
                </Button>
              )}
            </div>
          </section>
          <section className={s.section}>
            <h3>{t("reports.history")}</h3>
            {detail.events.length ? (
              detail.events.map((e) => (
                <article className={s.event} key={e.id}>
                  <strong>{person(e.actor_id)}</strong> /{" "}
                  {t(`reports.status.${e.status}`)}
                  <p className={s.meta}>
                    {fullDate(e.created_at)} /{" "}
                    {e.assigned_to !== "0"
                      ? person(e.assigned_to)
                      : t("reports.unassigned")}
                  </p>
                  {e.note && <p className={s.preview}>{e.note}</p>}
                </article>
              ))
            ) : (
              <p className={s.meta}>{t("reports.noHistory")}</p>
            )}
          </section>
        </>
      )}
      {moderating && (
        <ModerateModal
          user={moderating}
          onClose={() => setModerating(null)}
          onDone={(c) => {
            setNote((old) =>
              [old, t("reports.caseRecorded", { number: c.number })]
                .filter(Boolean)
                .join("\n"),
            );
          }}
        />
      )}
    </div>
  );
}
