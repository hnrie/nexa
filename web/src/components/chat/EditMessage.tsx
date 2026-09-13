import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { humanizeMentions } from "@/components/composer/mentions";
import { editMessage } from "@/components/composer/send";
import { useAutosize } from "@/components/composer/useAutosize";
import type { DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./Chat.module.css";

export function EditMessage({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const setEditing = useUI((u) => u.setEditing);
  const toast = useUI((u) => u.toast);
  const [text, setText] = useState(() => humanizeMentions(msg.payload?.t ?? "", users));
  const [busy, setBusy] = useState(false);
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
      setEditing(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the edit.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.edit}>
      <textarea
        ref={ref}
        className={s.editTa}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(null);
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {touch ? (
        <div className={s.editActions}>
          <Button variant="secondary" className={s.editBtn} onClick={() => setEditing(null)}>Cancel</Button>
          <Button className={s.editBtn} loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      ) : (
        <div className={s.editHint}>
          escape to <b onClick={() => setEditing(null)}>cancel</b> • enter to <b onClick={() => void save()}>save</b>
        </div>
      )}
    </div>
  );
}
