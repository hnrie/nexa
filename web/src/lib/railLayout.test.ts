import { describe, expect, it } from "vitest";
import {
  addToFolder,
  createFolder,
  deleteFolder,
  dropEntry,
  findPlace,
  folderOf,
  isPinned,
  moveEntry,
  newFolderId,
  orderedServerIds,
  pinEntry,
  railServerIds,
  removeFromFolder,
  resolveRail,
  sanitizeRail,
  siblingIds,
  unpinEntry,
  updateFolder,
  type RailLayout,
  type ServerFolder,
} from "./railLayout";

const folder = (id: string, servers: string[], extra: Partial<ServerFolder> = {}): ServerFolder => ({ id, name: "", color: null, servers, ...extra });
/** Folder ids handed out in order, so a test can say which one it expects. */
const ids = (...list: string[]) => {
  let i = 0;
  return () => list[i++] ?? "fzz";
};

describe("the order before folders", () => {
  it("is the chosen order, then join order for servers never placed", () => {
    expect(orderedServerIds(["1", "2", "3", "4"], ["3", "9", "1"])).toEqual(["3", "1", "2", "4"]);
  });

  it("becomes the rail unchanged when there is no layout yet, nothing pinned", () => {
    expect(resolveRail(null, ["1", "2", "3"], ["3", "1"])).toEqual({ pinned: [], rest: ["3", "1", "2"] });
  });
});

describe("resolveRail", () => {
  const layout: RailLayout = { pinned: ["5", folder("fa", ["1", "2"])], rest: ["3", folder("fb", ["4"]), folder("fc", ["8"])] };

  it("shows each joined server once, where it was put", () => {
    const r = resolveRail(layout, ["1", "2", "3", "4", "5"]);
    expect(r.pinned).toEqual(["5", folder("fa", ["1", "2"])]);
    // a folder whose servers have all gone goes too
    expect(r.rest).toEqual(["3", folder("fb", ["4"])]);
  });

  it("forgets servers that were left, and a folder left empty by it", () => {
    const r = resolveRail(layout, ["1", "3", "5"]);
    expect(r).toEqual({ pinned: ["5", folder("fa", ["1"])], rest: ["3"] });
  });

  it("puts servers joined since at the top of the unpinned ones, the newest first, never above a pin", () => {
    const r = resolveRail(layout, ["1", "2", "3", "4", "5", "6", "7"]);
    expect(r.pinned).toEqual(["5", folder("fa", ["1", "2"])]);
    expect(r.rest.slice(0, 3)).toEqual(["7", "6", "3"]);
    expect(railServerIds(r)).toEqual(["5", "1", "2", "7", "6", "3", "4"]);
  });

  it("keeps a server named twice only where it first appears", () => {
    const r = resolveRail({ pinned: ["1"], rest: [folder("fa", ["1", "2"]), "2"] }, ["1", "2"]);
    expect(r).toEqual({ pinned: ["1"], rest: [folder("fa", ["2"])] });
  });
});

describe("sanitizeRail", () => {
  it("reads nothing into what is not a layout", () => {
    expect(sanitizeRail(null)).toBeNull();
    expect(sanitizeRail("rail")).toBeNull();
    expect(sanitizeRail({})).toEqual({ pinned: [], rest: [] });
  });

  it("leaves out what is malformed and keeps the rest", () => {
    const got = sanitizeRail({
      pinned: ["1", 2, "x", { id: "fa", name: "Games", color: "#FFAA00", servers: ["3", "3", 4, "1"], open: true }],
      rest: [{ id: "fa", servers: ["5"] }, { id: "../", servers: ["6"] }, { id: "fb", name: 7, color: "red", servers: "7" }, "8", null],
    });
    expect(got).toEqual({
      pinned: ["1", { id: "fa", name: "Games", color: "#ffaa00", servers: ["3"], open: true }],
      rest: [{ id: "fb", name: "", color: null, servers: [] }, "8"],
    });
  });

  it("cuts a name that is too long", () => {
    const got = sanitizeRail({ pinned: [], rest: [{ id: "fa", name: "x".repeat(300), servers: ["1"] }] });
    expect((got!.rest[0] as ServerFolder).name.length).toBe(40);
  });
});

