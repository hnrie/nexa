/**
 * Messages from people this account has blocked, decided in one place.
 *
 * Every view that shows or counts messages asks here, so they all agree: the
 * conversation itself, notifications, unread and mention counts, typing lines,
 * pins, search. A blocked person's messages fold into a "N blocked messages"
 * row that can be opened, or, with "Hide their messages completely" on, leave
 * no trace at all; with "Also hide replies" on too, so do messages answering
 * theirs.
 *
 * Whatever the display, anything from a blocked person is quiet: it never
 * notifies, pings, counts as unread or shows them typing. Being blocked is
 * about not hearing from someone, and a badge for a message nobody will read
 * is noise either way.
 *
 * Only this account's own blocks count (a relationship of type "blocked");
 * who has blocked this account is not something it is told.
 */
import { useMemo } from "react";
import type { Relationship } from "@/api/types";
import { heldMessage } from "@/stores/messages";
import { useRelationships } from "@/stores/relationships";
import { useSettings, type Settings } from "@/stores/settings";

/** What becomes of one message: shown as it is, folded into a blocked row, or left out entirely. */
export type MessageFate = "show" | "collapse" | "hide";

export interface BlockRules {
  /** Everyone this account has blocked. */
  blocked: ReadonlySet<string>;
  /** Their messages leave no trace, rather than folding into a row. */
  hideMessages: boolean;
  /** Messages replying to theirs go too (only while hideMessages is on). */
  hideReplies: boolean;
}

/** The fields of a message the decision reads. */
export interface MessageLike {
  author_id: string;
  type: string;
  reply_to_id?: string | null;
}

/** Who wrote a message, by id, when it is known on this device. */
export type AuthorOf = (messageId: string) => string | undefined;

const NOBODY: ReadonlySet<string> = new Set();

export function blockRules(rels: Record<string, Relationship>, blocking: Settings["blocking"] | undefined): BlockRules {
  let blocked: Set<string> | null = null;
  for (const r of Object.values(rels)) {
    if (r.type !== "blocked") continue;
    (blocked ??= new Set()).add(r.user.id);
  }
  const hideMessages = blocking?.hideMessages === true;
  return { blocked: blocked ?? NOBODY, hideMessages, hideReplies: hideMessages && blocking?.hideReplies === true };
}

let cached: { rels: Record<string, Relationship>; blocking: Settings["blocking"] | undefined; rules: BlockRules } | null = null;

/** The rules as they stand, for code outside React (the gateway, notifications). */
export function currentBlockRules(): BlockRules {
  const rels = useRelationships.getState().byUser;
  const blocking = useSettings.getState().settings.blocking;
  if (!cached || cached.rels !== rels || cached.blocking !== blocking) cached = { rels, blocking, rules: blockRules(rels, blocking) };
  return cached.rules;
}

/** The rules, kept current, for a component. */
export function useBlockRules(): BlockRules {
  const rels = useRelationships((r) => r.byUser);
  const blocking = useSettings((s) => s.settings.blocking);
  return useMemo(() => blockRules(rels, blocking), [rels, blocking]);
}

/** Whether this account has blocked someone. */
export function isBlocked(userId: string | undefined, rules: BlockRules): boolean {
  return !!userId && rules.blocked.has(userId);
}

/**
 * What becomes of one message. `authorOf` finds who wrote the message a reply
 * answers; a reply to a message this device does not have is shown, since
 * there is no telling whose it was.
 */
export function messageFate(m: MessageLike, rules: BlockRules, authorOf?: AuthorOf): MessageFate {
  if (rules.blocked.size === 0) return "show";
  if (rules.blocked.has(m.author_id)) {
    if (rules.hideMessages) return "hide";
    // A note that they joined or pinned something is not something they said:
    // it stays, so the conversation still reads right around it.
    return m.type.startsWith("system_") ? "show" : "collapse";
  }
  if (rules.hideReplies && m.reply_to_id) {
    const to = authorOf?.(m.reply_to_id);
    if (to && rules.blocked.has(to)) return "hide";
  }
  return "show";
}

/** Whether a message must stay quiet: no notification, sound, badge, mention or "new" line. */
export function isQuiet(m: MessageLike, rules: BlockRules, authorOf?: AuthorOf): boolean {
  return rules.blocked.has(m.author_id) || messageFate(m, rules, authorOf) === "hide";
}

/** Who wrote a message in a channel, from the messages this device holds (loaded, or quoted by a reply). */
export function loadedAuthorOf(channelId: string): AuthorOf {
  return (id) => heldMessage(channelId, id)?.author_id;
}
