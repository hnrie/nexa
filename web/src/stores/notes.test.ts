// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteInviteRow, NoteRow } from "@/api/types";
import { generateIdentity } from "@/crypto/keys";
import { newNoteKey, sealNote, sealNoteKey } from "@/crypto/notes";
import { heldNoteKey } from "@/lib/notes/keys";

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("@/api/notes", () => ({ notes: api }));
const rekey = vi.hoisted(() => ({ rekeyNote: vi.fn(async () => "done"), forgetRekeys: vi.fn() }));
vi.mock("@/lib/notes/rekey", () => rekey);

import { useKeys } from "./keys";
import { HERE_TTL, peopleHere, sortedNotes, useNotes, watchNote } from "./notes";

const me = generateIdentity();

async function row(id: string, title: string, over: Partial<NoteRow> = {}, key = newNoteKey()): Promise<{ row: NoteRow; key: Uint8Array }> {
  return {
    key,
    row: {
      id,
      owner_id: "9",
      head: await sealNote(key, "head", { title, preview: `${title} text`, files: {} }),
      version: 1,
      edited_by: "9",
      created_at: 1,
      updated_at: Number(id),
      role: 3,
      key_sealed: await sealNoteKey(me.publicKey, key),
      key_epoch: 0,
      members: 1,
      ...over,
    },
  };
}

beforeEach(() => {
  useKeys.setState({ identity: me });
  api.list.mockReset();
  api.get.mockReset();
  rekey.rekeyNote.mockClear();
});
afterEach(() => {
  useNotes.getState().clear();
});

