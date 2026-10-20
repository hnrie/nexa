import { beforeEach, describe, expect, it } from "vitest";
import { BOT_FLAG } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { generateIdentity, open } from "@/crypto/keys";
import { useChannels } from "@/stores/channels";
import { useUsers } from "@/stores/users";
import { addressedBots, MAX_BOT_COPIES, sealCopies } from "./botCopies";

const bot = generateIdentity();

function user(id: string, flags = 0) {
  return { id, username: `u${id}`, display_name: `U${id}`, avatar_id: null, flags, public_key: b64.enc(bot.publicKey) } as never;
}

beforeEach(() => {
  useUsers.setState({ byId: { "1": user("1"), "2": user("2"), "10": user("10", BOT_FLAG), "11": user("11", BOT_FLAG) } });
  useChannels.setState({
    byId: {
      dm: { id: "dm", type: "dm", server_id: null, recipient_ids: ["1", "10"] },
      text: { id: "text", type: "text", server_id: "s", recipient_ids: [] },
    } as never,
  });
});

describe("the bots a message is addressed to", () => {
  it("is the other side of a conversation with a bot", () => {
    expect(addressedBots("dm", [], undefined, "1").map((u) => u.id)).toEqual(["10"]);
  });

  it("is the bots it mentions and the one it replies to, never people", () => {
    expect(addressedBots("text", ["2", "11"], "10", "1").map((u) => u.id)).toEqual(["11", "10"]);
  });

  it("counts each bot once and never the sender", () => {
    expect(addressedBots("text", ["10", "10"], "10", "10").map((u) => u.id)).toEqual([]);
    expect(addressedBots("text", ["10", "10", "11"], "11", "1").map((u) => u.id)).toEqual(["10", "11"]);
  });

  it("stops at the most copies a message carries", () => {
    const many: Record<string, unknown> = {};
    const ids: string[] = [];
    for (let i = 100; i < 100 + MAX_BOT_COPIES + 3; i++) {
      many[String(i)] = user(String(i), BOT_FLAG);
      ids.push(String(i));
    }
    useUsers.setState({ byId: many as never });
    expect(addressedBots("text", ids, undefined, "1")).toHaveLength(MAX_BOT_COPIES);
  });
});

describe("sealed copies", () => {
  it("open with the bot's key to the message as sent", async () => {
    const copies = await sealCopies([user("10", BOT_FLAG)], { t: "hello <@10>" });
    const opened = await open(bot.privateKey, bot.publicKey, b64.dec(copies["10"]!));
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ t: "hello <@10>" });
  });
});
