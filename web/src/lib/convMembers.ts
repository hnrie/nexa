/**
 * Who this device believes is in a conversation.
 *
 * The server decides which accounts a conversation key is wrapped for: the
 * `user_ids` in a `keys_needed` event, in `GET /keys/needs`, and in the answer
 * to creating an epoch all go straight into the wrapping. One fabricated event
 * naming an attacker's account was enough to make an online member seal the
 * conversation root for it and upload the result, with nothing on screen.
 *
 * So the list is checked against the membership the client already holds — the
 * same lists it draws in the member sidebar and the group header. That does not
 * make the server honest; it could still add the account to the server properly
 * and ask again. But then the account is *in the member list*, where a person
 * can see it, which is the difference between a silent theft and a visible one.
 *
 * Where the client cannot be sure, it says so instead of guessing. A large
 * server loads its members lazily, so the list in hand is a subset and a
 * stranger cannot be told from someone simply not fetched yet. Refusing there
 * would strand real members without keys for messages they are entitled to
 * read, which is the worse failure of the two: this fails open and records that
 * it did.
 */

import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";

export type ConvMembership =
  /** No channel and no server here goes by that id; nothing can be said. */
  | { known: false }
  /**
   * The people this device knows to be in the conversation. `complete` is true
   * only when the whole list is in hand, which is the only case where an id
   * that is missing from it really means "not a member".
   */
  | { known: true; complete: boolean; members: Set<string> };

/**
 * A conversation id is a DM or group-DM channel, a private channel that carries
 * its own keys, or a whole server (see `convForChannel`). Resolve it to the
 * membership this device holds.
 */
export function membershipOf(conv: string): ConvMembership {
  const ch = useChannels.getState().byId[conv];
  if (ch) {
    if (ch.type === "dm" || ch.type === "group_dm" || ch.type === "subchat") {
      // Recipients ride on the channel object itself and are always complete:
      // a group DM with a member missing from the list could not be drawn. A
      // subchat is a conversation of its own with its own keys, and its people
      // (the chat's, kept in step with it) ride on it the same way; leaving it
      // out let a forged request seal a side conversation's key for anyone.
      return { known: true, complete: true, members: new Set(ch.recipient_ids) };
    }
    if (ch.server_id) return serverMembership(ch.server_id);
    return { known: false };
  }
  return serverMembership(conv);
}

/**
 * A server channel's own conversation is entitled to whoever can view that
 * channel, which is a subset of the server's members. The subset is not
 * recomputed here: this client's view of role overwrites can lag the server's,
 * and a member wrongly dropped loses messages they are entitled to. The server
 * membership is the superset, and it is what catches the case that matters —
 * an account that is in no part of this conversation at all.
 */
function serverMembership(serverId: string): ConvMembership {
  const st = useServers.getState().byId[serverId];
  if (!st) return { known: false };
  return { known: true, complete: st.membersComplete, members: new Set(Object.keys(st.members)) };
}

export interface RecipientCheck {
  /** The ids that may be sealed to. */
  allowed: string[];
  /** The ids this device knows are not in the conversation. */
  outsiders: string[];
  /** False when the list could not really be checked, so `allowed` is "as asked". */
  checked: boolean;
}

/** Filters a server-supplied recipient list down to the members this device knows about. */
export function checkRecipients(conv: string, userIds: readonly string[]): RecipientCheck {
  const m = membershipOf(conv);
  if (!m.known || !m.complete) return { allowed: [...userIds], outsiders: [], checked: false };
  const allowed: string[] = [];
  const outsiders: string[] = [];
  for (const id of userIds) (m.members.has(id) ? allowed : outsiders).push(id);
  return { allowed, outsiders, checked: true };
}
