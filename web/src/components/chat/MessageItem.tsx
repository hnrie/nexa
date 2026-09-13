import { Hash, Link2, Lock, MailOpen, MoreHorizontal, Pencil, Pin, PinOff, Reply, RotateCw, SmilePlus, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Markdown, emojiCount, isEmojiOnly, parse, plainText } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { formatFull, formatTime, formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useRelationships } from "@/stores/relationships";
import { useUsers, displayName } from "@/stores/users";
import { memberColor, useServers } from "@/stores/servers";
import { useChannels } from "@/stores/channels";
import { useShiftHeld } from "@/hooks/useShiftHeld";
import { stickerUrl } from "@/api/users";
import type { MessagePayload } from "@/crypto/message";
import { Attachments } from "./Attachments";
import { Embeds } from "./Embeds";
import { MSG_FLAG_SUPPRESS_EMBEDS } from "@/api/types";
import type { UnfurlResult } from "@/api/types";
import { EditMessage } from "./EditMessage";
import { isOnlyMediaLinks } from "./mediaLinks";
import { Reactions } from "./Reactions";
import { SystemMessage } from "./SystemMessage";
import { Tooltip } from "@/components/common/Tooltip";
import { MSG_FLAG_PINNED } from "@/api/types";
import { discardPending, retryPending } from "@/components/composer/send";
import { buildMessageMenu, canDelete, canEdit, copyMessageLink, deleteMessageNow, markUnread, togglePin } from "./messageMenu";
import s from "./Chat.module.css";

interface Props {
  msg: DecryptedMessage;
  groupStart: boolean;
  pending?: "sending" | "failed";
  highlight?: boolean;
  /** The topmost row in the list; its hover toolbar must not overhang out of view. */
  first?: boolean;
}

