import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerState } from "@/stores/servers";
import { useServers } from "@/stores/servers";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { adoptRail, currentRail, folderMenuItems, folderName, serverArrangeItems } from "./railActions";

const server = (id: string, name: string) => ({ server: { id, name, icon_id: null } }) as unknown as ServerState;

function load(settings: Partial<typeof DEFAULT_SETTINGS>, loaded = true) {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ...settings }, loaded, key: loaded ? new Uint8Array(32) : null });
}

const ids = (items: ContextMenuItem[]) => items.map((i) => i.id);

beforeEach(() => {
  useServers.setState({ byId: { "1": server("1", "Alpha"), "2": server("2", "Beta"), "3": server("3", "Gamma") }, order: ["1", "2", "3"] });
});

afterEach(() => {
  useSettings.getState().reset();
  useServers.getState().clear();
});

describe("adopting the order an account had", () => {
  it("keeps the order chosen before folders came in, once the settings are in", () => {
    load({ serverPositions: ["3", "1"] });
    adoptRail();
    expect(useSettings.getState().settings.rail).toEqual({ pinned: [], rest: ["3", "1", "2"] });
    // the old order is left as it was, for a version without folders
    expect(useSettings.getState().settings.serverPositions).toEqual(["3", "1"]);
  });

  it("does nothing before the settings are in, or once there is a layout", () => {
    load({ serverPositions: ["3"] }, false);
    adoptRail();
    expect(useSettings.getState().settings.rail).toBeNull();
    load({ rail: { pinned: ["2"], rest: ["1"] } });
    adoptRail();
    expect(useSettings.getState().settings.rail).toEqual({ pinned: ["2"], rest: ["1"] });
    // and a server joined since is shown under the pinned ones
    expect(currentRail()).toEqual({ pinned: ["2"], rest: ["3", "1"] });
  });
});

describe("the menus", () => {
  it("offers a loose server pinning, a folder to go into and a new one, and its moves", () => {
    load({ rail: { pinned: [], rest: ["1", { id: "fa", name: "", color: null, servers: ["2", "3"] }] } });
    const items = serverArrangeItems("1", { openModal: () => undefined, moves: [{ id: "move-down", label: "Move down" }] });
    expect(ids(items)).toEqual(["pin", "add-to-folder", "move-down"]);
    const sub = items[1]!.submenu!;
    expect(ids(sub)).toEqual(["folder-fa", "new-folder"]);
    // an unnamed folder is called by its servers' names
    expect(sub[0]!.label).toBe(folderName({ id: "fa", name: "", color: null, servers: ["2", "3"] }));
    expect(sub[0]!.label).toContain("Beta");
    expect(sub[0]!.checked).toBeUndefined();
    expect(items.at(-1)!.separatorAfter).toBe(true);
  });

  it("ticks the folder a server is in and offers taking it out by the folder's name", () => {
    load({ rail: { pinned: [], rest: [{ id: "fa", name: "Games", color: null, servers: ["2", "3"] }, "1"] } });
    const items = serverArrangeItems("2", { openModal: () => undefined, moves: [] });
    expect(ids(items)).toEqual(["pin", "add-to-folder", "remove-from-folder"]);
    expect(items[1]!.submenu![0]!.checked).toBe(true);
    expect(items[2]!.label).toContain("Games");
    items[2]!.onSelect!();
    expect(useSettings.getState().settings.rail).toEqual({ pinned: [], rest: [{ id: "fa", name: "Games", color: null, servers: ["3"] }, "2", "1"] });
  });

  it("pins and unpins from the menu", () => {
    load({ rail: { pinned: [], rest: ["1", "2", "3"] } });
    serverArrangeItems("3", { openModal: () => undefined, moves: [] })[0]!.onSelect!();
    expect(currentRail()).toEqual({ pinned: ["3"], rest: ["1", "2"] });
    const again = serverArrangeItems("3", { openModal: () => undefined, moves: [] });
    again[0]!.onSelect!();
    expect(currentRail()).toEqual({ pinned: [], rest: ["3", "1", "2"] });
  });

  it("gives a folder read, settings, pin, moves and delete, and asks before deleting", () => {
    load({ rail: { pinned: [], rest: [{ id: "fa", name: "Games", color: null, servers: ["2", "3"] }, "1"] } });
    const opened: { kind: string; props?: Record<string, unknown> }[] = [];
    const items = folderMenuItems("fa", { openModal: (kind, props) => opened.push({ kind, props }), moves: [{ id: "move-down", label: "Move down" }] });
    expect(ids(items)).toEqual(["read", "settings", "pin", "move-down", "delete"]);
    items.at(-1)!.onSelect!();
    expect(opened[0]!.kind).toBe("confirm");
    void (opened[0]!.props!["onConfirm"] as () => void)();
    expect(currentRail()).toEqual({ pinned: [], rest: ["2", "3", "1"] });
  });
});
