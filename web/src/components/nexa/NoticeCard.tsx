import { ArrowRight, Clock, MessagesSquare } from "lucide-react";
import type { MemberCase, People, ResetField, StaffCase } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { actionIcon, caseStanding, fieldLabel, formatSpan, fullDate, noticeExplainer, noticeTitle, relativeTo, severity } from "@/lib/moderation";
import { formatBytes, formatTimestamp } from "@/lib/time";
import { t } from "@/i18n";
import { PersonChip } from "./NexaBits";
import s from "./Nexa.module.css";

interface Props {
  c: MemberCase | StaffCase;
  people: People;
  /** Staff see the values a reset took away and whether the notice was read. */
  perspective: "member" | "staff";
  /** Shows the button that opens the case's thread. */
  onOpenThread?: () => void;
  /** Leaves out the headline, for where the page around it already says it. */
  bare?: boolean;
}

function isStaffCase(c: MemberCase | StaffCase): c is StaffCase {
  return "user_id" in c;
}

/**
 * A case, as its notice: what was done, why, by whom, and where it stands.
 * The same card is the Nexa message, the pop-up, the ban screen and the top of
 * the case's thread, so the member reads the same thing wherever they meet it.
 */
export function NoticeCard({ c, people, perspective, onOpenThread, bare = false }: Props) {
  const Icon = actionIcon(c.action);
  const tone = severity(c.action);
  const standing = caseStanding(c);
  const d = c.details;
  const staff = perspective === "staff";
  return (
    <article className={s.notice} data-tone={tone} aria-label={noticeTitle(c.action, d)}>
      {!bare ? (
        <header className={s.noticeHead}>
          <span className={s.noticeIcon} data-tone={tone} aria-hidden="true">
            <Icon size={18} />
          </span>
          <div className={s.noticeTitles}>
            <h3 className={s.noticeTitle}>{noticeTitle(c.action, d)}</h3>
            <p className={s.noticeExplainer}>{noticeExplainer(c)}</p>
          </div>
          {standing ? (
            <span className={s.chip} data-tone={standing.tone}>
              {standing.label}
            </span>
          ) : null}
        </header>
      ) : null}

      <section className={s.reason}>
        <span className={s.label}>{t("nexa.notice.reason")}</span>
        <p className={s.reasonText}>{c.reason}</p>
      </section>

      {c.action === "avatar_remove" ? (
        <p className={s.detailLine}>
          {t("nexa.notice.removed", { what: [d.avatar ? t("moderation.field.avatar") : "", d.banner ? t("moderation.field.banner") : ""].filter(Boolean).join(", ") })}
        </p>
      ) : null}

      {c.action === "field_reset" && d.fields?.length ? (
        <div className={s.fields} role="table" aria-label={t("nexa.notice.resetFields")}>
          {d.fields.map((f: ResetField) => (
            <div className={s.fieldRow} role="row" key={f}>
              <span className={s.fieldName} role="cell">{fieldLabel(f)}</span>
              <span className={s.fieldValue} role="cell">
                {staff && d.old?.[f] ? (
                  <>
                    <span className={s.oldValue} title={d.old[f]}>{d.old[f]}</span>
                    <ArrowRight size={14} aria-hidden="true" className={[s.fieldArrow, s.flip].join(" ")} />
                  </>
                ) : null}
                <span className={s.newValue}>{f === "status" ? t("nexa.notice.cleared") : f === "username" ? `@${d.new?.[f] ?? ""}` : d.new?.[f]}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {c.action === "field_reset" && d.fields?.includes("username") && d.new?.username ? (
        <p className={s.callout}>
          {staff
            ? t("nexa.notice.signInNoteStaff", { old: `@${d.old?.username ?? ""}` })
            : t("nexa.notice.signInNote", { next: d.new.username, old: d.old?.username ?? "" })}
        </p>
      ) : null}

      {c.action === "mute" || c.action === "ban" ? (
        <p className={s.detailLine}>
          <Clock size={14} aria-hidden="true" />
          {c.expires_at === null
            ? t("nexa.notice.permanent")
            : t("nexa.notice.duration", { span: d.duration_ms ? formatSpan(d.duration_ms) : relativeTo(c.expires_at), until: fullDate(c.expires_at) })}
        </p>
      ) : null}

      {c.action === "delete" && d.counts && staff ? (
        <p className={s.detailLine}>
          {t("moderation.delete.removedSummary", { messages: d.counts.messages, files: d.counts.attachments, size: formatBytes(d.counts.attachment_bytes), servers: d.counts.owned_servers, groups: d.counts.owned_groups })}
          {d.complete === false ? ` ${t("moderation.delete.incomplete")}` : ""}
        </p>
      ) : null}

      {c.lifted_at ? (
        <div className={s.lifted}>
          <p className={s.liftedLine}>
            {t("nexa.notice.liftedBy")} {c.lifted_by ? <PersonChip id={c.lifted_by} person={people[c.lifted_by]} size={16} /> : null}
            <time className={s.meta} dateTime={new Date(c.lifted_at).toISOString()} title={fullDate(c.lifted_at)}>
              {formatTimestamp(c.lifted_at)}
            </time>
          </p>
          {c.lift_reason ? <p className={s.liftReason}>“{c.lift_reason}”</p> : null}
        </div>
      ) : null}

      <footer className={s.noticeFoot}>
        <span className={s.credit}>
          {t("nexa.notice.actionedBy")} <PersonChip id={c.moderator_id} person={people[c.moderator_id]} size={18} withUsername />
        </span>
        <span className={s.meta}>
          {t("nexa.notice.caseNumber", { number: c.number })} · <time dateTime={new Date(c.created_at).toISOString()} title={fullDate(c.created_at)}>{formatTimestamp(c.created_at)}</time>
        </span>
        {staff && isStaffCase(c) ? (
          <span className={s.meta}>{c.notice_ack_at ? t("moderation.case.seenAt", { when: formatTimestamp(c.notice_ack_at) }) : t("moderation.case.notSeen")}</span>
        ) : null}
      </footer>

      {onOpenThread ? (
        <div className={s.noticeActions}>
          <Button size="sm" variant="secondary" onClick={onOpenThread} data-testid="open-case-thread">
            <MessagesSquare size={16} aria-hidden="true" /> {c.action === "delete" ? t("nexa.notice.viewCase") : t("nexa.notice.openThread")}
            {c.unread > 0 ? <span className={s.pill}>{c.unread}</span> : null}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
