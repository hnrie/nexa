import { describe, expect, it } from "vitest";
import type { PollOutcome, PollTally } from "@/api/types";
import type { PollPayload } from "@/crypto/message";
import { searchableText, toDoc } from "@/search/doc";
import type { DecryptedMessage } from "@/stores/messages";
import { answerLabel, hookPollOf, pollRequest, pollVerdict, pollWords } from "./poll";

const poll: PollPayload = {
  question: "Lunch?",
  answers: [{ text: "Pizza", emoji: { name: "🍕" } }, { text: "Soup" }, { text: "Salad", emoji: { id: "42", name: "leaf", animated: true } }],
  hours: 24,
  multiselect: true,
};

describe("hookPollOf", () => {
  it("numbers the answers from 1, as the server counts them, and keeps their emoji", () => {
    const shaped = hookPollOf(poll, undefined, 1_000);
    expect(shaped.question).toBe("Lunch?");
    expect(shaped.answers).toEqual([
      { answer_id: 1, text: "Pizza", emoji: { name: "🍕" } },
      { answer_id: 2, text: "Soup" },
      { answer_id: 3, text: "Salad", emoji: { id: "42", name: "leaf", animated: true } },
    ]);
    expect(shaped.allow_multiselect).toBe(true);
  });

  it("closes when the server says, and until it has, when the poll's hours run out", () => {
    const tally: PollTally = { answer_counts: [], total_voters: 0, expires_at: 99_999, is_finalized: false };
    expect(hookPollOf(poll, tally, 1_000).expiry).toBe(99_999);
    expect(hookPollOf(poll, undefined, 1_000).expiry).toBe(1_000 + 24 * 3_600_000);
  });
});

describe("pollRequest", () => {
  it("tells the server the shape of a poll and nothing it says", () => {
    const req = pollRequest(poll);
    expect(req).toEqual({ answer_count: 3, duration: 24, allow_multiselect: true });
    expect(JSON.stringify(req)).not.toMatch(/Lunch|Pizza|Soup|Salad|🍕/);
  });
});

describe("pollWords", () => {
  it("is the question and then each answer, a line each", () => {
    expect(pollWords(poll)).toBe("Lunch?\nPizza\nSoup\nSalad");
  });

  it("makes a person's poll findable by its question and answers", () => {
    const msg = { id: "m1", channel_id: "c1", author_id: "u1", type: "default", created_at: 5, edited_at: null, flags: 0, mentions: [], payload: { poll } } as unknown as DecryptedMessage;
    const doc = toDoc(msg);
    expect(doc).not.toBeNull();
    expect(searchableText(doc!)).toContain("Soup");
    expect(searchableText(doc!)).toContain("Lunch?");
  });
});

describe("pollVerdict", () => {
  const outcome = (o: Partial<PollOutcome>): PollOutcome => ({ answer_counts: [], total_votes: 0, total_voters: 0, victor_answer_id: 0, victor_answer_votes: 0, ...o });

  it("names the winner, its emoji in front when that is a character, with its share of the votes", () => {
    expect(pollVerdict(outcome({ total_votes: 3, victor_answer_id: 1, victor_answer_votes: 2 }), poll)).toEqual({ kind: "winner", answer: "🍕 Pizza", percent: 67 });
    // a custom emoji is a picture, which a sentence cannot hold
    expect(pollVerdict(outcome({ total_votes: 4, victor_answer_id: 3, victor_answer_votes: 4 }), poll)).toEqual({ kind: "winner", answer: "Salad", percent: 100 });
  });

  it("tells a tie and a poll nobody voted in apart", () => {
    expect(pollVerdict(outcome({ total_votes: 2, victor_answer_votes: 1 }), poll)).toEqual({ kind: "tie" });
    expect(pollVerdict(outcome({}), poll)).toEqual({ kind: "none" });
  });

  it("names no answer it cannot read", () => {
    expect(pollVerdict(outcome({ total_votes: 1, victor_answer_id: 2, victor_answer_votes: 1 }), null)).toEqual({ kind: "winner", answer: null, percent: 100 });
    expect(pollVerdict(outcome({ total_votes: 1, victor_answer_id: 9, victor_answer_votes: 1 }), poll)).toEqual({ kind: "winner", answer: null, percent: 100 });
  });

  it("labels an answer without an emoji by its words alone", () => {
    expect(answerLabel({ text: "Soup" })).toBe("Soup");
  });
});
