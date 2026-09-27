// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollOutcome, PublicUser } from "@/api/types";
import type { PollPayload } from "@/crypto/message";
import { sanitizeHook } from "@/lib/webhookMessage";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useUsers } from "@/stores/users";
import { SystemMessage } from "./SystemMessage";
import { forgetFetchedPolls } from "./usePollOf";

const fetchedMessage = vi.hoisted(() => ({ get: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/api/messages", async (orig) => {
  const real = await orig<typeof import("@/api/messages")>();
  return { ...real, messages: { ...real.messages, get: fetchedMessage.get } };
});
vi.mock("@/lib/decrypt", async (orig) => {
  const real = await orig<typeof import("@/lib/decrypt")>();
  return { ...real, decryptForStore: (m: DecryptedMessage) => (fetchedMessage.decrypt.getMockImplementation() ? fetchedMessage.decrypt(m) : real.decryptForStore(m)) };
});

const CH = "700";
const POLL = "900";
const BOB = "2";
const poll: PollPayload = { question: "Lunch?", answers: [{ text: "Pizza", emoji: { name: "🍕" } }, { text: "Soup" }], hours: 24, multiselect: false };

function message(extra: Partial<DecryptedMessage>): DecryptedMessage {
  return {
    id: "1",
    channel_id: CH,
    author_id: BOB,
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: 1_790_000_000_000,
    ...extra,
  };
}

const outcome = (o: Partial<PollOutcome>): PollOutcome => ({ answer_counts: [{ id: 1, count: 2 }, { id: 2, count: 1 }], total_votes: 3, total_voters: 3, victor_answer_id: 1, victor_answer_votes: 2, ...o });
const line = (o: Partial<PollOutcome>) => message({ id: "950", type: "system_poll_result", reply_to_id: POLL, poll_result: outcome(o) });
const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, " ") ?? "";

beforeEach(() => {
  useUsers.setState({ byId: { [BOB]: { id: BOB, username: "bob", display_name: "Bob" } as PublicUser } });
  useMessages.setState({ channels: {} });
  forgetFetchedPolls();
  fetchedMessage.get.mockReset();
  fetchedMessage.decrypt.mockReset();
});
afterEach(cleanup);

describe("a poll's closing line", () => {
  it("reads a webhook's result as it always has", () => {
    const hook = sanitizeHook({ name: "Deploys", embeds: [{ type: "poll_result", fields: [
      { name: "poll_question_text", value: "Ship it?" },
      { name: "victor_answer_votes", value: "3" },
      { name: "total_votes", value: "4" },
      { name: "victor_answer_id", value: "1" },
      { name: "victor_answer_text", value: "Yes" },
    ] }] })!;
    const { container } = render(<SystemMessage msg={message({ id: "951", type: "system_poll_result", reply_to_id: POLL, webhook_id: "77", hook })} />);
    expect(text(container)).toContain("Deploys's poll Ship it? has closed. Yes won with 75%.");
  });

  it("puts a person's numbers together with the poll in the list", () => {
    useMessages.getState().insert(CH, [message({ id: POLL, payload: { poll } })]);
    const { container } = render(<SystemMessage msg={line({})} />);
    expect(text(container)).toContain("Bob's poll Lunch? has closed. 🍕 Pizza won with 67%.");
    expect(screen.getByRole("button", { name: "Bob" })).toBeTruthy();
    expect(fetchedMessage.get).not.toHaveBeenCalled();
  });

  it("fetches and opens the poll when the list does not hold it", async () => {
    fetchedMessage.get.mockResolvedValue(message({ id: POLL }));
    fetchedMessage.decrypt.mockImplementation(async (m: DecryptedMessage) => ({ ...m, payload: { poll } }));
    const { container } = render(<SystemMessage msg={line({ victor_answer_id: 2, victor_answer_votes: 2, total_votes: 2 })} />);
    expect(text(container)).toContain("Bob's poll has closed.");
    await waitFor(() => expect(text(container)).toContain("Bob's poll Lunch? has closed. Soup won with 100%."));
    expect(fetchedMessage.get).toHaveBeenCalledWith(CH, POLL);
  });

  it("says a tie, or that nobody voted, without the poll's words", async () => {
    fetchedMessage.get.mockRejectedValue(new Error("gone"));
    const tie = render(<SystemMessage msg={line({ victor_answer_id: 0, victor_answer_votes: 1, total_votes: 2 })} />);
    await waitFor(() => expect(fetchedMessage.get).toHaveBeenCalled());
    await act(async () => {});
    expect(text(tie.container)).toContain("Bob's poll has closed. It ended in a tie.");
    tie.unmount();
    const none = render(<SystemMessage msg={line({ victor_answer_id: 0, victor_answer_votes: 0, total_votes: 0 })} />);
    // a failure that may pass is not remembered: the poll is asked for again
    await waitFor(() => expect(fetchedMessage.get).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(text(none.container)).toContain("Bob's poll has closed. Nobody voted.");
  });

  it("names no winner it cannot read", async () => {
    fetchedMessage.get.mockRejectedValue(new Error("gone"));
    const { container } = render(<SystemMessage msg={line({})} />);
    await waitFor(() => expect(fetchedMessage.get).toHaveBeenCalled());
    await act(async () => {});
    expect(text(container)).toContain("Bob's poll has closed.");
    expect(text(container)).not.toContain("won");
  });
});
