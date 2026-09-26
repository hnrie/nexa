import { describe, expect, it } from "vitest";
import type { DecryptedMessage } from "@/lib/decrypt";
import { sanitizeHook } from "@/lib/webhookMessage";
import { searchableText, toDoc } from "./doc";

function hookMessage(webhook: unknown, over: Partial<DecryptedMessage> = {}): DecryptedMessage {
  const hook = sanitizeHook(webhook)!;
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
    webhook_id: "77",
    webhook,
    hook,
    payload: hook.content ? { t: hook.content } : {},
    ...over,
  };
}

describe("toDoc, for a webhook's message", () => {
  it("indexes the name it was sent as and the words in its embeds, components and poll", () => {
    const doc = toDoc(
      hookMessage({
        name: "Status Page",
        content: "Incident update",
        embeds: [{ title: "Database degraded", fields: [{ name: "Region", value: "eu-west" }] }],
        components: [{ type: 10, content: "Follow along" }],
        poll: { question: { text: "Was this useful?" }, answers: [{ answer_id: 1, poll_media: { text: "Yes" } }] },
        link_embeds: [{ url: "https://status.example.com", title: "Status" }],
      }),
    )!;
    expect(doc.t).toBe("Incident update");
    expect(doc.hn).toBe("Status Page");
    expect(doc.hx).toBe(["Database degraded", "Region", "eu-west", "Follow along", "Was this useful?", "Yes"].join("\n"));
    expect(doc.emb).toEqual([{ url: "https://status.example.com", title: "Status" }]);
    const text = searchableText(doc);
    // a preview's title is found as a linked page's is
    for (const word of ["Status Page", "eu-west", "Follow along", "Was this useful?", "\nStatus"]) expect(text).toContain(word);
  });

  it("leaves the webhook fields off a message with nothing more to say", () => {
    const doc = toDoc(hookMessage({ name: "Bot", content: "just text" }))!;
    expect(doc.hn).toBe("Bot");
    expect(doc.hx).toBeUndefined();
    expect(doc.emb).toBeUndefined();
  });

  it("does not index a poll's result line", () => {
    expect(toDoc(hookMessage({ name: "Bot" }, { type: "system_poll_result", payload: undefined }))).toBeNull();
  });
});
