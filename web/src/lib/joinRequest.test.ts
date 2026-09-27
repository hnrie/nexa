// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, Invite } from "@/api/types";

const calls = vi.hoisted(() => ({
  createDM: vi.fn(),
  createGroupInvite: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("@/api/channels", () => ({ channels: { createDM: calls.createDM, createGroupInvite: calls.createGroupInvite } }));
// the one path every message takes; what it is handed is what goes out, sealed
vi.mock("@/components/composer/send", () => ({ sendMessage: calls.sendMessage }));

import { clearKeyring, ring } from "@/lib/keyring";
import { useChannels } from "@/stores/channels";
import { JOIN_LINK_SETTINGS, joinRequestError, joinRequestText, newGroupLink, sendJoinRequest } from "./joinRequest";

const group = (name: string) => ({ id: "g1", type: "group_dm", name, recipient_ids: ["me", "ann"] }) as unknown as Channel;
const dm = { id: "dm1", type: "dm", name: "", recipient_ids: ["me", "cat"] } as unknown as Channel;
const invite = (code: string): Invite => ({ code, server_id: null, channel_id: "g1", inviter_id: "me", max_uses: 0, uses: 0, expires_at: null, created_at: 0 });

beforeEach(() => {
  calls.createDM.mockReset().mockResolvedValue(dm);
  calls.createGroupInvite.mockReset().mockResolvedValue(invite("abc"));
  calls.sendMessage.mockReset().mockResolvedValue(undefined);
  useChannels.setState({ byId: { g1: group("Pals") } });
  clearKeyring();
});

describe("joinRequestText", () => {
  it("names the group, then gives the link on a line of its own", () => {
    expect(joinRequestText("Pals", "https://x/invite/abc#k=0.key")).toBe("Join my group chat “Pals”\nhttps://x/invite/abc#k=0.key");
  });

  it("leaves the name out for a group that has none", () => {
    expect(joinRequestText("", "https://x/invite/abc")).toBe("Join my group chat\nhttps://x/invite/abc");
    expect(joinRequestText("  ", "https://x/invite/abc")).toBe("Join my group chat\nhttps://x/invite/abc");
    expect(joinRequestText(null, "https://x/invite/abc")).toBe("Join my group chat\nhttps://x/invite/abc");
  });

  it("keeps markdown in the name as the name", () => {
    expect(joinRequestText("**VIP** _club_", "L")).toBe("Join my group chat “\\*\\*VIP\\*\\* \\_club\\_”\nL");
  });
});

describe("newGroupLink", () => {
  it("makes a link with the invite menu's first settings, carrying the group's key when this device holds it", async () => {
    expect(await newGroupLink("g1")).toBe(`${window.location.origin}/invite/abc`);
    expect(calls.createGroupInvite).toHaveBeenCalledWith("g1", JOIN_LINK_SETTINGS);
    ring.set("g1", 2, new Uint8Array(32).fill(7));
    const link = await newGroupLink("g1", { max_age: 86400, max_uses: 1 });
    expect(calls.createGroupInvite).toHaveBeenLastCalledWith("g1", { max_age: 86400, max_uses: 1 });
    expect(link).toMatch(new RegExp(`^${window.location.origin}/invite/abc#k=2\\.[A-Za-z0-9_-]{43}$`));
  });
});

describe("sendJoinRequest", () => {
  it("opens the direct message with the friend and sends the link there as an ordinary message", async () => {
    expect(await sendJoinRequest("g1", "cat", "https://x/invite/abc#k=0.key")).toBe("dm1");
    expect(calls.createDM).toHaveBeenCalledWith(["cat"]);
    // the conversation is known here before its first message goes, as opening it from Message would do
    expect(useChannels.getState().byId["dm1"]).toBeTruthy();
    expect(calls.sendMessage).toHaveBeenCalledWith("dm1", "Join my group chat “Pals”\nhttps://x/invite/abc#k=0.key");
  });

  it("says why a conversation could not be opened", async () => {
    calls.createDM.mockRejectedValue(new ApiError(403, "blocked", "You cannot message this user."));
    const err = await sendJoinRequest("g1", "cat", "L").catch((e: unknown) => e);
    expect(calls.sendMessage).not.toHaveBeenCalled();
    expect(joinRequestError(err, "Cat")).toBe("You can’t message this person.");
    expect(joinRequestError(new Error("boom"), "Cat")).toBe("Could not send Cat a join request.");
  });

  it("adds nothing to a failed send, which has said why already", async () => {
    calls.sendMessage.mockRejectedValue(new Error("waiting_for_key"));
    const err = await sendJoinRequest("g1", "cat", "L").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(joinRequestError(err, "Cat")).toBeNull();
  });
});
