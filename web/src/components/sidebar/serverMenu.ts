import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { selectServerChannels, useChannels } from "@/stores/channels";
import { useReadStates, isUnread } from "@/stores/readStates";
import { canI, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { copyAndSay } from "@/lib/copyText";
import { openMenuItems } from "./openMenu";

import { t } from "@/i18n";
export interface MenuCtx {
  nav: (path: string) => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

const ANY_MANAGE = P.MANAGE_SERVER | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.VIEW_AUDIT_LOG | P.BAN_MEMBERS | P.KICK_MEMBERS;

function anyOf(p: bigint, bits: bigint): boolean {
  return (p & bits) !== 0n;
}

export function markServerRead(serverId: string): void {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState();
  for (const ch of Object.values(channels)) {
    if (ch.server_id !== serverId || ch.type !== "text" || !ch.last_message_id) continue;
    if (isUnread(reads.byChannel[ch.id], ch.last_message_id) || (reads.byChannel[ch.id]?.mentions ?? 0) > 0) void reads.ack(ch.id, ch.last_message_id);
  }
}

export function toggleMuted(id: string): void {
  const st = useSettings.getState();
  const muted = st.settings.notifications.muted;
  st.patch({ notifications: { ...st.settings.notifications, muted: muted.includes(id) ? muted.filter((x) => x !== id) : [...muted, id] } });
}

export async function leaveServer(serverId: string, nav: (p: string) => void): Promise<void> {
  try {
    await serversApi.leave(serverId);
    useServers.getState().remove(serverId);
    nav("/channels/@me");
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("sidebar.serverMenu.couldNotLeaveTheServer"), "error");
  }
}

function copy(text: string): void {
  copyAndSay(text);
}

export function serverMenuItems(serverId: string, ctx: MenuCtx): ContextMenuItem[] {
  const st = useServers.getState().byId[serverId];
  if (!st) return [];
  const me = useAuth.getState().me;
  const settings = useSettings.getState().settings;
  const muted = settings.notifications.muted.includes(serverId);
  const owner = st.server.owner_id === me?.id;
  const items: ContextMenuItem[] = [{ id: "read", label: t("sidebar.dmMenu.markAsRead"), onSelect: () => markServerRead(serverId), separatorAfter: true }];
  // offered only where there is a channel to invite into: without one the
  // dialog opened on an empty list and a blank link
  const invitable = selectServerChannels(useChannels.getState().byId, serverId).some((c) => c.type === "text" && canI(st, P.CREATE_INSTANT_INVITE, c.id));
  if (invitable) items.push({ id: "invite", label: t("chat.chat.invitePeople"), onSelect: () => ctx.openModal("invite", { serverId }) });
  if (anyOf(st.myPermissions, ANY_MANAGE)) items.push({ id: "settings", label: t("server.serverSettings.serverSettings"), onSelect: () => ctx.openModal("serverSettings", { serverId }) });
  if (canI(st, P.MANAGE_CHANNELS)) {
    items.push({ id: "channel", label: t("modals.createChannel.createChannel"), onSelect: () => ctx.openModal("createChannel", { serverId }) });
    items.push({ id: "category", label: t("modals.createCategory.createCategory"), onSelect: () => ctx.openModal("createCategory", { serverId }) });
  }
  items[items.length - 1]!.separatorAfter = true;
  items.push({ id: "mute", label: muted ? t("sidebar.serverMenu.unmuteServer") : t("sidebar.serverMenu.muteServer"), onSelect: () => toggleMuted(serverId) });
  items.push({ id: "notif", label: t("modals.serverNotifications.notificationSettings"), onSelect: () => ctx.openModal("serverNotifications", { serverId }), separatorAfter: true });
  items.push({ id: "profile", label: t("sidebar.serverMenu.editServerProfile"), onSelect: () => ctx.openModal("serverProfile", { serverId }) });
  if (!owner) {
    items.push({
      id: "leave",
      label: t("sidebar.serverMenu.leaveServer"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("sidebar.serverMenu.leaveNamed", { name: st.server.name }),
          body: t("sidebar.serverMenu.areYouSureYouWantToLeave", { name: st.server.name }),
          confirmLabel: t("sidebar.serverMenu.leaveServer"),
          danger: true,
          onConfirm: () => leaveServer(serverId, ctx.nav),
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: t("sidebar.serverMenu.copyServerId"), onSelect: () => copy(serverId) });
  return items;
}

export function channelMenuItems(channelId: string, ctx: MenuCtx): ContextMenuItem[] {
  const ch = useChannels.getState().byId[channelId];
  if (!ch || !ch.server_id) return [];
  const st = useServers.getState().byId[ch.server_id];
  const settings = useSettings.getState().settings;
  const muted = settings.notifications.muted.includes(channelId);
  const items: ContextMenuItem[] = [];
  // a voice channel has no chat to open beside another one
  if (ch.type !== "voice") items.push(...openMenuItems(ch.server_id, channelId));
  if (ch.type === "text") {
    items.push({
      id: "read",
      label: t("sidebar.dmMenu.markAsRead"),
      disabled: !ch.last_message_id,
      onSelect: () => ch.last_message_id && void useReadStates.getState().ack(ch.id, ch.last_message_id),
      separatorAfter: true,
    });
  }
  if (canI(st, P.CREATE_INSTANT_INVITE, channelId)) items.push({ id: "invite", label: t("chat.chat.invitePeople"), onSelect: () => ctx.openModal("invite", { serverId: ch.server_id, channelId }) });
  // a voice channel's call takes guests without an account, through a link
  if (ch.type === "voice" && canI(st, P.CREATE_INSTANT_INVITE | P.CONNECT, channelId)) items.push({ id: "guests", label: t("chat.chat.inviteGuestsToCall"), onSelect: () => ctx.openModal("guestLink", { channelId }) });
  items.push({ id: "link", label: t("sidebar.serverMenu.copyLink"), onSelect: () => copy(`${window.location.origin}/channels/${ch.server_id}/${ch.id}`), separatorAfter: true });
  if (ch.type === "text") items.push({ id: "mute", label: muted ? t("sidebar.serverMenu.unmuteChannel") : t("sidebar.serverMenu.muteChannel"), onSelect: () => toggleMuted(channelId), separatorAfter: true });
  if (canI(st, P.MANAGE_CHANNELS, channelId)) {
    items.push({ id: "edit", label: t("sidebar.serverSidebar.editChannel"), onSelect: () => ctx.openModal("channelSettings", { channelId }) });
    items.push({
      id: "delete",
      label: t("sidebar.serverMenu.deleteChannel"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("sidebar.serverMenu.deleteChannel"),
          body: t("sidebar.serverMenu.areYouSureYouWantToDeleteChannel", { name: ch.name }),
          confirmLabel: t("sidebar.serverMenu.deleteChannel"),
          danger: true,
          onConfirm: async () => {
            await serversApi.deleteChannel(ch.id);
            useChannels.getState().remove(ch.id);
          },
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: t("sidebar.dmMenu.copyChannelId"), onSelect: () => copy(channelId) });
  return items;
}

export function categoryMenuItems(categoryId: string, ctx: MenuCtx & { collapsed: boolean; toggle: () => void }): ContextMenuItem[] {
  const ch = useChannels.getState().byId[categoryId];
  if (!ch || !ch.server_id) return [];
  const st = useServers.getState().byId[ch.server_id];
  const settings = useSettings.getState().settings;
  const items: ContextMenuItem[] = [{ id: "collapse", label: ctx.collapsed ? t("sidebar.serverMenu.expandCategory") : t("sidebar.serverMenu.collapseCategory"), onSelect: ctx.toggle, separatorAfter: true }];
  if (canI(st, P.MANAGE_CHANNELS)) {
    items.push({ id: "create", label: t("modals.createChannel.createChannel"), onSelect: () => ctx.openModal("createChannel", { serverId: ch.server_id, parentId: categoryId }) });
    items.push({ id: "edit", label: t("sidebar.serverMenu.editCategory"), onSelect: () => ctx.openModal("channelSettings", { channelId: categoryId }) });
    items.push({
      id: "delete",
      label: t("sidebar.serverMenu.deleteCategory"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("sidebar.serverMenu.deleteCategory"),
          body: t("sidebar.serverMenu.deleteTheCategoryNamed", { name: ch.name }),
          confirmLabel: t("sidebar.serverMenu.deleteCategory"),
          danger: true,
          onConfirm: async () => {
            await serversApi.deleteChannel(ch.id);
            useChannels.getState().remove(ch.id);
          },
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: t("sidebar.serverMenu.copyCategoryId"), onSelect: () => copy(categoryId) });
  return items;
}
