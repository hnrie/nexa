import type { StickerPack } from "@/api/types";
import { groupPacks, useExpressions } from "./expressions";

const pack = (id: string, over: Partial<StickerPack>): StickerPack => ({
  id,
  kind: "sticker",
  owner_user_id: null,
  server_id: null,
  name: id,
  description: "",
  cover_sticker_id: null,
  public: false,
  created_at: 0,
  updated_at: Number(id.replace(/\D/g, "")) || 0,
  stickers: [],
  installed: false,
  ...over,
});

describe("groupPacks", () => {
  it("groups this server's packs, mine, installed ones and other servers', each pack once", () => {
    const packs = Object.fromEntries(
      [
        pack("p1", { server_id: "s1" }),
        pack("p2", { owner_user_id: "me" }),
        pack("p3", { owner_user_id: "them", installed: true, public: true }),
        // installed from a server you are not looking at: once, under Installed
        pack("p4", { server_id: "s2", installed: true, public: true }),
        pack("p5", { server_id: "s2" }),
        // this server's pack that you also installed: once, under This server
        pack("p6", { server_id: "s1", installed: true, public: true }),
        pack("e1", { kind: "emoji", owner_user_id: "me" }),
      ].map((p) => [p.id, p]),
    );
    const groups = groupPacks(packs, "s1", "me");
    expect(groups.map((g) => [g.label, g.packs.map((p) => p.id)])).toEqual([
      ["This Server", ["p6", "p1"]],
      ["My Packs", ["p2"]],
      ["Installed", ["p4", "p3"]],
      ["Other Servers", ["p5"]],
    ]);
    const ids = groups.flatMap((g) => g.packs.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves out groups with nothing in them", () => {
    expect(groupPacks({}, "s1", "me")).toEqual([]);
    expect(groupPacks({ p2: pack("p2", { owner_user_id: "me" }) }, null, "me").map((g) => g.label)).toEqual(["My Packs"]);
  });
});

describe("removeServer", () => {
  it("drops the server's packs even when it has no custom emoji", () => {
    useExpressions.getState().clear();
    useExpressions.getState().setPacks([pack("p1", { server_id: "s1" }), pack("p2", { owner_user_id: "me" })]);
    useExpressions.getState().removeServer("s1");
    expect(Object.keys(useExpressions.getState().packs)).toEqual(["p2"]);
  });
});
