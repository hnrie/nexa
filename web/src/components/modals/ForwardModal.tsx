import { CornerUpRight, Hash, Paperclip, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { SearchBox } from "@/components/common/SearchBox";
import type { DecryptedMessage } from "@/lib/decrypt";
import { forwardMessage, forwardTargets } from "@/lib/forward";
import { channelDisplayName } from "@/lib/names";
import { fold } from "@/search/text";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { t } from "@/i18n";
import { Field, TextArea } from "@/components/common/TextInput";
import s from "./ForwardModal.module.css";

/**
 * Forward Message: the message as it will go, and the one conversation, group
 * or server channel to send it to, found by its name or its server's. Its files go as they are, without uploading
 * them again (lib/forward.ts).
 */
export function ForwardModal({ msg, onClose }: { msg: DecryptedMessage; onClose: () => void }) {
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const servers = useServers((st) => st.byId);
  const [query, setQuery] = useState("");
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = msg.payload?.att?.length ?? 0;
  const rows = useMemo(
    () =>
      forwardTargets(files > 0)
        .filter((c) => c.id !== msg.channel_id)
        .map((c) => {
          const dm = !c.server_id;
          const other = c.type === "dm" ? c.recipient_ids.find((id) => id !== meId) : undefined;
          return {
            ch: c,
            name: dm ? channelDisplayName(c, users, meId) : c.name,
            sub: dm ? (other ? `@${users[other]?.username ?? ""}` : t("chat.chatView.membersCount", { count: c.recipient_ids.length })) : (servers[c.server_id!]?.server.name ?? ""),
            other,
          };
        }),
    [files, msg.channel_id, meId, users, servers],
  );
  const q = fold(query.trim());
  const shown = q ? rows.filter((r) => fold(r.name).includes(q) || fold(r.sub).includes(q)) : rows;

  const send = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await forwardMessage(msg, picked, comment);
      useUI.getState().toast(t("forward.sent"), "success");
      onClose();
    } catch {
      useUI.getState().toast(t("forward.failed"), "error");
      setBusy(false);
    }
  };

  const text = msg.payload?.t ?? "";
  return (
    <Modal
      open
      onClose={onClose}
      title={t("forward.title")}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void send()} disabled={!picked} loading={busy} data-testid="forward-send">
            <CornerUpRight size={16} aria-hidden="true" /> {t("forward.send")}
          </Button>
        </>
      }
    >
      <div className={s.preview} data-testid="forward-preview">
        <span className={s.label}><CornerUpRight size={14} aria-hidden="true" />{t("forward.forwarded")}</span>
        {text ? <p className={s.text}>{text}</p> : null}
        {files ? <span className={s.files}><Paperclip size={14} aria-hidden="true" />{t("forward.files", { count: files })}</span> : null}
        {files ? <p className={s.free}>{t("forward.noUpload")}</p> : null}
      </div>
      <Field label={t("forward.comment")}><TextArea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} rows={2} disabled={busy} data-testid="forward-comment" /></Field>
      <SearchBox value={query} onChange={setQuery} placeholder={t("forward.search")} aria-label={t("forward.search")} autoFocus />
      <p className={s.hint}>{t("forward.pickOne")}</p>
      <div className={s.list} role="radiogroup" aria-label={t("forward.where")} data-testid="forward-list">
        {shown.length === 0 ? <div className={s.empty}>{t("forward.none")}</div> : null}
        {shown.map((r) => {
          const on = picked === r.ch.id;
          return (
            <label key={r.ch.id} className={s.row} data-on={on || undefined}>
              {r.ch.server_id ? (
                <span className={s.glyph} aria-hidden="true"><Hash size={18} /></span>
              ) : r.ch.type === "group_dm" && !r.ch.icon_id ? (
                <span className={s.glyph} aria-hidden="true"><Users size={18} /></span>
              ) : (
                <Avatar id={r.other ?? r.ch.id} avatarId={r.other ? (users[r.other]?.avatar_id ?? null) : r.ch.icon_id} name={r.name} size={32} kind={r.other ? "avatar" : "icon"} />
              )}
              <span className={s.names}>
                <span className={s.name}>{r.name}</span>
                <span className={s.sub}>{r.sub}</span>
              </span>
              <input type="radio" name="forward-to" checked={on} onChange={() => setPicked(r.ch.id)} data-testid={`forward-to-${r.ch.id}`} />
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
