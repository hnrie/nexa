// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeUser, Relationship } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useRelationships } from "@/stores/relationships";
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
