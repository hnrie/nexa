import { Lock, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { AUTO_ARCHIVE, autoArchiveLabel, canStartThread, nameFromText, startThread } from "@/lib/threads";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import s from "@/components/modals/ServerModals.module.css";

/**
 * Starting a thread: from a message (named after what it says, to change) or
 * on its own, where it can be private. How long it may stay quiet before it
 * closes starts at what its channel is set to.
 */
export function CreateThreadModal({ onClose, channelId, messageId }: { onClose: () => void; channelId: string; messageId?: string | undefined }) {
  const nav = useNavigate();
  const parent = useChannels((c) => c.byId[channelId]);
  const starter = useMessages((m) => (messageId ? m.channels[channelId]?.byId[messageId] : undefined));
  const [name, setName] = useState(() => nameFromText(starter?.payload?.t ?? ""));
  const [priv, setPriv] = useState(false);
  const [archive, setArchive] = useState(parent?.default_auto_archive ?? 4320);
  const [busy, setBusy] = useState(false);
  const toast = useUI((u) => u.toast);
  const mayPrivate = !messageId && canStartThread(parent, true);
  const mayPublic = canStartThread(parent, false);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy || !parent) return;
    setBusy(true);
    try {
      const thread = await startThread(parent, { name: clean, ...(messageId ? { messageId } : {}), private: priv, autoArchive: archive });
      onClose();
      nav(`/channels/${parent.server_id}/${thread.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("threads.create.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("threads.create.title")}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void create()} loading={busy} disabled={!name.trim() || (!priv && !mayPublic)} data-testid="thread-create">{t("threads.create.title")}</Button>
        </>
      }
    >
      <div className={s.form}>
        {parent ? <p className={s.hint}>{t("threads.create.in", { name: parent.name })}</p> : null}
        <Field label={t("threads.create.name")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus placeholder={t("threads.create.namePlaceholder")} onKeyDown={(e) => e.key === "Enter" && void create()} data-testid="thread-name" />
        </Field>
        {mayPrivate ? (
          <Field as="div" label={t("threads.create.who")}>
            <div className={s.types} role="radiogroup" aria-label={t("threads.create.who")}>
              <label className={s.type} data-on={!priv}>
                <span className={s.typeIcon}><MessageSquareText size={22} /></span>
                <span className={s.typeText}>
                  <span className={s.typeLabel}>{t("threads.create.public")}</span>
                  <span className={s.typeDesc}>{t("threads.create.publicDesc")}</span>
                </span>
                <input type="radio" name="who" checked={!priv} onChange={() => setPriv(false)} />
              </label>
              <label className={s.type} data-on={priv}>
                <span className={s.typeIcon}><Lock size={22} /></span>
                <span className={s.typeText}>
                  <span className={s.typeLabel}>{t("threads.create.private")}</span>
                  <span className={s.typeDesc}>{t("threads.create.privateDesc")}</span>
                </span>
                <input type="radio" name="who" checked={priv} onChange={() => setPriv(true)} />
              </label>
            </div>
          </Field>
        ) : null}
        <Field label={t("threads.create.closeAfter")}>
          <Select value={archive} onChange={(e) => setArchive(Number(e.target.value))}>
            {AUTO_ARCHIVE.map((m) => (
              <option key={m} value={m}>{autoArchiveLabel(m)}</option>
            ))}
          </Select>
        </Field>
        <p className={s.fine}>{t("threads.create.closeHint")}</p>
      </div>
    </Modal>
  );
}
