import { Check, Copy, KeyRound, Hash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Invite } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { inviteUrl } from "@/lib/inviteLink";
import { formatFull } from "@/lib/time";
import { ring } from "@/lib/keyring";
import { P } from "@/lib/perms";
import { selectServerChannels, useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
function ages(): { v: number; label: string }[] {
  return [
  { v: 1800, label: t("modals.customStatus.30Minutes") },
  { v: 3600, label: t("modals.customStatus.1Hour") },
  { v: 21600, label: t("modals.invite.6Hours") },
  { v: 43200, label: t("modals.invite.12Hours") },
  { v: 86400, label: t("modals.groupInvite.1Day") },
  { v: 604800, label: t("modals.groupInvite.7Days") },
  { v: 0, label: t("modals.groupInvite.never") },
];
}
const USES = [0, 1, 5, 10, 25, 50, 100];

export function InviteModal({ onClose, serverId, channelId }: { onClose: () => void; serverId: string; channelId?: string | undefined }) {
  const st = useServers((x) => x.byId[serverId]);
  const channels = useChannels((c) => c.byId);
  const toast = useUI((u) => u.toast);
  const candidates = useMemo(() => selectServerChannels(channels, serverId).filter((c) => c.type === "text" && canI(st, P.CREATE_INSTANT_INVITE, c.id)), [channels, serverId, st]);
  const [channel, setChannel] = useState(channelId && candidates.some((c) => c.id === channelId) ? channelId : (candidates[0]?.id ?? ""));
  const [age, setAge] = useState(604800);
  const [uses, setUses] = useState(0);
  const [withKey, setWithKey] = useState(true);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = ring.latest(serverId);
  // only the newest request may fill in the link, so a slow earlier one cannot show old settings
  const seq = useRef(0);

  const generate = async (ch = channel, a = age, u = uses) => {
    if (!ch) return;
    const n = ++seq.current;
    setBusy(true);
    try {
      const inv = await serversApi.createInvite(ch, { max_age: a, max_uses: u });
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

  const link = invite ? inviteUrl(invite.code, withKey && key ? key : null) : "";
  const copy = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const chName = channels[channel]?.name ?? "";

  return (
    <Modal open onClose={onClose} title={t("modals.invite.inviteFriendsTo", { name: st?.server.name ?? t("modals.invite.theServer") })} width={480}>
      <div className={s.form}>
        <Field label={t("modals.invite.inviteToChannel")}>
          <Select value={channel} onChange={(e) => { setChannel(e.target.value); void generate(e.target.value); }}>
            {candidates.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t("modals.invite.sendAServerInviteLinkTo")} hint={invite ? `${invite.expires_at ? t("modals.invite.yourInviteLinkExpiresOn", { when: formatFull(invite.expires_at) }) : t("modals.invite.yourInviteLinkExpiresNever")}${invite.max_uses ? t("modals.invite.andCanBeUsedTimes", { count: invite.max_uses }) : ""}.` : undefined}>
          <div className={s.linkRow}>
            <TextInput readOnly value={link} placeholder={busy ? t("modals.groupInvite.generating") : ""} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <Button onClick={copy} variant={copied ? "positive" : "primary"} disabled={!link}>{copied ? <><Check size={16} /> {t("modals.groupInvite.copied")}</> : <><Copy size={16} /> {t("modals.groupInvite.copy")}</>}</Button>
          </div>
        </Field>
        <div className={s.keyNote} data-warn={!key}>
          <KeyRound size={16} />
          <span>{key ? t("modals.invite.thisLinkCarriesTheServerS") : t("modals.invite.youDonTHoldThisServer")}</span>
        </div>
        <Toggle checked={withKey && !!key} disabled={!key} onChange={setWithKey} label={t("modals.invite.includeTheEncryptionKeyInThe")} />
        <div className={s.sep} />
        <div className={s.row2}>
          <Field label={t("modals.groupInvite.expireAfter")}>
            <Select value={age} onChange={(e) => { const v = Number(e.target.value); setAge(v); void generate(channel, v, uses); }}>
              {ages().map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label={t("modals.groupInvite.maxNumberOfUses")}>
            <Select value={uses} onChange={(e) => { const v = Number(e.target.value); setUses(v); void generate(channel, age, v); }}>
              {USES.map((u) => <option key={u} value={u}>{u === 0 ? t("modals.invite.noLimit") : t("modals.invite.usesCount", { count: u })}</option>)}
            </Select>
          </Field>
        </div>
        <p className={s.fine}><Hash size={12} /> {chName ? t("modals.invite.landInChannel", { name: chName }) : t("modals.invite.pickAChannel")}</p>
      </div>
    </Modal>
  );
}
