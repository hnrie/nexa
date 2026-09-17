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
import { formatFull } from "@/lib/time";
import { channelDisplayName } from "@/lib/names";
import { ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
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

/** A shareable link that adds whoever opens it to this group chat. */
export function GroupInviteModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const channel = useChannels((c) => c.byId[channelId]);
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [age, setAge] = useState(604800);
  const [uses, setUses] = useState(0);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = ring.latest(channelId);
  // only the newest request may fill in the link, so a slow earlier one cannot show old settings
  const seq = useRef(0);

  const generate = async (a = age, u = uses) => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const inv = await channelsApi.createGroupInvite(channelId, { max_age: a, max_uses: u });
      if (n === seq.current) setInvite(inv);
    } catch (err) {
      if (n === seq.current) toast(err instanceof ApiError ? err.message : t("modals.groupInvite.couldNotCreateAnInvite"), "error");
    } finally {
      if (n === seq.current) setBusy(false);
    }
  };
  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!channel) return null;
  const name = channelDisplayName(channel, users, meId);
  const link = invite ? inviteUrl(invite.code, key) : "";
  const copy = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Modal open onClose={onClose} title={t("modals.groupInvite.invitePeopleTo", { name })} width={480}>
      <div className={s.form}>
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
            <Select value={age} onChange={(e) => { const v = Number(e.target.value); setAge(v); void generate(v, uses); }}>
              {ages().map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label={t("modals.groupInvite.maxNumberOfUses")}>
            <Select value={uses} onChange={(e) => { const v = Number(e.target.value); setUses(v); void generate(age, v); }}>
              {USES.map((u) => <option key={u} value={u}>{u === 0 ? t("modals.groupInvite.noLimit") : t("modals.groupInvite.usesCount", { count: u })}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
