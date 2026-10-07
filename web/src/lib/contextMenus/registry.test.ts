import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUI } from "@/stores/ui";
import { about, addButton, button, buildItems, buttonInfo, defineMenu, dropAdded, dropChanges, editButton, kindOfButton, listButtons, menuButtons, menuKinds, removeButton, resetChanges, type Subject } from "./registry";

type Ctx = { a: boolean; b: boolean; c: boolean };
const item = (id: string) => ({ id, label: id });
const groups = [
  [button<Ctx>("t1", (c) => c.a && item("one"))],
  [button<Ctx>("t2", (c) => c.b && item("two")), button<Ctx>("t3", () => item("three"))],
  [button<Ctx>("t4", (c) => (c.c ? [item("four"), item("five")] : null))],
];

describe("buildItems", () => {
  it("draws a line between groups that show something, never after the last", () => {
    const out = buildItems(groups, { a: true, b: true, c: true });
    expect(out.map((i) => [i.id, !!i.separatorAfter])).toEqual([["one", true], ["two", false], ["three", true], ["four", false], ["five", false]]);
  });

  it("leaves no line behind for a group with nothing to show", () => {
    expect(buildItems(groups, { a: false, b: false, c: false }).map((i) => [i.id, !!i.separatorAfter])).toEqual([["three", false]]);
    expect(buildItems(groups, { a: true, b: false, c: false }).map((i) => [i.id, !!i.separatorAfter])).toEqual([["one", true], ["three", false]]);
  });

  it("keeps a line an item asks for itself", () => {
    const g = [[button<null>("s1", () => ({ id: "x", label: "x", separatorAfter: true })), button<null>("s2", () => item("y"))]];
    expect(buildItems(g, null).map((i) => !!i.separatorAfter)).toEqual([true, false]);
  });
});

describe("defineMenu", () => {
  it("registers its kind and buttons", () => {
    defineMenu("testMenu", groups);
    expect(menuKinds()).toContain("testMenu");
    expect(menuButtons("testMenu").map((b) => [b.id, b.group])).toEqual([["t1", 0], ["t2", 1], ["t3", 1], ["t4", 2]]);
    expect(kindOfButton("t4")).toBe("testMenu");
  });

  it("refuses a button id another menu has", () => {
    defineMenu("testA", [[button("sharedId", () => null)]]);
    expect(() => defineMenu("testB", [[button("sharedId", () => null)]])).toThrow(/used twice/);
    expect(() => defineMenu("testC", [[button("dup", () => null), button("dup", () => null)]])).toThrow(/used twice/);
  });

  it("lets a kind be defined again", () => {
    defineMenu("testAgain", [[button("again1", () => null)]]);
    defineMenu("testAgain", [[button("again2", () => null)]]);
    expect(kindOfButton("again1")).toBeNull();
    expect(kindOfButton("again2")).toBe("testAgain");
  });

  it("opens with its items, and opens nothing when it has none", () => {
    const menu = defineMenu("testOpen", [[button<Ctx>("o1", (c) => c.a && item("one")), button<Ctx>("o2", () => item("three"))]]);
    useUI.getState().closeContextMenu();
    expect(menu.open({ a: false, b: false, c: false }, { x: 1, y: 2, label: "L" })).toBe(true);
    expect(useUI.getState().contextMenu).toMatchObject({ x: 1, y: 2, label: "L", items: [{ id: "three" }] });
    const empty = defineMenu("testEmpty", [[button<null>("nothing", () => null)]]);
    useUI.getState().closeContextMenu();
    expect(empty.open(null, { x: 0, y: 0 })).toBe(false);
    expect(useUI.getState().contextMenu).toBeNull();
  });
});

// Every menu module loads, together, without two buttons sharing an id or an import cycle leaving a menu half made.
describe("the app's menus", () => {
  const root = join(__dirname, "../..");
  const withMenus: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith("registry.ts") && readFileSync(p, "utf8").includes("defineMenu<")) withMenus.push(p);
    }
  };
  walk(root);
  it("register, each button once", async () => {
    for (const f of withMenus) await import(f);
    const kinds = menuKinds().filter((k) => !k.startsWith("test"));
    expect(kinds.length).toBeGreaterThan(40);
    const ids = kinds.flatMap((k) => menuButtons(k).map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of ["message", "server", "channel", "member", "dm", "groupMember"]) expect(kinds).toContain(k);
    expect(kindOfButton("deleteMessage")).toBe("message");
  }, 60_000);
});

