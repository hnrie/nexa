import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { gateway } from "@/gateway/session";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import s from "./CustomStatusModal.module.css";

const CLEAR: { label: string; ms: number | null }[] = [
  { label: "Don't clear", ms: null },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "4 hours", ms: 4 * 60 * 60_000 },
  { label: "Today", ms: -1 },
];

export function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const me = useAuth((a) => a.me);
  const presence = usePresence((p) => (me ? p.byUser[me.id] : undefined));
  const setPresence = usePresence((p) => p.set);
  const [text, setText] = useState(presence?.status_text ?? "");
  const [emoji, setEmoji] = useState(presence?.status_emoji ?? "");
  const [clear, setClear] = useState(0);

  const save = () => {
    if (!me) return;
    const opt = CLEAR[clear];
    let expires: number | null = null;
    if (opt?.ms === -1) {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      expires = d.getTime();
    } else if (opt?.ms) expires = Date.now() + opt.ms;
    const t = text.trim().slice(0, 128);
    const em = emoji.trim().slice(0, 64);
    gateway()?.sendPresence(t || em ? { status_text: t, status_emoji: em, status_expires_at: expires } : { clear_status: true });
    setPresence({ user_id: me.id, status: presence?.status ?? "online", status_text: t, status_emoji: em, status_expires_at: expires });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Set a custom status" width={440} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className={s.form}>
        <div className={s.row}>
          <Field label="Emoji" className={s.emoji}>
            <TextInput value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="😀" maxLength={16} />
          </Field>
          <Field label={`What's cookin', ${me?.display_name ?? ""}?`} className={s.textField}>
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Support has arrived!" maxLength={128} autoFocus />
          </Field>
        </div>
        <Field label="Clear after">
          <select className={s.select} value={clear} onChange={(e) => setClear(Number(e.target.value))}>
            {CLEAR.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
          </select>
        </Field>
        {presence?.status_text || presence?.status_emoji ? (
          <Button variant="link" onClick={() => { setText(""); setEmoji(""); }}>Clear status</Button>
        ) : null}
      </div>
    </Modal>
  );
}
