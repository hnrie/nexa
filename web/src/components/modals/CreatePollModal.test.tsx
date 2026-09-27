// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatePollModal, durationLabel, pollFromForm } from "./CreatePollModal";

const sent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/components/composer/send", () => ({ sendPoll: sent }));

afterEach(() => {
  cleanup();
  sent.mockClear();
});

describe("pollFromForm", () => {
  it("needs a question and two answers, and leaves empty answers out", () => {
    expect(pollFromForm("  ", [{ text: "a" }, { text: "b" }], 24, false)).toBeNull();
    expect(pollFromForm("Lunch?", [{ text: "a" }, { text: "  " }], 24, false)).toBeNull();
    expect(pollFromForm(" Lunch? ", [{ text: " Pizza ", emoji: { name: "🍕" } }, { text: "" }, { text: "Soup" }], 72, true)).toEqual({
      question: "Lunch?",
      answers: [{ text: "Pizza", emoji: { name: "🍕" } }, { text: "Soup" }],
      hours: 72,
      multiselect: true,
    });
  });
});

describe("durationLabel", () => {
  it("says each length in its largest whole unit", () => {
    expect([1, 4, 8, 24, 72, 168, 336].map(durationLabel)).toEqual(["1 hour", "4 hours", "8 hours", "1 day", "3 days", "1 week", "2 weeks"]);
  });
});

describe("CreatePollModal", () => {
  it("posts the poll as written and closes", () => {
    const onClose = vi.fn();
    render(<CreatePollModal onClose={onClose} channelId="700" />);
    const post = screen.getByTestId("poll-post") as HTMLButtonElement;
    expect(post.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("poll-question"), { target: { value: "Lunch?" } });
    const [a, b] = screen.getAllByTestId("poll-answer-input");
    fireEvent.change(a!, { target: { value: "Pizza" } });
    fireEvent.change(b!, { target: { value: "Soup" } });
    fireEvent.click(screen.getByTestId("poll-add-answer"));
    fireEvent.change(screen.getAllByTestId("poll-answer-input")[2]!, { target: { value: "Salad" } });
    fireEvent.change(screen.getByTestId("poll-duration"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Allow multiple answers"));
    expect(post.disabled).toBe(false);
    fireEvent.click(post);
    expect(sent).toHaveBeenCalledWith("700", { question: "Lunch?", answers: [{ text: "Pizza" }, { text: "Soup" }, { text: "Salad" }], hours: 4, multiselect: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps two answers at least, and ten at most", () => {
    render(<CreatePollModal onClose={() => {}} channelId="700" />);
    expect(screen.queryByRole("button", { name: "Remove Answer 1" })).toBeNull();
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByTestId("poll-add-answer"));
    expect(screen.getAllByTestId("poll-answer-input")).toHaveLength(10);
    expect(screen.queryByTestId("poll-add-answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Answer 10" }));
    expect(screen.getAllByTestId("poll-answer-input")).toHaveLength(9);
  });
});
