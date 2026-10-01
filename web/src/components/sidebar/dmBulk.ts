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
  const run = async () => {
    usePick.getState().clear();
    for (const id of ids) {
      if (id === NEXA_ID) closeNexa(ctx.nav);
      else await closeDM(id, ctx.nav);
    }
  };
  if (groups.length === 0) return void run();
  ctx.openModal("confirm", {
    title: t("pick.closeTitle", { count: ids.length }),
    body: t("pick.closeBody", { count: groups.length }),
    confirmLabel: t("pick.closeConfirm"),
    danger: true,
    onConfirm: run,
  });
}

/**
 * What can be done to several conversations of the DM list at once: the bar's
 * buttons (read, pin, mute, close) and the menu with all of it. One-to-one
 * conversations also offer what concerns the people in them: a group chat
 * with them, no longer being friends, blocking.
 */
export function dmBulk(ids: string[], ctx: Ctx): { bar: PickAction[]; menu: () => ContextMenuItem[] } {
  const layout: DMListLayout = useSettings.getState().settings.dmList;
  const settings = useSettings.getState().settings;
  const allPinned = ids.every((id) => isPinnedDM(layout, id));
  const allMuted = ids.every((id) => id === NEXA_ID || settings.notifications.muted.includes(id));
  const anyUnread = ids.some(unreadIn);
  const people = peopleOf(ids);
  const friends = people.filter((u) => useRelationships.getState().byUser[u.id]?.type === "friend");
  const blockable = people.filter((u) => useRelationships.getState().byUser[u.id]?.type !== "blocked");
  const pin = () => changeDMList((l) => ids.reduce((acc, id) => (allPinned ? unpinDM(acc, id) : isPinnedDM(acc, id) ? acc : pinDM(acc, id)), l));
  const bar: PickAction[] = [
    { id: "read", icon: CheckCheck, label: t("sidebar.dmMenu.markAsRead"), disabled: !anyUnread, onSelect: () => markRead(ids) },
    { id: "pin", icon: allPinned ? PinOff : Pin, label: allPinned ? t("pick.unpin") : t("pick.pin"), onSelect: pin },
    { id: "mute", icon: allMuted ? Bell : BellOff, label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted) },
    { id: "close", icon: LogOut, label: t("pick.close"), danger: true, onSelect: () => closeAll(ids, ctx) },
  ];
  const menu = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { id: "read", label: t("sidebar.dmMenu.markAsRead"), disabled: !anyUnread, onSelect: () => markRead(ids), separatorAfter: true },
      { id: "pin", label: allPinned ? t("pick.unpin") : t("pick.pin"), onSelect: pin },
      {
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
      },
      { id: "mute", label: allMuted ? t("pick.unmute") : t("pick.mute"), onSelect: () => setMuted(ids, !allMuted), separatorAfter: true },
    ];
    if (people.length) {
      items.push({ id: "group-chat", label: t("pick.groupChatWith", { count: people.length }), onSelect: () => ctx.openModal("createDM", { initial: people.map((u) => u.id) }) });
      if (friends.length) items.push({ id: "remove-friends", label: t("pick.removeFriends", { count: friends.length }), danger: true, onSelect: () => confirmRemoveFriends(friends) });
      if (blockable.length) items.push({ id: "block", label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) });
      items[items.length - 1]!.separatorAfter = true;
    }
    items.push({ id: "close", label: t("pick.close"), danger: true, onSelect: () => closeAll(ids, ctx) });
    return items;
  };
  return { bar, menu };
}
