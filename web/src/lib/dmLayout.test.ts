import { describe, expect, it } from "vitest";
import { compareIds } from "./ids";
import {
  addToGroup,
  createGroup,
  deleteGroup,
  dmListView,
  dropDM,
  forgetDM,
  groupOf,
  moveInMain,
  movePinnedDM,
  NEXA_ID,
  pinDM,
  pruneDMs,
  removeFromGroup,
  renameGroup,
  rowId,
  sanitizeDMList,
  setDMSort,
  setGroupCollapsed,
  unpinDM,
  type DMListLayout,
} from "./dmLayout";

/** Activity by conversation, as snowflakes: a bigger number is more recent. */
const activity: Record<string, string> = { "10": "100", "20": "200", "30": "300", "40": "400", "50": "500", [NEXA_ID]: "250" };
const all = ["10", "20", "30", "40", "50", NEXA_ID];
const view = (layout: DMListLayout, known: (id: string) => boolean = (id) => id in activity) => dmListView(layout, all, known, (id) => activity[id] ?? "0", compareIds);
const rows = (list: ReturnType<typeof view>["rest"]) => list.map((r) => (r.kind === "conversation" ? r.id : `${r.group.id}[${r.ids.join(",")}]`));

describe("the DM list", () => {
  it("is the conversations by activity when nothing is arranged, Nexa among them", () => {
    const v = view({ pins: [], groups: [] });
    expect(v.pinned).toEqual([]);
    expect(rows(v.rest)).toEqual(["50", "40", "30", NEXA_ID, "20", "10"]);
  });

  it("shows the pinned ones first, in the order they were pinned", () => {
    const v = view({ pins: ["10", "gfam", "30"], groups: [{ id: "gfam", name: "Family", ids: ["20", "50"] }] });
    expect(rows(v.pinned)).toEqual(["10", "gfam[50,20]", "30"]);
    expect(rows(v.rest)).toEqual(["40", NEXA_ID]);
  });

  it("puts a group where its most recent conversation would be, and an empty one last", () => {
    const v = view({ pins: [], groups: [{ id: "gold", name: "Old", ids: ["10", "20"] }, { id: "gnone", name: "Empty", ids: [] }] });
    expect(rows(v.rest)).toEqual(["50", "40", "30", NEXA_ID, "gold[20,10]", "gnone[]"]);
  });

  it("leaves out conversations that are gone, and shows one named twice once", () => {
    const layout: DMListLayout = { pins: ["99", "20"], groups: [{ id: "ga", name: "A", ids: ["20", "30", "98"] }] };
    const v = view(layout);
    expect(rows(v.pinned)).toEqual(["20"]);
    expect(rows(v.rest)).toEqual(["50", "40", "ga[30]", NEXA_ID, "10"]);
    // Nexa closed: it is simply not known
    expect(rows(view({ pins: [NEXA_ID], groups: [] }, (id) => id !== NEXA_ID && id in activity).pinned)).toEqual([]);
  });
});

describe("sanitizeDMList", () => {
  it("reads defaults into what is not a layout", () => {
    expect(sanitizeDMList(undefined)).toEqual({ pins: [], groups: [] });
    expect(sanitizeDMList({ pins: "10" })).toEqual({ pins: [], groups: [] });
  });

  it("keeps each conversation once, pinned before grouped, and only pins that exist", () => {
    const got = sanitizeDMList({
      pins: ["10", "10", "gx", "ga", 5, "nexa", "evil"],
      groups: [{ id: "ga", name: "A", ids: ["10", "20", "20", "nexa"], collapsed: true }, { id: "ga", name: "again", ids: [] }, { id: "bad!", ids: [] }, { id: "gb", name: 3, ids: ["30"] }],
    });
    expect(got).toEqual({ pins: ["10", "ga", "nexa"], groups: [{ id: "ga", name: "A", ids: ["20"], collapsed: true }, { id: "gb", name: "", ids: ["30"] }] });
  });
});

