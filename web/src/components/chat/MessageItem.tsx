import { Lock, MoreHorizontal, Pencil, Reply, SmilePlus } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Markdown, isEmojiOnly, parse, plainText } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { formatFull, formatTime, formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { Attachments } from "./Attachments";
import { EditMessage } from "./EditMessage";
import { Reactions } from "./Reactions";
import { SystemMessage } from "./SystemMessage";
import { buildMessageMenu, canEdit } from "./messageMenu";
import s from "./Chat.module.css";

interface Props {
  msg: DecryptedMessage;
  groupStart: boolean;
  pending?: "sending" | "failed";
  highlight?: boolean;
}

function ReplyPreview({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const target = useMessages((m) => (msg.reply_to_id ? m.channels[msg.channel_id]?.byId[msg.reply_to_id] : undefined));
  const setJumpTo = useUI((u) => u.setJumpTo);
  const openModal = useUI((u) => u.openModal);
  if (!msg.reply_to_id) return null;
  if (!target) return <div className={s.replyLine}><span className={s.replyText}>Original message was deleted or is not loaded.</span></div>;
  const author = users[target.author_id];
  const text = target.payload?.t ? plainText(parse(target.payload.t, { inline: true })) : target.payload?.att?.length ? "Click to see attachment" : target.decryptError ? "Encrypted message" : "";
  return (
    <div className={s.replyLine} onClick={() => setJumpTo({ channelId: msg.channel_id, messageId: target.id })}>
      <Avatar id={target.author_id} avatarId={author?.avatar_id ?? null} name={displayName(author)} size={16} />
      <span className={s.replyName} onClick={(e) => { e.stopPropagation(); openModal("profile", { userId: target.author_id }); }}>{displayName(author)}</span>
      <span className={s.replyText}>{text}</span>
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ msg, groupStart, pending, highlight }: Props) {
  const me = useAuth((a) => a.me);
  const author = useUsers((u) => u.byId[msg.author_id]);
  const editing = useUI((u) => u.editing?.channelId === msg.channel_id && u.editing.messageId === msg.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const setReplyTo = useUI((u) => u.setReplyTo);
  const setEditing = useUI((u) => u.setEditing);
  const dev = useSettings((st) => st.settings.developerMode);
  const ctx = useRenderCtx();
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const mentioned = !!me && (msg.mention_everyone || msg.mentions.includes(me.id)) && msg.author_id !== me.id;
  const text = msg.payload?.t ?? "";
  const nodes = useMemo(() => (text ? parse(text) : []), [text]);
  const jumbo = useMemo(() => nodes.length > 0 && isEmojiOnly(nodes), [nodes]);

  const openMenu = useCallback((x: number, y: number) => {
    setMenuOpen(true);
    openContextMenu({ x, y, items: buildMessageMenu(msg, { openReactionPicker: () => setPicker(new DOMRect(x, y, 0, 0)) }) });
    const unsub = useUI.subscribe((state) => {
      if (!state.contextMenu) {
        setMenuOpen(false);
        unsub();
      }
    });
  }, [msg, openContextMenu]);

  if (msg.type.startsWith("system_")) return <SystemMessage msg={msg} />;

  const name = displayName(author, msg.author_id === me?.id ? me.display_name : "Unknown User");
  const isReply = !!msg.reply_to_id;
  const showHeader = groupStart || isReply;

  return (
    <div
      className={s.msg}
      data-id={msg.id}
      data-group-start={showHeader}
      data-mentioned={mentioned}
      data-highlight={highlight}
      data-pending={pending === "sending"}
      data-failed={pending === "failed"}
      data-menu={menuOpen}
      onContextMenu={(e) => {
        if (pending) return;
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
    >
      {isReply ? <ReplyPreview msg={msg} /> : null}
      {showHeader ? (
        <>
          <div className={s.avatar} data-group-start={showHeader} onClick={() => openModal("profile", { userId: msg.author_id })}>
            <Avatar id={msg.author_id} avatarId={author?.avatar_id ?? null} name={name} size={40} />
          </div>
          <div className={s.headerRow}>
            <span className={s.author} onClick={() => openModal("profile", { userId: msg.author_id })}>{name}</span>
            <time className={s.time} title={formatFull(msg.created_at)} dateTime={new Date(msg.created_at).toISOString()}>{formatTimestamp(msg.created_at)}</time>
          </div>
        </>
      ) : (
        <span className={s.gutterTime} title={formatFull(msg.created_at)}>{formatTime(msg.created_at)}</span>
      )}
      {editing ? (
        <EditMessage msg={msg} />
      ) : (
        <div className={[s.content, jumbo ? s.jumbo : ""].join(" ")}>
          {msg.decryptError === "no_key" ? (
            <span className={s.waiting}><Lock size={14} /> Waiting for the encryption key…</span>
          ) : msg.decryptError === "bad" ? (
            <span className={s.waiting}><Lock size={14} /> This message could not be decrypted.</span>
          ) : (
            <>
              {text ? <Markdown source={text} ctx={ctx} jumbo={jumbo} /> : null}
              {msg.edited_at ? <span className={s.edited} title={formatFull(msg.edited_at)}>(edited)</span> : null}
            </>
          )}
          {msg.payload?.att?.length ? <Attachments list={msg.payload.att} /> : null}
          {pending === "failed" ? <div className={s.edited} style={{ color: "var(--danger)" }}>Failed to send.</div> : null}
        </div>
      )}
      {!pending ? <Reactions msg={msg} pickerAnchor={picker} onOpenPicker={setPicker} onPickerClose={() => setPicker(null)} /> : null}
      {!pending && !editing ? (
        <div className={s.toolbar} role="toolbar">
          <button className={s.tBtn} title="Add Reaction" aria-label="Add Reaction" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}><SmilePlus size={20} /></button>
          {canEdit(msg) ? (
            <button className={s.tBtn} title="Edit" aria-label="Edit" onClick={() => setEditing({ channelId: msg.channel_id, messageId: msg.id })}><Pencil size={20} /></button>
          ) : null}
          <button className={s.tBtn} title="Reply" aria-label="Reply" onClick={() => setReplyTo({ channelId: msg.channel_id, messageId: msg.id, ping: true })}><Reply size={20} /></button>
          <button className={s.tBtn} title="More" aria-label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}><MoreHorizontal size={20} /></button>
        </div>
      ) : null}
      {dev && !pending ? <span hidden data-dev-id={msg.id} /> : null}
    </div>
  );
});
