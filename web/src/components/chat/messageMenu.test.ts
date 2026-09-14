import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { Channel, Member, Role, ServerView } from "@/api/types";
import { DEFAULT_EVERYONE, P, permString } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import type { DecryptedMessage } from "@/stores/messages";
import { useSelection } from "@/stores/selection";
import { useServers } from "@/stores/servers";
import { buildMessageMenu, canDelete, canPick, canPin, deleteMessagesNow, startSelecting } from "./messageMenu";

const S = "100";
const ch = (id: string, extra: Partial<Channel> = {}): Channel => ({
  id,
  server_id: S,
  type: "text",
  name: "c" + id,
  topic: "",
  position: 0,
  parent_id: null,
  nsfw: false,
  slowmode_seconds: 0,
  user_limit: 0,
  owner_id: null,
  icon_id: null,
  last_message_id: null,
  created_at: 0,
  recipient_ids: [],
  key_conv_id: S,
  ...extra,
});
const role = (id: string, position: number, permissions: bigint): Role => ({ id, server_id: S, name: "r" + id, color: 0, hoist: false, mentionable: false, position, permissions: permString(permissions), icon_id: null, created_at: 0 });
const member = (user_id: string, role_ids: string[] = []): Member => ({ server_id: S, user_id, nickname: "", avatar_id: null, joined_at: 0, timeout_until: null, flags: 0, role_ids });
const msg = (channel_id: string, author_id: string) => ({ id: "900", channel_id, author_id, type: "default", flags: 0 }) as DecryptedMessage;

// "1" owns the server, "2" moderates with Manage Messages, "3" is a plain member
function signIn(userId: string) {
  const mod = userId === "2";
  const v: ServerView = {
    id: S,
    name: "Srv",
    icon_id: null,
    banner_id: null,
    owner_id: "1",
    description: "",
    system_channel_id: null,
    default_notifications: 0,
    flags: 0,
    created_at: 0,
    channels: [ch("200"), ch("300", { server_id: null, type: "group_dm", owner_id: "1", recipient_ids: ["1", "2", "3"] })],
    roles: [role(S, 0, DEFAULT_EVERYONE), role("400", 1, DEFAULT_EVERYONE | P.MANAGE_MESSAGES)],
    members: [member("1"), member("2", ["400"]), member("3")],
    member_count: 3,
    me: member(userId, mod ? ["400"] : []),
    my_permissions: permString(mod ? DEFAULT_EVERYONE | P.MANAGE_MESSAGES : DEFAULT_EVERYONE),
  };
  useServers.getState().clear();
  useChannels.getState().clear();
  useChannels.getState().upsert(v.channels);
  useServers.getState().setFromView(v);
  useAuth.setState({ me: { id: userId, flags: 0 } as never });
}

describe("message permissions", () => {
  beforeEach(() => signIn("3"));
  it("lets moderators and the owner delete anyone's message in a server", () => {
    expect(canDelete(msg("200", "1"))).toBe(false);
    expect(canDelete(msg("200", "3"))).toBe(true);
    signIn("2");
    expect(canDelete(msg("200", "3"))).toBe(true);
    signIn("1");
    expect(canDelete(msg("200", "3"))).toBe(true);
  });
  it("offers pinning in servers only with Manage Messages", () => {
    expect(canPin(msg("200", "3"))).toBe(false);
    expect(canPin(msg("300", "1"))).toBe(true);
    signIn("2");
    expect(canPin(msg("200", "3"))).toBe(true);
  });
  it("keeps group DM deletes to the author and the group's owner", () => {
    expect(canDelete(msg("300", "2"))).toBe(false);
    signIn("1");
    expect(canDelete(msg("300", "2"))).toBe(true);
  });
});

describe("picking messages to delete", () => {
  beforeEach(() => {
    signIn("3");
    useSelection.getState().clear();
  });
  const labels = (m: DecryptedMessage) => buildMessageMenu(m, { openReactionPicker: () => {} }).map((i) => i.id);

  it("puts a picture's Copy Image and Save Image first when opened on one", () => {
    const withImage = buildMessageMenu(msg("200", "1"), { openReactionPicker: () => {} }, { src: "blob:x", name: "cat.png" });
    expect(withImage.slice(0, 3).map((i) => i.id)).toEqual(["copy-image", "save-image", "react"]);
    expect(withImage[1]!.separatorAfter).toBe(true);
    expect(labels(msg("200", "1"))).not.toContain("copy-image");
  });

  it("offers Select Messages wherever deleting is offered", () => {
    expect(labels(msg("200", "3"))).toContain("select");
    expect(labels(msg("200", "1"))).not.toContain("select");
    signIn("2");
    expect(labels(msg("200", "1"))).toContain("select");
  });

  it("starts with the message ticked, and never ticks a system message", () => {
    startSelecting(msg("200", "3"));
    expect(useSelection.getState().channelId).toBe("200");
    expect(Object.keys(useSelection.getState().picked)).toEqual(["900"]);
    expect(canPick({ ...msg("200", "3"), type: "system_pin" } as DecryptedMessage)).toBe(false);
  });

  it("deletes in batches of a hundred and forgets each batch as it goes", async () => {
    const ids = Array.from({ length: 230 }, (_, i) => String(1000 + i));
    const batches: string[][] = [];
    const request = vi.spyOn(api, "request").mockImplementation(((_m: string, _p: string, body?: unknown) => {
      const list = (body as { ids: string[] }).ids;
      batches.push(list);
      return Promise.resolve({ ids: list });
    }) as typeof api.request);
    useSelection.getState().start("200");
    useSelection.getState().addRange(ids, ids[ids.length - 1]!);
    await deleteMessagesNow("200", ids);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 30]);
    expect(Object.keys(useSelection.getState().picked)).toEqual([]);
    request.mockRestore();
  });

  it("keeps what did not go picked when a batch fails", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(2000 + i));
    let calls = 0;
    const request = vi.spyOn(api, "request").mockImplementation(((_m: string, _p: string, body?: unknown) => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ ids: (body as { ids: string[] }).ids }) : Promise.reject(new Error("nope"));
    }) as typeof api.request);
    useSelection.getState().start("200");
    useSelection.getState().addRange(ids, ids[0]!);
    await expect(deleteMessagesNow("200", ids)).rejects.toThrow("nope");
    expect(Object.keys(useSelection.getState().picked)).toHaveLength(50);
    request.mockRestore();
  });
});
