import type { MouseEvent } from "react";
import { memberMenu } from "@/components/server/memberMenu";
import { menuPoint } from "@/components/sidebar/ServerSidebar";
import { useChannels } from "@/stores/channels";
import { groupMemberMenu } from "./groupMemberMenu";

/**
 * Opens the menu for someone shown in a conversation (a message's picture or
 * name, the name a reply quotes): the one the member list there opens, a
 * server's member menu or, in a group or a one-to-one conversation, the group
 * member menu. False, and nothing opened, where neither applies or the menu
 * has nothing to offer, so the caller can let the message's own menu open.
 */
export function openPersonMenu(
  e: MouseEvent<HTMLElement>,
  userId: string,
  channelId: string,
  nav: (path: string) => void,
  openModal: (kind: string, props?: Record<string, unknown>) => void,
): boolean {
  const ch = useChannels.getState().byId[channelId];
  if (!ch) return false;
  // at the pointer, or by the name when the keyboard opened it
  const at = menuPoint(e);
  if (ch.server_id) return memberMenu.open({ serverId: ch.server_id, userId, openModal }, at);
  if (ch.type === "group_dm" || ch.type === "dm") return groupMemberMenu.open({ channelId, userId, nav, openModal }, at);
  return false;
}