describe("pinning", () => {
  const base: RailLayout = { pinned: ["1"], rest: ["2", folder("fa", ["3", "4"]), "5"] };

  it("puts what is pinned at the bottom of the pinned ones", () => {
    const r = pinEntry(base, "5");
    expect(r).toEqual({ pinned: ["1", "5"], rest: ["2", folder("fa", ["3", "4"])] });
    expect(isPinned(r, "5")).toBe(true);
  });

  it("pins a folder with its servers", () => {
    const r = pinEntry(base, "fa");
    expect(r.pinned).toEqual(["1", folder("fa", ["3", "4"])]);
    expect(isPinned(r, "fa")).toBe(true);
    // a server in a pinned folder is not pinned itself
    expect(isPinned(r, "3")).toBe(false);
  });

  it("takes a server out of its folder to pin it", () => {
    const r = pinEntry(base, "3");
    expect(r).toEqual({ pinned: ["1", "3"], rest: ["2", folder("fa", ["4"]), "5"] });
  });

  it("unpins to just under the pinned ones", () => {
    expect(unpinEntry(base, "1")).toEqual({ pinned: [], rest: ["1", "2", folder("fa", ["3", "4"]), "5"] });
    // not pinned: nothing to do
    expect(unpinEntry(base, "2")).toBe(base);
  });

  it("keeps what is pinned on top when a server is joined afterwards", () => {
    const pinned = pinEntry(base, "fa");
    const r = resolveRail(pinned, ["1", "2", "3", "4", "5", "9"]);
    expect(railServerIds(r).slice(0, 4)).toEqual(["1", "3", "4", "9"]);
  });
});

describe("dropEntry", () => {
  const base: RailLayout = { pinned: ["1"], rest: ["2", "3", folder("fa", ["4", "5"]), "6"] };

  it("makes a folder of a server dropped on another, where the other was", () => {
    const r = dropEntry(base, "6", { id: "2", where: "combine" }, ids("fnew"));
    expect(r.rest).toEqual([folder("fnew", ["2", "6"]), "3", folder("fa", ["4", "5"])]);
  });

  it("puts a server dropped on a folder at its end", () => {
    expect(dropEntry(base, "2", { id: "fa", where: "combine" }).rest).toEqual(["3", folder("fa", ["4", "5", "2"]), "6"]);
  });

  it("puts a server dropped beside a folder's server into that folder", () => {
    expect(dropEntry(base, "3", { id: "5", where: "before" }).rest).toEqual(["2", folder("fa", ["4", "3", "5"]), "6"]);
  });

  it("takes a server dragged out of a folder out of it", () => {
    expect(dropEntry(base, "4", { id: "6", where: "after" }).rest).toEqual(["2", "3", folder("fa", ["5"]), "6", "4"]);
  });

  it("removes the folder its last server was dragged out of", () => {
    const one: RailLayout = { pinned: [], rest: ["2", folder("fa", ["4"])] };
    expect(dropEntry(one, "4", { id: "2", where: "before" })).toEqual({ pinned: [], rest: ["4", "2"] });
    // dropped on its own folder, there is nowhere else for it to go
    expect(dropEntry(one, "4", { id: "fa", where: "combine" })).toBe(one);
  });

  it("does not put a folder in a folder: among another folder's servers, it goes beside it", () => {
    const two: RailLayout = { pinned: [], rest: [folder("fb", ["7"]), "2", folder("fa", ["4", "5"])] };
    expect(dropEntry(two, "fb", { id: "5", where: "combine" }).rest).toEqual(["2", folder("fa", ["4", "5"]), folder("fb", ["7"])]);
    expect(dropEntry(two, "fb", { id: "4", where: "before" }).rest).toEqual(["2", folder("fb", ["7"]), folder("fa", ["4", "5"])]);
    // and on a server's middle, beside it rather than into a new folder
    expect(dropEntry(two, "fb", { id: "2", where: "combine" }).rest).toEqual(["2", folder("fb", ["7"]), folder("fa", ["4", "5"])]);
  });

  it("pins what is dropped among the pinned ones, and unpins what is dropped below them", () => {
    const r = dropEntry(base, "fa", { id: "1", where: "after" });
    expect(r.pinned).toEqual(["1", folder("fa", ["4", "5"])]);
    expect(dropEntry(r, "1", { id: "2", where: "before" })).toEqual({ pinned: [folder("fa", ["4", "5"])], rest: ["1", "2", "3", "6"] });
  });

  it("does nothing when dropped on itself or on something unknown", () => {
    expect(dropEntry(base, "2", { id: "2", where: "combine" })).toBe(base);
    expect(dropEntry(base, "2", { id: "99", where: "before" })).toBe(base);
  });
});

