import { ShareLinkButton } from "@/components/common/ShareLinkButton";
import { Check, Copy, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import type { GuestLink } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { guestLinkFor } from "@/lib/guestLink";
import { P } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { formatFull } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "@/components/modals/ServerModals.module.css";
import v from "./Voice.module.css";

import { t } from "@/i18n";
function ages(): { v: number; label: string }[] {
  return [
  { v: 3600, label: t("modals.customStatus.1Hour") },
  { v: 21600, label: t("modals.invite.6Hours") },
  { v: 86400, label: t("modals.groupInvite.1Day") },
  { v: 604800, label: t("modals.groupInvite.7Days") },
];
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);

/**
 * Invite people without an account into a call: a link they open, give a
 * name and pass a captcha, and they are in the call as guests. They can only
 * be in the call; they see nothing of the server or the conversation.
 */
export function GuestLinkModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const toast = useUI((u) => u.toast);
  const channel = useChannels((c) => c.byId[channelId]);
  const server = useServers((st) => (channel?.server_id ? st.byId[channel.server_id] : undefined));
  // everyone in a DM or group, and a voice channel's moderators, can turn off every link to the call
  const managesAll = !channel?.server_id || canI(server, P.MOVE_MEMBERS, channelId) || canI(server, P.MANAGE_CHANNELS, channelId);
  const [state, setState] = useState<{ url: string; link: GuestLink } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [age, setAge] = useState(86400);
  const [confirming, setConfirming] = useState(false);
  // only the newest request may fill in the link
  const seq = useRef(0);

  const load = async (opts: { fresh?: boolean; maxAge?: number } = {}) => {
    const n = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const next = await guestLinkFor(channelId, opts);
      if (n === seq.current) setState(next);
    } catch (err) {
      if (n === seq.current) setError(errorText(err, t("voice.guestLink.couldNotMakeAGuestLink")));
    } finally {
      if (n === seq.current) setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const copy = () => {
    if (!state) return;
    void navigator.clipboard?.writeText(state.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // revoking puts out whoever came in through those links; a fresh link takes the place of the one shown
  const revoke = async () => {
    setBusy(true);
    try {
      const { revoked } = await guestsApi.revokeAll(channelId);
      toast(revoked ? t("voice.guestLink.thoseGuestLinksNoLongerWork") : t("voice.guestLink.thereWereNoGuestLinksTo"), "success");
      setConfirming(false);
      setState(null);
      await load({ fresh: true, maxAge: age });
    } catch (err) {
      toast(errorText(err, t("voice.guestLink.couldNotRevokeTheLinks")), "error");
      setBusy(false);
    }
  };

  const expires = state ? new Date(state.link.expires_at) : null;
  // Copying the link is what the dialog is for; revoking breaks every link
  // already handed out, so it is a quiet button at the foot that asks first,
  // not the biggest, brightest control in the dialog.
  const revokeLabel = managesAll ? t("voice.guestLink.revokeAll") : t("voice.guestLink.revokeMine");
  const footer = confirming ? (
    <>
      <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{t("chat.editMessage.cancel")}</Button>
      <Button variant="danger" onClick={() => void revoke()} disabled={busy} data-testid="guest-link-revoke-confirm">{revokeLabel}</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" className={v.revokeStart} onClick={() => setConfirming(true)} disabled={busy} data-testid="guest-link-revoke">{revokeLabel}</Button>
      <Button variant="secondary" onClick={onClose}>{t("modals.serverNotifications.done")}</Button>
    </>
  );
  return (
    <Modal open onClose={onClose} title={t("voice.guestLink.inviteGuestsToThisCall")} width={480} footer={footer}>
      <div className={s.form}>
        <p className={s.hint}>{t("voice.guestLink.anyoneWithThisLinkCanJoin")}</p>
        <Field label={t("voice.guestLink.guestLink")} hint={expires ? t("voice.guestLink.newGuestsCanUseItUntil", { when: formatFull(expires.getTime()) }) : undefined}>
          <div className={s.linkRow}>
            <TextInput readOnly value={state?.url ?? ""} placeholder={busy ? t("voice.guestLink.makingALink") : ""} onFocus={(e) => e.currentTarget.select()} data-testid="guest-link" />
            <Button onClick={copy} variant={copied ? "positive" : "primary"} disabled={!state} data-testid="guest-link-copy">{copied ? <><Check size={16} /> {t("modals.groupInvite.copied")}</> : <><Copy size={16} /> {t("modals.groupInvite.copy")}</>}</Button>
            <ShareLinkButton link={state?.url ?? ""} title={t("voice.guestLink.inviteGuestsToThisCall")} />
          </div>
        </Field>
        {error ? <p className={s.hint} style={{ color: "var(--text-danger)" }}>{error}</p> : null}
        <div className={s.keyNote}>
          <ShieldCheck size={16} />
          <span>{t("voice.guestLink.theCallStaysEndToEnd")}</span>
        </div>
        <div className={s.sep} />
        <div className={s.row2}>
          <Field label={t("voice.guestLink.newLinkExpiresAfter")}>
            <Select value={age} onChange={(e) => setAge(Number(e.target.value))}>
              {ages().map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <Button variant="secondary" onClick={() => void load({ fresh: true, maxAge: age })} disabled={busy} data-testid="guest-link-new">{t("voice.guestLink.newLink")}</Button>
          </div>
        </div>
        {confirming ? (
          <div className={s.keyNote} data-warn="true" role="alert" data-testid="guest-link-revoke-warning">
            <TriangleAlert size={16} />
            <span>{managesAll ? t("voice.guestLink.revokeAllWarning") : t("voice.guestLink.revokeMineWarning")}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
