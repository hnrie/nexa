/**
 * People's polls.
 *
 * A person's poll is sealed in its message (crypto/message.ts PollPayload),
 * and the server knows only how many answers it has, how long it runs and
 * whether more than one may be picked: enough to take votes and count them.
 * It is drawn by the same view as a webhook's poll, whose shape
 * (lib/webhookMessage.ts HookPoll) this turns it into, and its closing line
 * carries only numbers, which the reader puts together with the poll's words.
 */

import type { PollOutcome, PollRequest, PollTally } from "@/api/types";
import type { PollPayload } from "@/crypto/message";
import type { HookPoll } from "./webhookMessage";

/** How long a poll can run, in hours, as the Create Poll dialog offers it. */
export const POLL_DURATIONS = [1, 4, 8, 24, 72, 168, 336] as const;
export const DEFAULT_POLL_HOURS = 24;

/**
 * A person's poll in the shape the poll view takes. An answer's id is its
 * place in the list, from 1, as the server counts them. When it closes is
 * the server's to say; until the tally arrives (a poll still being sent),
 * it is worked out from when the message was written.
 */
export function hookPollOf(p: PollPayload, tally: PollTally | undefined, createdAt: number): HookPoll {
  return {
    question: p.question,
    answers: p.answers.map((a, i) => ({ answer_id: i + 1, text: a.text, ...(a.emoji ? { emoji: { ...a.emoji } } : {}) })),
    expiry: tally?.expires_at ?? createdAt + p.hours * 3_600_000,
    allow_multiselect: p.multiselect,
  };
}

/** All the server is told of a poll: how many answers, how many hours, and whether several may be picked. */
export function pollRequest(p: PollPayload): PollRequest {
  return { answer_count: p.answers.length, duration: p.hours, allow_multiselect: p.multiselect };
}

/**
 * A poll's words, one per line: the question, then its answers. They stand
 * for a message's text wherever that is read without the message itself:
 * search, notifications, the line over a reply.
 */
export function pollWords(p: PollPayload): string {
  return [p.question, ...p.answers.map((a) => a.text)].filter((x) => x.trim()).join("\n");
}

/** The answer as a closing line names it: with its emoji in front when that is a character. */
export function answerLabel(a: PollPayload["answers"][number]): string {
  return a.emoji && !a.emoji.id ? `${a.emoji.name} ${a.text}`.trim() : a.text;
}

/** How a poll went, told as its closing line tells it. */
export type PollVerdict = { kind: "none" } | { kind: "tie" } | { kind: "winner"; answer: string | null; percent: number };

/**
 * A person's poll's result, from the numbers its line carries and the poll
 * itself: nobody voted, a tie, or the winner and its share of the votes. The
 * winner's words are null when the poll cannot be read (deleted, or not
 * opened yet), so nothing names the wrong answer.
 */
export function pollVerdict(o: PollOutcome, poll: PollPayload | null | undefined): PollVerdict {
  if (!o.total_votes) return { kind: "none" };
  if (!o.victor_answer_id) return { kind: "tie" };
  const a = poll?.answers[o.victor_answer_id - 1];
  return { kind: "winner", answer: a ? answerLabel(a) : null, percent: Math.round((o.victor_answer_votes / o.total_votes) * 100) };
}
