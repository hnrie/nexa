import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useSettings } from "@/stores/settings";
import { closeDM, dmMenu, isViewingDM, purgeDM } from "./dmMenu";

function channel(id: string, type: Channel["type"], parent: string | null = null): Channel {
  return { id, type, parent_id: parent, recipient_ids: [] } as unknown as Channel;
}

const byId: Record<string, Channel> = {
  "10": channel("10", "dm"),
  "20": channel("20", "dm"),
  "11": channel("11", "subchat", "10"),
};

describe("isViewingDM", () => {
  it("is true on the conversation and on its subchats", () => {
    expect(isViewingDM("/channels/@me/10", "10", byId)).toBe(true);
    expect(isViewingDM("/channels/@me/11", "10", byId)).toBe(true);
  });

  it("is false on another conversation, on Friends and in servers", () => {
    expect(isViewingDM("/channels/@me/20", "10", byId)).toBe(false);
    expect(isViewingDM("/channels/@me", "10", byId)).toBe(false);
    expect(isViewingDM("/channels/5/10", "10", byId)).toBe(false);
  });
});

describe("closing a conversation", () => {
  beforeEach(() => {
    vi.spyOn(channelsApi, "close").mockResolvedValue(undefined);
    vi.spyOn(channelsApi, "purge").mockResolvedValue(undefined);
    useChannels.setState({ byId: { ...byId } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("leaves the user where they are when they are reading another one", async () => {
    vi.stubGlobal("window", { location: { pathname: "/channels/@me/20" } });
    const nav = vi.fn();
    await closeDM("10", nav);
    await purgeDM("10", nav);
    expect(nav).not.toHaveBeenCalled();
  });

  it("sends the user to Friends from the conversation or one of its subchats", async () => {
    const nav = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/channels/@me/10" } });
    await closeDM("10", nav);
    expect(nav).toHaveBeenLastCalledWith("/channels/@me");
    useChannels.setState({ byId: { ...byId } });
    vi.stubGlobal("window", { location: { pathname: "/channels/@me/11" } });
    await purgeDM("10", nav);
    expect(nav).toHaveBeenCalledTimes(2);
  });
});

describe("the developer-mode items on a conversation", () => {
  const ctx = { nav: () => undefined, openModal: () => undefined };
  const ids = (channelId: string) => dmMenu.items({ channelId, ...ctx }).map((i) => i.id);
  beforeEach(() => {
    useAuth.setState({ me: { id: "1" } as never });
    useChannels.setState({
      byId: {
        "10": { ...channel("10", "dm"), recipient_ids: ["1", "2"] },
        "30": { ...channel("30", "group_dm"), recipient_ids: ["1", "2", "3"], owner_id: "1" },
      } as never,
    });
  });

  it("offers the person first in a one-to-one conversation, then the conversation", () => {
    useSettings.setState((st) => ({ settings: { ...st.settings, developerMode: true } }));
    expect(ids("10").slice(-3)).toEqual(["copy-user", "copy-bot", "copy"]);
    // a group is a conversation, not a person
    expect(ids("30")).not.toContain("copy-user");
    expect(ids("30")).not.toContain("copy-bot");
    expect(ids("30").at(-1)).toBe("copy");
  });

  it("offers no IDs with developer mode off", () => {
    useSettings.setState((st) => ({ settings: { ...st.settings, developerMode: false } }));
    expect(ids("10")).not.toContain("copy-user");
    expect(ids("10")).not.toContain("copy-bot");
    expect(ids("10")).not.toContain("copy");
  });
});
