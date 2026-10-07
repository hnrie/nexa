import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { useUI } from "@/stores/ui";
import { button, buildItems, defineMenu, kindOfButton, menuButtons, menuKinds } from "./registry";

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
