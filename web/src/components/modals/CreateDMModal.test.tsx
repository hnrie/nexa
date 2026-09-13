// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, Relationship } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { CreateDMModal } from "./CreateDMModal";

const addRecipient = vi.fn<(id: string, uid: string) => Promise<Channel>>();
vi.mock("@/api/channels", () => ({ channels: { addRecipient: (id: string, uid: string) => addRecipient(id, uid), createDM: vi.fn() } }));

function friend(id: string, name: string): Relationship {
  return { type: "friend", nickname: "", created_at: 0, user: { id, username: name, display_name: name, avatar_id: null } as Relationship["user"] };
}

const group = { id: "g1", type: "group_dm", name: "", recipient_ids: ["me"] } as unknown as Channel;

afterEach(() => {
  cleanup();
  useUI.setState({ toasts: [] });
  addRecipient.mockReset();
});

describe("CreateDMModal adding to a group", () => {
  it("retries only the friends who were not added after a partial failure", async () => {
    useChannels.setState({ byId: { g1: group } });
    useRelationships.getState().setMany([friend("a", "alice"), friend("b", "bob")]);
    const onClose = vi.fn();
    addRecipient.mockImplementation(async (id, uid) => {
      if (uid === "b" && addRecipient.mock.calls.length === 2) throw new ApiError(500, "internal", "Try again.");
      const cur = useChannels.getState().byId[id]!;
      return { ...cur, recipient_ids: [...cur.recipient_ids, uid] };
    });
    render(
      <MemoryRouter>
        <CreateDMModal onClose={onClose} initial={["a", "b"]} groupId="g1" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Add to Group"));
    await waitFor(() => expect(useUI.getState().toasts.map((t) => t.text)).toEqual(["Try again."]));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Add to Group"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addRecipient.mock.calls.map((c) => c[1])).toEqual(["a", "b", "b"]);
    expect(useChannels.getState().byId["g1"]?.recipient_ids).toEqual(["me", "a", "b"]);
  });
});
