// @vitest-environment jsdom
import { useAuth } from "./auth";
import { useTabs } from "./tabs";
import { lastChannelOf, rememberChannel } from "./serverNav";
import { useVoice } from "./voice";
import { useSlowmode } from "./slowmode";

const person = (id: string) => ({ id, username: id, display_name: id, flags: 0 }) as unknown as NonNullable<ReturnType<typeof useAuth.getState>["me"]>;
const layout = (channelId: string) =>
  JSON.stringify({
    tabs: [
      { id: "t1", serverId: null, channelId: null },
      { id: "t2", serverId: "1", channelId },
    ],
    active: "t2",
  });
/** The shape tabs were saved in while they could hold split panes. */
const paneLayout = (channelId: string) =>
  JSON.stringify({
    tabs: [{ id: "t1", root: { kind: "pane", id: "p1" }, focus: "p1" }, { id: "t2", root: { kind: "pane", id: "p2" }, focus: "p2" }],
    active: "t2",
    panes: { p1: { id: "p1", serverId: null, channelId: null }, p2: { id: "p2", serverId: "1", channelId } },
  });
const channelOf = (tabId: string) => useTabs.getState().tabs.find((t) => t.id === tabId)?.channelId;

beforeEach(() => {
  localStorage.clear();
  useAuth.setState({ me: null });
  useTabs.getState().reset();
});

describe("what one account leaves on a shared browser", () => {
  it("gives each account its own tabs, and the next one starts from one empty tab", () => {
    localStorage.setItem("ec:tabs:alice", layout("100"));
    useAuth.setState({ me: person("alice") });
    expect(useTabs.getState().tabs).toHaveLength(2);
    expect(channelOf("t2")).toBe("100");
    // alice signs out, bob signs in
    useTabs.getState().reset();
    useAuth.setState({ me: null });
    useAuth.setState({ me: person("bob") });
    expect(useTabs.getState().tabs.map((t) => t.channelId)).toEqual([null]);
    // and alice's tabs are still hers when she is back
    useTabs.getState().reset();
    useAuth.setState({ me: person("alice") });
    expect(channelOf("t2")).toBe("100");
  });

  it("saves the tabs under the account they belong to, and nothing while nobody is signed in", () => {
    vi.useFakeTimers();
    try {
      useAuth.setState({ me: person("carol") });
      useTabs.getState().openTab("1", "2");
      vi.advanceTimersByTime(500);
      expect(JSON.parse(localStorage.getItem("ec:tabs:carol") ?? "{}").tabs).toHaveLength(2);
      useTabs.getState().reset();
      useAuth.setState({ me: null });
      useTabs.getState().openTab("1", "3");
      vi.advanceTimersByTime(500);
      expect(Object.keys(localStorage).filter((k) => k.startsWith("ec:tabs") || k.startsWith("ec:panes"))).toEqual(["ec:tabs:carol"]);
      expect(JSON.parse(localStorage.getItem("ec:tabs:carol") ?? "{}").tabs).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes over the one layout kept before layouts were per account", () => {
    localStorage.setItem("ec:panes", paneLayout("200"));
    useAuth.setState({ me: person("dave") });
    expect(channelOf("t2")).toBe("200");
    expect(localStorage.getItem("ec:panes")).toBeNull();
    expect(localStorage.getItem("ec:tabs:dave")).not.toBeNull();
  });

  it("remembers the last channel of a server per account", () => {
    useAuth.setState({ me: person("alice") });
    rememberChannel("s1", "c-alice");
    useAuth.setState({ me: person("bob") });
    expect(lastChannelOf("s1")).toBeNull();
    rememberChannel("s1", "c-bob");
    useAuth.setState({ me: person("alice") });
    expect(lastChannelOf("s1")).toBe("c-alice");
    // signed out, nothing is remembered or offered
    useAuth.setState({ me: null });
    rememberChannel("s1", "c-nobody");
    expect(lastChannelOf("s1")).toBeNull();
  });

  it("keeps the volumes chosen for people per account", () => {
    useAuth.setState({ me: person("alice") });
    useVoice.getState().setVolume("friend", 150);
    useAuth.setState({ me: person("bob") });
    expect(useVoice.getState().volumes).toEqual({});
    useAuth.setState({ me: person("alice") });
    expect(useVoice.getState().volumes).toEqual({ friend: 150 });
    useAuth.setState({ me: null });
    expect(useVoice.getState().volumes).toEqual({});
  });

  it("forgets slow mode waits at sign-out", () => {
    useSlowmode.getState().markSent("c1");
    useSlowmode.getState().setUntil("c1", Date.now() + 60_000);
    useSlowmode.getState().reset();
    expect(useSlowmode.getState().lastSent).toEqual({});
    expect(useSlowmode.getState().until).toEqual({});
  });
});
