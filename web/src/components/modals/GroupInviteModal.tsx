import { Check, Copy, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Invite } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { inviteUrl } from "@/lib/inviteLink";
import { JOIN_LINK_SETTINGS } from "@/lib/joinRequest";
import { formatFull } from "@/lib/time";
import { channelDisplayName } from "@/lib/names";
import { ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { copyText } from "@/lib/copyText";
import { useUsers } from "@/stores/users";
import { GroupFriendAdder } from "./GroupFriendAdder";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
function ages(): { v: number; label: string }[] {
  return [
  { v: 1800, label: t("modals.customStatus.30Minutes") },
  { v: 86400, label: t("modals.groupInvite.1Day") },
  { v: 604800, label: t("modals.groupInvite.7Days") },
  { v: 0, label: t("modals.groupInvite.never") },
];
}
const USES = [0, 1, 5, 10, 25];

/**
 * Bringing people into a group chat: friends added straight from the list (a
 * Link Only friend is sent this link in a direct message instead, with Send
 * Join Request), or a shareable link that adds whoever opens it.
 */
export function GroupInviteModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const channel = useChannels((c) => c.byId[channelId]);
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [age, setAge] = useState(JOIN_LINK_SETTINGS.max_age);
  const [uses, setUses] = useState(JOIN_LINK_SETTINGS.max_uses);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = ring.latest(channelId);
  // only the newest request may fill in the link, so a slow earlier one cannot show old settings
  const seq = useRef(0);
  const newest = useRef<Promise<Invite> | null>(null);

  /** Makes the link for these settings, and shows it while it is still the newest asked for. */
  const make = (a: number, u: number): Promise<Invite> => {
    const n = ++seq.current;
    setBusy(true);
    const job = channelsApi.createGroupInvite(channelId, { max_age: a, max_uses: u });
    newest.current = job;
    void job
      .then(
        (inv) => {
          if (n === seq.current) setInvite(inv);
        },
        () => undefined,
      )
      .finally(() => {
        if (n === seq.current) setBusy(false);
      });
    return job;
  };
  /** The same, saying so when it fails and is still the newest. */
  const generate = (a = age, u = uses) => {
    const job = make(a, u);
    const n = seq.current;
    job.catch((err: unknown) => {
      if (n === seq.current) toast(err instanceof ApiError ? err.message : t("modals.groupInvite.couldNotCreateAnInvite"), "error");
    });
  };
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * The link a join request carries: the one shown here, once the request for
   * these settings is in, or one made now with them when that failed. A
   * failure here is the join request's to report.
   */
  const joinLink = async (): Promise<string> => {
    const shown = await newest.current?.catch(() => null);
    const inv = shown ?? (await make(age, uses));
    return inviteUrl(inv.code, ring.latest(channelId));
  };

  if (!channel) return null;
  const name = channelDisplayName(channel, users, meId);
  const link = invite ? inviteUrl(invite.code, key) : "";
  const copy = () => {
    if (!link) return;
    void copyText(link).then((ok) => {
      if (!ok) {
        useUI.getState().toast(t("common.copyFailed"), "error");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Modal open onClose={onClose} title={t("modals.groupInvite.invitePeopleTo", { name })} width={480}>
      <div className={s.form}>
        <GroupFriendAdder channelId={channelId} joinLink={joinLink} />
        <div className={s.sep} role="presentation" />
        <p className={s.hint}>{t("modals.groupInvite.anyoneWithThisLinkJoinsThe")}</p>
        <Field label={t("modals.createServer.inviteLink")} hint={invite?.expires_at ? t("modals.groupInvite.expiresOn", { when: formatFull(invite.expires_at) }) : t("modals.groupInvite.thisLinkNeverExpires")}>
          <div className={s.linkRow}>
            <TextInput readOnly value={link} placeholder={busy ? t("modals.groupInvite.generating") : ""} onFocus={(e) => e.currentTarget.select()} data-testid="group-invite-link" />
            <Button onClick={copy} variant={copied ? "positive" : "primary"} disabled={!link}>{copied ? <><Check size={16} /> {t("modals.groupInvite.copied")}</> : <><Copy size={16} /> {t("modals.groupInvite.copy")}</>}</Button>
          </div>
        </Field>
        <div className={s.keyNote} data-warn={!key}>
          <KeyRound size={16} />
          <span>{key ? t("modals.groupInvite.theLinkCarriesThisChatS") : t("modals.groupInvite.youDoNotHoldThisChat")}</span>
        </div>
        <div className={s.row2}>
          <Field label={t("modals.groupInvite.expireAfter")}>
            <Select value={age} onChange={(e) => { const v = Number(e.target.value); setAge(v); generate(v, uses); }}>
              {ages().map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label={t("modals.groupInvite.maxNumberOfUses")}>
            <Select value={uses} onChange={(e) => { const v = Number(e.target.value); setUses(v); generate(age, v); }}>
              {USES.map((u) => <option key={u} value={u}>{u === 0 ? t("modals.groupInvite.noLimit") : t("modals.groupInvite.usesCount", { count: u })}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
