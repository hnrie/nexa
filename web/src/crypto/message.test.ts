import { b64, equal, randomBytes, utf8 } from "./bytes";
import { channelKey, newRootKey } from "./conv";
import { DecryptError } from "./keys";
import {
  aadBytes,
  decryptMessage,
  encryptMessage,
  isEnvelope,
  type Aad,
  type AttachmentMeta,
  type Envelope,
  type MessagePayload,
} from "./message";

const root = newRootKey();
const key = channelKey(root, "chan-1");
const aad: Aad = { conv: "conv-1", epoch: 2, channelId: "chan-1", authorId: "user-1" };

/** Encrypt arbitrary bytes under the real key and AAD, bypassing the JSON layer. */
async function forgeEnvelope(plaintext: Uint8Array, a: Aad = aad): Promise<Envelope> {
  const iv = randomBytes(12);
  const k = await crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, ["encrypt"]);
  const params: AesGcmParams = { name: "AES-GCM", iv: new Uint8Array(iv), additionalData: new Uint8Array(aadBytes(a)) };
  const ct = await crypto.subtle.encrypt(params, k, new Uint8Array(plaintext));
  return { v: 1, conv: a.conv, epoch: a.epoch, iv: b64.enc(iv), ct: b64.enc(new Uint8Array(ct)) };
}

describe("aadBytes", () => {
  it("binds conversation, epoch, channel and author", () => {
    expect(utf8.dec(aadBytes(aad))).toBe("conv-1|2|chan-1|user-1");
  });

  it("changes when any field changes", () => {
    const base = aadBytes(aad);
    expect(equal(aadBytes({ ...aad, conv: "conv-2" }), base)).toBe(false);
    expect(equal(aadBytes({ ...aad, epoch: 3 }), base)).toBe(false);
    expect(equal(aadBytes({ ...aad, channelId: "chan-2" }), base)).toBe(false);
    expect(equal(aadBytes({ ...aad, authorId: "user-2" }), base)).toBe(false);
  });
});

