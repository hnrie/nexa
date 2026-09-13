// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Channel, Invite } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { GroupInviteModal } from "./GroupInviteModal";

const pending: { maxUses: number; resolve: (inv: Invite) => void }[] = [];
vi.mock("@/api/channels", () => ({
  channels: {
    createGroupInvite: (_id: string, body: { max_age: number; max_uses: number }) =>
      new Promise<Invite>((resolve) => pending.push({ maxUses: body.max_uses, resolve })),
  },
}));

function invite(code: string, maxUses: number): Invite {
  return { code, server_id: null, channel_id: "g1", inviter_id: "me", max_uses: maxUses, uses: 0, expires_at: null, created_at: 0 };
}

afterEach(() => {
  cleanup();
  pending.length = 0;
});

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
});
