import { describe, expect, it, vi } from "vitest";
import type { Channel, GroupAddNotice, PublicUser, Relationship } from "@/api/types";

const added: [string, string][] = [];
vi.mock("@/api/channels", () => ({
  channels: {
    addRecipient: (id: string, uid: string) => {
      added.push([id, uid]);
      return Promise.resolve({ id, type: "group_dm", recipient_ids: ["me", uid] } as unknown as Channel);
    },
  },
}));

import { useChannels } from "@/stores/channels";
import { addFriendToGroup, friendsToAdd, isLinkOnly, noticeSpot } from "./groupAdd";

function user(id: string, name: string, extra: Partial<PublicUser> = {}): PublicUser {
  return { id, username: name.toLowerCase(), display_name: name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0, ...extra };
}
function rel(u: PublicUser, type: Relationship["type"] = "friend", nickname = ""): Relationship {
  return { user: u, type, nickname, created_at: 0 };
}

describe("isLinkOnly", () => {
  it("is only set by the flag itself", () => {
    expect(isLinkOnly(undefined)).toBe(false);
    expect(isLinkOnly(user("1", "Ann"))).toBe(false);
    expect(isLinkOnly(user("1", "Ann", { group_link_only: false }))).toBe(false);
    expect(isLinkOnly(user("1", "Ann", { group_link_only: true }))).toBe(true);
  });
});

describe("friendsToAdd", () => {
  const ann = user("1", "Ann");
  const bob = user("2", "Bob");
  const cat = user("3", "Cat");
  const rels: Record<string, Relationship> = {
    "1": rel(ann),
    "2": rel(bob, "friend", "Bobby"),
    "3": rel(cat),
    "4": rel(user("4", "Dee"), "incoming"),
    "5": rel(user("5", "Eve"), "blocked"),
  };

  it("lists friends who are not in the group yet, by the name shown", () => {
    expect(friendsToAdd(rels, {}, ["3", "me"], "").map((c) => c.user.id)).toEqual(["1", "2"]);
    expect(friendsToAdd(rels, {}, [], "").map((c) => c.nickname || c.user.display_name)).toEqual(["Ann", "Bobby", "Cat"]);
  });

  it("finds them by name, username or nickname", () => {
    expect(friendsToAdd(rels, {}, [], "  BOBBY ").map((c) => c.user.id)).toEqual(["2"]);
    expect(friendsToAdd(rels, {}, [], "an").map((c) => c.user.id)).toEqual(["1"]);
    expect(friendsToAdd(rels, {}, [], "zzz")).toEqual([]);
  });

  it("goes by the newest copy of each person, where Link Only arrives", () => {
    const fresh = { "1": user("1", "Ann", { group_link_only: true }) };
    const list = friendsToAdd(rels, fresh, [], "");
    expect(list.find((c) => c.user.id === "1")?.linkOnly).toBe(true);
    expect(list.find((c) => c.user.id === "2")?.linkOnly).toBe(false);
  });
});

describe("addFriendToGroup", () => {
  it("adds through the server and keeps the channel it answers with", async () => {
    useChannels.setState({ byId: {} });
    await addFriendToGroup("g1", "42");
    expect(added).toEqual([["g1", "42"]]);
    expect(useChannels.getState().byId["g1"]?.recipient_ids).toEqual(["me", "42"]);
  });
});

describe("noticeSpot", () => {
  const notice: GroupAddNotice = { channel_id: "g", added_by: "amy", added_at: 10_000 };
  const msg = (id: string, created_at: number, extra: { type?: string; author_id?: string; mentions?: string[] } = {}) => ({ id, created_at, type: "default", author_id: "x", mentions: [], ...extra });
  const addLine = msg("5", 10_050, { type: "system_member_add", author_id: "amy", mentions: ["me"] });
  const byId = (list: ReturnType<typeof msg>[]) => Object.fromEntries(list.map((m) => [m.id, m]));
  const present = { hasOlder: true, hasNewer: false };

  it("follows the line saying who added you", () => {
    const list = [msg("1", 5_000), addLine, msg("9", 20_000)];
    expect(noticeSpot(list.map((m) => m.id), byId(list), notice, "me", present)).toEqual({ after: "5" });
  });

  it("does not follow the line from an earlier time you were added", () => {
    const old = msg("2", 3_000, { type: "system_member_add", author_id: "amy", mentions: ["me"] });
    const list = [old, msg("9", 20_000)];
    expect(noticeSpot(list.map((m) => m.id), byId(list), notice, "me", present)).toBe("end");
  });

  it("does not follow a line about someone else", () => {
    const other = msg("5", 10_050, { type: "system_member_add", author_id: "amy", mentions: ["zed"] });
    expect(noticeSpot(["5"], byId([other]), notice, "me", present)).toBe("end");
  });

  it("goes first in a group that began with the add", () => {
    const list = [msg("7", 12_000), msg("8", 13_000)];
    expect(noticeSpot(list.map((m) => m.id), byId(list), notice, "me", { hasOlder: false, hasNewer: false })).toBe("start");
    expect(noticeSpot([], {}, notice, "me", { hasOlder: false, hasNewer: false })).toBe("start");
  });

  it("waits at the end when the line is not loaded, and nowhere short of the present", () => {
    const list = [msg("7", 12_000)];
    expect(noticeSpot(list.map((m) => m.id), byId(list), notice, "me", present)).toBe("end");
    expect(noticeSpot(list.map((m) => m.id), byId(list), notice, "me", { hasOlder: true, hasNewer: true })).toBeNull();
  });
});
