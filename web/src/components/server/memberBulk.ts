import { personText, personList } from "@/lib/personText";
import { Ban, DoorOpen, ShieldOff } from "lucide-react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { servers as serversApi } from "@/api/servers";
import type { PublicUser } from "@/api/types";
import type { PickAction } from "@/components/common/Pick";
import { promptFields } from "@/components/modals/PromptModal";
import { managesGroup } from "@/components/sidebar/dmMenu";
import { confirmBlockPeople } from "@/lib/friendship";
import { canManageRole, P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { usePick } from "@/stores/pick";
import { useRelationships } from "@/stores/relationships";
import { canI, memberHighest, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { button, defineMenu, type MenuPlacement } from "@/lib/contextMenus/registry";
import { useUsers } from "@/stores/users";
import { outranks } from "./memberMenu";

import { t } from "@/i18n";

function usersOf(ids: string[]): PublicUser[] {
  const byId = useUsers.getState().byId;
  return ids.map((id) => byId[id]).filter((u): u is PublicUser => !!u);
}

/** Runs a job for each member in turn, and says once how it went. */
async function each(ids: string[], job: (id: string) => Promise<void>, done: (count: number) => string): Promise<void> {
  let ok = 0;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      await job(id);
      ok++;
    } catch (err) {
      firstError ??= err;
    }
  }
  const ui = useUI.getState();
  if (ok) ui.toast(done(ok), "success");
  if (firstError) ui.toast(firstError instanceof ApiError ? firstError.message : t("friends.couldNotUpdate"), "error");
}

/** Kicks or bans several members after one question, with one reason for all of them. */
async function removeAll(serverId: string, ids: string[], ban: boolean): Promise<void> {
  const people = usersOf(ids);
  const values = await promptFields({
    title: ban ? t("pick.banTitle", { count: ids.length }) : t("pick.kickTitle", { count: ids.length }),
    fields: [{ key: "reason", label: t("server.memberAction.reasonOptional"), maxLength: 512, hint: personList(people, serverId) }],
    confirmLabel: ban ? t("pick.ban", { count: ids.length }) : t("pick.kick", { count: ids.length }),
    allowEmpty: true,
  });
  if (!values) return;
  const reason = values["reason"]?.trim() || undefined;
  usePick.getState().clear();
  await each(
    ids,
    async (id) => {
      if (ban) await serversApi.ban(serverId, id, reason ? { reason } : {});
      else await serversApi.kick(serverId, id, reason);
      useServers.getState().removeMember(serverId, id);
    },
    (count) => (ban ? t("pick.banned", { count }) : t("pick.kicked", { count })),
  );
}

/** Whom a pick of members can be acted on: who is below you (never the owner), who can be blocked, and the roles you may hand out. */
function memberPlan(serverId: string, ids: string[]) {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me?.id;
  const others = ids.filter((id) => id !== me);
  const below = others.filter((id) => outranks(serverId, id));
  const blockable = usersOf(others).filter((u) => useRelationships.getState().byUser[u.id]?.type !== "blocked");
  const mine = st && me ? memberHighest(st, me) : { highest: 0, isOwner: false };
  const roles = st && canI(st, P.MANAGE_ROLES) && below.length ? rolesByPosition(st).filter((r) => r.id !== serverId && canManageRole(mine.highest, mine.isOwner, r.position)) : [];
  const give = (roleId: string, on: boolean) =>
    void each(
      below.filter((id) => st?.members[id]?.role_ids.includes(roleId) !== on),
      async (id) => useServers.getState().upsertMember(on ? await serversApi.addRole(serverId, id, roleId) : await serversApi.removeRole(serverId, id, roleId)),
      (count) => (on ? t("pick.roleGiven", { count }) : t("pick.roleTaken", { count })),
    );
  return {
    below,
    blockable,
    roles,
    give,
    kick: !!st && below.length > 0 && canI(st, P.KICK_MEMBERS),
    ban: !!st && below.length > 0 && canI(st, P.BAN_MEMBERS),
  };
}

interface MemberBulkCtx {
  serverId: string;
  ids: string[];
}

