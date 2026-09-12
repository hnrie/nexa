import { Check, Copy, KeyRound, Hash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Invite } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { inviteUrl } from "@/lib/inviteLink";
import { ring } from "@/lib/keyring";
import { P } from "@/lib/perms";
import { selectServerChannels, useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

const AGES: { v: number; label: string }[] = [
  { v: 1800, label: "30 minutes" },
  { v: 3600, label: "1 hour" },
  { v: 21600, label: "6 hours" },
  { v: 43200, label: "12 hours" },
  { v: 86400, label: "1 day" },
  { v: 604800, label: "7 days" },
  { v: 0, label: "Never" },
];
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

  const generate = async (ch = channel, a = age, u = uses) => {
    if (!ch) return;
    setBusy(true);
    try {
      setInvite(await serversApi.createInvite(ch, { max_age: a, max_uses: u }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create an invite.", "error");
    } finally {
      setBusy(false);
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
    <Modal open onClose={onClose} title={`Invite friends to ${st?.server.name ?? "the server"}`} width={480}>
      <div className={s.form}>
        <Field label="Invite to channel">
          <Select value={channel} onChange={(e) => { setChannel(e.target.value); void generate(e.target.value); }}>
            {candidates.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Send a server invite link to a friend" hint={invite ? `Your invite link expires ${invite.expires_at ? `on ${new Date(invite.expires_at).toLocaleString()}` : "never"}${invite.max_uses ? ` and can be used ${invite.max_uses} times` : ""}.` : undefined}>
          <div className={s.linkRow}>
            <TextInput readOnly value={link} placeholder={busy ? "Generating…" : ""} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <Button onClick={copy} variant={copied ? "positive" : "primary"} disabled={!link}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}</Button>
          </div>
        </Field>
        <div className={s.keyNote} data-warn={!key}>
          <KeyRound size={16} />
          <span>{key ? "This link carries the server's current encryption key, so whoever opens it can read the channels right away. Anyone with the link can read the history it unlocks; keys rotate when someone is removed." : "You don't hold this server's encryption key yet, so the link can't carry it. New members will receive a key from a member who is online."}</span>
        </div>
        <Toggle checked={withKey && !!key} disabled={!key} onChange={setWithKey} label="Include the encryption key in the link" />
        <div className={s.sep} />
        <div className={s.row2}>
          <Field label="Expire after">
            <Select value={age} onChange={(e) => { const v = Number(e.target.value); setAge(v); void generate(channel, v, uses); }}>
              {AGES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="Max number of uses">
            <Select value={uses} onChange={(e) => { const v = Number(e.target.value); setUses(v); void generate(channel, age, v); }}>
              {USES.map((u) => <option key={u} value={u}>{u === 0 ? "No limit" : `${u} use${u === 1 ? "" : "s"}`}</option>)}
            </Select>
          </Field>
        </div>
        <p className={s.fine}><Hash size={12} /> {chName ? `People who use this link land in #${chName}.` : "Pick a channel to invite people to."}</p>
      </div>
    </Modal>
  );
}
