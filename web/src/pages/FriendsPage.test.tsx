// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeUser, Relationship } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import FriendsPage, { sortRelationships } from "./FriendsPage";

const rel = (id: string, name: string, type: Relationship["type"] = "friend", username = name.toLowerCase()): Relationship =>
  ({ user: { id, username, display_name: name, avatar_id: null }, type, nickname: "", created_at: Number(id) }) as unknown as Relationship;

describe("sortRelationships", () => {
  const list = [rel("1", "Zoë"), rel("2", "adam"), rel("3", "Émile"), rel("4", "Bob")];
  it("lists people by name in the reader's language, not by when they became friends", () => {
    expect(sortRelationships(list, "all", () => "offline", "en").map((r) => r.user.display_name)).toEqual(["adam", "Bob", "Émile", "Zoë"]);
  });
  it("puts the most reachable first on the Online tab", () => {
    const status: Record<string, string> = { "1": "online", "2": "dnd", "3": "idle", "4": "online" };
    expect(sortRelationships(list, "online", (id) => status[id]!, "en").map((r) => r.user.display_name)).toEqual(["Bob", "Zoë", "Émile", "adam"]);
  });
  it("puts requests to answer before requests sent", () => {
    const pending = [rel("1", "Ann", "outgoing"), rel("2", "Zed", "incoming")];
    expect(sortRelationships(pending, "pending", () => "offline", "en").map((r) => r.type)).toEqual(["incoming", "outgoing"]);
  });
});

describe("FriendsPage for a new account", () => {
  beforeEach(() => {
    useAuth.setState({ me: { id: "9", username: "newbie", display_name: "Newbie" } as unknown as MeUser });
    useRelationships.setState({ byUser: {} });
  });
  afterEach(cleanup);

  it("says what to do first instead of that nobody is online", () => {
    render(<MemoryRouter><FriendsPage /></MemoryRouter>);
    expect(screen.getByTestId("friends-first-run")).toBeTruthy();
    expect(screen.getByText(/@newbie/)).toBeTruthy();
    // its Add friend goes straight to the form
    fireEvent.click(screen.getAllByRole("button", { name: /add friend/i }).find((b) => b.closest("[data-testid=friends-first-run]"))!);
    expect(screen.getByRole("textbox", { name: /username/i })).toBeTruthy();
  });
});

describe("a row in the friends list", () => {
  beforeEach(() => {
    useAuth.setState({ me: { id: "9", username: "me", display_name: "Me" } as unknown as MeUser });
    useRelationships.setState({ byUser: { "2": rel("2", "Bob"), "3": rel("3", "Cy", "incoming") } });
    useUI.setState({ modals: [], modal: null, contextMenu: null });
  });
  afterEach(cleanup);

  it("opens the person's full profile, and its buttons keep their own jobs", () => {
    render(<MemoryRouter><FriendsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    const row = screen.getByTestId("friend-row");
    // a real button, so Enter and Space open it too
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(useUI.getState().modals.map((m) => [m.kind, m.props])).toEqual([["profile", { userId: "2" }]]);
    useUI.setState({ modals: [], modal: null });
    fireEvent.click(screen.getByTestId("friend-more"));
    expect(useUI.getState().modals).toEqual([]);
    expect(useUI.getState().contextMenu?.items.map((i) => i.id)).toContain("block");
    // nothing interactive inside anything interactive
    expect(document.querySelectorAll("button button, button a, a button").length).toBe(0);
  });

  it("offers Accept and Ignore for a request, and opens the profile from the rest of the row", () => {
    render(<MemoryRouter><FriendsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: /Pending/ }));
    expect(screen.getByTestId("friend-accept").getAttribute("aria-label")).toBe("Accept friend request");
    expect(screen.getByTestId("friend-ignore").getAttribute("aria-label")).toBe("Ignore friend request");
    expect(screen.getByText("Sent you a friend request")).toBeTruthy();
    fireEvent.click(screen.getByTestId("friend-row"));
    expect(useUI.getState().modals.map((m) => m.kind)).toEqual(["profile"]);
  });
});
