import { describe, expect, it } from "vitest";
import type { Message } from "@/api/types";
import { decryptForStore } from "./decrypt";

function message(over: Partial<Message>): Message {
  return {
    id: "100",
    channel_id: "5",
    author_id: "9",
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: 1_790_000_000_000,
    ...over,
  };
}

describe("decryptForStore, for a webhook's message", () => {
  it("takes its words and files as they came, with nothing to decrypt", async () => {
    const out = await decryptForStore(
      message({
        webhook_id: "77",
        webhook: {
          name: "Deploys",
          content: "Shipped **v2**",
          embeds: [{ title: "Changelog" }],
          attachments: [
            { id: "1", blob_id: "10", filename: "notes.txt", size: 3 },
            { id: "2", blob_id: "20", filename: "shot.png", size: 9, inline: true },
          ],
        },
      }),
    );
    expect(out.decryptError).toBeUndefined();
    expect(out.hook?.name).toBe("Deploys");
    expect(out.hook?.embeds[0]?.title).toBe("Changelog");
    expect(out.payload).toEqual({ t: "Shipped **v2**", att: [{ blob_id: "10", name: "notes.txt", type: "application/octet-stream", size: 3, key: "", plain: true }] });
  });

  it("gives a message with only embeds an empty payload rather than none, so it still shows", async () => {
    const out = await decryptForStore(message({ webhook_id: "77", webhook: { name: "x", embeds: [{ title: "Only an embed" }] } }));
    expect(out.payload).toEqual({});
    expect(out.hook?.embeds).toHaveLength(1);
  });

  it("keeps a poll's result line a line, with its hook for the numbers", async () => {
    const out = await decryptForStore(message({ type: "system_poll_result", webhook_id: "77", webhook: { name: "x", embeds: [{ type: "poll_result", fields: [] }] } }));
    expect(out.payload).toBeUndefined();
    expect(out.hook?.embeds[0]?.type).toBe("poll_result");
  });

  it("marks one it cannot read as unreadable instead of throwing", async () => {
    const out = await decryptForStore(message({ webhook_id: "77", webhook: "garbage" }));
    expect(out.decryptError).toBe("bad");
    expect(out.hook).toBeUndefined();
  });

  it("forgets what an earlier copy held when the message is read again", async () => {
    const first = await decryptForStore(message({ webhook_id: "77", webhook: { name: "x", content: "first" } }));
    const again = await decryptForStore({ ...first, webhook: { name: "x", content: "edited" } });
    expect(again.payload?.t).toBe("edited");
    expect(again.hook?.content).toBe("edited");
  });
});
