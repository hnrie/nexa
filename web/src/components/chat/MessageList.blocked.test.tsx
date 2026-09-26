// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Relationship } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useRelationships } from "@/stores/relationships";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { MessageList } from "./MessageList";

// A row is only its id and whether it starts a group: these tests are about
// which messages the list shows and how it strings them together.
vi.mock("./MessageItem", () => ({
  MessageItem: ({ msg, groupStart }: { msg: DecryptedMessage; groupStart: boolean }) => <div data-id={msg.id} data-row="" data-start={groupStart ? "1" : "0"} data-testid="row" />,
}));

const CHANNEL = "800";
const channel = { id: CHANNEL, server_id: "s1", type: "text", name: "general", topic: "", recipient_ids: [], key_conv_id: "s1", last_message_id: null } as unknown as Channel;
const NOON = Date.UTC(2026, 0, 5, 12);
const MIN = 60_000;
const DAY = 86_400_000;

function msg(id: string, author: string, at: number, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id, channel_id: CHANNEL, author_id: author, type: "default", ciphertext: null, key_conv_id: null, key_epoch: null, reply_to_id: null,
    mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: at, payload: { t: id }, ...extra,
  };
}

function seed(list: DecryptedMessage[]): void {
  useMessages.setState({
    channels: {
      [CHANNEL]: { ids: list.map((m) => m.id), byId: Object.fromEntries(list.map((m) => [m.id, m])), hasOlder: false, hasNewer: false, loading: false, loaded: true, failed: 0, pending: [] },
    },
  });
}

function block(id: string): void {
  useRelationships.getState().set({ user: { id, username: id, display_name: id, avatar_id: null } as Relationship["user"], type: "blocked", nickname: "", created_at: 0 });
}

const shown = () => screen.queryAllByTestId("row").map((r) => `${r.dataset.id}${r.dataset.start === "1" ? "*" : ""}`);
const runs = () => [...document.querySelectorAll<HTMLElement>("[data-blocked-run]")].map((r) => r.textContent);
const dates = () => document.querySelectorAll(".dateDivider").length;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // jsdom lays nothing out; going to a message scrolls it into view
  Element.prototype.scrollIntoView = vi.fn();
  useAuth.setState({ me: { id: "me", username: "me", display_name: "Me" } as never });
  useUI.setState({ focused: false, jumpTo: null, toasts: [] });
  useRelationships.getState().clear();
  block("carol");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useMessages.setState({ channels: {} });
  useRelationships.getState().clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

const hiding = (replies = false) => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, blocking: { hideMessages: true, hideReplies: replies } } });

describe("messages from someone blocked, folded", () => {
  it("fold a run into one row that opens and closes", () => {
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + MIN), msg("3", "carol", NOON + 2 * MIN), msg("4", "bob", NOON + 3 * MIN)]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["1*", "4*"]);
    expect(runs()).toEqual(["2 blocked messagesShow"]);
    fireEvent.click(screen.getByTestId("blocked-run-toggle"));
    // opened, they read as ordinary messages, grouped among themselves
    expect(shown()).toEqual(["1*", "2*", "3", "4*"]);
    expect(runs()).toEqual(["2 blocked messagesHide"]);
    fireEvent.click(screen.getByTestId("blocked-run-toggle"));
    expect(shown()).toEqual(["1*", "4*"]);
  });

  it("keep a run to one day, so each day keeps its date line", () => {
    seed([msg("1", "carol", NOON), msg("2", "carol", NOON + DAY), msg("3", "bob", NOON + DAY + MIN)]);
    render(<MessageList channel={channel} />);
    expect(runs()).toEqual(["1 blocked messageShow", "1 blocked messageShow"]);
    expect(dates()).toBe(2);
  });

  it("leave notes about them in place", () => {
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + MIN, { type: "system_join" })]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["1*", "2*"]);
    expect(runs()).toEqual([]);
  });
});

describe("messages from someone blocked, hidden completely", () => {
  it("leave no row, and the messages around them group as if they had never been sent", () => {
    hiding();
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + MIN), msg("3", "bob", NOON + 2 * MIN)]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["1*", "3"]);
    expect(runs()).toEqual([]);
  });

  it("leave no date line for a day that had only them", () => {
    hiding();
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + DAY), msg("3", "bob", NOON + 2 * DAY)]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["1*", "3*"]);
    expect(dates()).toBe(2);
  });

  it("take replies to them along when asked to", () => {
    hiding(true);
    seed([msg("1", "carol", NOON), msg("2", "bob", NOON + MIN, { type: "reply", reply_to_id: "1" }), msg("3", "dave", NOON + 2 * MIN)]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["3*"]);
  });

  it("keep replies to them otherwise", () => {
    hiding(false);
    seed([msg("1", "carol", NOON), msg("2", "bob", NOON + MIN, { type: "reply", reply_to_id: "1" })]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["2*"]);
  });
});

describe("going to a message from someone blocked", () => {
  it("opens the folded run it is in", () => {
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + MIN)]);
    render(<MessageList channel={channel} />);
    expect(shown()).toEqual(["1*"]);
    act(() => useUI.getState().setJumpTo({ channelId: CHANNEL, messageId: "2" }));
    expect(shown()).toEqual(["1*", "2*"]);
  });

  it("says a hidden one is hidden rather than calling it missing", () => {
    hiding();
    seed([msg("1", "bob", NOON), msg("2", "carol", NOON + MIN)]);
    render(<MessageList channel={channel} />);
    act(() => useUI.getState().setJumpTo({ channelId: CHANNEL, messageId: "2" }));
    expect(useUI.getState().jumpTo).toBeNull();
    expect(useUI.getState().toasts.map((t) => t.text)).toEqual(["That message is from someone you blocked, so it is hidden."]);
  });
});
