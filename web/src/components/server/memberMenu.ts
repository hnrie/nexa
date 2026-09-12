import { P, canActOn } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { canI, memberHighest, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";

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

/** Context menu for a member row: profile, mention, nickname, roles, moderation. */
export function memberMenuItems(serverId: string, userId: string, ctx: { openModal: (kind: string, props?: Record<string, unknown>) => void }): ContextMenuItem[] {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me;
  if (!st || !me) return [];
  const self = userId === me.id;
  const above = outranks(serverId, userId);
  const username = useUsers.getState().byId[userId]?.username;
  const items: ContextMenuItem[] = [
    { id: "profile", label: "Profile", onSelect: () => ctx.openModal("profile", { userId }) },
    {
      id: "mention",
      label: "Mention",
      disabled: !username,
      onSelect: () => window.dispatchEvent(new CustomEvent("ec:insert-text", { detail: `@${username} ` })),
      separatorAfter: true,
    },
  ];
  const canNick = self ? canI(st, P.CHANGE_NICKNAME) || canI(st, P.MANAGE_NICKNAMES) : canI(st, P.MANAGE_NICKNAMES) && above;
  if (canNick) items.push({ id: "nick", label: self ? "Change Nickname" : "Change Their Nickname", onSelect: () => ctx.openModal("serverProfile", { serverId, userId }) });
  if (canI(st, P.MANAGE_ROLES) && above) items.push({ id: "roles", label: "Roles", onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "roles" }) });
  if (!self && above) {
    const timedOut = !!st.members[userId]?.timeout_until && st.members[userId]!.timeout_until! > Date.now();
    const mod: ContextMenuItem[] = [];
    if (canI(st, P.MODERATE_MEMBERS)) mod.push({ id: "timeout", label: timedOut ? "Remove Timeout" : "Timeout", danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "timeout" }) });
    if (canI(st, P.KICK_MEMBERS)) mod.push({ id: "kick", label: "Kick", danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "kick" }) });
    if (canI(st, P.BAN_MEMBERS)) mod.push({ id: "ban", label: "Ban", danger: true, onSelect: () => ctx.openModal("memberAction", { serverId, userId, action: "ban" }) });
    if (mod.length) {
      items[items.length - 1]!.separatorAfter = true;
      items.push(...mod);
    }
  }
  if (useSettings.getState().settings.developerMode) {
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: "Copy User ID", onSelect: () => void navigator.clipboard?.writeText(userId).then(() => useUI.getState().toast("Copied!", "success")) });
  }
  return items;
}