describe("arranging the DM list", () => {
  const base: DMListLayout = { pins: ["10", "gfam"], groups: [{ id: "gfam", name: "Family", ids: ["20"] }, { id: "gwork", name: "Work", ids: ["30", "40"] }] };

  it("pins a conversation at the bottom of the pins, out of its group", () => {
    const r = pinDM(base, "30");
    expect(r.pins).toEqual(["10", "gfam", "30"]);
    expect(groupOf(r, "30")).toBeNull();
    expect(groupOf(r, "40")?.id).toBe("gwork");
  });

  it("pins at a place, and reorders the pins by dropping one among them", () => {
    expect(pinDM(base, "50", 0).pins).toEqual(["50", "10", "gfam"]);
    // "10" dropped before the end: it lands after "gfam"
    expect(pinDM(base, "10", 2).pins).toEqual(["gfam", "10"]);
    expect(pinDM(base, "gfam", 0).pins).toEqual(["gfam", "10"]);
    expect(pinDM(base, "gnope")).toBe(base);
  });

  it("unpins back to the main list and moves a pin by one place", () => {
    expect(unpinDM(base, "10").pins).toEqual(["gfam"]);
    expect(unpinDM(base, "50")).toBe(base);
    expect(movePinnedDM(base, "gfam", -1).pins).toEqual(["gfam", "10"]);
    expect(movePinnedDM(base, "gfam", 1)).toBe(base);
  });

  it("moves a conversation into a group, out of the pins or another group", () => {
    const r = addToGroup(base, "10", "gwork");
    expect(r.pins).toEqual(["gfam"]);
    expect(r.groups[1]!.ids).toEqual(["30", "40", "10"]);
    const s = addToGroup(r, "30", "gfam");
    expect(s.groups.map((g) => g.ids)).toEqual([["20", "30"], ["40", "10"]]);
    expect(addToGroup(base, "20", "gfam")).toBe(base);
    expect(addToGroup(base, "20", "gnone")).toBe(base);
  });

  it("takes a conversation out of its group", () => {
    expect(removeFromGroup(base, "30").groups[1]!.ids).toEqual(["40"]);
    expect(removeFromGroup(base, "50")).toBe(base);
  });

  it("creates a group with the conversation it was made from", () => {
    const { layout, id } = createGroup(base, "  Friends from school ", ["10"], () => "gnew");
    expect(id).toBe("gnew");
    expect(layout.groups.at(-1)).toEqual({ id: "gnew", name: "Friends from school", ids: ["10"] });
    expect(layout.pins).toEqual(["gfam"]);
  });

  it("renames, collapses and deletes a group; its conversations go back to the list", () => {
    expect(renameGroup(base, "gwork", " Office ").groups[1]!.name).toBe("Office");
    const collapsed = setGroupCollapsed(base, "gfam", true);
    expect(collapsed.groups[0]!.collapsed).toBe(true);
    expect(setGroupCollapsed(collapsed, "gfam", false).groups[0]).toEqual({ id: "gfam", name: "Family", ids: ["20"] });
    const r = deleteGroup(base, "gfam");
    expect(r).toEqual({ pins: ["10"], groups: [{ id: "gwork", name: "Work", ids: ["30", "40"] }] });
    expect(rows(view(r).rest)).toContain("20");
  });

  it("forgets a closed conversation, and drops the ones that are gone", () => {
    expect(forgetDM(base, "10").pins).toEqual(["gfam"]);
    expect(forgetDM(base, "30").groups[1]!.ids).toEqual(["40"]);
    expect(forgetDM(base, "50")).toBe(base);
    const pruned = pruneDMs(base, (id) => id !== "20" && id !== "40");
    expect(pruned).toEqual({ pins: ["10", "gfam"], groups: [{ id: "gfam", name: "Family", ids: [] }, { id: "gwork", name: "Work", ids: ["30"] }] });
    expect(pruneDMs(base, () => true)).toBe(base);
  });

  it("drops a dragged conversation or group where it lands", () => {
    expect(dropDM(base, "50", { kind: "pinned", index: 1 }).pins).toEqual(["10", "50", "gfam"]);
    expect(dropDM(base, "10", { kind: "group", groupId: "gwork" }).groups[1]!.ids).toEqual(["30", "40", "10"]);
    // a group does not go into a group
    expect(dropDM(base, "gfam", { kind: "group", groupId: "gwork" })).toBe(base);
    const main = dropDM(base, "30", { kind: "main" });
    expect(groupOf(main, "30")).toBeNull();
    expect(dropDM(base, "gfam", { kind: "main" }).pins).toEqual(["10"]);
  });
});

describe("putting the main list in order by hand", () => {
  const ids = ["1", "2", "3", "4"];
  const known = () => true;
  // activity: higher id is newer
  const activity = (id: string) => id;
  const cmp = (a: string, b: string) => Number(a) - Number(b);
  const rest = (l: DMListLayout) => dmListView(l, ids, known, activity, cmp).rest.map(rowId);

  it("goes by activity until a row is moved, then keeps the order it was moved into", () => {
    const start: DMListLayout = { pins: [], groups: [] };
    expect(rest(start)).toEqual(["4", "3", "2", "1"]);
    const moved = moveInMain(start, "1", "4", "before", rest(start));
    expect(moved.sort).toBe("custom");
    expect(rest(moved)).toEqual(["1", "4", "3", "2"]);
    // more activity changes nothing now
    expect(dmListView(moved, ids, known, (id) => (id === "2" ? "99" : id), cmp).rest.map(rowId)).toEqual(["1", "4", "3", "2"]);
  });

  it("puts a conversation that is new since at the top", () => {
    const moved = moveInMain({ pins: [], groups: [] }, "2", "3", "after", ["4", "3", "2", "1"]);
    expect(dmListView(moved, [...ids, "5"], known, activity, cmp).rest.map(rowId)).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("takes a pinned conversation out of the pins to put it in the list", () => {
    const pinned: DMListLayout = { pins: ["3"], groups: [] };
    const moved = dropDM(pinned, "3", { kind: "main", at: "1", where: "after", rest: ["4", "2", "1"] });
    expect(moved.pins).toEqual([]);
    expect(rest(moved)).toEqual(["4", "2", "1", "3"]);
  });

  it("goes back to activity, and survives being stored and read back", () => {
    const moved = moveInMain({ pins: [], groups: [] }, "1", "4", "before", ["4", "3", "2", "1"]);
    expect(sanitizeDMList(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
    expect(rest(setDMSort(moved, "recent", rest(moved)))).toEqual(["4", "3", "2", "1"]);
    // forgetting a conversation takes it out of the order too
    expect(forgetDM(moved, "1").order).toEqual(["4", "3", "2"]);
  });
});
