// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { MAX_MESSAGE_LENGTH } from "@/components/composer/limit";
import { EditMessage } from "./EditMessage";

const edit = vi.fn(async () => undefined);
vi.mock("@/components/composer/send", async (real) => ({
  ...(await real<typeof import("@/components/composer/send")>()),
  editMessage: (...args: unknown[]) => edit(...(args as [])),
  editNames: () => ({}),
}));

const msg: DecryptedMessage = {
  id: "10",
  channel_id: "700",
  author_id: "1",
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
  created_at: 1,
  payload: { t: "hello" },
};

function box(): HTMLTextAreaElement {
  return screen.getByLabelText("Edit Your Message") as HTMLTextAreaElement;
}

function paste(el: HTMLTextAreaElement, text: string) {
  el.setSelectionRange(el.value.length, el.value.length);
  fireEvent.paste(el, { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") } });
}

describe("editing a message", () => {
  beforeEach(() => {
    edit.mockClear();
    // a draft parked by the test before would come back in the box
    useUI.setState({ toasts: [], editDrafts: {}, editing: { channelId: "700", messageId: "10" } } as never);
  });
  afterEach(cleanup);

  it("counts down near the limit, as the message box does", () => {
    render(<EditMessage msg={msg} />);
    expect(screen.queryByTestId("message-counter")).toBeNull();
    fireEvent.change(box(), { target: { value: "a".repeat(MAX_MESSAGE_LENGTH - 10) } });
    const counter = screen.getByTestId("message-counter");
    expect(counter.textContent).toContain("10");
    expect(counter.dataset["over"]).toBe("false");
    expect(counter.querySelector(".visually-hidden")?.textContent).toBe("10 characters left");
  });

  it("refuses to save an edit past the limit and says why", async () => {
    render(<EditMessage msg={msg} />);
    fireEvent.change(box(), { target: { value: "a".repeat(MAX_MESSAGE_LENGTH + 5) } });
    expect(screen.getByTestId("message-counter").dataset["over"]).toBe("true");
    fireEvent.keyDown(box(), { key: "Enter" });
    await Promise.resolve();
    expect(edit).not.toHaveBeenCalled();
    expect(useUI.getState().toasts.map((t) => t.text)).toContain("Messages are limited to 4,000 characters.");
  });

  it("saves an edit right at the limit", async () => {
    render(<EditMessage msg={msg} />);
    fireEvent.change(box(), { target: { value: "a".repeat(MAX_MESSAGE_LENGTH) } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await Promise.resolve();
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("holds back a paste that would go past the limit until asked", () => {
    render(<EditMessage msg={msg} />);
    const long = "b".repeat(MAX_MESSAGE_LENGTH);
    paste(box(), long);
    expect(box().value).toBe("hello");
    expect(screen.getByTestId("edit-notice").textContent).toContain("longer than a message can be (4,000 characters)");
    fireEvent.click(screen.getByRole("button", { name: "Paste Anyway" }));
    expect(box().value).toBe("hello" + long);
    expect(screen.queryByTestId("edit-notice")).toBeNull();
    expect(screen.getByTestId("message-counter").dataset["over"]).toBe("true");
  });

  it("lets a paste that fits go in as usual", () => {
    render(<EditMessage msg={msg} />);
    paste(box(), " world");
    expect(screen.queryByTestId("edit-notice")).toBeNull();
  });

  it("wraps the selection in bold with Ctrl+B", () => {
    render(<EditMessage msg={msg} />);
    const el = box();
    el.setSelectionRange(0, 5);
    fireEvent.keyDown(el, { key: "b", ctrlKey: true });
    expect(el.value).toBe("**hello**");
  });
});
