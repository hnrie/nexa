import { describe, expect, it } from "vitest";
import { fullReportedMessage, messageEvidence } from "./reporting";
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
    expect(text).toContain("not evidence");
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

describe("complete message reports", () => {
  it("shares every readable field and every file, without conversation keys", () => {
    const msg = {
      id: "1",
      type: "message",
      edited_at: 123,
      channel_key: "private channel key",
      ciphertext: { ct: "secret envelope" },
      attachments: [{ blob_id: "2" }],
      payload: {
        t: "Entire message, including the ending",
        att: [
          {
            blob_id: "2",
            name: "evidence.txt",
            type: "text/plain",
            size: 20,
            key: "per-file key",
          },
        ],
        embeds: [{ fields: [{ name: "Field", value: "Full value" }] }],
        poll: {
          question: "Question",
          answers: [{ text: "Answer" }],
          hours: 1,
          multiselect: false,
        },
        fwd: { at: 1, comment: "Full comment" },
      },
    } as unknown as DecryptedMessage;
    const result = fullReportedMessage(msg)!;
    expect(result.content.t).toBe("Entire message, including the ending");
    expect(JSON.stringify(result.content)).toContain("Full value");
    expect(JSON.stringify(result.content)).not.toContain("per-file key");
    expect(result.attachments[0]?.key).toBe("per-file key");
    expect(JSON.stringify(result)).not.toContain("private channel key");
    expect(JSON.stringify(result)).not.toContain("secret envelope");
    expect(result.edited_at).toBe(123);
  });
  it("blocks reports when plaintext or an attachment is unavailable", () => {
    expect(
      fullReportedMessage({ decryptError: "no_key" } as DecryptedMessage),
    ).toBeNull();
    expect(
      fullReportedMessage({
        type: "message",
        payload: { t: "text" },
        attachments: [{ blob_id: "3" }],
      } as DecryptedMessage),
    ).toBeNull();
  });
});
