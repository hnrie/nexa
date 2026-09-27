// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, PublicUser, Relationship } from "@/api/types";

const added: [string, string][] = [];
vi.mock("@/api/channels", () => ({
  channels: {
    addRecipient: (id: string, uid: string) => {
      added.push([id, uid]);
      return Promise.resolve({ id, type: "group_dm", recipient_ids: ["me", "ann", uid] } as unknown as Channel);
    },
  },
}));

import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUsers } from "@/stores/users";
import { GroupFriendAdder } from "./GroupFriendAdder";

function user(id: string, name: string, extra: Partial<PublicUser> = {}): PublicUser {
  return { id, username: id, display_name: name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0, ...extra };
}
const rel = (u: PublicUser, type: Relationship["type"] = "friend"): Relationship => ({ user: u, type, nickname: "", created_at: 0 });

beforeEach(() => {
  added.length = 0;
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
  it("lists friends who are not in the group, with Add, and Link Only for who joins by link", () => {
    render(<GroupFriendAdder channelId="g1" />);
    expect(screen.getAllByTestId("group-add-row").map((r) => r.dataset.user)).toEqual(["bea", "cat"]);
    expect(within(rowOf("Bea")).getByRole("button", { name: "Add Bea" })).toBeTruthy();
    const tag = within(rowOf("Cat")).getByRole("button", { name: "Link Only" });
    expect(within(rowOf("Cat")).queryByRole("button", { name: /^Add/ })).toBeNull();
    // what it means is its description, not only a bubble a screen reader never reaches
    const hint = document.getElementById(tag.getAttribute("aria-describedby")!.split(" ")[0]!);
    expect(hint?.textContent).toBe("Cat only joins group chats from an invite link sent to them in a message.");
  });

  it("explains Link Only in a tooltip on focus", () => {
    vi.useFakeTimers();
    render(<GroupFriendAdder channelId="g1" />);
    fireEvent.focus(within(rowOf("Cat")).getByRole("button", { name: "Link Only" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Cat only joins group chats from an invite link sent to them in a message.");
  });

  it("goes by the newest copy of a friend, so turning Link Only on shows at once", () => {
    render(<GroupFriendAdder channelId="g1" />);
    act(() => useUsers.setState({ byId: { bea: user("bea", "Bea", { group_link_only: true }) } }));
    expect(within(rowOf("Bea")).getByRole("button", { name: "Link Only" })).toBeTruthy();
  });

  it("adds through the server and keeps the row, marked Added, with the same button", async () => {
    render(<GroupFriendAdder channelId="g1" />);
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
    render(<GroupFriendAdder channelId="g1" />);
    fireEvent.change(screen.getByTestId("group-add-search"), { target: { value: "ca" } });
    expect(screen.getAllByTestId("group-add-row").map((r) => r.dataset.user)).toEqual(["cat"]);
    fireEvent.change(screen.getByTestId("group-add-search"), { target: { value: "zed" } });
    expect(screen.queryAllByTestId("group-add-row")).toHaveLength(0);
    expect(screen.getByText("No friends match.")).toBeTruthy();
  });

  it("says so when every friend is in the group already", () => {
    useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me", "ann", "bea", "cat"] } as unknown as Channel } });
    render(<GroupFriendAdder channelId="g1" />);
    expect(screen.getByText("All your friends are in this group already.")).toBeTruthy();
    expect(screen.queryByTestId("group-add-search")).toBeNull();
  });
});
