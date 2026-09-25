import { Check, Hash, Link2, Lock, MailOpen, MoreHorizontal, Pencil, Pin, PinOff, Reply, RotateCw, SmilePlus, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Markdown, emojiCount, isEmojiOnly, parse, plainText } from "@/markdown";
import { useRowRenderCtx } from "@/lib/markdownCtx";
import { formatFull, formatTime, formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage, type PendingUpload } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useRelationships } from "@/stores/relationships";
import { rangeBetween, useSelection } from "@/stores/selection";
import { useUsers, displayName } from "@/stores/users";
import { memberColor, useServers } from "@/stores/servers";
import { useChannels } from "@/stores/channels";
import { mentionsMe } from "@/lib/mentionsMe";
import { useShiftHeld } from "@/hooks/useShiftHeld";
import { stickerUrl } from "@/api/users";
import { StickerView as StickerMedia } from "@/components/stickers/StickerView";
import { stickerFormatOf, useExpressions } from "@/stores/expressions";
import { imageTarget, type ImageTarget } from "@/lib/imageActions";
import type { MessagePayload } from "@/crypto/message";
import { Attachments } from "./Attachments";
import { UploadCard } from "./UploadCard";
import { Embeds } from "./Embeds";
import { MSG_FLAG_SUPPRESS_EMBEDS } from "@/api/types";
import type { UnfurlResult } from "@/api/types";
import { EditMessage } from "./EditMessage";
import { isOnlyMediaLinks } from "./mediaLinks";
import { Reactions } from "./Reactions";
import { StickerPopout } from "./StickerPopout";
import { SystemMessage } from "./SystemMessage";
import { Tooltip } from "@/components/common/Tooltip";
import { MSG_FLAG_PINNED } from "@/api/types";
import { discardPending, retryPending } from "@/components/composer/send";
import { buildMessageMenu, canDelete, canEdit, canPick, canPin, copyMessageLink, deleteMessageNow, markUnread, togglePin } from "./messageMenu";
import s from "./Chat.module.css";

import { t } from "@/i18n";
interface Props {
  msg: DecryptedMessage;
  groupStart: boolean;
  pending?: "sending" | "failed";
  /** A pending message's files still going up, shown in place of its attachments. */
  upload?: PendingUpload | undefined;
  highlight?: boolean;
  /** The topmost row in the list; its hover toolbar must not overhang out of view. */
  first?: boolean;
}

