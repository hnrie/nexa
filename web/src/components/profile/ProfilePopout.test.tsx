// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servers as serversApi } from "@/api/servers";
import type { Member, PublicUser, Role, Server } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { closeProfilePopout, openProfilePopout, useProfilePopout } from "@/stores/profilePopout";
import { useServers, type ServerState } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { ProfileCard } from "./ProfileCard";

const person = (id: string, name: string) => ({ id, username: name.toLowerCase(), display_name: name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, public_key: null, created_at: 0, flags: 0, server_tag: null }) as unknown as PublicUser;
const role = (id: string, name: string, position: number, permissions = 0n): Role => ({ id, server_id: "s1", name, color: 0x2ec4b6, hoist: false, mentionable: false, position, permissions: permissions.toString(), icon_id: null, created_at: 0 });
const member = (userId: string, roleIds: string[]): Member => ({ server_id: "s1", user_id: userId, nickname: "", avatar_id: null, joined_at: 0, timeout_until: null, flags: 0, role_ids: roleIds });

/** A server where Bob has Night Owls; `canManage` says whether this account may manage roles. */
function seed(canManage: boolean) {
  const me = member("me", canManage ? ["mod"] : []);
  const st: ServerState = {
    server: { id: "s1", name: "Game Night", owner_id: "owner" } as Server,
    roles: { s1: role("s1", "@everyone", 0), owls: role("owls", "Night Owls", 1), raid: role("raid", "Raid Lead", 2), mod: role("mod", "Mods", 5, P.MANAGE_ROLES) },
    members: { me, bob: member("bob", ["owls"]) },
    memberCount: 3,
    me,
    myPermissions: canManage ? P.MANAGE_ROLES : 0n,
    membersComplete: true,
  };
  useServers.setState({ byId: { s1: st } });
}

function renderPopout() {
  return render(
    <MemoryRouter>
      <ProfileCard userId="bob" variant="popout" serverId="s1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ me: { ...person("me", "Alice") } as never });
  useUsers.setState({ byId: { bob: person("bob", "Bob"), me: person("me", "Alice") } });
  vi.spyOn(usersApi, "profile").mockResolvedValue({ user: person("bob", "Bob"), mutual_friends: [], mutual_servers: [], widgets: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useServers.setState({ byId: {} });
  closeProfilePopout();
});

describe("the profile popout's roles", () => {
  it("lets someone who may manage roles take one off with its x and give another with the +", async () => {
    seed(true);
    const removed = vi.spyOn(serversApi, "removeRole").mockResolvedValue(member("bob", []));
    const added = vi.spyOn(serversApi, "addRole").mockResolvedValue(member("bob", ["owls", "raid"]));
    renderPopout();
    const roles = await screen.findByTestId("profile-roles");
    expect(roles.textContent).toContain("Night Owls");
    // their own role and the ones above it cannot be given from here
    fireEvent.click(screen.getByTestId("role-add"));
    const menu = useUI.getState().contextMenu;
    expect(menu?.items.map((i) => i.label)).toEqual(["Raid Lead"]);
    act(() => menu!.items[0]!.onSelect!());
    expect(added).toHaveBeenCalledWith("s1", "bob", "raid");
    await waitFor(() => expect(roles.textContent).toContain("Raid Lead"));
    const x = screen.getByRole("button", { name: "Remove Night Owls" });
    await waitFor(() => expect((x as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(x);
    expect(removed).toHaveBeenCalledWith("s1", "bob", "owls");
    await waitFor(() => expect(roles.textContent).not.toContain("Night Owls"));
  });

  it("shows the roles without either to someone who may not", async () => {
    seed(false);
    renderPopout();
    const roles = await screen.findByTestId("profile-roles");
    expect(roles.textContent).toContain("Night Owls");
    expect(screen.queryByTestId("role-remove")).toBeNull();
    expect(screen.queryByTestId("role-add")).toBeNull();
  });

  it("offers a message to them", async () => {
    seed(false);
    renderPopout();
    await waitFor(() => expect(screen.getByTestId("popout-message").getAttribute("placeholder")).toBe("Message @Bob"));
  });
});

describe("opening a popout", () => {
  it("opens beside what was pressed, and the same press again closes it", () => {
    const name = document.createElement("button");
    openProfilePopout("bob", name, "s1");
    expect(useProfilePopout.getState().open).toEqual({ userId: "bob", anchor: name, serverId: "s1" });
    openProfilePopout("bob", name, "s1");
    expect(useProfilePopout.getState().open).toBeNull();
  });
});
