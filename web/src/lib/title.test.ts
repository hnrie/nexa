import type { Relationship } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { pendingFriendRequests, unreadTotal } from "./title";
import { homeLabel } from "@/components/rail/Rail";

const rel = (id: string, type: Relationship["type"]): Relationship => ({ user: { id } as Relationship["user"], type, nickname: "", created_at: 0 });

describe("what is waiting", () => {
  beforeEach(() => {
    useChannels.setState({ byId: {} });
    useReadStates.setState({ byChannel: {} });
  });

  it("counts friend requests to answer, not the ones sent or friends", () => {
    useRelationships.getState().setMany([rel("1", "incoming"), rel("2", "incoming"), rel("3", "outgoing"), rel("4", "friend"), rel("5", "blocked")]);
    expect(pendingFriendRequests()).toBe(2);
    expect(unreadTotal()).toBe(2);
  });

  it("reads Home's badge out", () => {
    expect(homeLabel(3, 1)).toBe("3 unread messages and 1 friend request");
    expect(homeLabel(1, 0)).toBe("1 unread message");
    expect(homeLabel(0, 2)).toBe("2 friend requests");
  });
});
