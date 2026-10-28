import { BellOff, Bell, CheckCheck, LogOut, Pin, PinOff } from "lucide-react";
import type { PublicUser } from "@/api/types";
import type { PickAction } from "@/components/common/Pick";
import { confirmBlockPeople, confirmRemoveFriends } from "@/lib/friendship";
import { addToGroup, createGroup, isPinnedDM, NEXA_ID, pinDM, unpinDM, type DMListLayout } from "@/lib/dmLayout";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useNexa } from "@/stores/nexa";
import { usePick } from "@/stores/pick";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { button, defineMenu, type MenuPlacement } from "@/lib/contextMenus/registry";
import { useUsers } from "@/stores/users";
import { promptText } from "@/components/modals/PromptModal";
import { GROUP_NAME_MAX } from "@/lib/dmLayout";
import { changeDMList, closeNexa, groupName } from "./dmArrange";
import { closeDM } from "./dmMenu";

import { t } from "@/i18n";

interface Ctx {
  nav: (path: string) => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

/** The people on the other end of the picked one-to-one conversations. */
function peopleOf(ids: string[]): PublicUser[] {
  const me = useAuth.getState().me?.id;
  const byId = useChannels.getState().byId;
  const users = useUsers.getState().byId;
  const out: PublicUser[] = [];
  for (const id of ids) {
    const ch = byId[id];
    if (ch?.type !== "dm") continue;
    const other = ch.recipient_ids.find((u) => u !== me);
    const u = other ? users[other] : undefined;
    if (u && !out.some((x) => x.id === u.id)) out.push(u);
  }
  return out;
}

function unreadIn(id: string): boolean {
  if (id === NEXA_ID) return (useNexa.getState().state?.unread ?? 0) > 0;
  const ch = useChannels.getState().byId[id];
  return !!ch?.last_message_id && isUnread(useReadStates.getState().byChannel[id], ch.last_message_id);
}

function markRead(ids: string[]): void {
  const reads = useReadStates.getState();
  for (const id of ids) {
    if (id === NEXA_ID) {
      useNexa.getState().markSeen();
      continue;
    }
    const ch = useChannels.getState().byId[id];
    if (ch?.last_message_id && isUnread(reads.byChannel[id], ch.last_message_id)) void reads.ack(id, ch.last_message_id);
  }
}

function setMuted(ids: string[], on: boolean): void {
  const n = useSettings.getState().settings.notifications;
  const muted = on ? [...new Set([...n.muted, ...ids.filter((id) => id !== NEXA_ID)])] : n.muted.filter((x) => !ids.includes(x));
  useSettings.getState().patch({ notifications: { ...n, muted } });
}

/** Closes the picked one-to-one conversations and leaves the picked groups, asking first when any group is among them. */
function closeAll(ids: string[], ctx: Ctx): void {
  const byId = useChannels.getState().byId;
  const groups = ids.filter((id) => byId[id]?.type === "group_dm");
  const run = async (silent = false) => {
    usePick.getState().clear();
    for (const id of ids) {
      if (id === NEXA_ID) closeNexa(ctx.nav);
      else await closeDM(id, ctx.nav, silent && groups.includes(id));
    }
  };
  if (groups.length === 0) return void run();
  ctx.openModal("confirm", {
    title: t("pick.closeTitle", { count: ids.length }),
    body: t("pick.closeBody", { count: groups.length }),
    confirmLabel: t("pick.closeConfirm"),
    danger: true,
    checkboxLabel: t("chat.leaveSilently"),
    onConfirm: run,
  });
}

interface BulkCtx extends Ctx {
  ids: string[];
}

const allPinnedIn = (ids: string[]) => ids.every((id) => isPinnedDM(useSettings.getState().settings.dmList, id));
const allMutedIn = (ids: string[]) => ids.every((id) => id === NEXA_ID || useSettings.getState().settings.notifications.muted.includes(id));
const pinAll = (ids: string[]) => {
  const allPinned = allPinnedIn(ids);
  changeDMList((l) => ids.reduce((acc, id) => (allPinned ? unpinDM(acc, id) : isPinnedDM(acc, id) ? acc : pinDM(acc, id)), l));
};
const relation = (id: string) => useRelationships.getState().byUser[id]?.type;

/** The menu for several conversations of the DM list picked at once. */
export const dmBulkMenu = defineMenu<BulkCtx>("dmBulk", [
  [button("markConversationsRead", ({ ids }) => ({ id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !ids.some(unreadIn), onSelect: () => markRead(ids) }))],
  [
    button("pinConversations", ({ ids }) => ({ id: "pin", label: allPinnedIn(ids) ? t("pick.unpin") : t("pick.pin"), onSelect: () => pinAll(ids) })),
    button("addConversationsToGroup", ({ ids }) => {
      const layout: DMListLayout = useSettings.getState().settings.dmList;
      return {
        id: "group",
        label: t("organize.dm.addToGroup"),
        submenu: [
          ...layout.groups.map((g, i): ContextMenuItem => ({
            id: `group-${g.id}`,
            label: groupName(g),
            separatorAfter: i === layout.groups.length - 1,
            onSelect: () => changeDMList((l) => ids.reduce((acc, id) => addToGroup(acc, id, g.id), l)),
          })),
          {
            id: "new-group",
            label: t("organize.dm.newGroup"),
            onSelect: () =>
              void promptText(t("organize.dm.newGroupTitle"), { label: t("organize.dm.groupName"), maxLength: GROUP_NAME_MAX, hint: t("organize.dm.groupHint") }, t("organize.dm.createGroup")).then((name) => {
                if (name?.trim()) changeDMList((l) => createGroup(l, name, ids).layout);
              }),
          },
        ],
      };
    }),
    button("muteConversations", ({ ids }) => {
      const allMuted = allMutedIn(ids);
      return { id: "mute", label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted) };
    }),
  ],
  [
    button("groupChatWithPeople", ({ ids, openModal }) => {
      const people = peopleOf(ids);
      return people.length > 0 && { id: "group-chat", label: t("pick.groupChatWith", { count: people.length }), onSelect: () => openModal("createDM", { initial: people.map((u) => u.id) }) };
    }),
    button("removeFriendsOfConversations", ({ ids }) => {
      const friends = peopleOf(ids).filter((u) => relation(u.id) === "friend");
      return friends.length > 0 && { id: "remove-friends", label: t("pick.removeFriends", { count: friends.length }), danger: true, onSelect: () => confirmRemoveFriends(friends) };
    }),
    button("blockPeopleOfConversations", ({ ids }) => {
      const blockable = peopleOf(ids).filter((u) => relation(u.id) !== "blocked");
      return blockable.length > 0 && { id: "block", label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) };
    }),
  ],
  [button("closeConversations", (ctx) => ({ id: "close", label: t("pick.close"), danger: true, onSelect: () => closeAll(ctx.ids, ctx) }))],
]);

/**
 * What can be done to several conversations of the DM list at once: the bar's
 * buttons (read, pin, mute, close), and `menu`, which opens the menu with all
 * of it. One-to-one conversations also offer what concerns the people in
 * them: a group chat with them, no longer being friends, blocking.
 */
export function dmBulk(ids: string[], ctx: Ctx): { bar: PickAction[]; menu: (at: MenuPlacement) => void } {
  const allPinned = allPinnedIn(ids);
  const allMuted = allMutedIn(ids);
  const bar: PickAction[] = [
    { id: "read", icon: CheckCheck, label: t("sidebar.dmMenu.markAsRead"), disabled: !ids.some(unreadIn), onSelect: () => markRead(ids) },
    { id: "pin", icon: allPinned ? PinOff : Pin, label: allPinned ? t("pick.unpin") : t("pick.pin"), onSelect: () => pinAll(ids) },
    { id: "mute", icon: allMuted ? Bell : BellOff, label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted) },
    { id: "close", icon: LogOut, label: t("pick.close"), danger: true, onSelect: () => closeAll(ids, ctx) },
  ];
  return { bar, menu: (at) => void dmBulkMenu.open({ ...ctx, ids }, at) };
}
