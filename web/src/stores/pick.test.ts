import { afterEach, describe, expect, it } from "vitest";
import { pickClick, picking, usePick } from "./pick";

const plain = { ctrlKey: false, metaKey: false, shiftKey: false };
const order = ["a", "b", "c", "d", "e"];

afterEach(() => usePick.getState().clear());

describe("picking rows of a list", () => {
  it("picks with Ctrl or ⌘ and a click, and lets go of the last one to stop", () => {
    expect(pickClick({ ...plain, ctrlKey: true }, "dms", "b", order)).toBe(true);
    expect(pickClick({ ...plain, metaKey: true }, "dms", "d", order)).toBe(true);
    expect(usePick.getState().ids).toEqual(["b", "d"]);
    expect(picking(usePick.getState(), "dms")).toBe(true);
    pickClick({ ...plain, ctrlKey: true }, "dms", "b", order);
    pickClick({ ...plain, ctrlKey: true }, "dms", "d", order);
    expect(usePick.getState().list).toBeNull();
  });

  it("picks a run with Shift, from the last one picked", () => {
    pickClick({ ...plain, ctrlKey: true }, "dms", "b", order);
    pickClick({ ...plain, shiftKey: true }, "dms", "d", order);
    expect(usePick.getState().ids.sort()).toEqual(["b", "c", "d"]);
  });

  it("opens the row on a plain click, which ends picking by mouse", () => {
    pickClick({ ...plain, ctrlKey: true }, "dms", "b", order);
    expect(pickClick(plain, "dms", "c", order)).toBe(false);
    expect(usePick.getState().ids).toEqual([]);
  });

  it("picks on a plain tap once Select has started it, and stays in it with nothing picked", () => {
    usePick.getState().start("friends", "a");
    expect(pickClick(plain, "friends", "c", order)).toBe(true);
    expect(usePick.getState().ids).toEqual(["a", "c"]);
    pickClick(plain, "friends", "a", order);
    pickClick(plain, "friends", "c", order);
    expect(picking(usePick.getState(), "friends")).toBe(true);
  });

  it("starts over when another list is picked from", () => {
    pickClick({ ...plain, ctrlKey: true }, "dms", "b", order);
    pickClick({ ...plain, ctrlKey: true }, "servers", "s1", ["s1", "s2"]);
    expect(usePick.getState()).toMatchObject({ list: "servers", ids: ["s1"] });
    expect(picking(usePick.getState(), "dms")).toBe(false);
  });

  it("lets go of rows that have gone from the list", () => {
    usePick.getState().set("dms", ["a", "b"]);
    usePick.getState().drop(["a"]);
    expect(usePick.getState().ids).toEqual(["b"]);
    usePick.getState().drop(["b"]);
    expect(usePick.getState().list).toBeNull();
  });
});
