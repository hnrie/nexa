import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { humanizeMentions } from "@/components/composer/mentions";
import { editMessage } from "@/components/composer/send";
import { useAutosize } from "@/components/composer/useAutosize";
import type { DecryptedMessage } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./Chat.module.css";

import { t } from "@/i18n";
export function EditMessage({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const endEdit = useUI((u) => u.endEdit);
  const setEditDraft = useUI((u) => u.setEditDraft);
  const toast = useUI((u) => u.toast);
  // an edit left behind in another conversation comes back with what was typed
  const [text, setText] = useState(() => {
    const parked = useUI.getState().editDrafts[msg.channel_id];
    return parked?.messageId === msg.id && parked.text !== null ? parked.text : humanizeMentions(msg.payload?.t ?? "", users);
  });
  const [busy, setBusy] = useState(false);
  const spellcheck = useSettings((st) => st.settings.spellcheck !== false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Phone keyboards have no Shift+Enter, so there return adds a line, as in
  // the composer, and saving and cancelling get real buttons.
  const [touch] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches);
  useAutosize(ref, text, 400);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const save = async () => {
    if (busy) return;
    const body = text.trim();
    if (!body && !msg.payload?.att?.length) return;
    setBusy(true);
    try {
      await editMessage(msg.channel_id, msg.id, body);
      endEdit(msg.channel_id, msg.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("chat.editMessage.couldNotSaveTheEdit"), "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => endEdit(msg.channel_id, msg.id);
  return (
    <div className={s.edit}>
      <textarea
        ref={ref}
        className={s.editTa}
        value={text}
        rows={1}
        spellCheck={spellcheck}
        onChange={(e) => {
          setText(e.target.value);
          setEditDraft(msg.channel_id, msg.id, e.target.value);
        }}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {touch ? (
        <div className={s.editActions}>
          <Button variant="secondary" className={s.editBtn} onClick={cancel}>{t("chat.editMessage.cancel")}</Button>
          <Button className={s.editBtn} loading={busy} onClick={() => void save()}>{t("chat.editMessage.save")}</Button>
        </div>
      ) : (
        <div className={s.editHint}>
          escape to <b onClick={cancel}>cancel</b> • enter to <b onClick={() => void save()}>save</b>
        </div>
      )}
    </div>
  );
}
