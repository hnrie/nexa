// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Channel, Invite, Relationship } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { CreateDMModal } from "./CreateDMModal";

const addRecipient = vi.fn<(id: string, uid: string) => Promise<Channel>>();
const createDM = vi.fn<(ids: string[], name?: string) => Promise<Channel>>();
const createGroupInvite = vi.fn<(id: string, body: { max_age: number; max_uses: number }) => Promise<Invite>>();
const sendMessage = vi.hoisted(() => vi.fn<(channelId: string, text: string) => Promise<void>>());
vi.mock("@/api/channels", () => ({
  channels: {
    addRecipient: (id: string, uid: string) => addRecipient(id, uid),
    createDM: (ids: string[], name?: string) => createDM(ids, name),
    createGroupInvite: (id: string, body: { max_age: number; max_uses: number }) => createGroupInvite(id, body),
  },
}));
vi.mock("@/components/composer/send", () => ({ sendMessage: (channelId: string, text: string) => sendMessage(channelId, text) }));

function friend(id: string, name: string): Relationship {
  return { type: "friend", nickname: "", created_at: 0, user: { id, username: name, display_name: name, avatar_id: null } as Relationship["user"] };
}

const group = { id: "g1", type: "group_dm", name: "", recipient_ids: ["me"] } as unknown as Channel;

afterEach(() => {
  cleanup();
  useUI.setState({ toasts: [] });
  addRecipient.mockReset();
  createDM.mockReset();
  createGroupInvite.mockReset();
  sendMessage.mockReset();
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

describe("CreateDMModal with nobody picked", () => {
  it("makes a group of one and opens it", async () => {
    useChannels.setState({ byId: {} });
    useRelationships.getState().setMany([friend("a", "alice")]);
    const made = { id: "g9", type: "group_dm", name: "", recipient_ids: ["me"] } as unknown as Channel;
    createDM.mockResolvedValue(made);
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CreateDMModal onClose={onClose} />
      </MemoryRouter>,
    );
    const button = screen.getByTestId("create-dm-submit");
    expect(button.textContent).toBe("Create Group");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createDM).toHaveBeenCalledWith([], undefined);
    expect(useChannels.getState().byId["g9"]).toBeTruthy();
  });

  it("names the button for what picking does", () => {
    useRelationships.getState().setMany([friend("a", "alice"), friend("b", "bob")]);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} />
      </MemoryRouter>,
    );
    const button = () => screen.getByTestId("create-dm-submit").textContent;
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(button()).toBe("Create DM");
    fireEvent.click(boxes[1]!);
    expect(button()).toBe("Create Group");
  });

  it("still needs someone to add to a group that exists", () => {
    useChannels.setState({ byId: { g1: group } });
    useRelationships.getState().setMany([friend("a", "alice")]);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} groupId="g1" />
      </MemoryRouter>,
    );
    expect((screen.getByTestId("create-dm-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("CreateDMModal and friends who join groups only from a link", () => {
  const linkOnly = (id: string, name: string): Relationship => {
    const r = friend(id, name);
    return { ...r, user: { ...r.user, group_link_only: true } };
  };
  const checkbox = (name: string) => screen.queryByRole("checkbox", { name: new RegExp(name) });
  const submit = () => screen.getByTestId("create-dm-submit") as HTMLButtonElement;

  it("offers Send Join Request in place of the checkbox when adding to a group that exists", () => {
    useChannels.setState({ byId: { g1: group } });
    useRelationships.getState().setMany([friend("b", "bea"), linkOnly("c", "cat")]);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} groupId="g1" />
      </MemoryRouter>,
    );
    expect(checkbox("bea")).toBeTruthy();
    expect(checkbox("cat")).toBeNull();
    expect(screen.getByRole("button", { name: "Send Join Request to cat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link Only" })).toBeNull();
  });

  it("sends every join request from it with one link, made on the first with the invite menu's settings", async () => {
    useChannels.setState({ byId: { g1: { ...group, name: "Pals" } } });
    useRelationships.getState().setMany([linkOnly("c", "cat"), linkOnly("d", "dot")]);
    createGroupInvite.mockResolvedValue({ code: "one", server_id: null, channel_id: "g1", inviter_id: "me", max_uses: 0, uses: 0, expires_at: null, created_at: 0 });
    createDM.mockImplementation(async (ids) => ({ id: `dm-${ids[0]}`, type: "dm", name: "", recipient_ids: ["me", ids[0]!] }) as unknown as Channel);
    sendMessage.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} groupId="g1" />
      </MemoryRouter>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send Join Request to cat" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send Join Request to dot" }));
    });
    expect(createGroupInvite.mock.calls).toEqual([["g1", { max_age: 604800, max_uses: 0 }]]);
    const link = `${window.location.origin}/invite/one`;
    expect(sendMessage.mock.calls).toEqual([
      ["dm-c", `Join my group chat “Pals”\n${link}`],
      ["dm-d", `Join my group chat “Pals”\n${link}`],
    ]);
    const row = screen.getByRole("button", { name: "Join Request Sent to cat" }).closest("[data-link-only]") as HTMLElement;
    expect(within(row).getByText("Sent")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Join Request Sent to dot");
  });

  it("lets a Link Only friend be picked alone, for a direct message, but not into a group", () => {
    useRelationships.getState().setMany([friend("b", "bea"), linkOnly("c", "cat")]);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} />
      </MemoryRouter>,
    );
    expect(checkbox("cat")).toBeTruthy();
    fireEvent.click(checkbox("bea")!);
    // with someone else picked, cat would be put in a group
    expect(checkbox("cat")).toBeNull();
    expect(screen.getByRole("button", { name: "Link Only" })).toBeTruthy();
  });

  it("holds a group back while a Link Only friend picked first is in it", () => {
    useRelationships.getState().setMany([friend("b", "bea"), linkOnly("c", "cat")]);
    render(
      <MemoryRouter>
        <CreateDMModal onClose={() => undefined} />
      </MemoryRouter>,
    );
    fireEvent.click(checkbox("cat")!);
    expect(submit().disabled).toBe(false);
    fireEvent.click(checkbox("bea")!);
    expect(screen.getByTestId("link-only-held").textContent).toBe("cat only joins group chats from an invite link. Remove them here and send them a link instead.");
    expect(submit().disabled).toBe(true);
    fireEvent.click(checkbox("cat")!);
    expect(screen.queryByTestId("link-only-held")).toBeNull();
    expect(submit().disabled).toBe(false);
  });
});