function ReplyPreview({ msg }: { msg: DecryptedMessage }) {
  const users = useUsers((u) => u.byId);
  const target = useMessages((m) => (msg.reply_to_id ? m.channels[msg.channel_id]?.byId[msg.reply_to_id] : undefined));
  const setJumpTo = useUI((u) => u.setJumpTo);
  const openModal = useUI((u) => u.openModal);
  const ctx = useRowRenderCtx();
  if (!msg.reply_to_id) return null;
  const replyTo = msg.reply_to_id;
  // Jumping works whether or not the original is loaded: the list fetches the
  // page around it, and says so if it really is gone. Only the newest page is
  // loaded when a conversation opens, so most replies point past it.
  const jump = () => setJumpTo({ channelId: msg.channel_id, messageId: replyTo });
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    jump();
  };
  if (!target) {
    return (
      <div className={s.replyLine} role="button" tabIndex={0} onClick={jump} onKeyDown={keys}>
        <span className={s.replyText}>{t("chat.messageItem.originalMessageWasDeletedOrIs")}</span>
      </div>
    );
  }
  const author = users[target.author_id];
  const mediaOnly = !!target.payload?.t && isOnlyMediaLinks(target.payload.t, (target.payload.embeds ?? []) as UnfurlResult[]);
  const text = target.payload?.t && !mediaOnly ? plainText(parse(target.payload.t, { inline: true }), ctx) : target.payload?.att?.length || mediaOnly ? t("chat.messageItem.clickToSeeAttachment") : target.decryptError ? t("chat.messageItem.encryptedMessage") : "";
  return (
    <div className={s.replyLine} role="button" tabIndex={0} onClick={jump} onKeyDown={keys}>
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

export const MessageItem = memo(function MessageItem({ msg, groupStart, pending, upload, highlight, first }: Props) {
  const me = useAuth((a) => a.me);
  const author = useUsers((u) => u.byId[msg.author_id]);
  const editing = useUI((u) => u.editing?.channelId === msg.channel_id && u.editing.messageId === msg.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const setReplyTo = useUI((u) => u.setReplyTo);
  const setEditing = useUI((u) => u.setEditing);
  const dev = useSettings((st) => st.settings.developerMode);
  const ctx = useRowRenderCtx();
  const serverId = useChannels((c) => c.byId[msg.channel_id]?.server_id ?? null);
  const serverState = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const member = serverState?.members[msg.author_id];
  const color = serverState ? memberColor(serverState, msg.author_id) : undefined;
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWatch = useRef<(() => void) | null>(null);
  const friendNickname = useRelationships((r) => r.byUser[msg.author_id]?.nickname);
  const selecting = useSelection((x) => x.channelId === msg.channel_id);
  const picked = useSelection((x) => x.channelId === msg.channel_id && !!x.picked[msg.id]);
  const pickable = selecting && !pending && canPick(msg);

  // A role of mine in the server counts too. The row listens to my roles
  // there, so its tint follows a role given or taken away.
  useServers((st) => (serverId ? st.byId[serverId]?.me?.role_ids : undefined));
  const mentioned = !!me && msg.author_id !== me.id && mentionsMe(msg, me.id);
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

  const openMenu = useCallback((x: number, y: number, image?: ImageTarget | null) => {
    setMenuOpen(true);
    openContextMenu({ x, y, items: buildMessageMenu(msg, { openReactionPicker: () => setPicker(new DOMRect(x, y, 0, 0)) }, image) });
    menuWatch.current?.();
    menuWatch.current = useUI.subscribe((state) => {
      if (!state.contextMenu) {
        setMenuOpen(false);
        menuWatch.current?.();
        menuWatch.current = null;
      }
    });
  }, [msg, openContextMenu]);
  // Switching channels unmounts every row, menu open or not, and the store
  // would keep this subscriber and the closure behind it for good.
  useEffect(
    () => () => {
      menuWatch.current?.();
      menuWatch.current = null;
    },
    [],
  );

  /** While picking, a tap anywhere on the row ticks it; Shift ticks everything from the last one. */
  const pick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = useSelection.getState();
    if (e.shiftKey && sel.anchor && sel.anchor !== msg.id) {
      const ch = useMessages.getState().channels[msg.channel_id];
      const range = rangeBetween(ch?.ids ?? [], sel.anchor, msg.id).filter((id) => {
        const m = ch?.byId[id];
        return !!m && canPick(m);
      });
      sel.addRange(range, msg.id);
    } else sel.toggle(msg.id);
  };

  if (msg.type.startsWith("system_")) return <SystemMessage msg={msg} />;

  const baseName = displayName(author, msg.author_id === me?.id ? me.display_name : t("names.unknownUser"));
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
      data-uploading={!!upload || undefined}
      data-menu={menuOpen}
      data-pickable={pickable || undefined}
      data-picked={picked || undefined}
      onClickCapture={pickable ? pick : undefined}
      onContextMenu={(e) => {
        if (pending) return;
        // a right click in the edit box is for the text: spelling suggestions, cut, copy and paste
        if (e.target instanceof Element && e.target.closest("textarea, input, [contenteditable='true']")) return;
        e.preventDefault();
        if (selecting) {
          // a long press or right click while picking ticks the row instead of opening its menu
          if (pickable) pick(e);
          return;
        }
        // the menu key or Shift+F10 on a focused row has no pointer: open by the row
        if (e.clientX === 0 && e.clientY === 0) {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(r.left + 72, r.top + 8);
          return;
        }
        openMenu(e.clientX, e.clientY, imageTarget(e.target));
      }}
      // reachable with the arrow keys from the list (MessageList), and its
      // toolbar shows while it has focus
      tabIndex={-1}
      data-row=""
    >
      {pickable ? (
        <button type="button" className={s.pick} role="checkbox" aria-checked={picked} aria-label={picked ? t("chat.messageItem.unselectMessage") : t("chat.messageItem.selectMessage")} data-testid="pick-message">
          {picked ? <Check size={14} strokeWidth={3} /> : null}
        </button>
      ) : null}
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
            <span className={s.waiting}><Lock size={14} /> {t("chat.messageItem.waitingForTheEncryptionKey")}</span>
          ) : msg.decryptError === "bad" ? (
            <span className={s.waiting}><Lock size={14} /> {t("chat.messageItem.thisMessageCouldNotBeDecrypted")}</span>
          ) : (
            <>
              {text ? <Markdown source={text} ctx={ctx} jumbo={jumbo} /> : null}
              {msg.edited_at ? <span className={s.edited} title={formatFull(msg.edited_at)}>{t("chat.messageItem.edited")}</span> : null}
            </>
          )}
          {msg.payload?.sticker ? <StickerView sticker={msg.payload.sticker} /> : null}
          {upload ? <UploadCard channelId={msg.channel_id} tmpId={msg.id} upload={upload} failed={pending === "failed"} /> : msg.payload?.att?.length ? <Attachments list={msg.payload.att} /> : null}
          {embeds ? <Embeds list={embeds} /> : null}
          {pending === "failed" ? (
            <div className={s.failedRow}>
              <span>{t("chat.messageItem.messageFailedToSend")}</span>
              <button className={s.retry} onClick={() => void retryPending(msg.channel_id, msg.id)} data-testid="retry-send"><RotateCw size={13} /> {t("chat.messageItem.retry")}</button>
              <button className={s.retry} data-danger="true" onClick={() => discardPending(msg.channel_id, msg.id)}>{t("chat.messageItem.delete")}</button>
            </div>
          ) : null}
        </div>
      )}
      {!pending ? <Reactions msg={msg} pickerAnchor={picker} onOpenPicker={setPicker} onPickerClose={() => setPicker(null)} /> : null}
      {!pending && !editing && !selecting ? <RowToolbar msg={msg} pinned={pinned} dev={dev} setPicker={setPicker} openMenu={openMenu} /> : null}
      {dev && !pending ? <span hidden data-dev-id={msg.id} /> : null}
    </div>
  );
});

