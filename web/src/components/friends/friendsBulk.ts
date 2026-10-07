import { Check, MessageSquarePlus, ShieldOff, UserMinus, X, type LucideIcon } from "lucide-react";
import type { PublicUser } from "@/api/types";
import type { PickAction } from "@/components/common/Pick";
import { button, defineMenu, type MenuPlacement } from "@/lib/contextMenus/registry";
import { acceptRequests, confirmBlockPeople, confirmRemoveFriends, dropRequests, unblockPeople } from "@/lib/friendship";
import { usePick } from "@/stores/pick";
import { useRelationships } from "@/stores/relationships";

import { t } from "@/i18n";

type OpenModal = (kind: string, props?: Record<string, unknown>) => void;

interface FriendsBulkCtx {
  ids: string[];
  openModal: OpenModal;
}

/** One thing that can be done to the picked people, for the bar (with its icon) and the menu alike; null where it does not apply. */
interface Action {
  id: string;
  /** Unique across every menu: the menu's button for it. */
  button: string;
  icon: LucideIcon;
  /** Offered on the bar as well as under More. */
  inBar: boolean;
  make: (ctx: FriendsBulkCtx) => { label: string; danger?: boolean; onSelect: () => void } | null;
}

/** The picked people, by where each stands with this account. */
function standing(ids: string[]) {
  const byUser = useRelationships.getState().byUser;
  const of = (type: string): PublicUser[] => ids.map((id) => byUser[id]).filter((r) => r?.type === type).map((r) => r!.user);
  return {
    friends: of("friend"),
    incoming: of("incoming"),
    outgoing: of("outgoing"),
    blocked: of("blocked"),
    blockable: ids.map((id) => byUser[id]).filter((r) => !!r && r.type !== "blocked").map((r) => r!.user),
  };
}

const done = () => usePick.getState().clear();

const ACTIONS: Action[] = [
  { id: "group-chat", button: "groupChatWithFriends", icon: MessageSquarePlus, inBar: true, make: ({ ids, openModal }) => {
    const { friends } = standing(ids);
    return friends.length ? { label: t("pick.groupChatWith", { count: friends.length }), onSelect: () => openModal("createDM", { initial: friends.map((u) => u.id) }) } : null;
  } },
  { id: "accept", button: "acceptFriendRequests", icon: Check, inBar: true, make: ({ ids }) => {
    const { incoming } = standing(ids);
    return incoming.length ? { label: t("pick.acceptRequests", { count: incoming.length }), onSelect: () => void acceptRequests(incoming).then(done) } : null;
  } },
  { id: "ignore", button: "ignoreFriendRequests", icon: X, inBar: true, make: ({ ids }) => {
    const { incoming } = standing(ids);
    return incoming.length ? { label: t("pick.ignoreRequests", { count: incoming.length }), danger: true, onSelect: () => void dropRequests(incoming).then(done) } : null;
  } },
  { id: "cancel", button: "cancelFriendRequests", icon: X, inBar: true, make: ({ ids }) => {
    const { outgoing } = standing(ids);
    return outgoing.length ? { label: t("pick.cancelRequests", { count: outgoing.length }), danger: true, onSelect: () => void dropRequests(outgoing).then(done) } : null;
  } },
  { id: "unblock", button: "unblockPeople", icon: ShieldOff, inBar: true, make: ({ ids }) => {
    const { blocked } = standing(ids);
    return blocked.length ? { label: t("pick.unblockPeople", { count: blocked.length }), onSelect: () => void unblockPeople(blocked).then(done) } : null;
  } },
  { id: "remove", button: "removeFriends", icon: UserMinus, inBar: true, make: ({ ids }) => {
    const { friends } = standing(ids);
    return friends.length ? { label: t("pick.removeFriends", { count: friends.length }), danger: true, onSelect: () => confirmRemoveFriends(friends) } : null;
  } },
  { id: "block", button: "blockFriends", icon: ShieldOff, inBar: false, make: ({ ids }) => {
    const { blockable } = standing(ids);
    return blockable.length ? { label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) } : null;
  } },
];

/** The menu for several people of the friends list picked at once. */
export const friendsBulkMenu = defineMenu<FriendsBulkCtx>("friendsBulk", [
  ACTIONS.map((a) => button<FriendsBulkCtx>(a.button, (ctx) => {
    const made = a.make(ctx);
    return made && { id: a.id, label: made.label, ...(made.danger ? { danger: true } : {}), onSelect: made.onSelect };
  })),
]);

/**
 * What can be done to several people of the friends list at once, by where
 * each stands: friends can be put in a group chat together, let go or
 * blocked; requests answered or taken back; the blocked unblocked. `menu`
 * opens the menu with all of it.
 */
export function friendsBulk(ids: string[], openModal: OpenModal): { bar: PickAction[]; menu: (at: MenuPlacement) => void } {
  const bar: PickAction[] = [];
  for (const a of ACTIONS) {
    const made = a.inBar ? a.make({ ids, openModal }) : null;
    if (made) bar.push({ id: a.id, icon: a.icon, ...made });
  }
  // the bar keeps to what fits beside the count; the rest is under More
  return { bar: bar.slice(0, 3), menu: (at) => void friendsBulkMenu.open({ ids, openModal }, at) };
}
