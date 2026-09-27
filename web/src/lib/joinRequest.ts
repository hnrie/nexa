/**
 * Join requests: how a friend who joins group chats only from an invite link
 * (Link Only) is asked into one. They are sent the group's invite link in the
 * direct message with them, as an ordinary end-to-end encrypted message, and
 * join by tapping the invite card it shows.
 */
import { channels as channelsApi } from "@/api/channels";
import { sendMessage } from "@/components/composer/send";
import { t } from "@/i18n";
import { dmOpenError } from "@/lib/errors";
import { inviteUrl } from "@/lib/inviteLink";
import { ring } from "@/lib/keyring";
import { useChannels } from "@/stores/channels";

/** What a group's invite menu starts with, and what a link made elsewhere for a join request uses: a week, any number of uses. */
export const JOIN_LINK_SETTINGS = { max_age: 604800, max_uses: 0 };

/**
 * A new invite link to a group, carrying the group's key in its fragment when
 * this device holds it, the way the invite menu's own link does.
 */
export async function newGroupLink(groupId: string, settings: { max_age: number; max_uses: number } = JOIN_LINK_SETTINGS): Promise<string> {
  const inv = await channelsApi.createGroupInvite(groupId, settings);
  return inviteUrl(inv.code, ring.latest(groupId));
}

/** A group's name as written, never as formatting: a name like **VIP** keeps its stars. */
function literal(name: string): string {
  return name.replace(/[\\*_~|`<>[\]]/g, "\\$&");
}

/** The message a join request is: a line saying what it is, with the group's own name when it has one, then the link. */
export function joinRequestText(groupName: string | null | undefined, link: string): string {
  const name = (groupName ?? "").trim();
  const intro = name ? t("groupAdd.joinRequest.message", { name: literal(name) }) : t("groupAdd.joinRequest.messageUnnamed");
  return `${intro}\n${link}`;
}

/** The message could not go out. The send path has said why already, in its own toast, and left it in the conversation to retry. */
export class JoinRequestUnsent extends Error {
  constructor() {
    super("join_request_unsent");
  }
}

/**
 * Sends a friend a group's invite link: in your direct message with them,
 * opened or started the way Message does it, through the one path every
 * message takes. Resolves with that conversation's id once the message is in.
 */
export async function sendJoinRequest(groupId: string, friendId: string, link: string): Promise<string> {
  const dm = await channelsApi.createDM([friendId]);
  useChannels.getState().upsert(dm);
  try {
    await sendMessage(dm.id, joinRequestText(useChannels.getState().byId[groupId]?.name, link));
  } catch {
    throw new JoinRequestUnsent();
  }
  return dm.id;
}

/** What to tell someone whose join request failed: why, or null when the send has told them already. */
export function joinRequestError(err: unknown, name: string): string | null {
  if (err instanceof JoinRequestUnsent) return null;
  return dmOpenError(err, t("groupAdd.joinRequest.failed", { name }));
}