describe("encryptMessage / decryptMessage", () => {
  it("round trips a text payload", async () => {
    const payload: MessagePayload = { t: "hello world" };
    const env = await encryptMessage(key, aad, payload);
    expect(await decryptMessage(key, env, aad)).toEqual(payload);
  });

  it("round trips unicode, emoji and control characters", async () => {
    const payload: MessagePayload = {
      t: "日本語 — café 🚀 привет\nline\ttab \"quoted\" \\slash",
    };
    const env = await encryptMessage(key, aad, payload);
    const out = await decryptMessage(key, env, aad);
    expect(out.t).toBe(payload.t);
  });

  it("round trips attachments, stickers, embeds and flags", async () => {
    const att: AttachmentMeta[] = [
      { blob_id: "b1", name: "cat.png", type: "image/png", size: 12345, w: 800, h: 600, key: b64.enc(randomBytes(32)) },
      { blob_id: "b2", name: "clip.mp4", type: "video/mp4", size: 99, key: b64.enc(randomBytes(32)), spoiler: true, duration: 4.5 },
    ];
    const payload: MessagePayload = { t: "look", att, sticker: { id: "s1" }, embeds: [{ url: "https://example.com" }], flags: 3 };
    const env = await encryptMessage(key, aad, payload);
    expect(await decryptMessage(key, env, aad)).toEqual(payload);
  });

  it("round trips an empty payload", async () => {
    const env = await encryptMessage(key, aad, {});
    expect(await decryptMessage(key, env, aad)).toEqual({});
  });

  it("stamps the envelope from the aad", async () => {
    const env = await encryptMessage(key, aad, { t: "x" });
    expect(env.v).toBe(1);
    expect(env.conv).toBe(aad.conv);
    expect(env.epoch).toBe(aad.epoch);
    expect(isEnvelope(env)).toBe(true);
  });

  it("emits a fresh 12-byte iv and a different ciphertext each time", async () => {
    const payload: MessagePayload = { t: "same" };
    const a = await encryptMessage(key, aad, payload);
    const b = await encryptMessage(key, aad, payload);
    expect(b64.dec(a.iv).length).toBe(12);
    expect(b64.dec(b.iv).length).toBe(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("rejects the wrong channel key", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    await expect(decryptMessage(channelKey(root, "chan-2"), env, aad)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptMessage(channelKey(newRootKey(), "chan-1"), env, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects an aad mismatch on any field", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    const mismatches: Aad[] = [
      { ...aad, channelId: "chan-2" },
      { ...aad, authorId: "user-2" },
      { ...aad, conv: "conv-2" },
      { ...aad, epoch: 3 },
    ];
    for (const m of mismatches) {
      await expect(decryptMessage(key, env, m)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects a tampered ciphertext", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    const ct = b64.dec(env.ct);
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    await expect(decryptMessage(key, { ...env, ct: b64.enc(ct) }, aad)).rejects.toBeInstanceOf(DecryptError);

    const iv = b64.dec(env.iv);
    iv[0] = (iv[0] ?? 0) ^ 0x01;
    await expect(decryptMessage(key, { ...env, iv: b64.enc(iv) }, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects malformed base64", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    await expect(decryptMessage(key, { ...env, ct: "not base64!" }, aad)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptMessage(key, { ...env, iv: "%%%%" }, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects an iv of the wrong length", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    await expect(decryptMessage(key, { ...env, iv: b64.enc(randomBytes(16)) }, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects an unsupported envelope version", async () => {
    const env = await encryptMessage(key, aad, { t: "secret" });
    const bumped = { ...env, v: 2 } as unknown as Envelope;
    await expect(decryptMessage(key, bumped, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects an authentic ciphertext that is not JSON", async () => {
    const env = await forgeEnvelope(utf8.enc("this is not json"));
    await expect(decryptMessage(key, env, aad)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects an authentic ciphertext holding JSON that is not an object", async () => {
    for (const json of ["42", '"a string"', "null", "[1,2,3]", "true"]) {
      const env = await forgeEnvelope(utf8.enc(json));
      await expect(decryptMessage(key, env, aad)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects a payload whose content all has the wrong types", async () => {
    for (const json of ['{"t":1}', '{"att":"x"}', '{"embeds":[null]}', '{"sticker":{"id":5}}', '{"att":[{"blob_id":"b"}],"t":{}}']) {
      const env = await forgeEnvelope(utf8.enc(json));
      await expect(decryptMessage(key, env, aad)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("drops wrongly typed fields and keeps the usable ones", async () => {
    const good = { blob_id: "b1", name: "a.png", type: "image/png", size: 10, key: "k", w: 5 };
    const forged = {
      t: "hi",
      att: [good, { ...good, size: -1 }, { ...good, name: 7 }, null, { ...good, blob_id: "b2", w: "wide", spoiler: "yes" }],
      sticker: { id: "s", w: "x", name: {} },
      embeds: [null, 3, { url: "https://e.x", title: { bad: true }, image_w: "9", type: "link" }],
      flags: "3",
      extra: 1,
    };
    const env = await forgeEnvelope(utf8.enc(JSON.stringify(forged)));
    expect(await decryptMessage(key, env, aad)).toEqual({
      t: "hi",
      att: [good, { blob_id: "b2", name: "a.png", type: "image/png", size: 10, key: "k" }],
      sticker: { id: "s" },
      embeds: [{ url: "https://e.x", type: "link" }],
    });
  });
});

describe("isEnvelope", () => {
  const good: Envelope = { v: 1, conv: "c", epoch: 0, iv: "AAAA", ct: "BBBB" };

  it("accepts a well-formed envelope", () => {
    expect(isEnvelope(good)).toBe(true);
    expect(isEnvelope({ ...good, extra: "ignored" })).toBe(true);
  });

  it("rejects non-objects", () => {
    for (const x of [null, undefined, 0, 1, "", "envelope", true, [], () => undefined]) {
      expect(isEnvelope(x)).toBe(false);
    }
  });

  it("rejects missing or mistyped fields", () => {
    const bad: unknown[] = [
      {},
      { ...good, v: 2 },
      { ...good, v: "1" },
      { ...good, conv: 1 },
      { ...good, epoch: "0" },
      { ...good, epoch: 1.5 },
      { ...good, epoch: Number.NaN },
      { ...good, iv: null },
      { ...good, ct: undefined },
      { v: 1, conv: "c", epoch: 0, iv: "AAAA" },
    ];
    for (const x of bad) expect(isEnvelope(x)).toBe(false);
  });

  it("narrows the type for the compiler", () => {
    const x: unknown = good;
    if (!isEnvelope(x)) throw new Error("expected an envelope");
    expect(x.conv).toBe("c");
  });
});

describe("polls in the payload", () => {
  const poll = {
    question: "Lunch?",
    answers: [{ text: "Pizza", emoji: { name: "🍕" } }, { text: "Soup" }, { text: "Salad", emoji: { id: "123456789", name: "leaf", animated: true } }],
    hours: 24,
    multiselect: true,
  };

  it("round trips a poll, sealed with the rest of the message", async () => {
    const env = await encryptMessage(key, aad, { poll });
    expect(env.ct).not.toContain("Lunch");
    expect(await decryptMessage(key, env, aad)).toEqual({ poll });
  });

  it("holds a poll to the lengths the dialog allows, and fills in what it leaves unsaid", async () => {
    const long = { question: "q".repeat(400), answers: [{ text: "a".repeat(80), emoji: { name: "🍕", id: "not-an-id" } }, { text: "b", emoji: { name: 5 } }], hours: 9999, multiselect: "yes" };
    const env = await forgeEnvelope(utf8.enc(JSON.stringify({ poll: long })));
    const out = await decryptMessage(key, env, aad);
    expect(out.poll).toEqual({ question: "q".repeat(300), answers: [{ text: "a".repeat(55), emoji: { name: "🍕" } }, { text: "b" }], hours: 24, multiselect: false });
  });

  it("never cuts an emoji in half", async () => {
    const env = await forgeEnvelope(utf8.enc(JSON.stringify({ poll: { ...poll, answers: [{ text: "x".repeat(54) + "🍕🍕" }, { text: "b" }] } })));
    expect((await decryptMessage(key, env, aad)).poll?.answers[0]?.text).toBe("x".repeat(54) + "🍕");
  });

  it("keeps a message's other content when its poll is unusable", async () => {
    for (const bad of [
      { ...poll, question: "" },
      { ...poll, question: 7 },
      { ...poll, answers: [{ text: "only one" }] },
      { ...poll, answers: Array.from({ length: 11 }, (_, i) => ({ text: `a${i}` })) },
      // a broken answer would shift the ids of those after it, so the poll goes
      { ...poll, answers: [{ text: "a" }, null, { text: "c" }] },
      { ...poll, answers: [{ text: "a" }, { text: 2 }] },
      "poll",
    ]) {
      const env = await forgeEnvelope(utf8.enc(JSON.stringify({ t: "hi", poll: bad })));
      expect(await decryptMessage(key, env, aad)).toEqual({ t: "hi" });
    }
  });

  it("rejects a payload whose only content is a poll it cannot use", async () => {
    const env = await forgeEnvelope(utf8.enc(JSON.stringify({ poll: { question: "q", answers: [] } })));
    await expect(decryptMessage(key, env, aad)).rejects.toBeInstanceOf(DecryptError);
  });
});
