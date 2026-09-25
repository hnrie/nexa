import type { Channel, ServerView } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { checkRecipients, membershipOf } from "./convMembers";

const channel = (id: string, type: Channel["type"], extra: Partial<Channel> = {}): Channel =>
  ({ id, type, server_id: null, name: id, position: 0, parent_id: null, recipient_ids: [], last_message_id: null, key_conv_id: id, ...extra }) as unknown as Channel;

function server(id: string, members: string[], complete: boolean): void {
  const member = (user_id: string) => ({ server_id: id, user_id, role_ids: [], nickname: "", joined_at: 0 });
  const view = {
    id,
    name: id,
    owner_id: members[0] ?? "",
    icon_id: null,
    channels: [],
    roles: [],
    members: members.map(member),
    member_count: complete ? members.length : members.length + 500,
    me: member("me"),
    my_permissions: "0",
  } as unknown as ServerView;
  useServers.getState().setFromView(view);
}

beforeEach(() => {
  useChannels.getState().clear();
  useServers.getState().clear();
});

describe("who a conversation's key may be sealed for, by kind of conversation", () => {
  it("a DM: its two people and nobody else", () => {
    useChannels.getState().upsert(channel("dm1", "dm", { recipient_ids: ["me", "friend"] }));
    expect(checkRecipients("dm1", ["friend", "stranger"])).toEqual({ allowed: ["friend"], outsiders: ["stranger"], checked: true });
  });

  it("a group DM: its members and nobody else", () => {
    useChannels.getState().upsert(channel("g1", "group_dm", { recipient_ids: ["me", "a", "b"] }));
    expect(checkRecipients("g1", ["a", "b", "stranger"])).toEqual({ allowed: ["a", "b"], outsiders: ["stranger"], checked: true });
  });

  it("a subchat: its own people, checked like any group, not waved through", () => {
    useChannels.getState().upsert(channel("g1", "group_dm", { recipient_ids: ["me", "a", "b"] }));
    useChannels.getState().upsert(channel("sub1", "subchat", { parent_id: "g1", recipient_ids: ["me", "a", "b"] }));
    const m = membershipOf("sub1");
    expect(m).toEqual({ known: true, complete: true, members: new Set(["me", "a", "b"]) });
    expect(checkRecipients("sub1", ["a", "attacker"])).toEqual({ allowed: ["a"], outsiders: ["attacker"], checked: true });
  });

  it("a server whose members are all loaded: checked against them", () => {
    server("s1", ["me", "a"], true);
    expect(checkRecipients("s1", ["a", "stranger"])).toEqual({ allowed: ["a"], outsiders: ["stranger"], checked: true });
  });

  it("a private channel with its own keys: checked against its server's members", () => {
    server("s1", ["me", "a"], true);
    useChannels.getState().upsert(channel("priv", "text", { server_id: "s1" }));
    expect(checkRecipients("priv", ["a", "stranger"])).toEqual({ allowed: ["a"], outsiders: ["stranger"], checked: true });
  });

  it("a large server still loading its members: allowed as asked, and said to be unchecked", () => {
    server("big", ["me", "a"], false);
    expect(checkRecipients("big", ["a", "not-loaded-yet"])).toEqual({ allowed: ["a", "not-loaded-yet"], outsiders: [], checked: false });
  });

  it("a conversation this device knows nothing of: unchecked", () => {
    expect(membershipOf("nowhere")).toEqual({ known: false });
    expect(checkRecipients("nowhere", ["x"])).toEqual({ allowed: ["x"], outsiders: [], checked: false });
  });

  it("covers every kind of channel that carries its own key", () => {
    // the kinds a key conversation can be; a new one must be added above and in membershipOf
    for (const type of ["dm", "group_dm", "subchat"] as const) {
      useChannels.getState().upsert(channel(`k-${type}`, type, { recipient_ids: ["me"] }));
      expect(membershipOf(`k-${type}`)).toMatchObject({ known: true, complete: true });
    }
  });
});
