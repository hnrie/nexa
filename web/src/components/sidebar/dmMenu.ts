import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";

function nameOf(ch: Channel): string {
  return channelDisplayName(ch, useUsers.getState().byId, useAuth.getState().me?.id, friendNicknames(useRelationships.getState().byUser));
}

function forget(channelId: string): void {
  useChannels.getState().remove(channelId);
  useMessages.getState().clearChannel(channelId);
}

/** Closes a conversation for you; a new message brings it back. */
export async function closeDM(channelId: string, nav?: (p: string) => void): Promise<void> {
  try {
    await channelsApi.close(channelId);
    forget(channelId);
    nav?.("/channels/@me");
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : "Could not close that conversation.", "error");
  }
}

/** Deletes a conversation for everyone in it (or a group you own). */
export async function purgeDM(channelId: string, nav?: (p: string) => void): Promise<void> {
  try {
    await channelsApi.purge(channelId);
    forget(channelId);
    nav?.("/channels/@me");
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : "Could not delete that conversation.", "error");
  }
}

export interface DMMenuCtx {
  nav: (path: string) => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

/** Context menu for a DM or group row in the sidebar. */
export function dmMenuItems(channelId: string, ctx: DMMenuCtx): ContextMenuItem[] {
  const ch = useChannels.getState().byId[channelId];
  if (!ch) return [];
  const me = useAuth.getState().me;
  const settings = useSettings.getState().settings;
  const muted = settings.notifications.muted.includes(channelId);
  const group = ch.type === "group_dm";
  const owner = group && ch.owner_id === me?.id;
  const name = nameOf(ch);
  const reads = useReadStates.getState();
  const items: ContextMenuItem[] = [
    {
      id: "read",
      label: "Mark As Read",
      disabled: !ch.last_message_id || !isUnread(reads.byChannel[channelId], ch.last_message_id),
      onSelect: () => ch.last_message_id && void reads.ack(channelId, ch.last_message_id),
      separatorAfter: true,
    },
  ];
  if (group) {
    items.push({ id: "invite", label: "Invite People", onSelect: () => ctx.openModal("groupInvite", { channelId }) });
    items.push({ id: "add", label: "Add Friends", onSelect: () => ctx.openModal("createDM", { groupId: channelId }) });
  } else {
    items.push({ id: "profile", label: "Profile", onSelect: () => { const other = ch.recipient_ids.find((id) => id !== me?.id); if (other) ctx.openModal("profile", { userId: other }); } });
    items.push({ id: "call", label: "Start Call", onSelect: () => ctx.nav(`/channels/@me/${channelId}`) });
  }
  items.push({
    id: "mute",
    label: muted ? "Unmute Conversation" : "Mute Conversation",
    onSelect: () => {
      const list = settings.notifications.muted;
      useSettings.getState().patch({ notifications: { ...settings.notifications, muted: muted ? list.filter((x) => x !== channelId) : [...list, channelId] } });
    },
    separatorAfter: true,
  });
  items.push({
    id: "close",
    label: group ? "Leave Group" : "Close DM",
    danger: group,
    onSelect: () =>
      group
        ? ctx.openModal("confirm", {
            title: `Leave '${name}'`,
            body: "You stop receiving messages from this group. You need a new invite to come back.",
            confirmLabel: "Leave Group",
            danger: true,
            onConfirm: () => closeDM(channelId, ctx.nav),
          })
        : void closeDM(channelId, ctx.nav),
  });
  if (!group || owner) {
    items.push({
      id: "purge",
      label: group ? "Delete Group" : "Delete Conversation",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: group ? `Delete '${name}'` : `Delete your conversation with ${name}`,
          body: group
            ? "The group and every message in it are removed for everyone. This cannot be undone."
            : "Every message is removed for both of you, not just hidden from your side. This cannot be undone. To tidy your own list without deleting anything, use Close DM instead.",
          confirmLabel: group ? "Delete Group" : "Delete For Everyone",
          danger: true,
          onConfirm: () => purgeDM(channelId, ctx.nav),
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: "Copy Channel ID", onSelect: () => void navigator.clipboard?.writeText(channelId) });
  return items;
}
