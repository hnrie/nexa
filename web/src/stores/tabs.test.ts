// @vitest-environment jsdom
import { useAuth } from "./auth";
import { activeTab, readSaved, tabAddress, useTabs } from "./tabs";

const person = (id: string) => ({ id, username: id, display_name: id, flags: 0 }) as unknown as NonNullable<ReturnType<typeof useAuth.getState>["me"]>;

/** A layout as builds with split panes saved it: a tree of tiles per tab, and the panes they held. */
const splitLayout = JSON.stringify({
  tabs: [
    {
      id: "t1",
      root: {
        kind: "split",
        id: "s1",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          { kind: "pane", id: "p1" },
          { kind: "split", id: "s2", dir: "column", sizes: [0.5, 0.5], children: [{ kind: "pane", id: "p2" }, { kind: "pane", id: "p3" }] },
        ],
      },
      focus: "p3",
    },
    { id: "t2", root: { kind: "pane", id: "p4" }, focus: "p4" },
  ],
  active: "t1",
  panes: {
    p1: { id: "p1", serverId: "10", channelId: "11" },
    p2: { id: "p2", serverId: null, channelId: "21" },
    p3: { id: "p3", serverId: "30", channelId: "31" },
    p4: { id: "p4", serverId: null, channelId: null },
  },
});

beforeEach(() => {
  localStorage.clear();
  useAuth.setState({ me: null });
  useTabs.getState().reset();
});

describe("tabs saved while tabs could be split", () => {
  it("keeps each tab as the pane that had focus", () => {
    expect(readSaved(splitLayout)).toEqual({
      tabs: [
        { id: "t1", serverId: "30", channelId: "31" },
        { id: "t2", serverId: null, channelId: null },
      ],
      active: "t1",
    });
  });

  it("falls back to the first pane when the focused one is missing", () => {
    const raw = JSON.parse(splitLayout) as { tabs: { focus: string }[]; panes: Record<string, unknown> };
    raw.tabs[0]!.focus = "gone";
    delete raw.panes["p1"];
    expect(readSaved(JSON.stringify(raw))?.tabs[0]).toEqual({ id: "t1", serverId: null, channelId: "21" });
  });

  it("leaves out a tab with no panes left, and anything that is not a tab", () => {
    const raw = JSON.parse(splitLayout) as { tabs: unknown[]; panes: Record<string, unknown>; active: string };
    delete raw.panes["p4"];
    raw.tabs.push(null, 7, { root: { kind: "pane", id: "p1" } });
    raw.active = "t2";
    expect(readSaved(JSON.stringify(raw))).toEqual({ tabs: [{ id: "t1", serverId: "30", channelId: "31" }], active: "t1" });
  });

  it("moves them to the tabs' own place when the account signs in", () => {
    localStorage.setItem("ec:panes:alice", splitLayout);
    useAuth.setState({ me: person("alice") });
    const s = useTabs.getState();
    expect(s.tabs.map((t) => t.channelId)).toEqual(["31", null]);
    expect(activeTab(s).id).toBe("t1");
    expect(localStorage.getItem("ec:panes:alice")).toBeNull();
    expect(JSON.parse(localStorage.getItem("ec:tabs:alice") ?? "{}").tabs).toHaveLength(2);
  });
});

describe("reading saved tabs", () => {
  it("reads its own shape back", () => {
    const saved = { tabs: [{ id: "a", serverId: "1", channelId: "2" }, { id: "b", serverId: null, channelId: null }], active: "b" };
    expect(readSaved(JSON.stringify(saved))).toEqual(saved);
  });

  it("starts afresh from anything unreadable", () => {
    for (const raw of ["", "{", "null", "[]", '{"tabs":[]}', '{"tabs":{}}', '{"tabs":[{"id":""}]}']) expect(readSaved(raw)).toBeNull();
  });

  it("opens the first tab when the saved one is not among them, and drops ids that are not ids", () => {
    const raw = JSON.stringify({ tabs: [{ id: "a", serverId: "x/y", channelId: "2" }, { id: "a", serverId: null, channelId: "3" }], active: "zzz" });
    expect(readSaved(raw)).toEqual({ tabs: [{ id: "a", serverId: null, channelId: "2" }], active: "a" });
  });
});

describe("tabs", () => {
  it("opens, reorders and closes the way a browser's do", () => {
    const first = activeTab(useTabs.getState()).id;
    const b = useTabs.getState().openTab("1", "2");
    const c = useTabs.getState().openTab(null, "3", { background: true });
    expect(useTabs.getState().active).toBe(b);
    useTabs.getState().moveTab(2, 0);
    expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([c, first, b]);
    // the open tab closes and the one on its right would open; it was last, so the one on its left does
    useTabs.getState().closeTab(b);
    expect(useTabs.getState().active).toBe(first);
    useTabs.getState().closeTab(first);
    useTabs.getState().closeTab(c);
    // the last tab stays
    expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([c]);
  });

  it("follows the address without waking anyone when nothing changed", () => {
    const tab = activeTab(useTabs.getState());
    useTabs.getState().setTabChannel(tab.id, "5", "6");
    expect(tabAddress(activeTab(useTabs.getState()))).toBe("/channels/5/6");
    const before = useTabs.getState().tabs;
    useTabs.getState().setTabChannel(tab.id, "5", "6");
    expect(useTabs.getState().tabs).toBe(before);
    useTabs.getState().setTabChannel(tab.id, null, "7");
    expect(tabAddress(activeTab(useTabs.getState()))).toBe("/channels/@me/7");
    useTabs.getState().setTabChannel(tab.id, null, null);
    expect(tabAddress(activeTab(useTabs.getState()))).toBe("/channels/@me");
  });
});
