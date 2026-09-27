import { beforeEach, describe, expect, it } from "vitest";
import type { Channel, Member, Role, ServerView } from "@/api/types";
import { DEFAULT_EVERYONE, P, permString } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { canCreatePoll, plusButton } from "./plusMenu";

describe("plusButton", () => {
  it("opens a menu only when there is a choice to make", () => {
    expect(plusButton({ attach: true, poll: true })).toEqual({ kind: "menu", options: ["upload", "poll"] });
  });

  it("does the one thing it can at once", () => {
    expect(plusButton({ attach: true, poll: false })).toEqual({ kind: "direct", option: "upload" });
    expect(plusButton({ attach: false, poll: true })).toEqual({ kind: "direct", option: "poll" });
  });

  it("is not there when it can do nothing", () => {
    expect(plusButton({ attach: false, poll: false })).toEqual({ kind: "none" });
  });
});

describe("canCreatePoll", () => {
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
  const member = (user_id: string): Member => ({ server_id: S, user_id, nickname: "", avatar_id: null, joined_at: 0, timeout_until: null, flags: 0, role_ids: [] });
  const deny = (channel: string, p: bigint) => [{ channel_id: channel, target_id: S, target_type: "role" as const, allow: "0", deny: permString(p) }];
  const channels = [ch("200"), ch("201", { overwrites: deny("201", P.CREATE_POLLS) }), ch("202", { overwrites: deny("202", P.SEND_MESSAGES) })];
  const view = (everyone: bigint): ServerView => ({
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
    channels,
    roles: [role(S, 0, everyone)],
    members: [member("1"), member("2")],
    member_count: 2,
    me: member("2"),
    my_permissions: permString(everyone),
  });

  beforeEach(() => {
    useServers.getState().clear();
    useChannels.getState().upsert(channels);
  });

  it("follows Create Polls and Send Messages in each channel", () => {
    useServers.getState().setFromView(view(DEFAULT_EVERYONE));
    const st = useServers.getState().byId[S];
    expect(canCreatePoll(st, ch("200"))).toBe(true);
    expect(canCreatePoll(st, ch("201"))).toBe(false);
    expect(canCreatePoll(st, ch("202"))).toBe(false);
  });

  it("is off everywhere in a server that took Create Polls from everyone", () => {
    useServers.getState().setFromView(view(DEFAULT_EVERYONE & ~P.CREATE_POLLS));
    expect(canCreatePoll(useServers.getState().byId[S], ch("200"))).toBe(false);
  });

  it("is always on in a conversation, which has no roles to take it away", () => {
    expect(canCreatePoll(undefined, { id: "300", server_id: null })).toBe(true);
  });
});