// Plugins lay changes over the menus: added, removed and edited buttons, each taken back when its plugin stops.
describe("changes laid over a menu", () => {
  type C = { who: string };
  const picked: string[] = [];
  const menu = defineMenu<C>(
    "layerMenu",
    [
      [button<C>("layerOpen", () => ({ id: "open", label: "Open", onSelect: () => picked.push("open") })), button<C>("layerCopy", () => ({ id: "copy", label: "Copy", onSelect: () => picked.push("copy") }))],
      [button<C>("layerDelete", () => ({ id: "delete", label: "Delete", danger: true, onSelect: () => picked.push("delete") }))],
    ],
  );
  about(menu, ["user"], ({ who }) => ({ userId: who }));
  const labels = () => menu.items({ who: "bob" }).map((i) => i.label + (i.separatorAfter ? " |" : ""));

  beforeEach(() => {
    resetChanges();
    picked.length = 0;
  });

  it("adds a button where it is placed, or at the end, telling it what the menu is about", () => {
    const seen: Subject[] = [];
    addButton("p1", "layerMenu", { id: "wave", label: "Wave", after: "layerOpen", onClick: (s) => seen.push(s) });
    addButton("p1", "layerMenu", { id: "last", label: "Last", onClick: () => undefined });
    addButton("p1", "layerMenu", { id: "first", label: "First", before: "layerOpen", onClick: () => undefined });
    expect(labels()).toEqual(["First", "Open", "Wave", "Copy |", "Delete", "Last"]);
    menu.items({ who: "bob" }).find((i) => i.label === "Wave")!.onSelect!();
    expect(seen).toEqual([{ userId: "bob", menu: "layerMenu" }]);
  });

  it("refuses an id that is taken and a menu that is not there", () => {
    expect(() => addButton("p1", "layerMenu", { id: "layerOpen", label: "x", onClick: () => undefined })).toThrow(/already there/);
    addButton("p1", "layerMenu", { id: "mine", label: "x", onClick: () => undefined });
    expect(() => addButton("p2", "layerMenu", { id: "mine", label: "x", onClick: () => undefined })).toThrow(/already there/);
    expect(() => addButton("p1", "noSuchMenu", { id: "other", label: "x", onClick: () => undefined })).toThrow(/no menu/);
    expect(() => removeButton("p1", "noSuchButton")).toThrow(/no context menu button/);
    expect(() => editButton("p1", "noSuchButton", {})).toThrow(/no context menu button/);
  });

  it("removes and edits built-in buttons, and the line moves with what is left", () => {
    removeButton("p1", "layerDelete");
    expect(labels()).toEqual(["Open", "Copy"]);
    editButton("p1", "layerCopy", { label: "Copy Name", danger: true, onClick: (_s, original) => { picked.push("before"); original(); } });
    const copy = menu.items({ who: "bob" }).find((i) => i.label === "Copy Name")!;
    expect(copy.danger).toBe(true);
    copy.onSelect!();
    expect(picked).toEqual(["before", "copy"]);
    editButton("p2", "layerOpen", { visible: () => false });
    expect(labels()).toEqual(["Copy Name"]);
  });

  it("takes back everything a plugin changed when it stops, leaving the others' changes", () => {
    removeButton("p1", "layerDelete");
    editButton("p1", "layerOpen", { label: "Opened" });
    addButton("p2", "layerMenu", { id: "keep", label: "Keep", onClick: () => undefined });
    dropChanges("p1");
    expect(labels()).toEqual(["Open", "Copy |", "Delete", "Keep"]);
    dropAdded("p2", "keep");
    expect(labels()).toEqual(["Open", "Copy |", "Delete"]);
  });

  it("applies two plugins' changes to one button in the order they were made", () => {
    editButton("p1", "layerOpen", { label: "One" });
    editButton("p2", "layerOpen", { label: "Two" });
    expect(labels()[0]).toBe("Two");
    dropChanges("p2");
    expect(labels()[0]).toBe("One");
  });

  it("leaves the menu working when a plugin's code throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    addButton("p1", "layerMenu", { id: "bad", label: "Bad", visible: () => { throw new Error("no"); }, onClick: () => undefined });
    addButton("p1", "layerMenu", { id: "boom", label: "Boom", onClick: () => { throw new Error("no"); } });
    expect(labels()).toEqual(["Open", "Copy |", "Delete", "Boom"]);
    expect(() => menu.items({ who: "bob" }).find((i) => i.label === "Boom")!.onSelect!()).not.toThrow();
    warn.mockRestore();
  });

  it("reports buttons as get and list see them", () => {
    menu.items({ who: "bob" });
    addButton("p1", "layerMenu", { id: "wave", label: "Wave", after: "layerOpen", onClick: () => undefined });
    removeButton("p1", "layerCopy");
    editButton("p1", "layerDelete", { label: "Remove" });
    expect(listButtons("layerMenu").map((b) => [b.id, b.label, b.builtIn])).toEqual([["layerOpen", "Open", true], ["wave", "Wave", false], ["layerDelete", "Remove", true]]);
    expect(buttonInfo("layerCopy")).toBeNull();
    expect(buttonInfo("wave")).toMatchObject({ menu: "layerMenu", builtIn: false });
  });
});

// The plugin API loads every menu module from one list, which has to name each of them.
describe("the list of menu modules", () => {
  it("names every module that defines a menu", () => {
    const root = join(__dirname, "../..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith("registry.ts") && /defineMenu[<(]/.test(readFileSync(p, "utf8"))) found.push(relative(root, p).replace(/\.tsx?$/, ""));
      }
    };
    walk(root);
    const listed = readFileSync(join(__dirname, "all.ts"), "utf8");
    expect(found.filter((f) => !listed.includes(`"@/${f}"`))).toEqual([]);
  });
});

// Menus come from the registry: no component opens one with items of its own.
describe("no inline menus", () => {
  const root = join(__dirname, "../..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(root);
  it("opens every menu through a registered one", () => {
    const allowed = new Set(["lib/contextMenus/registry.ts", "stores/ui.ts"]);
    const offenders = files.map((f) => relative(root, f)).filter((f) => !allowed.has(f) && /openContextMenu\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
