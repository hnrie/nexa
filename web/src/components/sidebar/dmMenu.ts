import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { isInstanceAdmin } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { joinVoice } from "@/voice/session";
import { openMenuItems } from "./openMenu";

import { t } from "@/i18n";
function nameOf(ch: Channel): string {
  return channelDisplayName(ch, useUsers.getState().byId, useAuth.getState().me?.id, friendNicknames(useRelationships.getState().byUser));
}

function forget(channelId: string): void {
  useChannels.getState().remove(channelId);
  useMessages.getState().clearChannel(channelId);
}

/**
 * Whether the page at `pathname` shows this conversation or one of its
 * subchats, so closing the conversation has to take the user somewhere else.
 */
export function isViewingDM(pathname: string, channelId: string, byId: Record<string, Channel | undefined>): boolean {
  const open = pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
  if (!open) return false;
  return open === channelId || byId[open]?.parent_id === channelId;
}

/** Sends the user to Friends only when they are reading the conversation that went away. */
function leave(channelId: string, nav?: (p: string) => void): void {
  if (nav && isViewingDM(window.location.pathname, channelId, useChannels.getState().byId)) nav("/channels/@me");
}

/** Closes a conversation for you; a new message brings it back. */
export async function closeDM(channelId: string, nav?: (p: string) => void): Promise<void> {
  try {
    await channelsApi.close(channelId);
    leave(channelId, nav);
    forget(channelId);
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("sidebar.dmMenu.couldNotCloseThatConversation"), "error");
  }
}

/** Deletes a conversation for everyone in it (or a group you own). */
export async function purgeDM(channelId: string, nav?: (p: string) => void): Promise<void> {
  try {
    await channelsApi.purge(channelId);
    leave(channelId, nav);
    forget(channelId);
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("sidebar.dmMenu.couldNotDeleteThatConversation"), "error");
  }
}

/** Whether you may do what a group's owner does: you own it, or you run this instance. */
export function managesGroup(ch: Channel | undefined): boolean {
  const me = useAuth.getState().me;
  if (!ch || ch.type !== "group_dm" || !me) return false;
  return ch.owner_id === me.id || isInstanceAdmin(me.id);
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
  const owner = managesGroup(ch);
  const name = nameOf(ch);
  const reads = useReadStates.getState();
  const items: ContextMenuItem[] = [
    ...openMenuItems(null, channelId),
    {
      id: "read",
      label: t("sidebar.dmMenu.markAsRead"),
      disabled: !ch.last_message_id || !isUnread(reads.byChannel[channelId], ch.last_message_id),
      onSelect: () => ch.last_message_id && void reads.ack(channelId, ch.last_message_id),
      separatorAfter: true,
    },
  ];
  if (group) {
    items.push({ id: "edit", label: t("modals.editGroup.editGroup"), onSelect: () => ctx.openModal("editGroup", { channelId }) });
    items.push({ id: "invite", label: t("chat.chat.invitePeople"), onSelect: () => ctx.openModal("groupInvite", { channelId }) });
    items.push({ id: "add", label: t("sidebar.dmMenu.addFriends"), onSelect: () => ctx.openModal("createDM", { groupId: channelId }) });
  } else {
    items.push({ id: "profile", label: t("profile.profile.profile"), onSelect: () => { const other = ch.recipient_ids.find((id) => id !== me?.id); if (other) ctx.openModal("profile", { userId: other }); } });
    items.push({
      id: "call",
      label: t("sidebar.dmMenu.startCall"),
      onSelect: () => {
        ctx.nav(`/channels/@me/${channelId}`);
        void joinVoice(channelId);
      },
    });
  }
  items.push({
    id: "mute",
    label: muted ? t("sidebar.dmMenu.unmuteConversation") : t("sidebar.dmMenu.muteConversation"),
    onSelect: () => {
      const list = settings.notifications.muted;
      useSettings.getState().patch({ notifications: { ...settings.notifications, muted: muted ? list.filter((x) => x !== channelId) : [...list, channelId] } });
    },
    separatorAfter: true,
  });
  items.push({
    id: "close",
    label: group ? t("chat.groupMemberMenu.leaveGroup") : t("sidebar.dMSidebar.closeDm"),
    danger: group,
    onSelect: () =>
      group
        ? ctx.openModal("confirm", {
            title: `Leave '${name}'`,
            body: t("sidebar.dmMenu.youStopReceivingMessagesFromThis"),
            confirmLabel: t("chat.groupMemberMenu.leaveGroup"),
            danger: true,
            onConfirm: () => closeDM(channelId, ctx.nav),
          })
        : void closeDM(channelId, ctx.nav),
  });
  if (!group || owner) {
    items.push({
      id: "purge",
      label: group ? t("sidebar.dmMenu.deleteGroup") : t("sidebar.dmMenu.deleteConversation"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: group ? t("sidebar.dmMenu.deleteNamed", { name }) : t("sidebar.dmMenu.deleteYourConversationWith", { name }),
          body: group
            ? t("sidebar.dmMenu.theGroupAndEveryMessageIn")
            : t("sidebar.dmMenu.everyMessageIsRemovedForBoth"),
          confirmLabel: group ? t("sidebar.dmMenu.deleteGroup") : t("sidebar.dmMenu.deleteForEveryone"),
          danger: true,
          onConfirm: () => purgeDM(channelId, ctx.nav),
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: t("sidebar.dmMenu.copyChannelId"), onSelect: () => void navigator.clipboard?.writeText(channelId) });
  return items;
}
