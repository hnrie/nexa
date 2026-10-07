import type { Channel, PublicUser } from "@/api/types";

const api = vi.hoisted(() => ({ patch: vi.fn(), removeRecipient: vi.fn() }));
vi.mock("@/api/channels", () => ({ channels: { patch: api.patch, removeRecipient: api.removeRecipient } }));

import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUsers } from "@/stores/users";
import { groupMemberMenu } from "./groupMemberMenu";

const ADMIN = 1;
const group = { id: "g", type: "group_dm", parent_id: null, owner_id: "owner", name: "Crew", recipient_ids: ["owner", "me", "bob"] } as unknown as Channel;

function signIn(flags = 0): void {
  useAuth.setState({ me: { id: "me", display_name: "Me", flags } as never });
}

function ids(userId: string): string[] {
  return groupMemberMenu.items({ channelId: "g", userId: userId, nav: vi.fn(), openModal: vi.fn() }).map((i) => i.id);
}

describe("groupMemberMenuItems", () => {
  beforeEach(() => {
    useChannels.setState({ byId: { g: group } });
    useRelationships.setState({ byUser: {} });
    useUsers.setState({
      byId: {
        owner: { id: "owner", username: "olive", display_name: "Olive", flags: 0 } as PublicUser,
        bob: { id: "bob", username: "bob", display_name: "Bob", flags: 0 } as PublicUser,
      },
    });
  });

  it("gives a member the profile, a mention, a message and the friend and block choices, and nothing over others", () => {
    signIn();
    expect(ids("bob")).toEqual(["profile", "copy-profile-link", "mention", "message", "add-friend", "block"]);
    expect(ids("owner")).toEqual(["profile", "copy-profile-link", "mention", "message", "add-friend", "block"]);
    expect(ids("me")).toEqual(["profile", "mention", "leave"]);
  });

  it("lets the owner hand the group on and remove people", () => {
    useChannels.setState({ byId: { g: { ...group, owner_id: "me" } } });
    signIn();
    expect(ids("bob")).toEqual(["profile", "copy-profile-link", "mention", "message", "add-friend", "block", "owner", "remove"]);
    // leaving is still how the owner goes
    expect(ids("me")).toEqual(["profile", "mention", "leave"]);
  });

  it("gives a Nexa admin the owner's actions, short of removing the owner", () => {
    signIn(ADMIN);
    expect(ids("bob")).toEqual(["profile", "copy-profile-link", "mention", "message", "add-friend", "block", "owner", "remove"]);
    expect(ids("owner")).toEqual(["profile", "copy-profile-link", "mention", "message", "add-friend", "block"]);
    const mine = groupMemberMenu.items({ channelId: "g", userId: "me", nav: vi.fn(), openModal: vi.fn() });
    expect(mine.find((i) => i.id === "owner")?.label).toBe("Take Ownership");
  });

  it("asks before removing anyone", () => {
    signIn(ADMIN);
    const openModal = vi.fn();
    groupMemberMenu.items({ channelId: "g", userId: "bob", nav: vi.fn(), openModal }).find((i) => i.id === "remove")!.onSelect!();
    expect(openModal).toHaveBeenCalledWith("confirm", expect.objectContaining({ title: "Remove Bob?", danger: true }));
  });

  it("asks the owner before handing the group on, naming who gets it, and makes them the owner", async () => {
    useChannels.setState({ byId: { g: { ...group, owner_id: "me" } } });
    signIn();
    const openModal = vi.fn();
    const items = groupMemberMenu.items({ channelId: "g", userId: "bob", nav: vi.fn(), openModal });
    const owner = items.find((i) => i.id === "owner")!;
    expect(owner.label).toBe("Transfer Ownership");
    expect(owner.danger).toBeFalsy();
    owner.onSelect!();
    const [kind, props] = openModal.mock.calls[0]! as [string, { title: string; body: string; confirmLabel: string; onConfirm: () => Promise<unknown> }];
    expect(kind).toBe("confirm");
    expect(props.title).toBe("Transfer Ownership of “Crew”?");
    expect(props.body).toBe("Bob becomes the group's owner, able to remove people and delete the group, and you become a member like everyone else.");
    expect(props.confirmLabel).toBe("Transfer Ownership");
    await props.onConfirm();
    expect(api.patch).toHaveBeenCalledWith("g", { owner_id: "bob" });
  });

  it("puts Remove from Group last among the owner's choices, as a danger, and removes once confirmed", async () => {
    useChannels.setState({ byId: { g: { ...group, owner_id: "me" } } });
    signIn();
    const openModal = vi.fn();
    const items = groupMemberMenu.items({ channelId: "g", userId: "bob", nav: vi.fn(), openModal });
    const remove = items[items.length - 1]!;
    expect([remove.id, remove.label, remove.danger]).toEqual(["remove", "Remove from Group", true]);
    remove.onSelect!();
    const props = openModal.mock.calls[0]![1] as { title: string; body: string; danger: boolean; onConfirm: () => Promise<unknown> };
    expect(props.title).toBe("Remove Bob?");
    expect(props.body).toBe("Bob will be removed from “Crew” and stop getting its messages. They'll need a new invite to come back.");
    await props.onConfirm();
    expect(api.removeRecipient).toHaveBeenCalledWith("g", "bob");
  });
});