/** The menu for several members of a server picked at once. */
export const memberBulkMenu = defineMenu<MemberBulkCtx>("memberBulk", [
  [
    button("addRoleToMembers", ({ serverId, ids }) => {
      const p = memberPlan(serverId, ids);
      return p.roles.length > 0 && { id: "add-role", label: t("pick.addRole"), submenu: p.roles.map((r) => ({ id: `add-${r.id}`, label: r.name, onSelect: () => p.give(r.id, true) })) };
    }),
    button("removeRoleFromMembers", ({ serverId, ids }) => {
      const p = memberPlan(serverId, ids);
      return p.roles.length > 0 && { id: "remove-role", label: t("pick.removeRole"), submenu: p.roles.map((r) => ({ id: `rm-${r.id}`, label: r.name, onSelect: () => p.give(r.id, false) })) };
    }),
  ],
  [
    button("kickMembers", ({ serverId, ids }) => {
      const p = memberPlan(serverId, ids);
      return p.kick && { id: "kick", label: t("pick.kick", { count: p.below.length }), danger: true, onSelect: () => void removeAll(serverId, p.below, false) };
    }),
    button("banMembers", ({ serverId, ids }) => {
      const p = memberPlan(serverId, ids);
      return p.ban && { id: "ban", label: t("pick.ban", { count: p.below.length }), danger: true, onSelect: () => void removeAll(serverId, p.below, true) };
    }),
  ],
  [button("blockMembers", ({ serverId, ids }) => {
    const { blockable } = memberPlan(serverId, ids);
    return blockable.length > 0 && { id: "block", label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) };
  })],
]);

/**
 * What can be done to several members of a server at once, by what you are
 * allowed to do there and whom you outrank: give or take a role, kick, ban;
 * and, about the people themselves, block them. `menu` opens the menu.
 */
export function memberBulk(serverId: string, ids: string[]): { bar: PickAction[]; menu: (at: MenuPlacement) => void } {
  const p = memberPlan(serverId, ids);
  const bar: PickAction[] = [];
  if (p.kick) bar.push({ id: "kick", icon: DoorOpen, label: t("pick.kick", { count: p.below.length }), danger: true, onSelect: () => void removeAll(serverId, p.below, false) });
  if (p.ban) bar.push({ id: "ban", icon: Ban, label: t("pick.ban", { count: p.below.length }), danger: true, onSelect: () => void removeAll(serverId, p.below, true) });
  if (p.blockable.length && bar.length < 3) bar.push({ id: "block", icon: ShieldOff, label: t("pick.block", { count: p.blockable.length }), danger: true, onSelect: () => confirmBlockPeople(p.blockable) });
  return { bar: bar.slice(0, 3), menu: (at) => void memberBulkMenu.open({ serverId, ids }, at) };
}

/** Whom a pick of people in a group chat can be acted on: removed (for whoever manages it), blocked. */
function groupPlan(channelId: string, ids: string[]) {
  const ch = useChannels.getState().byId[channelId];
  const me = useAuth.getState().me?.id;
  const others = ids.filter((id) => id !== me && id !== ch?.owner_id);
  return {
    removable: ch && managesGroup(ch) ? others : [],
    blockable: usersOf(ids.filter((id) => id !== me)).filter((u) => useRelationships.getState().byUser[u.id]?.type !== "blocked"),
  };
}

function removeFromGroup(channelId: string, others: string[]): void {
  useUI.getState().openModal("confirm", {
    title: t("pick.removeFromGroupTitle", { count: others.length }),
    body: personText("pick.removeFromGroupBody", null, null, { names: personList(usersOf(others)) }),
    confirmLabel: t("pick.removeFromGroup", { count: others.length }),
    danger: true,
    onConfirm: async () => {
      usePick.getState().clear();
      await each(others, (id) => channelsApi.removeRecipient(channelId, id), (count) => t("pick.removedFromGroup", { count }));
    },
  });
}

interface GroupBulkCtx {
  channelId: string;
  ids: string[];
}

/** The menu for several people of a group chat picked at once. */
export const groupMemberBulkMenu = defineMenu<GroupBulkCtx>("groupMemberBulk", [
  [
    button("removeGroupMembers", ({ channelId, ids }) => {
      const { removable } = groupPlan(channelId, ids);
      return removable.length > 0 && { id: "remove", label: t("pick.removeFromGroup", { count: removable.length }), danger: true, onSelect: () => removeFromGroup(channelId, removable) };
    }),
    button("blockGroupMembers", ({ channelId, ids }) => {
      const { blockable } = groupPlan(channelId, ids);
      return blockable.length > 0 && { id: "block", label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) };
    }),
  ],
]);

/** What can be done to several people in a group chat at once: remove them (for whoever manages it), block them. */
export function groupMemberBulk(channelId: string, ids: string[]): { bar: PickAction[]; menu: (at: MenuPlacement) => void } {
  const { removable, blockable } = groupPlan(channelId, ids);
  const bar: PickAction[] = [];
  if (removable.length) bar.push({ id: "remove", icon: DoorOpen, label: t("pick.removeFromGroup", { count: removable.length }), danger: true, onSelect: () => removeFromGroup(channelId, removable) });
  if (blockable.length) bar.push({ id: "block", icon: ShieldOff, label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) });
  return { bar, menu: (at) => void groupMemberBulkMenu.open({ channelId, ids }, at) };
}
