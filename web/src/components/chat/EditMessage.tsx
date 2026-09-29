import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { SpellLines, useSpellActive } from "@/components/common/SpellLines";
import { MAX_MESSAGE_LENGTH, pasteOverflows, tooLong, tooLongMessage } from "@/components/composer/limit";
import { MessageCounter } from "@/components/composer/MessageCounter";
import { humanizeMentions } from "@/components/composer/mentions";
import { editMessage, editNames, mentionScope, sendErrorText } from "@/components/composer/send";
import { closeShortcode, typedColon } from "@/components/composer/shortcodeTyping";
import { useAutosize } from "@/components/composer/useAutosize";
import { applyWrap, formatShortcut } from "@/components/composer/wrapShortcut";
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
  /** A paste that would take the message past the limit, held back until it is asked for. */
  const [held, setHeld] = useState<{ text: string; start: number; end: number } | null>(null);
  const spellcheck = useSettings((st) => st.settings.spellcheck !== false);
  const ownSpelling = useSpellActive();
  const tone = useSettings((st) => st.settings.skinTone);
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
  const change = (value: string) => {
    setText(value);
    setEditDraft(msg.channel_id, msg.id, value);
  };
  const save = async () => {
    if (busy) return;
    const body = text.trim();
    // An emptied message is one to delete, and deleting asks first; Enter on
    // an empty box used to do nothing at all.
    if (!body && !msg.payload?.att?.length && !msg.payload?.sticker) {
      confirmDelete(msg, () => endEdit(msg.channel_id, msg.id));
      return;
    }
    // held to the same limit as sending: an edit used to be a way round it
    if (tooLong(body)) {
      toast(tooLongMessage(), "error");
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
      // editMessage throws the bare code, which sending maps to a sentence
      toast(sendErrorText(err) ?? (err instanceof Error ? err.message : t("chat.editMessage.couldNotSaveTheEdit")), "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => endEdit(msg.channel_id, msg.id);
  const pasteAnyway = () => {
    const h = held;
    const el = ref.current;
    setHeld(null);
    if (!h || !el) return;
    change(text.slice(0, h.start) + h.text + text.slice(h.end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(h.start + h.text.length, h.start + h.text.length);
    });
  };
  const counter = <MessageCounter text={text} className={s.editCounter} />;
  return (
    <div className={s.edit}>
      {held ? (
        <div className={s.editNotice} role="status" data-testid="edit-notice">
          <span className={s.editNoticeText}>{t("composer.composer.pasteTooLong", { count: MAX_MESSAGE_LENGTH })}</span>
          <button type="button" className={s.editNoticeBtn} onClick={pasteAnyway}>{t("composer.composer.pasteAnyway")}</button>
          <button type="button" className={s.editNoticeClose} aria-label={t("composer.composer.dismiss")} onClick={() => setHeld(null)}><X size={16} /></button>
        </div>
      ) : null}
      <textarea
        aria-label={t("composer.editYourMessage")}
        ref={ref}
        className={s.editTa}
        value={text}
        rows={1}
        spellCheck={spellcheck && !ownSpelling}
        data-spell={ownSpelling ? "" : undefined}
        data-markdown=""
        onChange={(e) => {
          // a :name: typed out in full becomes its emoji as its closing colon goes in, as in the message box
          const el = e.currentTarget;
          const own = (name: string) => (mentionScope(msg.channel_id).emoji ?? []).some((em) => !em.fallback && em.name.toLowerCase() === name);
          const closed = typedColon(e.nativeEvent) ? closeShortcode(el.value, el.selectionStart ?? el.value.length, tone, own) : null;
          if (!closed) return change(el.value);
          change(closed.value);
          requestAnimationFrame(() => ref.current?.setSelectionRange(closed.caret, closed.caret));
        }}
        disabled={busy}
        onPaste={(e) => {
          // Past the limit a paste waits, as it does in the message box, rather
          // than making a message too long to save.
          const pasted = e.clipboardData.getData("text/plain");
          const el = e.currentTarget;
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? start;
          if (pasted && pasteOverflows(el.value, start, end, pasted)) {
            e.preventDefault();
            setHeld({ text: pasted, start, end });
          }
        }}
        onKeyDown={(e) => {
          // an input method's own Enter and Escape (keyCode 229 in Safari) are not ours
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          const marker = formatShortcut(e);
          if (marker) {
            e.preventDefault();
            applyWrap(e.currentTarget, marker);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && !e.shiftKey && !phone) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <SpellLines target={ref} text={text} />
      {touch ? (
        <div className={s.editActions}>
          {counter}
          <Button variant="secondary" className={s.editBtn} onClick={cancel}>{t("chat.editMessage.cancel")}</Button>
          <Button className={s.editBtn} loading={busy} onClick={() => void save()}>{t("chat.editMessage.save")}</Button>
        </div>
      ) : (
        <div className={s.editFoot}>
          <div className={s.editHint}>
            <Tr id="chat.editMessage.hint" values={{ cancel: <button type="button" onClick={cancel}>{t("chat.editMessage.cancelWord")}</button>, save: <button type="button" onClick={() => void save()}>{t("chat.editMessage.saveWord")}</button> }} />
          </div>
          {counter}
        </div>
      )}
    </div>
  );
}
