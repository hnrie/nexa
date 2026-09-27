import type { Channel } from "@/api/types";
import { P } from "@/lib/perms";
import { canI, type ServerState } from "@/stores/servers";

/** What the composer's plus button can do: upload a file, or ask a poll. */
export type PlusOption = "upload" | "poll";

/**
 * What a tap on the plus button does: there is no button when it could do
 * nothing, a single thing it does at once, and only a choice of several opens
 * a menu (a menu of one is a tap wasted).
 */
export type PlusButton = { kind: "none" } | { kind: "direct"; option: PlusOption } | { kind: "menu"; options: PlusOption[] };

export function plusButton(can: { attach: boolean; poll: boolean }): PlusButton {
  const options: PlusOption[] = [];
  if (can.attach) options.push("upload");
  if (can.poll) options.push("poll");
  if (options.length === 0) return { kind: "none" };
  if (options.length === 1) return { kind: "direct", option: options[0]! };
  return { kind: "menu", options };
}

/**
 * Whether this account may ask a poll in a channel: anywhere in a
 * conversation, and in a server channel where it has Create Polls and Send
 * Messages (both of which an owner can take away, per role or channel).
 */
export function canCreatePoll(st: ServerState | undefined, channel: Pick<Channel, "id" | "server_id">): boolean {
  if (!channel.server_id) return true;
  return canI(st, P.SEND_MESSAGES, channel.id) && canI(st, P.CREATE_POLLS, channel.id);
}
