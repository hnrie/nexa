import { SmilePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { Twemoji } from "@/components/common/Twemoji";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { gateway } from "@/gateway/session";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import s from "./CustomStatusModal.module.css";

import { t as tr_ } from "@/i18n";
function clearChoices(): { label: string; ms: number | null }[] {
  return [
  { label: tr_("modals.customStatus.donTClear"), ms: null },
  { label: tr_("modals.customStatus.30Minutes"), ms: 30 * 60_000 },
  { label: tr_("modals.customStatus.1Hour"), ms: 60 * 60_000 },
  { label: tr_("modals.customStatus.4Hours"), ms: 4 * 60 * 60_000 },
  { label: tr_("modals.customStatus.today"), ms: -1 },
];
}

export function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const me = useAuth((a) => a.me);
  const presence = usePresence((p) => (me ? p.byUser[me.id] : undefined));
  const setPresence = usePresence((p) => p.set);
  const [text, setText] = useState(presence?.status_text ?? "");
  const [emoji, setEmoji] = useState(presence?.status_emoji ?? "");
  const [clear, setClear] = useState(0);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  // The picker closes itself on any press outside it, this button included, before the click
  // lands; remember it was open so that click closes it rather than opening it again.
  const pickerWasOpen = useRef(false);

  const save = () => {
    if (!me) return;
    const opt = clearChoices()[clear];
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
    <Modal open onClose={onClose} title={tr_("modals.customStatus.setACustomStatus")} width={440} footer={<><Button variant="ghost" onClick={onClose}>{tr_("chat.editMessage.cancel")}</Button><Button onClick={save}>{tr_("chat.editMessage.save")}</Button></>}>
      <div className={s.form}>
        <div className={s.row}>
          <Field label={tr_("modals.customStatus.emoji")} className={s.emoji}>
            <div className={s.emojiPick}>
              <button
                type="button"
                className={s.emojiBtn}
                aria-label={emoji ? tr_("modals.customStatus.changeTheEmoji") : tr_("pickers.emojiPicker.pickAnEmoji")}
                onMouseDown={() => { pickerWasOpen.current = !!picker; }}
                onClick={(e) => {
                  const wasOpen = pickerWasOpen.current || !!picker;
                  pickerWasOpen.current = false;
                  setPicker(wasOpen ? null : e.currentTarget.getBoundingClientRect());
                }}
                data-testid="status-emoji"
                data-picker-toggle={picker ? true : undefined}
              >
                {emoji ? <Twemoji text={emoji} className={s.emojiImg} title="" /> : <SmilePlus size={20} />}
              </button>
              {emoji ? (
                <button type="button" className={s.emojiClear} aria-label={tr_("modals.customStatus.removeTheEmoji")} onClick={() => setEmoji("")}><X size={12} /></button>
              ) : null}
            </div>
          </Field>
          <Field label={`What's cookin', ${me?.display_name ?? ""}?`} className={s.textField}>
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder={tr_("modals.customStatus.supportHasArrived")} maxLength={128} autoFocus />
          </Field>
        </div>
        {picker ? (
          <ExpressionPicker
            anchor={picker}
            onClose={() => setPicker(null)}
            onEmoji={(e) => {
              // a custom emoji is a server picture; a status can only carry text
              if (!e.custom) setEmoji(e.unicode);
              setPicker(null);
            }}
          />
        ) : null}
        <Field label={tr_("modals.customStatus.clearAfter")}>
          <select className={s.select} value={clear} onChange={(e) => setClear(Number(e.target.value))}>
            {clearChoices().map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
          </select>
        </Field>
        {presence?.status_text || presence?.status_emoji ? (
          <Button variant="link" onClick={() => { setText(""); setEmoji(""); }}>{tr_("modals.customStatus.clearStatus")}</Button>
        ) : null}
      </div>
    </Modal>
  );
}
