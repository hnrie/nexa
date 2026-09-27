// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, Invite, PublicUser } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { GroupInviteModal } from "./GroupInviteModal";

const pending: { maxAge: number; maxUses: number; resolve: (inv: Invite) => void; reject: (err: unknown) => void }[] = [];
const sent = vi.hoisted(() => ({ messages: [] as [string, string][] }));
vi.mock("@/api/channels", () => ({
  channels: {
    createGroupInvite: (_id: string, body: { max_age: number; max_uses: number }) =>
      new Promise<Invite>((resolve, reject) => pending.push({ maxAge: body.max_age, maxUses: body.max_uses, resolve, reject })),
    createDM: () => Promise.resolve({ id: "dm-cat", type: "dm", name: "", recipient_ids: ["me", "cat"] }),
  },
}));
vi.mock("@/components/composer/send", () => ({
  sendMessage: (channelId: string, text: string) => {
    sent.messages.push([channelId, text]);
    return Promise.resolve();
  },
}));

function invite(code: string, maxUses: number): Invite {
  return { code, server_id: null, channel_id: "g1", inviter_id: "me", max_uses: maxUses, uses: 0, expires_at: null, created_at: 0 };
}

afterEach(() => {
  cleanup();
  pending.length = 0;
  sent.messages.length = 0;
});

function withLinkOnlyFriend(): void {
  useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me"] } as unknown as Channel } });
  const cat = { id: "cat", username: "cat", display_name: "Cat", group_link_only: true } as PublicUser;
  useRelationships.setState({ byUser: { cat: { user: cat, type: "friend", nickname: "", created_at: 0 } } });
  useUI.setState({ toasts: [] });
}
const joinButton = () => within(screen.getByTestId("group-add-friends")).getByRole("button", { name: "Send Join Request to Cat" });

describe("GroupInviteModal", () => {
  it("shows the link for the newest settings even when an older request answers last", async () => {
    useChannels.setState({ byId: { g1: { id: "g1", type: "group_dm", name: "Pals", recipient_ids: ["me"] } as unknown as Channel } });
    render(<GroupInviteModal onClose={() => {}} channelId="g1" />);
    const uses = screen.getAllByRole("combobox")[1]!;
    fireEvent.change(uses, { target: { value: "1" } });
    expect(pending.map((p) => p.maxUses)).toEqual([0, 1]);

    await act(async () => pending[1]!.resolve(invite("newest", 1)));
    await act(async () => pending[0]!.resolve(invite("stale", 0)));
    expect((screen.getByTestId("group-invite-link") as HTMLInputElement).value).toContain("newest");
  });

  it("sends a join request with the link it shows, once that link is in", async () => {
    withLinkOnlyFriend();
    render(<GroupInviteModal onClose={() => {}} channelId="g1" />);
    await act(async () => {
      fireEvent.click(joinButton());
    });
    expect(sent.messages).toEqual([]);
    await act(async () => pending[0]!.resolve(invite("shown", 0)));
    const link = (screen.getByTestId("group-invite-link") as HTMLInputElement).value;
    expect(link).toContain("/invite/shown");
    expect(sent.messages).toEqual([["dm-cat", `Join my group chat “Pals”\n${link}`]]);
    // no second link was made for it
    expect(pending).toHaveLength(1);
  });

  it("makes the link with the settings chosen when there was none to show", async () => {
    withLinkOnlyFriend();
    render(<GroupInviteModal onClose={() => {}} channelId="g1" />);
    await act(async () => pending[0]!.reject(new ApiError(500, "internal", "Something broke.")));
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "5" } });
    await act(async () => pending[1]!.reject(new ApiError(500, "internal", "Something broke.")));
    useUI.setState({ toasts: [] });
    await act(async () => {
      fireEvent.click(joinButton());
    });
    expect(pending.map((p) => [p.maxAge, p.maxUses])[2]).toEqual([604800, 5]);
    await act(async () => pending[2]!.resolve(invite("fresh", 5)));
    expect(sent.messages[0]?.[1]).toContain("/invite/fresh");
    // and the menu shows it too
    expect((screen.getByTestId("group-invite-link") as HTMLInputElement).value).toContain("/invite/fresh");
    expect(useUI.getState().toasts).toEqual([]);
  });
});
