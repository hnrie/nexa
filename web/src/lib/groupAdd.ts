/**
 * Adding friends to a group chat: who can be added, who is Link Only (joins
 * group chats only from an invite link sent to them), the one way an add is
 * made, and where Nexa's note to the person added goes in their conversation.
 */
import { channels as channelsApi } from "@/api/channels";
import type { Channel, GroupAddNotice, Message, PublicUser, Relationship } from "@/api/types";
import { useChannels } from "@/stores/channels";

/** Whether someone joins group chats only from an invite link, so friends cannot add them directly. */
export function isLinkOnly(u: Pick<PublicUser, "group_link_only"> | undefined): boolean {
  return u?.group_link_only === true;
}

/** A friend as a picker for a group shows them. */
export interface FriendChoice {
  user: PublicUser;
  nickname: string;
  linkOnly: boolean;
}

/**
 * The friends who are not in `memberIds`, matching `query` by name, username
 * or the nickname given them, sorted by the name shown. Each comes as the
 * freshest copy known: `users` follows user_update, where a friend turning on
 * Link Only arrives, and the relationship's copy is only as new as ready.
 */
export function friendsToAdd(rels: Record<string, Relationship>, users: Record<string, PublicUser>, memberIds: readonly string[], query: string): FriendChoice[] {
  const q = query.trim().toLowerCase();
  const members = new Set(memberIds);
  const out: FriendChoice[] = [];
  for (const r of Object.values(rels)) {
    if (r.type !== "friend" || members.has(r.user.id)) continue;
    const user = users[r.user.id] ?? r.user;
    if (q && ![user.display_name, user.username, r.nickname].some((s) => s && s.toLowerCase().includes(q))) continue;
    out.push({ user, nickname: r.nickname, linkOnly: isLinkOnly(user) });
  }
  const shown = (c: FriendChoice) => c.nickname || c.user.display_name || c.user.username;
  return out.sort((a, b) => shown(a).localeCompare(shown(b)));
}

/**
 * Puts a friend in a group, the way every add is made. The server asks
 * whoever holds the group's key to share it with them (keys_needed), and the
 * channel it answers with is stored here, so the newcomer is part of the
 * membership this device checks every key grant against.
 */
export async function addFriendToGroup(groupId: string, userId: string): Promise<Channel> {
  const ch = await channelsApi.addRecipient(groupId, userId);
  useChannels.getState().upsert(ch);
  return ch;
}

type NoticeMessage = Pick<Message, "id" | "type" | "author_id" | "mentions" | "created_at">;

/**
 * Where Nexa's note about being added goes among a conversation's loaded
 * messages: right after the line saying that friend added this account, when
 * it is loaded; first, in a conversation whose whole history is loaded and
 * began with the add (a group made with them in it, where no such line is
 * written); otherwise at the end, once the list reaches the present, so it is
 * seen however much was said since. Null while it has nowhere to go yet.
 */
export function noticeSpot(
  ids: readonly string[],
  byId: Record<string, NoticeMessage | undefined>,
  notice: GroupAddNotice,
  meId: string,
  { hasOlder, hasNewer }: { hasOlder: boolean; hasNewer: boolean },
): { after: string } | "start" | "end" | null {
  for (const id of ids) {
    const m = byId[id];
    // the line is written just after the add; an earlier one is from a time
    // they were added before, left, and were added again
    if (m && m.type === "system_member_add" && m.author_id === notice.added_by && m.mentions.includes(meId) && m.created_at >= notice.added_at - 1000) return { after: id };
  }
  if (!hasOlder) {
    const first = ids.map((id) => byId[id]).find((m) => m !== undefined);
    if (!first || first.created_at >= notice.added_at) return "start";
  }
  return hasNewer ? null : "end";
}
