// @vitest-environment jsdom
import { useAuth } from "./auth";
import { usePanes } from "./panes";
import { lastChannelOf, rememberChannel } from "./serverNav";
import { useVoice } from "./voice";
import { useSlowmode } from "./slowmode";

const person = (id: string) => ({ id, username: id, display_name: id, flags: 0 }) as unknown as NonNullable<ReturnType<typeof useAuth.getState>["me"]>;
const layout = (channelId: string) =>
  JSON.stringify({
    tabs: [{ id: "t1", root: { kind: "pane", id: "p1" }, focus: "p1" }, { id: "t2", root: { kind: "pane", id: "p2" }, focus: "p2" }],
    active: "t2",
    panes: { p1: { id: "p1", serverId: null, channelId: null }, p2: { id: "p2", serverId: "s1", channelId } },
  });

beforeEach(() => {
  localStorage.clear();
  useAuth.setState({ me: null });
  usePanes.getState().reset();
});

describe("what one account leaves on a shared browser", () => {
  it("gives each account its own tabs, and the next one starts from one empty tab", () => {
    localStorage.setItem("ec:panes:alice", layout("c-alice"));
    useAuth.setState({ me: person("alice") });
    expect(usePanes.getState().tabs).toHaveLength(2);
    expect(usePanes.getState().panes["p2"]?.channelId).toBe("c-alice");
    // alice signs out, bob signs in
    usePanes.getState().reset();
    useAuth.setState({ me: null });
    useAuth.setState({ me: person("bob") });
    expect(usePanes.getState().tabs).toHaveLength(1);
    expect(Object.values(usePanes.getState().panes).map((p) => p.channelId)).toEqual([null]);
    // and alice's layout is still hers when she is back
    usePanes.getState().reset();
    useAuth.setState({ me: person("alice") });
    expect(usePanes.getState().panes["p2"]?.channelId).toBe("c-alice");
  });

  it("saves the layout under the account it belongs to, and nothing while nobody is signed in", () => {
    vi.useFakeTimers();
    try {
      useAuth.setState({ me: person("carol") });
      usePanes.getState().openTab("s1", "c1");
      vi.advanceTimersByTime(500);
      expect(JSON.parse(localStorage.getItem("ec:panes:carol") ?? "{}").tabs).toHaveLength(2);
      usePanes.getState().reset();
      useAuth.setState({ me: null });
      usePanes.getState().openTab("s1", "c2");
      vi.advanceTimersByTime(500);
      expect(localStorage.getItem("ec:panes")).toBeNull();
      expect(JSON.parse(localStorage.getItem("ec:panes:carol") ?? "{}").tabs).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes over the one layout kept before layouts were per account", () => {
    localStorage.setItem("ec:panes", layout("c-old"));
    useAuth.setState({ me: person("dave") });
    expect(usePanes.getState().panes["p2"]?.channelId).toBe("c-old");
    expect(localStorage.getItem("ec:panes")).toBeNull();
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