describe("the notes store", () => {
  it("opens each note's title with its own key, keeping the key in memory only", async () => {
    const a = await row("100", "Groceries");
    const b = await row("200", "Raid Night");
    api.list.mockResolvedValue({ notes: [a.row, b.row], invites: [] });
    await useNotes.getState().load();
    const st = useNotes.getState();
    expect(st.status).toBe("ready");
    expect(sortedNotes(st.notes).map((n) => n.head?.title)).toEqual(["Raid Night", "Groceries"]);
    expect(heldNoteKey("100")?.key).toEqual(a.key);
    // nothing of a key in the store's state, where a snapshot of it would carry it
    expect(JSON.stringify(st)).not.toContain("key_sealed");
  });

  it("lists a note it cannot open, as one it cannot open", async () => {
    const a = await row("100", "Mine");
    const other = await row("200", "Not sealed to me", { key_sealed: await sealNoteKey(generateIdentity().publicKey, newNoteKey()) });
    api.list.mockResolvedValue({ notes: [a.row, other.row], invites: [] });
    await useNotes.getState().load();
    expect(useNotes.getState().notes["200"]?.head).toBeNull();
    expect(useNotes.getState().notes["100"]?.head?.title).toBe("Mine");
  });

  it("follows a save made elsewhere: the new title, version and time", async () => {
    const a = await row("100", "Draft");
    api.list.mockResolvedValue({ notes: [a.row], invites: [] });
    await useNotes.getState().load();
    const seen: unknown[] = [];
    const stop = watchNote("100", { update: (d) => seen.push(d) });
    useNotes.getState().updated({ id: "100", version: 2, head: await sealNote(a.key, "head", { title: "Final", preview: "", files: {} }), updated_at: 500, edited_by: "7" });
    await vi.waitFor(() => expect(useNotes.getState().notes["100"]?.head?.title).toBe("Final"));
    expect(useNotes.getState().notes["100"]).toMatchObject({ version: 2, updatedAt: 500, editedBy: "7" });
    // the page with it open hears of it too
    expect(seen).toHaveLength(1);
    stop();
    // an older save arriving late changes nothing
    useNotes.getState().updated({ id: "100", version: 1, head: await sealNote(a.key, "head", { title: "Stale", preview: "", files: {} }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(useNotes.getState().notes["100"]?.head?.title).toBe("Final");
  });

  it("loads the list again for a note it does not know, and asks again after the sharing changed", async () => {
    const a = await row("100", "Shared");
    api.list.mockResolvedValue({ notes: [a.row], invites: [] });
    await useNotes.getState().load();
    api.list.mockClear();
    useNotes.getState().updated({ id: "999", members: true });
    expect(api.list).toHaveBeenCalledTimes(1);
    api.get.mockResolvedValue({ ...a.row, members: 3 });
    useNotes.getState().updated({ id: "100", members: true });
    await vi.waitFor(() => expect(useNotes.getState().notes["100"]?.members).toBe(3));
    expect(useNotes.getState().sharing["100"]).toBe(1);
  });

  it("gives a note it owns a new key when someone holding the key has left", async () => {
    const a = await row("100", "Owned");
    api.list.mockResolvedValue({ notes: [a.row], invites: [] });
    await useNotes.getState().load();
    api.get.mockResolvedValue({ ...a.row, needs_rekey: true });
    useNotes.getState().updated({ id: "100", members: true, removed: true });
    await vi.waitFor(() => expect(rekey.rekeyNote).toHaveBeenCalledWith("100"));
  });

  it("knows who is in a note right now, and forgets whoever stops saying so", () => {
    useNotes.getState().present({ id: "100", user_id: "7", here: true, hello: true });
    useNotes.getState().present({ id: "100", user_id: "8", here: true, hello: false });
    expect(peopleHere(useNotes.getState().here["100"])).toEqual(["7", "8"]);
    useNotes.getState().present({ id: "100", user_id: "8", here: false, hello: false });
    expect(peopleHere(useNotes.getState().here["100"])).toEqual(["7"]);
    expect(peopleHere(useNotes.getState().here["100"], Date.now() + HERE_TTL + 1)).toEqual([]);
  });

  it("passes cursors to the page with the note open, and keeps none", () => {
    const got: string[] = [];
    const stop = watchNote("100", { cursor: (d) => got.push(d.data) });
    useNotes.getState().cursor({ id: "100", user_id: "7", data: "v1.a.b" });
    useNotes.getState().cursor({ id: "200", user_id: "7", data: "v1.c.d" });
    stop();
    useNotes.getState().cursor({ id: "100", user_id: "7", data: "v1.e.f" });
    expect(got).toEqual(["v1.a.b"]);
  });

  it("takes a note off the list when it is gone, telling the page with it open", async () => {
    const a = await row("100", "Going");
    api.list.mockResolvedValue({ notes: [a.row], invites: [] });
    await useNotes.getState().load();
    let gone = 0;
    watchNote("100", { gone: () => (gone += 1) });
    useNotes.getState().drop("100");
    expect(useNotes.getState().notes["100"]).toBeUndefined();
    expect(heldNoteKey("100")).toBeNull();
    expect(gone).toBe(1);
  });

  it("opens an invitation's title with the key it carries", async () => {
    const key = newNoteKey();
    const inv: NoteInviteRow = { id: "5", note_id: "500", role: 2, key_sealed: await sealNoteKey(me.publicKey, key), head: await sealNote(key, "head", { title: "Lore", preview: "", files: {} }), created_at: 1, from: { id: "7", username: "ann", display_name: "Ann", avatar_id: null } as never };
    useNotes.getState().invited(inv);
    await vi.waitFor(() => expect(useNotes.getState().invites[0]?.head?.title).toBe("Lore"));
    useNotes.getState().dropInvite("5");
    expect(useNotes.getState().invites).toEqual([]);
  });

  it("forgets everything, keys included, when the session ends", async () => {
    const a = await row("100", "Private");
    api.list.mockResolvedValue({ notes: [a.row], invites: [] });
    await useNotes.getState().load();
    useNotes.getState().clear();
    expect(useNotes.getState()).toMatchObject({ status: "idle", notes: {}, invites: [], here: {} });
    expect(heldNoteKey("100")).toBeNull();
  });
});
