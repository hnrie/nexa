// @vitest-environment jsdom
/**
 * The index as the app runs it: fed by live messages, edits, pins and
 * deletions from the gateway and by the pages the chat loads, and closed the
 * moment the keys go.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Channel, Message } from "@/api/types";
import { dispatchHooks } from "@/gateway/dispatch";
import type { DecryptedMessage } from "@/lib/decrypt";
import { parseQuery, resolveQuery } from "@/lib/search";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { historyHooks } from "@/stores/messages";
import { closeSearchIndex, installSearchIndex, openSearchIndex, parseCrawl, querySearch, useSearchIndex } from "./indexer";

function msg(id: string, text: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  const m: Message = { id, channel_id: "500", author_id: "u2", type: "default", ciphertext: null, key_conv_id: "k", key_epoch: 1, reply_to_id: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: Number(id) };
  return { ...m, payload: { t: text }, ...extra };
}

async function find(q: string): Promise<string[]> {
  const res = await querySearch({ query: resolveQuery(parseQuery(q), { users: {}, channelNames: {} }), scope: null, tab: "messages", sort: "newest", offset: 0, limit: 50 });
  return res.docs.map((d) => d.id);
}

/** Lets the index's worker (here, in the page) catch up with what it was sent. */
async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeAll(async () => {
  useChannels.getState().upsert({ id: "500", type: "dm", server_id: null, name: "", recipient_ids: ["u1", "u2"], last_message_id: null } as unknown as Channel);
  installSearchIndex();
  await openSearchIndex({ userId: "u1", identityPrivateKey: null, keep: false });
});

afterAll(() => closeSearchIndex());

const live = (m: DecryptedMessage) => {
  for (const h of dispatchHooks.onMessage) h(m, false, m);
};

describe("the index, kept current", () => {
  it("takes in messages as they arrive, and follows their edits, pins and deletions", async () => {
    live(msg("1000", "the ferry leaves at noon"));
    await settled();
    expect(await find("ferry")).toEqual(["1000"]);
    for (const h of dispatchHooks.onMessageChange) h({ kind: "update", msg: msg("1000", "the train leaves at noon", { edited_at: 5 }) });
    await settled();
    expect(await find("ferry")).toEqual([]);
    expect(await find("train")).toEqual(["1000"]);
    for (const h of dispatchHooks.onMessageChange) h({ kind: "pin", channelId: "500", id: "1000", pinned: true });
    await settled();
    expect(await find("pinned:yes")).toEqual(["1000"]);
    for (const h of dispatchHooks.onMessageChange) h({ kind: "delete", channelId: "500", ids: ["1000"] });
    await settled();
    expect(await find("train")).toEqual([]);
  });

  it("learns from the pages the chat loads, including what was deleted meanwhile", async () => {
    for (const id of ["2001", "2002", "2003"]) live(msg(id, `lunch plan ${id}`));
    await settled();
    expect(await find("lunch")).toEqual(["2003", "2002", "2001"]);
    // the chat loads a page: 2002 is not in it any more, and 2004 is new
    for (const h of historyHooks) h("500", [msg("2001", "lunch plan 2001"), msg("2003", "lunch plan 2003"), msg("2004", "lunch plan 2004")]);
    await settled();
    expect(await find("lunch")).toEqual(["2004", "2003", "2001"]);
  });

  it("forgets a conversation that goes", async () => {
    live(msg("3000", "a message in a group that is deleted"));
    await settled();
    for (const h of dispatchHooks.onMessageChange) h({ kind: "channelsGone", channelIds: ["500"] });
    await settled();
    expect(await find("group")).toEqual([]);
  });

  it("closes when the keys go, and answers nothing while closed", async () => {
    live(msg("4000", "still here"));
    await settled();
    expect(await find("still")).toEqual(["4000"]);
    useKeys.getState().reset();
    expect(useSearchIndex.getState().mode).toBe("closed");
    expect(await find("still")).toEqual([]);
  });
});

describe("a saved walk", () => {
  it("is taken back only in the shape it was saved in", () => {
    expect(parseCrawl({ v: 1, channels: { "12": { newest: "40", oldest: "3", done: true } } })).toEqual({ v: 1, channels: { "12": { newest: "40", oldest: "3", done: true } } });
    expect(parseCrawl({ v: 2, channels: {} })).toBeNull();
    expect(parseCrawl("nonsense")).toBeNull();
    // anything odd inside is left out rather than trusted
    expect(parseCrawl({ v: 1, channels: { "12": { newest: 40 }, abc: { done: true }, "13": { done: "yes" } } })).toEqual({ v: 1, channels: {} });
  });
});
