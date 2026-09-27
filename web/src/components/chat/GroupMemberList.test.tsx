// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Channel, PublicUser } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { GroupMemberList } from "./GroupMemberList";

const group = { id: "g", type: "group_dm", parent_id: null, owner_id: "me", name: "Crew", recipient_ids: ["me", "bob"] } as unknown as Channel;

function row(id: string): HTMLElement {
  return document.querySelector(`[data-testid=group-member-list] [data-user="${id}"]`) as HTMLElement;
}

beforeEach(() => {
  useAuth.setState({ me: { id: "me", display_name: "Me", flags: 0 } as never });
  useChannels.setState({ byId: { g: group } });
  useRelationships.setState({ byUser: {} });
  useUsers.setState({ byId: { bob: { id: "bob", username: "bob", display_name: "Bob", flags: 0 } as PublicUser } });
  useUI.setState({ contextMenu: null });
  render(
    <MemoryRouter>
      <GroupMemberList channel={group} drawer={false} open />
    </MemoryRouter>,
  );
});
afterEach(cleanup);

describe("GroupMemberList", () => {
  it("gives the owner a right-click menu on a member with handing the group on and removing them, named for them", () => {
    fireEvent.contextMenu(row("bob"), { clientX: 120, clientY: 80 });
    const menu = useUI.getState().contextMenu!;
    expect([menu.x, menu.y, menu.label]).toEqual([120, 80, "Bob"]);
    expect(menu.items.map((i) => i.id)).toEqual(expect.arrayContaining(["profile", "message", "owner", "remove"]));
    expect(screen.getByLabelText("Group Owner")).toBeTruthy();
  });

  it("opens the menu by the row when the keyboard asks for it, which has no pointer", () => {
    row("bob").getBoundingClientRect = () => ({ left: 900, right: 1140, top: 200, bottom: 244, width: 240, height: 44, x: 900, y: 200, toJSON: () => ({}) });
    fireEvent.contextMenu(row("bob"), { clientX: 0, clientY: 0 });
    const menu = useUI.getState().contextMenu!;
    expect([menu.x, menu.y]).toEqual([908, 244]);
  });
});
