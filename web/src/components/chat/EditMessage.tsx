import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { humanizeMentions } from "@/components/composer/mentions";
import { editMessage, editNames } from "@/components/composer/send";
import { useAutosize } from "@/components/composer/useAutosize";
import { confirmDelete } from "./messageMenu";
import type { DecryptedMessage } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./Chat.module.css";

import { t, Tr } from "@/i18n";
export function EditMessage({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const endEdit = useUI((u) => u.endEdit);
  const setEditDraft = useUI((u) => u.setEditDraft);
  const toast = useUI((u) => u.toast);
  // an edit left behind in another conversation comes back with what was typed
  const [text, setText] = useState(() => {
    const parked = useUI.getState().editDrafts[msg.channel_id];
    return parked?.messageId === msg.id && parked.text !== null ? parked.text : humanizeMentions(msg.payload?.t ?? "", users, editNames(msg.channel_id));
  });
  const [busy, setBusy] = useState(false);
  const spellcheck = useSettings((st) => st.settings.spellcheck !== false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Phone keyboards have no Shift+Enter, so there return adds a line, as in
  // the composer, and saving and cancelling get real buttons.
  const [touch] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches);
  // on a phone Return is a new line, as in the message box; elsewhere Enter saves
  const [phone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse) and (max-width: 767px)").matches);
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
    // An emptied message is one to delete, and deleting asks first; Enter on
    // an empty box used to do nothing at all.
    if (!body && !msg.payload?.att?.length && !msg.payload?.sticker) {
      confirmDelete(msg, () => endEdit(msg.channel_id, msg.id));
      return;
    }
    // nothing changed: close the editor without marking the message edited
    if (body === humanizeMentions(msg.payload?.t ?? "", useUsers.getState().byId, editNames(msg.channel_id)).trim()) {
      endEdit(msg.channel_id, msg.id);
      return;
    }
    setBusy(true);
    try {
      await editMessage(msg.channel_id, msg.id, body);
      endEdit(msg.channel_id, msg.id);
    } catch (err) {
      // editMessage throws the bare code, which sending maps to a sentence and
      // this path showed to the reader as `waiting_for_key`
      if (err instanceof Error && err.message === "waiting_for_key") toast(t("composer.send.waitingForTheEncryptionKeyFor"), "error");
      else toast(err instanceof Error ? err.message : t("chat.editMessage.couldNotSaveTheEdit"), "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => endEdit(msg.channel_id, msg.id);
  return (
    <div className={s.edit}>
      <textarea
        aria-label={t("composer.editYourMessage")}
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
          // an input method's own Enter and Escape (keyCode 229 in Safari) are not ours
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && !e.shiftKey && !phone) {
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
          <Tr id="chat.editMessage.hint" values={{ cancel: <button type="button" onClick={cancel}>{t("chat.editMessage.cancelWord")}</button>, save: <button type="button" onClick={() => void save()}>{t("chat.editMessage.saveWord")}</button> }} />
        </div>
      )}
    </div>
  );
}
