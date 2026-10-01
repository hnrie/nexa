import { Ban, DoorOpen, ShieldOff } from "lucide-react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { servers as serversApi } from "@/api/servers";
import type { PublicUser } from "@/api/types";
import type { PickAction } from "@/components/common/Pick";
import { promptFields } from "@/components/modals/PromptModal";
import { managesGroup } from "@/components/sidebar/dmMenu";
import { confirmBlockPeople, nameList } from "@/lib/friendship";
import { canManageRole, P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { usePick } from "@/stores/pick";
import { useRelationships } from "@/stores/relationships";
import { canI, memberHighest, rolesByPosition, useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
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
    fields: [{ key: "reason", label: t("server.memberAction.reasonOptional"), maxLength: 512, hint: nameList(people) }],
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

/**
 * What can be done to several members of a server at once, by what you are
 * allowed to do there and whom you outrank: give or take a role, kick, ban;
 * and, about the people themselves, block them.
 */
export function memberBulk(serverId: string, ids: string[]): { bar: PickAction[]; menu: () => ContextMenuItem[] } {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me?.id;
  const others = ids.filter((id) => id !== me);
  // the ones you may act on: below you, and never the owner
  const below = others.filter((id) => outranks(serverId, id));
  const blockable = usersOf(others).filter((u) => useRelationships.getState().byUser[u.id]?.type !== "blocked");
  const bar: PickAction[] = [];
  const menu: ContextMenuItem[] = [];
  if (st && canI(st, P.MANAGE_ROLES) && below.length) {
    const mine = me ? memberHighest(st, me) : { highest: 0, isOwner: false };
    const roles = rolesByPosition(st).filter((r) => r.id !== serverId && canManageRole(mine.highest, mine.isOwner, r.position));
    const give = (roleId: string, on: boolean) =>
      void each(
        below.filter((id) => st.members[id]?.role_ids.includes(roleId) !== on),
        async (id) => useServers.getState().upsertMember(on ? await serversApi.addRole(serverId, id, roleId) : await serversApi.removeRole(serverId, id, roleId)),
        (count) => (on ? t("pick.roleGiven", { count }) : t("pick.roleTaken", { count })),
      );
    if (roles.length) {
      menu.push({ id: "add-role", label: t("pick.addRole"), submenu: roles.map((r) => ({ id: `add-${r.id}`, label: r.name, onSelect: () => give(r.id, true) })) });
      menu.push({ id: "remove-role", label: t("pick.removeRole"), submenu: roles.map((r) => ({ id: `rm-${r.id}`, label: r.name, onSelect: () => give(r.id, false) })), separatorAfter: true });
    }
  }
  if (st && below.length && canI(st, P.KICK_MEMBERS)) {
    const kick: PickAction = { id: "kick", icon: DoorOpen, label: t("pick.kick", { count: below.length }), danger: true, onSelect: () => void removeAll(serverId, below, false) };
    bar.push(kick);
    menu.push({ id: kick.id, label: kick.label, danger: true, onSelect: kick.onSelect });
  }
  if (st && below.length && canI(st, P.BAN_MEMBERS)) {
    const ban: PickAction = { id: "ban", icon: Ban, label: t("pick.ban", { count: below.length }), danger: true, onSelect: () => void removeAll(serverId, below, true) };
    bar.push(ban);
    menu.push({ id: ban.id, label: ban.label, danger: true, onSelect: ban.onSelect });
  }
  if (blockable.length) {
    if (menu.length) menu[menu.length - 1]!.separatorAfter = true;
    menu.push({ id: "block", label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) });
    if (bar.length < 3) bar.push({ id: "block", icon: ShieldOff, label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) });
  }
  return { bar: bar.slice(0, 3), menu: () => menu };
}

/** What can be done to several people in a group chat at once: remove them (for whoever manages it), block them. */
export function groupMemberBulk(channelId: string, ids: string[]): { bar: PickAction[]; menu: () => ContextMenuItem[] } {
  const ch = useChannels.getState().byId[channelId];
  const me = useAuth.getState().me?.id;
  const others = ids.filter((id) => id !== me && id !== ch?.owner_id);
  const blockable = usersOf(ids.filter((id) => id !== me)).filter((u) => useRelationships.getState().byUser[u.id]?.type !== "blocked");
  const bar: PickAction[] = [];
  const menu: ContextMenuItem[] = [];
  if (ch && managesGroup(ch) && others.length) {
    const remove: PickAction = {
      id: "remove",
      icon: DoorOpen,
      label: t("pick.removeFromGroup", { count: others.length }),
      danger: true,
      onSelect: () =>
        useUI.getState().openModal("confirm", {
          title: t("pick.removeFromGroupTitle", { count: others.length }),
          body: t("pick.removeFromGroupBody", { names: nameList(usersOf(others)) }),
          confirmLabel: t("pick.removeFromGroup", { count: others.length }),
          danger: true,
          onConfirm: async () => {
            usePick.getState().clear();
            await each(others, (id) => channelsApi.removeRecipient(channelId, id), (count) => t("pick.removedFromGroup", { count }));
          },
        }),
    };
    bar.push(remove);
    menu.push({ id: remove.id, label: remove.label, danger: true, onSelect: remove.onSelect });
  }
  if (blockable.length) {
    const block: PickAction = { id: "block", icon: ShieldOff, label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) };
    bar.push(block);
    menu.push({ id: block.id, label: block.label, danger: true, onSelect: block.onSelect });
  }
  return { bar, menu: () => menu };
}
