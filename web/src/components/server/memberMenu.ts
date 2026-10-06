import { P, canActOn } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { canI, memberHighest, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { copyAndSay } from "@/lib/copyText";
import { useUsers } from "@/stores/users";
import { relationshipMenuItems } from "@/lib/friendship";
import { profileLinkItem } from "@/lib/profileLinks";

import { t } from "@/i18n";
/** Whether the current user outranks a member (or is that member). */
export function outranks(serverId: string, userId: string): boolean {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me;
  if (!st || !me) return false;
  if (userId === me.id) return true;
  const actor = memberHighest(st, me.id);
  const target = memberHighest(st, userId);
  return canActOn(actor.highest, target.highest, actor.isOwner, target.isOwner);
}

/** Time Out, Kick and Ban, each where this account may and outranks the member; nothing for itself. */
export function memberModerationItems(serverId: string, userId: string, ctx: { openModal: (kind: string, props?: Record<string, unknown>) => void }): ContextMenuItem[] {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me;
  if (!st || !me || userId === me.id || !outranks(serverId, userId)) return [];
  const timedOut = !!st.members[userId]?.timeout_until && st.members[userId]!.timeout_until! > Date.now();
  const mod: ContextMenuItem[] = [];
  if (canI(st, P.MODERATE_MEMBERS)) mod.push({ id: "timeout", label: timedOut ? t("server.memberAction.removeTimeout") : t("server.members.timeout"), danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "timeout" }) });
  if (canI(st, P.KICK_MEMBERS)) mod.push({ id: "kick", label: t("server.members.kick"), danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "kick" }) });
  if (canI(st, P.BAN_MEMBERS)) mod.push({ id: "ban", label: t("server.members.ban"), danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "ban" }) });
  return mod;
}

/** Context menu for a member row: profile, mention, nickname, roles, moderation. */
export function memberMenuItems(serverId: string, userId: string, ctx: { openModal: (kind: string, props?: Record<string, unknown>) => void }): ContextMenuItem[] {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me;
  if (!st || !me) return [];
  const self = userId === me.id;
  const above = outranks(serverId, userId);
  const username = useUsers.getState().byId[userId]?.username;
  const items: ContextMenuItem[] = [
    { id: "profile", label: t("profile.profile.profile"), onSelect: () => ctx.openModal("profile", { userId }) },
    ...[profileLinkItem(userId)].filter((x): x is ContextMenuItem => !!x),
    {
      id: "mention",
      label: t("settings.notifications.mention"),
      disabled: !username,
      onSelect: () => window.dispatchEvent(new CustomEvent("ec:insert-text", { detail: `@${username} ` })),
      separatorAfter: true,
    },
  ];
  // being friends, and blocking: the same choices a profile offers
  const people = relationshipMenuItems(userId);
  if (people.length) {
    items.push(...people);
    items[items.length - 1]!.separatorAfter = true;
  }
  // one's own profile in a server is always one's own to edit; someone else's nickname takes Manage Nicknames
  const canNick = self || (canI(st, P.MANAGE_NICKNAMES) && above);
  if (canNick) items.push({ id: "nick", label: self ? t("sidebar.serverMenu.editServerProfile") : t("server.memberMenu.changeTheirNickname"), onSelect: () => (self ? ctx.openModal("settings", { page: "profiles", serverId }) : ctx.openModal("serverProfile", { serverId, userId })) });
  if (canI(st, P.MANAGE_ROLES) && above) items.push({ id: "roles", label: t("server.members.roles"), onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "roles" }) });
  const mod = memberModerationItems(serverId, userId, ctx);
  if (mod.length) {
    items[items.length - 1]!.separatorAfter = true;
    items.push(...mod);
  }
  if (useSettings.getState().settings.developerMode) {
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: t("chat.groupMemberMenu.copyUserId"), onSelect: () => copyAndSay(userId) });
  }
  return items;
}
