// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@/api/types";

const dismissed: string[] = [];
vi.mock("@/api/channels", () => ({
  channels: {
    dismissAddNotice: (id: string) => {
      dismissed.push(id);
      return Promise.resolve();
    },
  },
}));
// the list is under test here, not how a message draws
vi.mock("./MessageItem", () => ({
  MessageItem: ({ msg }: { msg: { id: string } }) => <div data-id={msg.id} data-row="" data-testid="row" />,
}));

import { useAuth } from "@/stores/auth";
import { useGroupAddNotices } from "@/stores/groupAddNotices";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { MessageList } from "./MessageList";

const ME = "1";
const AMY = "2";
const GROUP = "700";

const group = { id: GROUP, server_id: null, type: "group_dm", name: "Pals", recipient_ids: [ME, AMY], key_conv_id: GROUP, owner_id: AMY, icon_id: null } as unknown as Channel;

function msg(id: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return { id, channel_id: GROUP, author_id: AMY, type: "default", ciphertext: null, key_conv_id: null, key_epoch: null, reply_to_id: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: Number(id), payload: { t: `m${id}` }, ...extra };
}

function seed(list: DecryptedMessage[], hasOlder = true): void {
  useMessages.setState({
    channels: { [GROUP]: { ids: list.map((m) => m.id), byId: Object.fromEntries(list.map((m) => [m.id, m])), hasOlder, hasNewer: false, loading: false, loaded: true, failed: 0, pending: [] } },
  });
}

/** The rows of the list in order, the note as "note". */
function order(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-id]")].map((el) => (el.dataset.id === "group-add-notice" ? "note" : el.dataset.id!));
}

class NoResize {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  dismissed.length = 0;
  vi.stubGlobal("ResizeObserver", NoResize);
  useAuth.setState({ me: { id: ME, username: "me", display_name: "Me" } as never });
  useUsers.setState({ byId: { [AMY]: { id: AMY, username: "amy", display_name: "Amy" } as never } });
  useUI.setState({ focused: false, jumpTo: null });
  useGroupAddNotices.setState({ byChannel: { [GROUP]: { channel_id: GROUP, added_by: AMY, added_at: 1000 } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useMessages.setState({ channels: {} });
  useGroupAddNotices.getState().clear();
});

describe("Nexa's note about being added to a group", () => {
  it("follows the line saying who added you, and is from Nexa for you alone", () => {
    seed([msg("990"), msg("1002", { type: "system_member_add", mentions: [ME] }), msg("1003")]);
    render(<MessageList channel={group} />);
    expect(order()).toEqual(["990", "1002", "note", "1003"]);
    const note = screen.getByTestId("group-add-notice");
    expect(note.textContent).toContain("Nexa");
    expect(note.textContent).toContain("Only you can see this");
    expect(note.textContent).toContain("Amy added you to this group because you’re friends.");
    expect(note.textContent).toContain("turn off “Let friends add me to group chats” in Settings, Privacy & Safety.");
  });

  it("waits at the bottom when that line is not loaded", () => {
    seed([msg("1005"), msg("1006")]);
    render(<MessageList channel={group} />);
    expect(order()).toEqual(["1005", "1006", "note"]);
  });

  it("comes first in a group that began with the add", () => {
    seed([msg("1005"), msg("1006")], false);
    render(<MessageList channel={group} />);
    expect(order()).toEqual(["note", "1005", "1006"]);
  });

  it("opens the friend's profile, and the setting it names", () => {
    seed([]);
    render(<MessageList channel={group} />);
    fireEvent.click(screen.getByTestId("group-add-notice-name"));
    expect(useUI.getState().modal).toMatchObject({ kind: "profile", props: { userId: AMY } });
    fireEvent.click(screen.getByTestId("group-add-notice-settings"));
    expect(useUI.getState().modal).toMatchObject({ kind: "settings", props: { page: "privacy" } });
  });

  it("goes when dismissed, here and on the server", async () => {
    seed([msg("1005")]);
    render(<MessageList channel={group} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-add-notice-dismiss"));
    });
    expect(dismissed).toEqual([GROUP]);
    expect(screen.queryByTestId("group-add-notice")).toBeNull();
  });

  it("is never shown in a conversation that is not a group", () => {
    seed([msg("1005")]);
    render(<MessageList channel={{ ...group, type: "dm" }} />);
    expect(screen.queryByTestId("group-add-notice")).toBeNull();
  });
});
