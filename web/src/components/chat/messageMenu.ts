import { channels as channelsApi } from "@/api/channels";
import { BULK_DELETE_MAX, messages as messagesApi } from "@/api/messages";
import { MSG_FLAG_PINNED } from "@/api/types";
import { humanizeMentions, type HumanNames } from "@/components/composer/mentions";
import { compareIds } from "@/lib/ids";
import { copyImage, saveImage, type ImageTarget } from "@/lib/imageActions";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useSelection } from "@/stores/selection";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { canI, isInstanceAdmin, P, useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import { mentionsMe } from "@/lib/mentionsMe";

import { t } from "@/i18n";
export interface MenuHooks {
  openReactionPicker: () => void;
}

export function canDelete(msg: DecryptedMessage): boolean {
  const me = useAuth.getState().me;
  if (!me) return false;
  if (msg.author_id === me.id) return true;
  // whoever runs the instance can take down any message
  if (isInstanceAdmin(me.id)) return true;
  const ch = useChannels.getState().byId[msg.channel_id];
  if (!ch) return false;
  // Manage Messages lets moderators and the server owner remove anyone's message
  if (ch.server_id) return canI(useServers.getState().byId[ch.server_id], P.MANAGE_MESSAGES, ch.id);
  return ch.type === "group_dm" && ch.owner_id === me.id;
}

/** Anyone in a DM may pin; a server channel needs Manage Messages, as the server requires. */
export function canPin(msg: DecryptedMessage): boolean {
  const ch = useChannels.getState().byId[msg.channel_id];
  if (!ch?.server_id) return true;
  return canI(useServers.getState().byId[ch.server_id], P.MANAGE_MESSAGES, ch.id);
}

export function canEdit(msg: DecryptedMessage): boolean {
  const me = useAuth.getState().me;
  return !!me && msg.author_id === me.id && (msg.type === "default" || msg.type === "reply") && !!msg.payload;
}

/** Copy Image and Save Image, for a picture a menu was opened on. */
export function imageMenuItems(image: ImageTarget): ContextMenuItem[] {
  const ui = useUI.getState();
  // a browser's own refusal says nothing useful; the helpers' own errors do
  const failed = (err: unknown, fallback: string) => ui.toast(err instanceof Error && !(err instanceof DOMException) && err.message ? err.message : fallback, "error");
  return [
    { id: "copy-image", label: t("chat.messageMenu.copyImage"), onSelect: () => void copyImage(image.src).then(() => ui.toast(t("chat.messageMenu.imageCopied"), "success"), (err: unknown) => failed(err, t("chat.messageMenu.couldNotCopyThePicture"))) },
    { id: "save-image", label: t("chat.messageMenu.saveImage"), onSelect: () => void saveImage(image.src, image.name).catch((err: unknown) => failed(err, t("chat.messageMenu.couldNotSaveThePicture"))) },
  ];
}

/** The menu for a message; opened on one of its pictures, the picture's own actions come first. */
export function buildMessageMenu(msg: DecryptedMessage, hooks: MenuHooks, image?: ImageTarget | null): ContextMenuItem[] {
  const ui = useUI.getState();
  const dev = useSettings.getState().settings.developerMode;
  const pinned = (msg.flags & MSG_FLAG_PINNED) !== 0;
  const items: ContextMenuItem[] = image ? imageMenuItems(image) : [];
  if (items.length) items[items.length - 1]!.separatorAfter = true;
  items.push({ id: "react", label: t("chat.messageItem.addReaction"), onSelect: hooks.openReactionPicker, separatorAfter: true });
  if (canEdit(msg)) items.push({ id: "edit", label: t("chat.messageItem.editMessage"), onSelect: () => ui.setEditing({ channelId: msg.channel_id, messageId: msg.id }) });
  items.push({ id: "reply", label: t("chat.messageItem.reply"), onSelect: () => ui.setReplyTo({ channelId: msg.channel_id, messageId: msg.id, ping: true }), separatorAfter: true });
  items.push({
    id: "copy",
    label: t("chat.messageMenu.copyText"),
    disabled: !msg.payload?.t,
    onSelect: () => void navigator.clipboard?.writeText(humanizeMentions(msg.payload?.t ?? "", useUsers.getState().byId, knownNames())),
  });
  if (canPin(msg)) items.push({
    id: "pin",
    label: pinned ? t("chat.messageItem.unpinMessage") : t("chat.messageItem.pinMessage"),
    onSelect: () => {
      const p = pinned ? channelsApi.unpin(msg.channel_id, msg.id) : channelsApi.pin(msg.channel_id, msg.id);
      p.catch((err: unknown) => ui.toast(err instanceof Error ? err.message : t("chat.messageMenu.couldNotUpdateThePin"), "error"));
    },
  });
  items.push({ id: "unread", label: t("chat.messageItem.markUnread"), onSelect: () => markUnread(msg) });
  if (msg.payload?.embeds?.length && useAuth.getState().me?.id === msg.author_id) {
    const suppressed = (msg.flags & 4) !== 0;
    items.push({ id: "embeds", label: suppressed ? t("chat.messageMenu.showEmbeds") : t("chat.messageMenu.removeEmbeds"), onSelect: () => void messagesApi.edit(msg.channel_id, msg.id, { flags: suppressed ? 0 : 4 }).then((m) => useMessages.getState().setFlags(msg.channel_id, msg.id, m.flags)).catch(() => ui.toast(t("chat.messageMenu.couldNotUpdateEmbeds"), "error")) });
  }
  items.push({ id: "link", label: t("chat.messageItem.copyMessageLink"), onSelect: () => copyMessageLink(msg), separatorAfter: dev || canDelete(msg) });
  if (dev) items.push({ id: "id", label: t("chat.messageItem.copyMessageId"), onSelect: () => void navigator.clipboard?.writeText(msg.id), separatorAfter: canDelete(msg) });
  if (canDelete(msg)) {
    items.push({ id: "select", label: t("chat.messageMenu.selectMessages"), onSelect: () => startSelecting(msg) });
    items.push({
      id: "delete",
      label: t("chat.messageMenu.deleteMessage"),
      danger: true,
      onSelect: () =>
        ui.openModal("confirm", {
          title: t("chat.messageMenu.deleteMessage"),
          body: t("chat.messageMenu.areYouSureYouWantTo"),
          confirmLabel: t("chat.messageItem.delete"),
          danger: true,
          onConfirm: () => messagesApi.remove(msg.channel_id, msg.id).catch((err: unknown) => ui.toast(err instanceof Error ? err.message : t("chat.messageMenu.couldNotDelete"), "error")),
        }),
    });
  }
  return items;
}

/** Every role and channel name this device knows, so copied text reads the way the message does. */
function knownNames(): HumanNames {
  const roles: Record<string, string> = {};
  for (const st of Object.values(useServers.getState().byId)) for (const r of Object.values(st.roles)) roles[r.id] = r.name;
  const channels: Record<string, string> = {};
  for (const c of Object.values(useChannels.getState().byId)) if (c.server_id && c.name) channels[c.id] = c.name;
  return { roles, channels, emoji: () => true };
}

async function fetchForcedAck(channelId: string, prev: string): Promise<void> {
  // The regular ack never moves backwards; "mark unread" needs the manual flag.
  const { api } = await import("@/api/client");
  await api.request("POST", `/channels/${channelId}/messages/${prev === "0" ? "0" : prev}/ack`, { manual: true }).catch(() => undefined);
}

export function sortIds(a: string, b: string): number {
  return compareIds(a, b);
}

/** Marks the channel unread from this message down. */
export function markUnread(msg: DecryptedMessage): void {
  const ch = useMessages.getState().channels[msg.channel_id];
  const ids = ch?.ids ?? [];
  const idx = ids.indexOf(msg.id);
  const prev = idx > 0 ? ids[idx - 1]! : "0";
  // What is being made unread may hold mentions; zeroing the count left the
  // channel unread with no badge to say the reader is wanted in it.
  const meId = useAuth.getState().me?.id;
  let mentions = 0;
  if (meId && idx >= 0) {
    for (const id of ids.slice(idx)) {
      const m = ch?.byId[id];
      if (m && m.author_id !== meId && mentionsMe(m, meId)) mentions += 1;
    }
  }
  useReadStates.getState().set({ channel_id: msg.channel_id, last_read_message_id: prev === "0" ? null : prev, last_ack_at: Date.now(), mention_count: mentions });
  void (async () => {
    // The two acks say opposite things, and nothing used to sequence them: the
    // forced one is what Mark Unread means, so it lands last. At the top of a
    // loaded page there is no earlier message to read up to, and the plain ack
    // there would have marked this very message read.
    if (prev !== "0") await messagesApi.ack(msg.channel_id, prev).catch(() => undefined);
    await fetchForcedAck(msg.channel_id, prev);
  })();
}

/** Copies a permalink that opens the message in its channel. */
export function copyMessageLink(msg: DecryptedMessage): void {
  const chan = useChannels.getState().byId[msg.channel_id];
  const base = chan?.server_id ? `/channels/${chan.server_id}` : "/channels/@me";
  void navigator.clipboard?.writeText(`${location.origin}${base}/${msg.channel_id}/${msg.id}`).then(() => useUI.getState().toast(t("chat.messageMenu.linkCopied"), "success"));
}

/** Deletes without the confirmation dialog (the Shift shortcut). */
export async function deleteMessageNow(msg: DecryptedMessage): Promise<void> {
  try {
    await messagesApi.remove(msg.channel_id, msg.id);
    useMessages.getState().remove(msg.channel_id, msg.id);
  } catch (err) {
    useUI.getState().toast(err instanceof Error ? err.message : t("chat.messageMenu.couldNotDeleteTheMessage"), "error");
  }
}

/** Whether a message can be ticked while picking messages to delete. */
export function canPick(msg: DecryptedMessage): boolean {
  return !msg.type.startsWith("system_") && canDelete(msg);
}

/** Starts picking messages to delete in the message's channel, with that message ticked. */
export function startSelecting(msg: DecryptedMessage): void {
  const ui = useUI.getState();
  if (ui.editing?.channelId === msg.channel_id) ui.setEditing(null);
  useSelection.getState().start(msg.channel_id, canPick(msg) ? msg.id : undefined);
}

/**
 * Deletes the picked messages, a batch per request. Each batch that goes is
 * taken off the screen and out of the selection straight away, so a failure
 * part way leaves only what is still there picked, ready to try again.
 */
export async function deleteMessagesNow(channelId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BULK_DELETE_MAX) {
    const batch = ids.slice(i, i + BULK_DELETE_MAX);
    await messagesApi.removeMany(channelId, batch);
    // ids the server skipped were already gone, so the whole batch leaves the screen
    useMessages.getState().removeMany(channelId, batch);
    useSelection.getState().drop(batch);
  }
}

/** Pins or unpins, whichever the message is not. */
export async function togglePin(msg: DecryptedMessage): Promise<void> {
  const pinned = (msg.flags & MSG_FLAG_PINNED) !== 0;
  try {
    if (pinned) await channelsApi.unpin(msg.channel_id, msg.id);
    else await channelsApi.pin(msg.channel_id, msg.id);
  } catch (err) {
    useUI.getState().toast(err instanceof Error ? err.message : t("chat.messageMenu.couldNotUpdateThePin"), "error");
  }
}
