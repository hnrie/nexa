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
import { channelDisplayName } from "@/lib/names";
import { ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./ServerModals.module.css";

const AGES: { v: number; label: string }[] = [
  { v: 1800, label: "30 minutes" },
  { v: 86400, label: "1 day" },
  { v: 604800, label: "7 days" },
  { v: 0, label: "Never" },
];
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
      if (n === seq.current) toast(err instanceof ApiError ? err.message : "Could not create an invite.", "error");
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
    <Modal open onClose={onClose} title={`Invite people to ${name}`} width={480}>
      <div className={s.form}>
        <p className={s.hint}>Anyone with this link joins the group, friend or not. Group chats have no size limit here.</p>
        <Field label="Invite link" hint={invite?.expires_at ? `Expires ${new Date(invite.expires_at).toLocaleString()}.` : "This link never expires."}>
          <div className={s.linkRow}>
            <TextInput readOnly value={link} placeholder={busy ? "Generating…" : ""} onFocus={(e) => e.currentTarget.select()} data-testid="group-invite-link" />
            <Button onClick={copy} variant={copied ? "positive" : "primary"} disabled={!link}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}</Button>
          </div>
        </Field>
        <div className={s.keyNote} data-warn={!key}>
          <KeyRound size={16} />
          <span>{key ? "The link carries this chat's encryption key, so whoever joins can read what is already here." : "You do not hold this chat's key yet, so the link cannot carry it. Someone who has it needs to be online when the new member joins."}</span>
        </div>
        <div className={s.row2}>
          <Field label="Expire after">
            <Select value={age} onChange={(e) => { const v = Number(e.target.value); setAge(v); void generate(v, uses); }}>
              {AGES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="Max number of uses">
            <Select value={uses} onChange={(e) => { const v = Number(e.target.value); setUses(v); void generate(age, v); }}>
              {USES.map((u) => <option key={u} value={u}>{u === 0 ? "No limit" : `${u} use${u === 1 ? "" : "s"}`}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
