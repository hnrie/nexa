// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeUser } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useNotes, type NoteInviteItem, type NoteItem } from "@/stores/notes";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { NotesList } from "./NotesList";
import { SaveState } from "./NoteParts";

const note = (id: string, title: string, preview: string, over: Partial<NoteItem> = {}): NoteItem => ({
  id,
  ownerId: "9",
  role: 3,
  version: 1,
  createdAt: 1,
  updatedAt: Number(id),
  editedBy: "9",
  members: 1,
  keyEpoch: 0,
  head: { title, preview, files: {} },
  ...over,
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show(selected: string | null = null) {
  return render(
    <MemoryRouter initialEntries={["/channels/@me/notes"]}>
      <Routes>
        <Route path="*" element={<><NotesList selected={selected} onNew={() => undefined} making={false} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the list of notes", () => {
  beforeEach(() => {
    useAuth.setState({ me: { id: "9", username: "me", display_name: "Me" } as unknown as MeUser });
    useUsers.setState({ byId: { "7": { id: "7", username: "ann", display_name: "Ann", avatar_id: null } as never } });
    useUI.setState({ contextMenu: null, modals: [], modal: null });
    useNotes.setState({
      status: "ready",
      invites: [],
      here: { "200": { "7": Date.now() } },
      notes: {
        "100": note("100", "Groceries", "Milk\n![receipt.png](nexa-file:abc)\nBread"),
        "200": note("200", "Raid Night", "Meet at **nine**.", { members: 3 }),
        "300": note("300", "", "", { role: 1, members: 2 }),
      },
    });
  });
  afterEach(() => {
    cleanup();
    useNotes.getState().clear();
  });

  it("lists the note written in last first, each with its first words and not its files' names", () => {
    show();
    const rows = screen.getAllByTestId("note-card");
    expect(rows.map((r) => r.getAttribute("data-note"))).toEqual(["300", "200", "100"]);
    const groceries = rows[2]!;
    expect(groceries.textContent).toContain("Milk Bread");
    expect(groceries.textContent).not.toContain("receipt.png");
    // markdown is read, not shown
    expect(rows[1]!.textContent).toContain("Meet at nine.");
  });

  it("says who is in a note right now, how many have it, and when only reading is allowed", () => {
    show();
    const [untitled, raid] = screen.getAllByTestId("note-card");
    expect(raid!.textContent).toContain("3 people");
    expect(within(raid!).getAllByText("A").length).toBeGreaterThan(0);
    expect(untitled!.textContent).toContain("Untitled Note");
    expect(untitled!.textContent).toContain("View Only");
  });

  it("finds notes by their title and their words", () => {
    show();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Notes" }), { target: { value: "bread" } });
    expect(screen.getAllByTestId("note-card").map((r) => r.getAttribute("data-note"))).toEqual(["100"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Notes" }), { target: { value: "nothing like it" } });
    expect(screen.queryAllByTestId("note-card")).toHaveLength(0);
    expect(screen.getByText(/No notes match/)).toBeTruthy();
  });

  it("opens a note, and marks the one open", () => {
    show("200");
    expect(screen.getAllByTestId("note-card")[1]!.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getAllByTestId("note-card")[2]!);
    expect(screen.getByTestId("where").textContent).toBe("/channels/@me/notes/100");
  });

  it("shows requests to share a note above the notes, with their title and who asks", () => {
    const invite: NoteInviteItem = { id: "5", noteId: "500", role: 2, from: { id: "7", username: "ann", display_name: "Ann", avatar_id: null } as never, createdAt: 1, head: { title: "Lore", preview: "", files: {} } };
    useNotes.setState({ invites: [invite] });
    show();
    const req = screen.getByTestId("note-request");
    expect(req.textContent).toContain("Lore");
    expect(req.textContent).toContain("Ann wants to write a note with you");
    expect(within(req).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(req).getByRole("button", { name: "Decline" })).toBeTruthy();
  });
});

describe("whether a note is saved", () => {
  afterEach(cleanup);
  it("says so in a word, and offers to try again when it is not", () => {
    let tried = 0;
    const { rerender } = render(<SaveState state="saved" error={null} onRetry={() => (tried += 1)} />);
    expect(screen.getByTestId("note-save").textContent).toBe("Saved");
    rerender(<SaveState state="saving" error={null} onRetry={() => (tried += 1)} />);
    expect(screen.getByTestId("note-save").textContent).toBe("Saving");
    rerender(<SaveState state="failed" error={null} onRetry={() => (tried += 1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(tried).toBe(1);
  });
});
