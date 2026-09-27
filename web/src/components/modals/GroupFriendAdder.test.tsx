// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, PublicUser, Relationship } from "@/api/types";

const added: [string, string][] = [];
const calls = vi.hoisted(() => ({ createDM: vi.fn(), sendMessage: vi.fn() }));
vi.mock("@/api/channels", () => ({
  channels: {
    addRecipient: (id: string, uid: string) => {
      added.push([id, uid]);
      return Promise.resolve({ id, type: "group_dm", recipient_ids: ["me", "ann", uid] } as unknown as Channel);
    },
    createDM: calls.createDM,
  },
}));
vi.mock("@/components/composer/send", () => ({ sendMessage: calls.sendMessage }));

import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { GroupFriendAdder } from "./GroupFriendAdder";

const LINK = "https://chat.example/invite/abc#k=0.key";
const joinLink = vi.fn(() => Promise.resolve(LINK));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function user(id: string, name: string, extra: Partial<PublicUser> = {}): PublicUser {
  return { id, username: id, display_name: name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0, ...extra };
}
const rel = (u: PublicUser, type: Relationship["type"] = "friend"): Relationship => ({ user: u, type, nickname: "", created_at: 0 });

beforeEach(() => {
  added.length = 0;
  calls.createDM.mockReset().mockResolvedValue({ id: "dm-cat", type: "dm", name: "", recipient_ids: ["me", "cat"] } as unknown as Channel);
  calls.sendMessage.mockReset().mockResolvedValue(undefined);
  joinLink.mockClear();
  useUI.setState({ toasts: [] });
  useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me", "ann"] } as unknown as Channel } });
  useUsers.setState({ byId: {} });
  useRelationships.setState({
    byUser: {
      ann: rel(user("ann", "Ann")),
      bea: rel(user("bea", "Bea")),
      cat: rel(user("cat", "Cat", { group_link_only: true })),
      dee: rel(user("dee", "Dee"), "incoming"),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rowOf = (name: string) => screen.getAllByTestId("group-add-row").find((r) => r.textContent?.includes(name))!;

describe("GroupFriendAdder", () => {
  it("lists friends who are not in the group, with Add, and Send Join Request for who joins by link", () => {
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    expect(screen.getAllByTestId("group-add-row").map((r) => r.dataset.user)).toEqual(["bea", "cat"]);
    expect(within(rowOf("Bea")).getByRole("button", { name: "Add Bea" })).toBeTruthy();
    const btn = within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" });
    expect(btn.textContent).toBe("Send Join Request");
    expect(within(rowOf("Cat")).queryByRole("button", { name: /^Add/ })).toBeNull();
    // why there is no Add is its description, not only a bubble a screen reader never reaches
    const hint = document.getElementById(btn.getAttribute("aria-describedby")!.split(" ")[0]!);
    expect(hint?.textContent).toBe("Cat only joins group chats from an invite link sent to them in a message.");
  });

  it("explains why in a tooltip on focus", () => {
    vi.useFakeTimers();
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    fireEvent.focus(within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Cat only joins group chats from an invite link sent to them in a message.");
  });

  it("goes by the newest copy of a friend, so turning Link Only on shows at once", () => {
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    act(() => useUsers.setState({ byId: { bea: user("bea", "Bea", { group_link_only: true }) } }));
    expect(within(rowOf("Bea")).getByRole("button", { name: "Send Join Request to Bea" })).toBeTruthy();
  });

  it("sends a Link Only friend the group's link in a direct message, busy while it goes and Sent after", async () => {
    const sending = deferred<void>();
    calls.sendMessage.mockReturnValue(sending.promise);
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    const btn = within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.textContent).toBe("Sending…");
    // a second press while it goes sends nothing more
    fireEvent.click(btn);
    expect(calls.createDM).toHaveBeenCalledTimes(1);
    expect(calls.createDM).toHaveBeenCalledWith(["cat"]);
    expect(calls.sendMessage).toHaveBeenCalledWith("dm-cat", `Join my group chat “Pals”\n${LINK}`);
    await act(async () => sending.resolve());
    // the same button, so the keyboard stays on it
    const done = within(rowOf("Cat")).getByRole("button", { name: "Join Request Sent to Cat" });
    expect(done).toBe(btn);
    expect(done.textContent).toBe("Sent");
    expect(done.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Join Request Sent to Cat");
    fireEvent.click(done);
    expect(calls.sendMessage).toHaveBeenCalledTimes(1);
    expect(useUI.getState().toasts).toEqual([]);
  });

  it("keeps a friend who joins with the link in the list, marked Sent", async () => {
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    await act(async () => {
      fireEvent.click(within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" }));
    });
    act(() => useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me", "ann", "cat"] } as unknown as Channel } }));
    expect(within(rowOf("Cat")).getByRole("button", { name: "Join Request Sent to Cat" })).toBeTruthy();
  });

  it("says why when it could not be sent, and can be tried again", async () => {
    calls.createDM.mockRejectedValueOnce(new ApiError(403, "blocked", "You cannot message this user."));
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    const btn = within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(useUI.getState().toasts.map((x) => [x.text, x.kind])).toEqual([["You can’t message this person.", "error"]]);
    expect(calls.sendMessage).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Send Join Request");
    expect(btn.getAttribute("aria-busy")).toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(calls.sendMessage).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe("Sent");
  });

  it("says why when there is no link to send, and sends nothing", async () => {
    joinLink.mockRejectedValueOnce(new ApiError(429, "rate_limited", "Slow down."));
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    await act(async () => {
      fireEvent.click(within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" }));
    });
    expect(calls.createDM).not.toHaveBeenCalled();
    expect(useUI.getState().toasts).toHaveLength(1);
    expect(useUI.getState().toasts[0]!.kind).toBe("error");
  });

  it("leaves a failed send to say why itself, once", async () => {
    calls.sendMessage.mockRejectedValueOnce(new Error("waiting_for_key"));
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    const btn = within(rowOf("Cat")).getByRole("button", { name: "Send Join Request to Cat" });
    await act(async () => {
      fireEvent.click(btn);
    });
    // the send path toasts its own reason, and the message waits in the conversation to retry
    expect(useUI.getState().toasts).toEqual([]);
    expect(btn.textContent).toBe("Send Join Request");
  });

  it("adds through the server and keeps the row, marked Added, with the same button", async () => {
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    const btn = within(rowOf("Bea")).getByRole("button", { name: "Add Bea" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(added).toEqual([["g1", "bea"]]);
    expect(useChannels.getState().byId["g1"]?.recipient_ids).toContain("bea");
    const done = within(rowOf("Bea")).getByRole("button", { name: "Added Bea" });
    expect(done).toBe(btn);
    expect(done.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Bea is in the group now.");
    fireEvent.click(done);
    expect(added).toHaveLength(1);
  });

  it("finds friends by name, and says when nobody matches", () => {
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    fireEvent.change(screen.getByTestId("group-add-search"), { target: { value: "ca" } });
    expect(screen.getAllByTestId("group-add-row").map((r) => r.dataset.user)).toEqual(["cat"]);
    fireEvent.change(screen.getByTestId("group-add-search"), { target: { value: "zed" } });
    expect(screen.queryAllByTestId("group-add-row")).toHaveLength(0);
    expect(screen.getByText("No friends match.")).toBeTruthy();
  });

  it("says so when every friend is in the group already", () => {
    useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me", "ann", "bea", "cat"] } as unknown as Channel } });
    render(<GroupFriendAdder channelId="g1" joinLink={joinLink} />);
    expect(screen.getByText("All your friends are in this group already.")).toBeTruthy();
    expect(screen.queryByTestId("group-add-search")).toBeNull();
  });
});
