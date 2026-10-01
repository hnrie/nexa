import { Check, MessageSquarePlus, ShieldOff, UserMinus, X } from "lucide-react";
import type { PublicUser } from "@/api/types";
import type { PickAction } from "@/components/common/Pick";
import { acceptRequests, confirmBlockPeople, confirmRemoveFriends, dropRequests, unblockPeople } from "@/lib/friendship";
import { usePick } from "@/stores/pick";
import { useRelationships } from "@/stores/relationships";
import type { ContextMenuItem } from "@/stores/ui";

import { t } from "@/i18n";

/**
 * What can be done to several people of the friends list at once, by where
 * each stands: friends can be put in a group chat together, let go or
 * blocked; requests answered or taken back; the blocked unblocked.
 */
export function friendsBulk(ids: string[], openModal: (kind: string, props?: Record<string, unknown>) => void): { bar: PickAction[]; menu: () => ContextMenuItem[] } {
  const byUser = useRelationships.getState().byUser;
  const of = (type: string): PublicUser[] => ids.map((id) => byUser[id]).filter((r) => r?.type === type).map((r) => r!.user);
  const friends = of("friend");
  const incoming = of("incoming");
  const outgoing = of("outgoing");
  const blocked = of("blocked");
  const blockable = ids.map((id) => byUser[id]).filter((r) => !!r && r.type !== "blocked").map((r) => r!.user);
  const done = () => usePick.getState().clear();
  const bar: PickAction[] = [];
  const menu: ContextMenuItem[] = [];
  const add = (action: PickAction, inBar: boolean) => {
    if (inBar) bar.push(action);
    menu.push({ id: action.id, label: action.label, ...(action.danger ? { danger: true } : {}), onSelect: action.onSelect });
  };
  if (friends.length) add({ id: "group-chat", icon: MessageSquarePlus, label: t("pick.groupChatWith", { count: friends.length }), onSelect: () => openModal("createDM", { initial: friends.map((u) => u.id) }) }, true);
  if (incoming.length) {
    add({ id: "accept", icon: Check, label: t("pick.acceptRequests", { count: incoming.length }), onSelect: () => void acceptRequests(incoming).then(done) }, true);
    add({ id: "ignore", icon: X, label: t("pick.ignoreRequests", { count: incoming.length }), danger: true, onSelect: () => void dropRequests(incoming).then(done) }, true);
  }
  if (outgoing.length) add({ id: "cancel", icon: X, label: t("pick.cancelRequests", { count: outgoing.length }), danger: true, onSelect: () => void dropRequests(outgoing).then(done) }, true);
  if (blocked.length) add({ id: "unblock", icon: ShieldOff, label: t("pick.unblockPeople", { count: blocked.length }), onSelect: () => void unblockPeople(blocked).then(done) }, true);
  if (friends.length) add({ id: "remove", icon: UserMinus, label: t("pick.removeFriends", { count: friends.length }), danger: true, onSelect: () => confirmRemoveFriends(friends) }, true);
  if (blockable.length) add({ id: "block", icon: ShieldOff, label: t("pick.block", { count: blockable.length }), danger: true, onSelect: () => confirmBlockPeople(blockable) }, false);
  // the bar keeps to what fits beside the count; the rest is under More
  return { bar: bar.slice(0, 3), menu: () => menu };
}
