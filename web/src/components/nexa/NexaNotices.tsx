import { PersonName } from "@/components/common/PersonName";
import { MessageSquareOff, UserX } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { MemberCase, Restriction } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { describeError } from "@/lib/errors";
import { fullDate, personName, relativeTo } from "@/lib/moderation";
import { formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useBan, useNexa } from "@/stores/nexa";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { NexaAvatar, OfficialBadge } from "./NexaBits";
import { NoticeCard } from "./NoticeCard";
import s from "./Nexa.module.css";

const NONE: MemberCase[] = [];

/**
 * The pop-up every new case gives its member, on every device they have
 * open, until they dismiss it: the same notice their Nexa conversation holds,
 * with the way into its thread. Several wait their turn, oldest first.
 */
export function NexaNotices() {
  const pending = useNexa((n) => n.state?.pending ?? NONE);
  const people = useNexa((n) => n.people);
  const status = useAuth((a) => a.status);
  const ban = useBan();
  const toast = useUI((u) => u.toast);
  const loc = useLocation();
  const nav = useNavigate();
  // a deletion is shown by DeletedNotice, which outlives the sign-out
  const queue = pending.filter((c) => c.action !== "delete");
  const c = queue[0];
  // the ban screen says it all; the case's own page shows its notice already
  if (!c || status !== "ready" || ban || loc.pathname === `/channels/@me/nexa/cases/${c.id}`) return null;
  const dismiss = () => void useNexa.getState().ack(c.id).catch((err) => toast(describeError(err), "error"));
  const open = () => {
    dismiss();
    nav(`/channels/@me/nexa/cases/${c.id}`);
  };
  return (
    <Modal open onClose={dismiss} bare width={560} closeOnOverlay={false} ariaLabel={t("nexa.modal.label")}>
      <div className={s.modalCard} data-testid="nexa-notice-modal">
        <div className={s.modalHead}>
          <NexaAvatar size={40} />
          <div className={s.modalWho}>
            <span className={s.modalName}>
              Nexa <OfficialBadge />
            </span>
            <span className={s.modalSub}>{t("nexa.modal.sub")}</span>
          </div>
          {queue.length > 1 ? <span className={s.modalCount}>{t("nexa.modal.count", { count: queue.length })}</span> : null}
        </div>
        <div className={s.modalBody}>
          <NoticeCard c={c} people={people} perspective="member" />
        </div>
        <div className={s.modalFoot}>
          <Button variant="secondary" onClick={dismiss} data-testid="nexa-notice-dismiss">
            {t("nexa.modal.gotIt")}
          </Button>
          <Button onClick={open} data-testid="nexa-notice-open">
            {t("nexa.notice.openThread")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Deleting an account signs it out straight after telling it why, so the
 * notice is kept here, outside the signed-in app, and read on the way out.
 */
export function DeletedNotice() {
  const d = useNexa((n) => n.deleted);
  if (!d) return null;
  const c = d.case;
  const moderator = d.people[c.moderator_id];
  return (
    <Modal open onClose={() => useNexa.getState().dismissDeleted()} bare width={520} closeOnOverlay={false} ariaLabel={t("nexa.notice.titleDelete")}>
      <div className={s.modalCard} data-testid="nexa-deleted-notice">
        <div className={s.modalHead}>
          <NexaAvatar size={40} />
          <div className={s.modalWho}>
            <span className={s.modalName}>
              Nexa <OfficialBadge />
            </span>
            <span className={s.modalSub}>{t("nexa.modal.sub")}</span>
          </div>
        </div>
        <div className={s.modalBody}>
          <article className={s.notice} data-tone="danger">
            <header className={s.noticeHead}>
              <span className={s.noticeIcon} data-tone="danger" aria-hidden="true">
                <UserX size={18} />
              </span>
              <div className={s.noticeTitles}>
                <h3 className={s.noticeTitle}>{t("nexa.notice.titleDelete")}</h3>
                <p className={s.noticeExplainer}>{t("nexa.notice.explainDelete")}</p>
              </div>
            </header>
            <section className={s.reason}>
              <span className={s.label}>{t("nexa.notice.reason")}</span>
              <p className={s.reasonText}>{c.reason}</p>
            </section>
            <footer className={s.noticeFoot}>
              <span className={s.credit}>
                {t("nexa.notice.actionedBy")} <strong><PersonName userId={moderator?.deleted ? null : c.moderator_id} user={moderator?.deleted ? null : moderator}>{personName(moderator)}</PersonName></strong>
                {moderator && !moderator.deleted ? <span className={s.personUser}>@{moderator.username}</span> : null}
              </span>
              <span className={s.meta}>
                {t("nexa.notice.caseNumber", { number: c.number })} · {formatTimestamp(c.created_at)}
              </span>
            </footer>
          </article>
        </div>
        <div className={s.modalFoot}>
          <Button onClick={() => useNexa.getState().dismissDeleted()}>{t("nexa.modal.gotIt")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** In place of the composer while the account is muted: why, until when, and where to appeal. */
export function MutedBar({ mute }: { mute: Restriction }) {
  const nav = useNavigate();
  return (
    <div className={s.mutedBar} role="status" data-testid="muted-bar">
      <span className={s.mutedIcon} aria-hidden="true">
        <MessageSquareOff size={22} />
      </span>
      <span className={s.mutedText}>
        <strong>{t("nexa.muted.title")}</strong> {t("nexa.muted.body")}
        <span className={s.mutedWhen}>{mute.expires_at === null ? t("nexa.muted.untilLifted") : t("nexa.muted.until", { when: fullDate(mute.expires_at), rel: relativeTo(mute.expires_at) })}</span>
      </span>
      <Button size="sm" variant="secondary" onClick={() => nav(`/channels/@me/nexa/cases/${mute.case_id}`)}>
        {t("nexa.muted.details")}
      </Button>
    </div>
  );
}