/**
 * The toolbar over a row, in a component of its own: holding Shift changes
 * what it offers, and with the Shift state in the row itself every loaded
 * message re-rendered — markdown, embeds and all — on each Shift press.
 */
function RowToolbar({ msg, pinned, dev, setPicker, openMenu }: { msg: DecryptedMessage; pinned: boolean; dev: boolean; setPicker: (r: DOMRect | null) => void; openMenu: (x: number, y: number) => void }) {
  const shift = useShiftHeld();
  const setEditing = useUI((u) => u.setEditing);
  const setReplyTo = useUI((u) => u.setReplyTo);
  return (
    <div className={s.toolbar} role="toolbar" data-shift={shift}>
      <ToolButton label={t("chat.messageItem.addReaction")} onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}><SmilePlus size={18} /></ToolButton>
      {canEdit(msg) ? (
        <ToolButton label={t("chat.messageItem.editMessage")} onClick={() => setEditing({ channelId: msg.channel_id, messageId: msg.id })}><Pencil size={18} /></ToolButton>
      ) : null}
      <ToolButton label={t("chat.messageItem.reply")} onClick={() => setReplyTo({ channelId: msg.channel_id, messageId: msg.id, ping: true })}><Reply size={18} /></ToolButton>
      {shift ? (
        <>
          {canPin(msg) ? <ToolButton label={pinned ? t("chat.messageItem.unpinMessage") : t("chat.messageItem.pinMessage")} onClick={() => void togglePin(msg)}>{pinned ? <PinOff size={18} /> : <Pin size={18} />}</ToolButton> : null}
          <ToolButton label={t("chat.messageItem.markUnread")} onClick={() => markUnread(msg)}><MailOpen size={18} /></ToolButton>
          <ToolButton label={t("chat.messageItem.copyMessageLink")} onClick={() => copyMessageLink(msg)}><Link2 size={18} /></ToolButton>
          {dev ? <ToolButton label={t("chat.messageItem.copyMessageId")} onClick={() => void navigator.clipboard?.writeText(msg.id)}><Hash size={18} /></ToolButton> : null}
          {canDelete(msg) ? (
            <ToolButton label={t("chat.messageItem.deleteMessageShiftSkipsThePrompt")} danger onClick={() => void deleteMessageNow(msg)}><Trash2 size={18} /></ToolButton>
          ) : null}
        </>
      ) : null}
      <ToolButton label={shift ? t("chat.messageItem.everythingElse") : t("chat.messageItem.moreHoldShiftForAllActions")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}><MoreHorizontal size={18} /></ToolButton>
    </div>
  );
}