describe("folders", () => {
  const base: RailLayout = { pinned: [folder("fp", ["1"])], rest: ["2", folder("fa", ["3", "4"]), "5"] };

  it("creates one where its first server was", () => {
    const { layout, id } = createFolder(base, ["5"], { name: "  Games ", color: "#3d9e60" }, ids("fnew"));
    expect(id).toBe("fnew");
    expect(layout.rest).toEqual(["2", folder("fa", ["3", "4"]), folder("fnew", ["5"], { name: "Games", color: "#3d9e60" })]);
  });

  it("creates one for a server in a folder just under that folder", () => {
    const { layout } = createFolder(base, ["3"], {}, ids("fnew"));
    expect(layout.rest).toEqual(["2", folder("fa", ["4"]), folder("fnew", ["3"]), "5"]);
    expect(folderOf(layout, "3")?.id).toBe("fnew");
  });

  it("creates one in the pinned ones for a pinned server", () => {
    const { layout } = createFolder(base, ["1"], {}, ids("fnew"));
    // the pinned folder it came from was left empty, so the new one takes its place
    expect(layout.pinned).toEqual([folder("fnew", ["1"])]);
  });

  it("moves a server into a folder, at its end", () => {
    expect(addToFolder(base, "2", "fa").rest).toEqual([folder("fa", ["3", "4", "2"]), "5"]);
    expect(addToFolder(base, "1", "fa")).toEqual({ pinned: [], rest: ["2", folder("fa", ["3", "4", "1"]), "5"] });
    // already there, or no such folder: nothing to do
    expect(addToFolder(base, "3", "fa")).toBe(base);
    expect(addToFolder(base, "2", "fz")).toBe(base);
    expect(addToFolder(base, "2", "5")).toBe(base);
  });

  it("takes a server out to just under its folder", () => {
    expect(removeFromFolder(base, "3").rest).toEqual(["2", folder("fa", ["4"]), "3", "5"]);
    expect(removeFromFolder(base, "1").pinned).toEqual(["1"]);
    expect(removeFromFolder(base, "2")).toBe(base);
  });

  it("deletes a folder and keeps its servers where it was", () => {
    expect(deleteFolder(base, "fa").rest).toEqual(["2", "3", "4", "5"]);
    expect(deleteFolder(base, "3")).toBe(base);
  });

  it("names, colours, opens and closes one", () => {
    let r = updateFolder(base, "fa", { name: "  Study  ", color: "#EB459F", open: true });
    expect(findPlace(r, "fa")).toMatchObject({ section: "rest", index: 1 });
    expect(r.rest[1]).toEqual(folder("fa", ["3", "4"], { name: "Study", color: "#eb459f", open: true }));
    r = updateFolder(r, "fa", { color: "not a colour", open: false });
    expect(r.rest[1]).toEqual(folder("fa", ["3", "4"], { name: "Study" }));
  });

  it("hands out ids nothing has", () => {
    const seq = [0, 0, 0.5];
    let i = 0;
    const id = newFolderId({ pinned: [folder("f000000", ["1"])], rest: [] }, () => seq[i++]!);
    expect(id).not.toBe("f000000");
    expect(id).toMatch(/^f[a-z0-9]{6}$/);
  });
});

describe("moving by one place", () => {
  const base: RailLayout = { pinned: ["1", "2"], rest: ["3", folder("fa", ["4", "5"])] };

  it("moves among its section, never across into the other one", () => {
    expect(moveEntry(base, "2", -1).pinned).toEqual(["2", "1"]);
    expect(moveEntry(base, "2", 1)).toBe(base);
    expect(moveEntry(base, "3", -1)).toBe(base);
    expect(moveEntry(base, "fa", -1).rest).toEqual([folder("fa", ["4", "5"]), "3"]);
  });

  it("moves among its folder's servers", () => {
    expect(siblingIds(base, "4")).toEqual(["4", "5"]);
    expect(siblingIds(base, "fa")).toEqual(["3", "fa"]);
    expect((moveEntry(base, "4", 1).rest[1] as ServerFolder).servers).toEqual(["5", "4"]);
  });
});
