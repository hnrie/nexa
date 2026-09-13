import { channels as channelsApi } from "@/api/channels";
import { messages as messagesApi } from "@/api/messages";
import { MSG_FLAG_PINNED } from "@/api/types";
import { humanizeMentions } from "@/components/composer/mentions";
import { compareIds } from "@/lib/ids";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { isInstanceAdmin } from "@/stores/servers";
import { useUsers } from "@/stores/users";

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
  return !!ch && ch.type === "group_dm" && ch.owner_id === me.id;
}

export function canEdit(msg: DecryptedMessage): boolean {
  const me = useAuth.getState().me;
  return !!me && msg.author_id === me.id && (msg.type === "default" || msg.type === "reply") && !!msg.payload;
}

export function buildMessageMenu(msg: DecryptedMessage, hooks: MenuHooks): ContextMenuItem[] {
  const ui = useUI.getState();
  const dev = useSettings.getState().settings.developerMode;
  const pinned = (msg.flags & MSG_FLAG_PINNED) !== 0;
  const items: ContextMenuItem[] = [
    { id: "react", label: "Add Reaction", onSelect: hooks.openReactionPicker, separatorAfter: true },
  ];
  if (canEdit(msg)) items.push({ id: "edit", label: "Edit Message", onSelect: () => ui.setEditing({ channelId: msg.channel_id, messageId: msg.id }) });
  items.push({ id: "reply", label: "Reply", onSelect: () => ui.setReplyTo({ channelId: msg.channel_id, messageId: msg.id, ping: true }), separatorAfter: true });
  items.push({
    id: "copy",
    label: "Copy Text",
    disabled: !msg.payload?.t,
    onSelect: () => void navigator.clipboard?.writeText(humanizeMentions(msg.payload?.t ?? "", useUsers.getState().byId)),
  });
  items.push({
    id: "pin",
    label: pinned ? "Unpin Message" : "Pin Message",
    onSelect: () => {
      const p = pinned ? channelsApi.unpin(msg.channel_id, msg.id) : channelsApi.pin(msg.channel_id, msg.id);
      p.catch((err: unknown) => ui.toast(err instanceof Error ? err.message : "Could not update the pin.", "error"));
    },
  });
  items.push({ id: "unread", label: "Mark Unread", onSelect: () => markUnread(msg) });
  if (msg.payload?.embeds?.length && useAuth.getState().me?.id === msg.author_id) {
    const suppressed = (msg.flags & 4) !== 0;
    items.push({ id: "embeds", label: suppressed ? "Show Embeds" : "Remove Embeds", onSelect: () => void messagesApi.edit(msg.channel_id, msg.id, { flags: suppressed ? 0 : 4 }).then((m) => useMessages.getState().setFlags(msg.channel_id, msg.id, m.flags)).catch(() => ui.toast("Could not update embeds.", "error")) });
  }
  items.push({ id: "link", label: "Copy Message Link", onSelect: () => copyMessageLink(msg), separatorAfter: dev || canDelete(msg) });
  if (dev) items.push({ id: "id", label: "Copy Message ID", onSelect: () => void navigator.clipboard?.writeText(msg.id), separatorAfter: canDelete(msg) });
  if (canDelete(msg)) {
    items.push({
      id: "delete",
      label: "Delete Message",
      danger: true,
      onSelect: () =>
        ui.openModal("confirm", {
          title: "Delete Message",
          body: "Are you sure you want to delete this message?",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: () => messagesApi.remove(msg.channel_id, msg.id).catch((err: unknown) => ui.toast(err instanceof Error ? err.message : "Could not delete.", "error")),
        }),
    });
  }
  return items;
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
  useReadStates.getState().set({ channel_id: msg.channel_id, last_read_message_id: prev === "0" ? null : prev, last_ack_at: Date.now(), mention_count: 0 });
  void messagesApi.ack(msg.channel_id, prev === "0" ? msg.id : prev);
  void fetchForcedAck(msg.channel_id, prev);
}

/** Copies a permalink that opens the message in its channel. */
export function copyMessageLink(msg: DecryptedMessage): void {
  const chan = useChannels.getState().byId[msg.channel_id];
  const base = chan?.server_id ? `/channels/${chan.server_id}` : "/channels/@me";
  void navigator.clipboard?.writeText(`${location.origin}${base}/${msg.channel_id}/${msg.id}`).then(() => useUI.getState().toast("Link copied.", "success"));
}

/** Deletes without the confirmation dialog (the Shift shortcut). */
export async function deleteMessageNow(msg: DecryptedMessage): Promise<void> {
  try {
    await messagesApi.remove(msg.channel_id, msg.id);
    useMessages.getState().remove(msg.channel_id, msg.id);
  } catch (err) {
    useUI.getState().toast(err instanceof Error ? err.message : "Could not delete the message.", "error");
  }
}

/** Pins or unpins, whichever the message is not. */
export async function togglePin(msg: DecryptedMessage): Promise<void> {
  const pinned = (msg.flags & MSG_FLAG_PINNED) !== 0;
  try {
    if (pinned) await channelsApi.unpin(msg.channel_id, msg.id);
    else await channelsApi.pin(msg.channel_id, msg.id);
  } catch (err) {
    useUI.getState().toast(err instanceof Error ? err.message : "Could not update the pin.", "error");
  }
}