/** A sticker in a message: 160 px, keeps its aspect; a click shows its name and, for a public pack, the pack. */
function StickerView({ sticker }: { sticker: NonNullable<MessagePayload["sticker"]> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const packs = useExpressions((x) => x.packs);
  // New messages carry the format; older ones are looked up in the packs on
  // this device. Anything still unknown renders as a picture, exactly as
  // before, which is right for every image format.
  const format = sticker.format ?? useMemo(() => stickerFormatOf(packs, sticker.id), [packs, sticker.id]);
  if (!sticker.blob) return <span className={s.edited}>{t("chat.messageItem.sticker")}</span>;
  const w = sticker.w && sticker.h ? Math.round((160 * sticker.w) / sticker.h) : 160;
  const toggle = (el: HTMLElement) => setAnchor((cur) => (cur ? null : el));
  // The lightbox only shows pictures, so video and animated stickers get
  // their own branch: no lightbox hook, and their click only opens the popout.
  // The wrapper is inline-block rather than contents: the popout positions
  // itself from this element's box, and a contents box does not have one,
  // which used to strand the popout in the top left corner.
  if (format === "tgs" || format === "webm") {
    const size = { width: Math.min(160, w), height: 160 };
    return (
      <>
        <span
          role="button"
          tabIndex={0}
          aria-label={sticker.name ? t("chat.messageItem.stickerNamed", { name: sticker.name }) : t("attachmentViews.sticker")}
          aria-expanded={!!anchor}
          data-testid="message-sticker"
          onClick={(e) => toggle(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            toggle(e.currentTarget);
          }}
          style={{ display: "inline-block", lineHeight: 0 }}
        >
          <StickerMedia format={format} src={stickerUrl(sticker.blob, 160)} alt={sticker.name ?? t("attachmentViews.sticker")} className={s.sticker} style={size} />
        </span>
        {anchor ? <StickerPopout sticker={sticker} anchor={anchor} onClose={close} /> : null}
      </>
    );
  }
  return (
    <>
      <img
        className={s.sticker}
        src={stickerUrl(sticker.blob, 160)}
        alt={sticker.name ?? t("attachmentViews.sticker")}
        width={Math.min(160, w)}
        height={160}
        loading="lazy"
        draggable={false}
        role="button"
        tabIndex={0}
        aria-label={sticker.name ? t("chat.messageItem.stickerNamed", { name: sticker.name }) : t("attachmentViews.sticker")}
        aria-expanded={!!anchor}
        data-testid="message-sticker"
        data-image-src={stickerUrl(sticker.blob)}
        data-image-name={sticker.name || "sticker"}
        onClick={(e) => toggle(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          toggle(e.currentTarget);
        }}
      />
      {anchor ? <StickerPopout sticker={sticker} anchor={anchor} onClose={close} /> : null}
    </>
  );
}
