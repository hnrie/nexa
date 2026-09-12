import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useReadStates, isUnread } from "@/stores/readStates";
import { canI, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";

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
    useUI.getState().toast(err instanceof ApiError ? err.message : "Could not leave the server.", "error");
  }
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).then(() => useUI.getState().toast("Copied!", "success"));
}

export function serverMenuItems(serverId: string, ctx: MenuCtx): ContextMenuItem[] {
  const st = useServers.getState().byId[serverId];
  if (!st) return [];
  const me = useAuth.getState().me;
  const settings = useSettings.getState().settings;
  const muted = settings.notifications.muted.includes(serverId);
  const owner = st.server.owner_id === me?.id;
  const items: ContextMenuItem[] = [
    { id: "read", label: "Mark As Read", onSelect: () => markServerRead(serverId), separatorAfter: true },
    { id: "invite", label: "Invite People", onSelect: () => ctx.openModal("invite", { serverId }) },
  ];
  if (anyOf(st.myPermissions, ANY_MANAGE)) items.push({ id: "settings", label: "Server Settings", onSelect: () => ctx.openModal("serverSettings", { serverId }) });
  if (canI(st, P.MANAGE_CHANNELS)) {
    items.push({ id: "channel", label: "Create Channel", onSelect: () => ctx.openModal("createChannel", { serverId }) });
    items.push({ id: "category", label: "Create Category", onSelect: () => ctx.openModal("createCategory", { serverId }) });
  }
  items[items.length - 1]!.separatorAfter = true;
  items.push({ id: "mute", label: muted ? "Unmute Server" : "Mute Server", onSelect: () => toggleMuted(serverId) });
  items.push({ id: "notif", label: "Notification Settings", onSelect: () => ctx.openModal("serverNotifications", { serverId }), separatorAfter: true });
  items.push({ id: "profile", label: "Edit Server Profile", onSelect: () => ctx.openModal("serverProfile", { serverId }) });
  if (!owner) {
    items.push({
      id: "leave",
      label: "Leave Server",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: `Leave '${st.server.name}'`,
          body: `Are you sure you want to leave ${st.server.name}? You won't be able to rejoin this server unless you are re-invited.`,
          confirmLabel: "Leave Server",
          danger: true,
          onConfirm: () => leaveServer(serverId, ctx.nav),
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: "Copy Server ID", onSelect: () => copy(serverId) });
  return items;
}

export function channelMenuItems(channelId: string, ctx: MenuCtx): ContextMenuItem[] {
  const ch = useChannels.getState().byId[channelId];
  if (!ch || !ch.server_id) return [];
  const st = useServers.getState().byId[ch.server_id];
  const settings = useSettings.getState().settings;
  const muted = settings.notifications.muted.includes(channelId);
  const items: ContextMenuItem[] = [];
  if (ch.type === "text") {
    items.push({
      id: "read",
      label: "Mark As Read",
      disabled: !ch.last_message_id,
      onSelect: () => ch.last_message_id && void useReadStates.getState().ack(ch.id, ch.last_message_id),
      separatorAfter: true,
    });
  }
  if (canI(st, P.CREATE_INSTANT_INVITE, channelId)) items.push({ id: "invite", label: "Invite People", onSelect: () => ctx.openModal("invite", { serverId: ch.server_id, channelId }) });
  items.push({ id: "link", label: "Copy Link", onSelect: () => copy(`${window.location.origin}/channels/${ch.server_id}/${ch.id}`), separatorAfter: true });
  if (ch.type === "text") items.push({ id: "mute", label: muted ? "Unmute Channel" : "Mute Channel", onSelect: () => toggleMuted(channelId), separatorAfter: true });
  if (canI(st, P.MANAGE_CHANNELS, channelId)) {
    items.push({ id: "edit", label: "Edit Channel", onSelect: () => ctx.openModal("channelSettings", { channelId }) });
    items.push({
      id: "delete",
      label: "Delete Channel",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: "Delete Channel",
          body: `Are you sure you want to delete #${ch.name}? This cannot be undone.`,
          confirmLabel: "Delete Channel",
          danger: true,
          onConfirm: async () => {
            await serversApi.deleteChannel(ch.id);
            useChannels.getState().remove(ch.id);
          },
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: "Copy Channel ID", onSelect: () => copy(channelId) });
  return items;
}

export function categoryMenuItems(categoryId: string, ctx: MenuCtx & { collapsed: boolean; toggle: () => void }): ContextMenuItem[] {
  const ch = useChannels.getState().byId[categoryId];
  if (!ch || !ch.server_id) return [];
  const st = useServers.getState().byId[ch.server_id];
  const settings = useSettings.getState().settings;
  const items: ContextMenuItem[] = [{ id: "collapse", label: ctx.collapsed ? "Expand Category" : "Collapse Category", onSelect: ctx.toggle, separatorAfter: true }];
  if (canI(st, P.MANAGE_CHANNELS)) {
    items.push({ id: "create", label: "Create Channel", onSelect: () => ctx.openModal("createChannel", { serverId: ch.server_id, parentId: categoryId }) });
    items.push({ id: "edit", label: "Edit Category", onSelect: () => ctx.openModal("channelSettings", { channelId: categoryId }) });
    items.push({
      id: "delete",
      label: "Delete Category",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: "Delete Category",
          body: `Delete the category '${ch.name}'? Channels inside it are kept and moved to the top of the list.`,
          confirmLabel: "Delete Category",
          danger: true,
          onConfirm: async () => {
            await serversApi.deleteChannel(ch.id);
            useChannels.getState().remove(ch.id);
          },
        }),
    });
  }
  if (settings.developerMode) items.push({ id: "copy", label: "Copy Category ID", onSelect: () => copy(categoryId) });
  return items;
}
