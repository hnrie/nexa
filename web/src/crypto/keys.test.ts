import { concat, equal, randomBytes, utf8 } from "./bytes";
import {
  DecryptError,
  generateIdentity,
  open,
  publicKeyOf,
  seal,
  unwrapGrant,
  unwrapPrivateKey,
  wrapGrant,
  wrapPrivateKey,
} from "./keys";

describe("DecryptError", () => {
  it("is an Error named DecryptError", () => {
    const err = new DecryptError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DecryptError);
    expect(err.name).toBe("DecryptError");
    expect(err.message).toBe("nope");
  });
});

describe("generateIdentity / publicKeyOf", () => {
  it("produces a 32-byte x25519 key pair", () => {
    const id = generateIdentity();
    expect(id.privateKey.length).toBe(32);
    expect(id.publicKey.length).toBe(32);
  });

  it("produces a fresh key pair each time", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(equal(a.privateKey, b.privateKey)).toBe(false);
    expect(equal(a.publicKey, b.publicKey)).toBe(false);
  });

  it("recomputes the public key from the private key", () => {
    const id = generateIdentity();
    expect(equal(publicKeyOf(id.privateKey), id.publicKey)).toBe(true);
    expect(equal(publicKeyOf(id.privateKey), publicKeyOf(id.privateKey))).toBe(true);
  });
});

describe("wrapPrivateKey / unwrapPrivateKey", () => {
  const encKey = new Uint8Array(32).fill(3);

  it("round trips the private key", async () => {
    const id = generateIdentity();
    const blob = await wrapPrivateKey(id.privateKey, encKey);
    expect(equal(await unwrapPrivateKey(blob, encKey), id.privateKey)).toBe(true);
  });

  it("emits iv(12) followed by the AES-GCM ciphertext and tag", async () => {
    const id = generateIdentity();
    const blob = await wrapPrivateKey(id.privateKey, encKey);
    expect(blob.length).toBe(12 + 32 + 16);
  });

  it("uses a fresh iv for every wrap", async () => {
    const id = generateIdentity();
    const a = await wrapPrivateKey(id.privateKey, encKey);
    const b = await wrapPrivateKey(id.privateKey, encKey);
    expect(equal(a, b)).toBe(false);
    expect(equal(a.subarray(0, 12), b.subarray(0, 12))).toBe(false);
  });

  it("rejects the wrong encryption key", async () => {
    const id = generateIdentity();
    const blob = await wrapPrivateKey(id.privateKey, encKey);
    await expect(unwrapPrivateKey(blob, new Uint8Array(32).fill(4))).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a tampered blob", async () => {
    const id = generateIdentity();
    const blob = await wrapPrivateKey(id.privateKey, encKey);
    for (let i = 0; i < blob.length; i++) {
      const bad = blob.slice();
      bad[i] = (bad[i] ?? 0) ^ 0x40;
      await expect(unwrapPrivateKey(bad, encKey)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects a truncated blob", async () => {
    await expect(unwrapPrivateKey(new Uint8Array(0), encKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapPrivateKey(new Uint8Array(12), encKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapPrivateKey(new Uint8Array(20), encKey)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("seal / open", () => {
  it("round trips a payload to the recipient", async () => {
    const me = generateIdentity();
    const data = utf8.enc("the quick brown fox");
    const blob = await seal(me.publicKey, data);
    expect(equal(await open(me.privateKey, me.publicKey, blob), data)).toBe(true);
  });

  it("round trips an empty payload", async () => {
    const me = generateIdentity();
    const blob = await seal(me.publicKey, new Uint8Array(0));
    expect((await open(me.privateKey, me.publicKey, blob)).length).toBe(0);
  });

  it("emits ephemeral public key(32), iv(12), ciphertext and tag", async () => {
    const me = generateIdentity();
    const data = randomBytes(20);
    const blob = await seal(me.publicKey, data);
    expect(blob.length).toBe(32 + 12 + 20 + 16);
  });

  it("uses a fresh ephemeral key per seal", async () => {
    const me = generateIdentity();
    const data = utf8.enc("same plaintext");
    const a = await seal(me.publicKey, data);
    const b = await seal(me.publicKey, data);
    expect(equal(a.subarray(0, 32), b.subarray(0, 32))).toBe(false);
    expect(equal(a, b)).toBe(false);
  });

  it("rejects the wrong recipient key", async () => {
    const me = generateIdentity();
    const other = generateIdentity();
    const blob = await seal(me.publicKey, utf8.enc("secret"));
    await expect(open(other.privateKey, other.publicKey, blob)).rejects.toBeInstanceOf(DecryptError);
    await expect(open(other.privateKey, me.publicKey, blob)).rejects.toBeInstanceOf(DecryptError);
    await expect(open(me.privateKey, other.publicKey, blob)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a flip of any single byte", async () => {
    const me = generateIdentity();
    const blob = await seal(me.publicKey, utf8.enc("0123456789abcdef"));
    for (let i = 0; i < blob.length; i++) {
      const bad = blob.slice();
      bad[i] = (bad[i] ?? 0) ^ 0x01;
      await expect(open(me.privateKey, me.publicKey, bad)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects an appended or truncated blob", async () => {
    const me = generateIdentity();
    const blob = await seal(me.publicKey, utf8.enc("hello"));
    await expect(open(me.privateKey, me.publicKey, concat(blob, new Uint8Array([0])))).rejects.toBeInstanceOf(DecryptError);
    await expect(open(me.privateKey, me.publicKey, blob.subarray(0, blob.length - 1))).rejects.toBeInstanceOf(DecryptError);
    await expect(open(me.privateKey, me.publicKey, new Uint8Array(10))).rejects.toBeInstanceOf(DecryptError);
    await expect(open(me.privateKey, me.publicKey, new Uint8Array(0))).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("wrapGrant / unwrapGrant", () => {
  it("aliases seal and open", () => {
    expect(wrapGrant).toBe(seal);
    expect(unwrapGrant).toBe(open);
  });

  it("round trips a conversation root key", async () => {
    const member = generateIdentity();
    const root = randomBytes(32);
    const wrapped = await wrapGrant(member.publicKey, root);
    expect(equal(await unwrapGrant(member.privateKey, member.publicKey, wrapped), root)).toBe(true);
  });

  it("rejects a grant meant for somebody else", async () => {
    const member = generateIdentity();
    const outsider = generateIdentity();
    const wrapped = await wrapGrant(member.publicKey, randomBytes(32));
    await expect(unwrapGrant(outsider.privateKey, outsider.publicKey, wrapped)).rejects.toBeInstanceOf(DecryptError);
  });
});