function ReplyPreview({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const target = useMessages((m) => (msg.reply_to_id ? m.channels[msg.channel_id]?.byId[msg.reply_to_id] : undefined));
  const setJumpTo = useUI((u) => u.setJumpTo);
  const openModal = useUI((u) => u.openModal);
  if (!msg.reply_to_id) return null;
  if (!target) return <div className={s.replyLine}><span className={s.replyText}>Original message was deleted or is not loaded.</span></div>;
  const author = users[target.author_id];
  const mediaOnly = !!target.payload?.t && isOnlyMediaLinks(target.payload.t, (target.payload.embeds ?? []) as UnfurlResult[]);
  const text = target.payload?.t && !mediaOnly ? plainText(parse(target.payload.t, { inline: true })) : target.payload?.att?.length || mediaOnly ? "Click to see attachment" : target.decryptError ? "Encrypted message" : "";
  return (
    <div className={s.replyLine} onClick={() => setJumpTo({ channelId: msg.channel_id, messageId: target.id })}>
      <Avatar id={target.author_id} avatarId={author?.avatar_id ?? null} name={displayName(author)} size={16} />
      <span className={s.replyName} onClick={(e) => { e.stopPropagation(); openModal("profile", { userId: target.author_id }); }}>{displayName(author)}</span>
      <span className={s.replyText}>{text}</span>
    </div>
  );
}

/** A hover-toolbar button that always says what it does. */
function ToolButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <Tooltip text={label} side="top">
      <button className={[s.tBtn, danger ? s.tDanger : ""].join(" ")} aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

export const MessageItem = memo(function MessageItem({ msg, groupStart, pending, highlight, first }: Props) {
  const me = useAuth((a) => a.me);
  const author = useUsers((u) => u.byId[msg.author_id]);
  const editing = useUI((u) => u.editing?.channelId === msg.channel_id && u.editing.messageId === msg.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const setReplyTo = useUI((u) => u.setReplyTo);
  const setEditing = useUI((u) => u.setEditing);
  const dev = useSettings((st) => st.settings.developerMode);
  const ctx = useRenderCtx();
  const serverId = useChannels((c) => c.byId[msg.channel_id]?.server_id ?? null);
  const serverState = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const member = serverState?.members[msg.author_id];
  const color = serverState ? memberColor(serverState, msg.author_id) : undefined;
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const friendNickname = useRelationships((r) => r.byUser[msg.author_id]?.nickname);
  const shift = useShiftHeld();

  const mentioned = !!me && (msg.mention_everyone || msg.mentions.includes(me.id)) && msg.author_id !== me.id;
  const imagePreviews = useSettings((st) => st.settings.imagePreviews);
  const embeds = msg.payload?.embeds?.length && !(msg.flags & MSG_FLAG_SUPPRESS_EMBEDS) ? (msg.payload.embeds as UnfurlResult[]) : null;
  // a GIF or picture link shows only the picture, the way an uploaded one does
  const mediaOnly = !!embeds && imagePreviews && isOnlyMediaLinks(msg.payload?.t ?? "", embeds);
  const text = mediaOnly ? "" : (msg.payload?.t ?? "");
  const nodes = useMemo(() => (text ? parse(text) : []), [text]);
  const jumbo = useMemo(() => nodes.length > 0 && isEmojiOnly(nodes), [nodes]);
  // one to three emoji get the big treatment; a wall of them shrinks so it still fits a line
  const jumboSize = useMemo(() => {
    if (!jumbo) return undefined;
    const n = emojiCount(nodes);
    return n <= 3 ? 48 : n <= 8 ? 36 : 28;
  }, [jumbo, nodes]);

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

  const baseName = displayName(author, msg.author_id === me?.id ? me.display_name : "Unknown User");
  // A nickname you gave a friend applies everywhere their name appears, not
  // just in the sidebar; a server nickname wins inside that server.
  const name = member?.nickname || friendNickname || baseName;
  const isReply = !!msg.reply_to_id;
  const pinned = (msg.flags & MSG_FLAG_PINNED) !== 0;

  const showHeader = groupStart || isReply;

  return (
    <div
      className={s.msg}
      data-id={msg.id}
      data-group-start={showHeader}
      data-mentioned={mentioned}
      data-highlight={highlight}
      data-first={first}
      data-reply={isReply}
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
            <span className={s.author} data-author={msg.author_id} style={color ? { color } : undefined} onClick={() => openModal("profile", { userId: msg.author_id })}>{name}</span>
            <time className={s.time} title={formatFull(msg.created_at)} dateTime={new Date(msg.created_at).toISOString()}>{formatTimestamp(msg.created_at)}</time>
          </div>
        </>
      ) : (
        <span className={s.gutterTime} title={formatFull(msg.created_at)}>{formatTime(msg.created_at)}</span>
      )}
      {editing ? (
        <EditMessage msg={msg} />
      ) : (
        <div className={[s.content, jumbo ? s.jumbo : ""].join(" ")} style={jumboSize ? ({ "--jumbo-size": `${jumboSize}px` } as React.CSSProperties) : undefined}>
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
          {msg.payload?.sticker ? <StickerView sticker={msg.payload.sticker} /> : null}
          {msg.payload?.att?.length ? <Attachments list={msg.payload.att} /> : null}
          {embeds ? <Embeds list={embeds} /> : null}
          {pending === "failed" ? (
            <div className={s.failedRow}>
              <span>Message failed to send.</span>
              <button className={s.retry} onClick={() => void retryPending(msg.channel_id, msg.id)} data-testid="retry-send"><RotateCw size={13} /> Retry</button>
              <button className={s.retry} data-danger="true" onClick={() => discardPending(msg.channel_id, msg.id)}>Delete</button>
            </div>
          ) : null}
        </div>
      )}
      {!pending ? <Reactions msg={msg} pickerAnchor={picker} onOpenPicker={setPicker} onPickerClose={() => setPicker(null)} /> : null}
      {!pending && !editing ? (
        <div className={s.toolbar} role="toolbar" data-shift={shift}>
          <ToolButton label="Add Reaction" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}><SmilePlus size={18} /></ToolButton>
          {canEdit(msg) ? (
            <ToolButton label="Edit Message" onClick={() => setEditing({ channelId: msg.channel_id, messageId: msg.id })}><Pencil size={18} /></ToolButton>
          ) : null}
          <ToolButton label="Reply" onClick={() => setReplyTo({ channelId: msg.channel_id, messageId: msg.id, ping: true })}><Reply size={18} /></ToolButton>
          {shift ? (
            <>
              <ToolButton label={pinned ? "Unpin Message" : "Pin Message"} onClick={() => void togglePin(msg)}>{pinned ? <PinOff size={18} /> : <Pin size={18} />}</ToolButton>
              <ToolButton label="Mark Unread" onClick={() => markUnread(msg)}><MailOpen size={18} /></ToolButton>
              <ToolButton label="Copy Message Link" onClick={() => copyMessageLink(msg)}><Link2 size={18} /></ToolButton>
              {dev ? <ToolButton label="Copy Message ID" onClick={() => void navigator.clipboard?.writeText(msg.id)}><Hash size={18} /></ToolButton> : null}
              {canDelete(msg) ? (
                <ToolButton label="Delete Message (Shift skips the prompt)" danger onClick={() => void deleteMessageNow(msg)}><Trash2 size={18} /></ToolButton>
              ) : null}
            </>
          ) : null}
          <ToolButton label={shift ? "Everything else" : "More (hold Shift for all actions)"} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}><MoreHorizontal size={18} /></ToolButton>
        </div>
      ) : null}
      {dev && !pending ? <span hidden data-dev-id={msg.id} /> : null}
    </div>
  );
});

/** A sticker in a message: 160 px, keeps its aspect, named on hover. */
function StickerView({ sticker }: { sticker: NonNullable<MessagePayload["sticker"]> }) {
  if (!sticker.blob) return <span className={s.edited}>[sticker]</span>;
  const w = sticker.w && sticker.h ? Math.round((160 * sticker.w) / sticker.h) : 160;
  return <img className={s.sticker} src={stickerUrl(sticker.blob)} alt={sticker.name ?? "sticker"} title={sticker.name} width={Math.min(160, w)} height={160} loading="lazy" draggable={false} />;
}
