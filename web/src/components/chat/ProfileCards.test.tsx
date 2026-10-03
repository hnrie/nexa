// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { useSharedProfiles } from "@/lib/profileLinks";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { ProfileCards } from "./ProfileCards";

const person = (id: string, name: string) => ({ id, username: name.toLowerCase(), display_name: name, avatar_id: null, banner_id: null, about_me: "Here for the music.", pronouns: "", accent_color: null, accent_color_2: null, public_key: null, created_at: 0, flags: 0, server_tag: null }) as unknown as PublicUser;
const linkTo = (username: string) => [{ type: "profile", url: `https://nexa.fish/@${username}`, username }] as never;

/** Lets the card's own request for the whole profile answer, inside act. */
const settle = () => act(async () => {});

function show(username: string) {
  return render(
    <MemoryRouter>
      <ProfileCards nodes={null} embeds={linkTo(username)} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ me: person("me", "Alice") as never });
  // what the link says of Bob is already here; the app may not know him yet
  useSharedProfiles.setState({ byName: { bob: { status: "ready", user: person("bob", "Bob"), at: Date.now() } } });
  vi.spyOn(usersApi, "profile").mockResolvedValue({ user: person("bob", "Bob"), mutual_friends: [], mutual_servers: [], widgets: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUsers.setState({ byId: {} });
  useSharedProfiles.setState({ byName: {} });
});

describe("a profile link in a message", () => {
  it("is drawn as the popout a name opens, laid in the chat", async () => {
    useUsers.setState({ byId: { me: person("me", "Alice"), bob: person("bob", "Bob") } });
    show("bob");
    const card = screen.getByTestId("profile-popout-card");
    expect(card.getAttribute("data-embedded")).toBe("true");
    expect(screen.getByText("Here for the music.")).toBeTruthy();
    // the box that messages them, as the popout has
    expect(screen.getByPlaceholderText("Message @Bob")).toBeTruthy();
    await settle();
  });

  it("holds the popout's shape until the app has the whole of them", async () => {
    useUsers.setState({ byId: { me: person("me", "Alice") } });
    const fetched = vi.spyOn(usersApi, "get").mockResolvedValue(person("bob", "Bob"));
    show("bob");
    expect(screen.getByTestId("profile-card").getAttribute("data-profile-state")).toBe("loading");
    expect(fetched).toHaveBeenCalledWith("bob");
    await waitFor(() => expect(screen.getByTestId("profile-popout-card")).toBeTruthy());
    await settle();
  });

  it("has no box to message yourself", async () => {
    useSharedProfiles.setState({ byName: { alice: { status: "ready", user: person("me", "Alice"), at: Date.now() } } });
    useUsers.setState({ byId: { me: person("me", "Alice") } });
    show("alice");
    expect(screen.getByTestId("profile-popout-card")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/^Message @/)).toBeNull();
    await settle();
  });
});
