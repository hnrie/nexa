import type { Channel, PublicUser } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUsers } from "@/stores/users";
import { groupMemberMenuItems } from "./groupMemberMenu";

const ADMIN = 1;
const group = { id: "g", type: "group_dm", parent_id: null, owner_id: "owner", name: "Crew", recipient_ids: ["owner", "me", "bob"] } as unknown as Channel;

function signIn(flags = 0): void {
  useAuth.setState({ me: { id: "me", display_name: "Me", flags } as never });
}

function ids(userId: string): string[] {
  return groupMemberMenuItems("g", userId, { nav: vi.fn(), openModal: vi.fn() }).map((i) => i.id);
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
    expect(ids("bob")).toEqual(["profile", "mention", "message", "add-friend", "block"]);
    expect(ids("owner")).toEqual(["profile", "mention", "message", "add-friend", "block"]);
    expect(ids("me")).toEqual(["profile", "mention", "leave"]);
  });

  it("lets the owner hand the group on and remove people", () => {
    useChannels.setState({ byId: { g: { ...group, owner_id: "me" } } });
    signIn();
    expect(ids("bob")).toEqual(["profile", "mention", "message", "add-friend", "block", "owner", "remove"]);
    // leaving is still how the owner goes
    expect(ids("me")).toEqual(["profile", "mention", "leave"]);
  });

  it("gives an instance admin the owner's actions, short of removing the owner", () => {
    signIn(ADMIN);
    expect(ids("bob")).toEqual(["profile", "mention", "message", "add-friend", "block", "owner", "remove"]);
    expect(ids("owner")).toEqual(["profile", "mention", "message", "add-friend", "block"]);
    const mine = groupMemberMenuItems("g", "me", { nav: vi.fn(), openModal: vi.fn() });
    expect(mine.find((i) => i.id === "owner")?.label).toBe("Take Ownership");
  });

  it("asks before removing anyone", () => {
    signIn(ADMIN);
    const openModal = vi.fn();
    groupMemberMenuItems("g", "bob", { nav: vi.fn(), openModal }).find((i) => i.id === "remove")!.onSelect!();
    expect(openModal).toHaveBeenCalledWith("confirm", expect.objectContaining({ title: "Remove Bob", danger: true }));
  });
});
