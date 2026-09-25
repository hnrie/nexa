import { mentionsMe } from "./mentionsMe";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";

const msg = (x: Partial<{ channel_id: string; mentions: string[]; mention_roles: string[]; mention_everyone: boolean }>) => ({
  channel_id: "c1",
  mentions: [] as string[],
  mention_roles: [] as string[],
  mention_everyone: false,
  ...x,
});

describe("mentionsMe", () => {
  beforeEach(() => {
    useChannels.setState({ byId: { c1: { id: "c1", server_id: "s1", type: "text" }, d1: { id: "d1", server_id: null, type: "dm" } } } as never);
    useServers.setState({ byId: { s1: { me: { user_id: "me", role_ids: ["mods"] } } } } as never);
  });

  it("answers for @everyone and a mention of me", () => {
    expect(mentionsMe(msg({ mention_everyone: true }), "me")).toBe(true);
    expect(mentionsMe(msg({ mentions: ["me"] }), "me")).toBe(true);
    expect(mentionsMe(msg({ mentions: ["someone"] }), "me")).toBe(false);
  });

  it("answers for a role I hold in that server, and not for one I don't", () => {
    expect(mentionsMe(msg({ mention_roles: ["mods"] }), "me")).toBe(true);
    expect(mentionsMe(msg({ mention_roles: ["designers"] }), "me")).toBe(false);
  });

  it("finds no roles outside a server", () => {
    expect(mentionsMe(msg({ channel_id: "d1", mention_roles: ["mods"] }), "me")).toBe(false);
    expect(mentionsMe(msg({ channel_id: "unknown", mention_roles: ["mods"] }), "me")).toBe(false);
  });
});
