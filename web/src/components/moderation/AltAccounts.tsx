import { Ban, Link2, MessageSquareOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { moderation as modApi, type ModAlt, type ModUser } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import { formatRelative } from "@/lib/time";
import { t } from "@/i18n";
import m from "./Moderation.module.css";

/** "Alt Accounts: 5" on an account that shares an address with others; opens the list. */
export function AltBadge({ user, onOpen }: { user: ModUser; onOpen: () => void }) {
  if (!user.alt_count) return null;
  return (
    <button type="button" className={m.altBadge} onClick={onOpen} title={t("moderation.alts.tip")} data-testid="alt-badge">
      <Link2 size={12} aria-hidden="true" />
      {t("moderation.alts.badge", { count: user.alt_count })}
    </button>
  );
}

/**
 * Every account seen at one of the same addresses as this one, with how many
 * they share. People on one network (a home, a school, a VPN) show here too,
 * so the dialog says so.
 */
export function AltAccountsModal({ user, onClose }: { user: ModUser; onClose: () => void }) {
  const nav = useNavigate();
  const [alts, setAlts] = useState<ModAlt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    modApi
      .alts(user.id)
      .then((r) => alive && setAlts(r.alts))
      .catch((err) => alive && setError(describeError(err, t("moderation.loadFailed"))));
    return () => {
      alive = false;
    };
  }, [user.id]);
  const open = (id: string) => {
    onClose();
    nav(`/channels/@admin/users/${id}`);
  };
  return (
    <Modal open onClose={onClose} bare width={520} ariaLabel={t("moderation.alts.title", { name: user.display_name })}>
      <div className={m.modal} data-testid="alts-modal">
        <div className={m.modalTop}>
          <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={40} />
          <div style={{ minWidth: 0 }}>
            <h2 className={m.modalTitle}>{t("moderation.alts.title", { name: user.display_name })}</h2>
            <div className={m.modalTarget}>
              <span>@{user.username}</span>
            </div>
          </div>
          <button type="button" className={m.modalClose} onClick={onClose} aria-label={t("chat.attachments.close")}>
            <X size={20} />
          </button>
        </div>
        <div className={m.modalScroll}>
          <p className={m.note}>{t("moderation.alts.explain")}</p>
          {error ? <p className={m.danger} role="alert">{error}</p> : null}
          {!alts && !error ? (
            <div style={{ padding: 16, display: "grid", placeItems: "center" }}>
              <Spinner size={24} label={t("chat.pins.loading")} />
            </div>
          ) : null}
          {alts && alts.length === 0 ? <p className={m.note}>{t("moderation.alts.none")}</p> : null}
          {alts?.length ? (
            <ul className={m.altList}>
              {alts.map((a) => (
                <li key={a.user.id}>
                  <button type="button" className={m.altRow} onClick={() => open(a.user.id)} data-testid="alt-row">
                    <Avatar id={a.user.id} avatarId={a.user.avatar_id} name={a.user.display_name} size={36} />
                    <span className={m.altWho}>
                      <span className={m.altName}>
                        {a.user.display_name}
                        {a.user.ban ? <Ban size={13} aria-label={t("moderation.state.banned")} className={m.altBan} /> : null}
                        {a.user.mute ? <MessageSquareOff size={13} aria-label={t("moderation.state.muted")} className={m.altMute} /> : null}
                      </span>
                      <span className={m.altSub}>@{a.user.username}</span>
                    </span>
                    <span className={m.altShared}>
                      <span>{t("moderation.alts.shared", { count: a.shared_ips })}</span>
                      <span>{t("moderation.alts.lastShared", { when: formatRelative(a.last_shared_at) })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={m.modalFoot}>
          <span className={m.grow} />
          <Button variant="ghost" onClick={onClose}>
            {t("moderation.alts.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
