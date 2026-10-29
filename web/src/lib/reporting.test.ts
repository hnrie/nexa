import { describe, expect, it } from "vitest";
import { messageEvidence } from "./reporting";
import type { DecryptedMessage } from "./decrypt";

describe("report evidence privacy", () => {
  it("copies individual readable parts without attachment keys or envelopes", () => {
    const msg = {
      id: "123",
      ciphertext: { secret: "encrypted envelope" },
      payload: {
        t: "The selected message text",
        fwd: { at: 1, comment: "Forward comment" },
        att: [
          {
            blob: "456",
            name: "proof.png",
            type: "image/png",
            size: 100,
            key: "secret attachment key",
          },
        ],
        sticker: { id: "789", name: "Sticker", blob: "777" },
        embeds: [
          {
            title: "Link title",
            url: "https://example.com",
            description: "Description",
            internal: "not evidence",
          },
        ],
      },
    } as unknown as DecryptedMessage;
    const evidence = messageEvidence(msg);
    expect(evidence.map((e) => e.part)).toEqual([
      "text",
      "attachment",
      "sticker",
      "embed",
    ]);
    const text = JSON.stringify(evidence);
    expect(text).toContain("proof.png");
    expect(text).toContain("Forward comment");
    expect(text).not.toContain("secret attachment key");
    expect(text).not.toContain("encrypted envelope");
    expect(text).not.toContain("not evidence");
    expect(evidence.every((e) => !("selected" in e))).toBe(true);
  });
  it("does not fabricate plaintext when decryption is unavailable", () => {
    expect(
      messageEvidence({
        id: "123",
        decryptError: "no_key",
      } as DecryptedMessage),
    ).toEqual([]);
  });
});

import { noticeTitle, noticeExplainer } from "./moderation";
it("describes reported-message removal without claiming the account was deleted", () => {
  expect(noticeTitle("message_remove", {})).toBe("Message Removed");
  expect(
    noticeExplainer({
      action: "message_remove",
      details: {},
      expires_at: null,
    }),
  ).toContain("Your other messages and your account are unchanged");
});
