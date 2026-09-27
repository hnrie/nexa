/**
 * Cross-language test vectors shared with internal/e2ee, the Go copy of this
 * module.
 *
 * - generate() runs the real functions here with a deterministic stand-in for
 *   crypto.getRandomValues, and records what each call produced together with
 *   the random bytes it took. The result is internal/e2ee/testdata/ts-vectors.json:
 *   the Go tests replay those bytes, must produce the same output byte for
 *   byte, and open everything. A normal run regenerates the vectors and checks
 *   that the file still matches; `WRITE_VECTORS=1 npx vitest run src/crypto/vectors.test.ts`
 *   rewrites it.
 * - testdata/go-vectors.json is written the same way by the Go tests
 *   (`WRITE_VECTORS=1 go test ./internal/e2ee`), and verify() replays and opens it here.
 *
 * The plaintext of every file vector is pattern(size), so large files need no
 * room in the fixtures; only their SHA-256 is kept.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bufferSource, gcmEncrypt } from "./aes";
import {
  botTokenHash,
  createBotIdentity,
  isBotToken,
  newBotToken,
  openBotEscrow,
  rewrapBotIdentity,
  sealBotEscrow,
  unwrapBotIdentity,
  wrapBotIdentity,
} from "./botIdentity";
import { b64, concat, equal, u32be, utf8 } from "./bytes";
import { channelKey, voiceFrameKey } from "./conv";
import { CHUNK, decryptFile, encryptFile, encryptedSize } from "./file";
import { DecryptError, type Identity, generateIdentity, open, publicKeyOf, seal, wrapGrant } from "./keys";
import { type Aad, type Envelope, type MessagePayload, decryptMessage, encryptMessage } from "./message";

const WRITE = process.env["WRITE_VECTORS"] === "1";
const TS_VECTORS = resolve(__dirname, "../../../internal/e2ee/testdata/ts-vectors.json");
const GO_VECTORS = resolve(__dirname, "testdata/go-vectors.json");

interface SealedVector {
  name: string;
  /** base64 of the random bytes the call took; "" when it was built by hand and cannot be replayed. */
  random: string;
  recipientPriv: string;
  recipientPub: string;
  data: string;
  blob: string;
}

interface BadSealedVector {
  name: string;
  recipientPriv: string;
  recipientPub: string;
  blob: string;
}

interface MessageVector {
  name: string;
  random: string;
  root: string;
  aad: Aad;
  /** base64 of the exact JSON that was encrypted. */
  plaintext: string;
  envelope: Envelope;
  /** What the web client's decryptMessage returns, or null when it refuses the message. */
  decrypted: unknown;
  error: boolean;
  /** The payload only has members Go's setters write, in the order they write them. */
  rebuild: boolean;
}

interface FileVector {
  name: string;
  size: number;
  random: string;
  key: string;
  baseIv: string;
  cipherSha256: string;
  /** The whole ciphertext, for small files. */
  cipher?: string;
}

interface Vectors {
  comment: string;
  identities: { priv: string; pub: string }[];
  sealed: SealedVector[];
  sealedBad: BadSealedVector[];
  grants: SealedVector[];
  channelKeys: { root: string; epoch: number; channelId: string; chanKey: string; voiceKey: string }[];
  messages: MessageVector[];
  files: FileVector[];
  encryptedSizes: { size: number; encrypted: number }[];
  botTokens: { token: string; valid: boolean }[];
  botWraps: { random: string; token: string; tokenHash: string; priv: string; pub: string; wrapped: string }[];
  botEscrows: { random: string; ownerPriv: string; ownerPub: string; botPriv: string; botPub: string; escrow: string }[];
  botCreated: {
    ownerPriv: string;
    ownerPub: string;
    token: string;
    tokenHash: string;
    botPriv: string;
    botPub: string;
    wrapped: string;
    escrow: string;
    newToken: string;
    newTokenHash: string;
    rewrapped: string;
  };
}

const enc = (u: Uint8Array): string => b64.enc(u);
const dec = (s: string): Uint8Array => b64.dec(s);
const hex = (u: Uint8Array): string => Array.from(u, (x) => x.toString(16).padStart(2, "0")).join("");
const b64url = (u: Uint8Array): string => enc(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The plaintext of every file vector; Go writes the same bytes. */
function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) % 251;
  return out;
}

/** SHA-256 in counter mode over a seed: the vectors' stand-in for a random source. */
class Stream {
  private counter = 0;
  private pool: Uint8Array = new Uint8Array(0);
  constructor(private readonly seed: string) {}

  take(n: number): Uint8Array {
    while (this.pool.length < n) {
      this.pool = concat(this.pool, sha256(concat(utf8.enc(this.seed), u32be(this.counter++))));
    }
    const out = this.pool.slice(0, n);
    this.pool = this.pool.slice(n);
    return out;
  }
}

/** Run fn with crypto.getRandomValues answering from `source`; returns what it gave out. */
async function withRandom<T>(source: (n: number) => Uint8Array, fn: () => Promise<T> | T): Promise<{ out: T; random: Uint8Array }> {
  const given: Uint8Array[] = [];
  const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((arr: ArrayBufferView) => {
    const bytes = source(arr.byteLength);
    new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
    given.push(bytes);
    return arr;
  }) as typeof crypto.getRandomValues);
  try {
    const out = await fn();
    return { out, random: concat(...given) };
  } finally {
    spy.mockRestore();
  }
}

/** Run fn on random bytes recorded by the other side, which it must use up exactly. */
async function replaying<T>(random: string, fn: () => Promise<T> | T): Promise<T> {
  const bytes = dec(random);
  let at = 0;
  const { out } = await withRandom((n) => {
    if (at + n > bytes.length) throw new Error("replay: the recorded random bytes ran out");
    at += n;
    return bytes.slice(at - n, at);
  }, fn);
  expect(at).toBe(bytes.length);
  return out;
}

const P = 2n ** 255n - 19n;
/** x25519 u-coordinates of small order: with any clamped scalar the shared secret is all zeros. */
const LOW_ORDER = [
  0n,
  1n,
  325606250916557431795983626356110631294008115727848805560023387167927233504n,
  39382357235489614581723060781553021112529911719440698176882885853963445705823n,
  P - 1n,
  P,
  P + 1n,
  2n ** 255n, // 0 with the top bit set, which x25519 ignores
  2n ** 255n + 1n,
];

function le32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** Build a sealed box by hand, with whatever ephemeral public key and shared secret it is given. */
async function sealByHand(ephPub: Uint8Array, shared: Uint8Array, recipientPub: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = hkdf(sha256, shared, new Uint8Array(0), concat(utf8.enc("evilion-chat/seal/v1"), ephPub, recipientPub), 32);
  return concat(ephPub, iv, await gcmEncrypt(key, iv, data, ephPub));
}

async function decryptedOrNull(key: Uint8Array, env: Envelope, aad: Aad): Promise<{ decrypted: unknown; error: boolean }> {
  try {
    return { decrypted: await decryptMessage(key, env, aad), error: false };
  } catch (err) {
    expect(err).toBeInstanceOf(DecryptError);
    return { decrypted: null, error: true };
  }
}

async function generate(): Promise<Vectors> {
  const rng = new Stream("nexa/e2ee/ts-vectors");
  const rec = <T>(fn: () => Promise<T> | T) => withRandom((n) => rng.take(n), fn);
  const newId = async (): Promise<Identity> => (await rec(generateIdentity)).out;

  const alice = await newId();
  const bob = await newId();

  const identities = [alice, bob, await newId()].map((id) => ({ priv: enc(id.privateKey), pub: enc(id.publicKey) }));
  // clamping: these private keys are not valid scalars until clamped
  for (const priv of [new Uint8Array(32), new Uint8Array(32).fill(0xff)]) {
    identities.push({ priv: enc(priv), pub: enc(publicKeyOf(priv)) });
  }

  const sealed: SealedVector[] = [];
  const toBob = { recipientPriv: enc(bob.privateKey), recipientPub: enc(bob.publicKey) };
  const sealCases: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["short", utf8.enc("hi")],
    ["32 bytes", rng.take(32)],
    ["1 KiB", rng.take(1024)],
  ];
  for (const [name, data] of sealCases) {
    const { out: blob, random } = await rec(() => seal(bob.publicKey, data));
    expect(equal(await open(bob.privateKey, bob.publicKey, blob), data)).toBe(true);
    sealed.push({ name, random: enc(random), ...toBob, data: enc(data), blob: enc(blob) });
  }
  {
    // x25519 ignores the top bit of the ephemeral key, while the key derivation and the AAD take its bytes as sent
    const eph = await newId();
    const ephPub = eph.publicKey.slice();
    ephPub[31] = (ephPub[31] ?? 0) | 0x80;
    const data = utf8.enc("high bit");
    const blob = await sealByHand(ephPub, x25519.getSharedSecret(eph.privateKey, bob.publicKey), bob.publicKey, rng.take(12), data);
    expect(utf8.dec(await open(bob.privateKey, bob.publicKey, blob))).toBe("high bit");
    sealed.push({ name: "ephemeral key with the top bit set", random: "", ...toBob, data: enc(data), blob: enc(blob) });
  }

  const sealedBad: BadSealedVector[] = [];
  for (const [i, u] of LOW_ORDER.entries()) {
    // sealed with the all-zero secret a low-order key yields: only refusing the key keeps this box shut
    const ephPub = le32(u);
    const blob = await sealByHand(ephPub, new Uint8Array(32), bob.publicKey, rng.take(12), utf8.enc("low order"));
    sealedBad.push({ name: `low-order ephemeral key ${i}`, ...toBob, blob: enc(blob) });
  }
  {
    const good = (await rec(() => seal(bob.publicKey, utf8.enc("tamper")))).out;
    const flipped = good.slice();
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    sealedBad.push({ name: "flipped tag bit", ...toBob, blob: enc(flipped) });
    sealedBad.push({ name: "one byte short", ...toBob, blob: enc(good.subarray(0, good.length - 1)) });
    sealedBad.push({ name: "shorter than a box", ...toBob, blob: enc(good.subarray(0, 59)) });
    const other = (await rec(() => seal(alice.publicKey, utf8.enc("not for bob")))).out;
    sealedBad.push({ name: "sealed to someone else", ...toBob, blob: enc(other) });
  }
  for (const s of sealedBad) {
    await expect(open(bob.privateKey, bob.publicKey, dec(s.blob))).rejects.toBeInstanceOf(DecryptError);
  }

  const grants: SealedVector[] = [];
  for (const [name, root] of [["root 1", rng.take(32)], ["root 2", rng.take(32)]] as const) {
    const { out: blob, random } = await rec(() => wrapGrant(alice.publicKey, root));
    grants.push({ name, random: enc(random), recipientPriv: enc(alice.privateKey), recipientPub: enc(alice.publicKey), data: enc(root), blob: enc(blob) });
  }

  const channelKeys: Vectors["channelKeys"] = [];
  for (const epoch of [0, 1, 2, 7]) {
    const root = rng.take(32);
    for (const channelId of ["1000000000000000002", "chan-1", "Ünïcödé 🔑", ""]) {
      channelKeys.push({ root: enc(root), epoch, channelId, chanKey: enc(channelKey(root, channelId)), voiceKey: enc(voiceFrameKey(root, channelId)) });
    }
  }

  const root = rng.take(32);
  const fileKey1 = enc(rng.take(32));
  const fileKey2 = enc(rng.take(32));
  const aad = (epoch: number, author = "1000000000000000003"): Aad => ({ conv: "1000000000000000001", epoch, channelId: "1000000000000000002", authorId: author });
  // member order is the one Go's setters write, where `rebuild` is set
  const photo = { blob_id: "1100000000000000001", name: "Ünïcode photo 📷.png", type: "image/png", size: 5368709120, w: 1920, h: 1080, key: fileKey1, spoiler: true, duration: 3.7066666666666666 };
  const notes = { blob_id: "1100000000000000002", name: "notes.txt", type: "", size: 0, key: fileKey2 };
  const embed = {
    url: "https://example.com/a?b=c&d=<e>",
    type: "link",
    title: "Example «quoted» 日本語",
    description: "Line one\nline two",
    site_name: "Example",
    image: "/api/v1/media/proxy?u=1",
    video_id: "dQw4w9WgXcQ",
    mime: "text/html",
    color: "#5865f2",
    invite_code: "abc123",
    image_w: 1200,
    image_h: 630,
    member_count: 42,
    online_count: 7,
  };
  const sticker = { id: "1200000000000000001", blob: "1200000000000000002", name: "wave", w: 160, h: 160, animated: true, format: "apng" };
  const cases: { name: string; aad: Aad; payload: unknown; rebuild?: boolean }[] = [
    { name: "ascii text", aad: aad(0), payload: { t: "hello world" }, rebuild: true },
    {
      name: "non-ascii text",
      aad: aad(3),
      payload: { t: "héllo wörld 👋 日本語 <b>&amp;</b> \u2028\u2029 \"q\" \\ /\n\r\t\b\f \u0001\u001f\u007f\u0085\ufeff" },
      rebuild: true,
    },
    { name: "empty text", aad: aad(1, "1000000000000000004"), payload: { t: "" }, rebuild: true },
    { name: "attachments, sticker, embeds and flags", aad: aad(2), payload: { t: "look", att: [photo, notes], sticker, embeds: [embed], flags: 4 }, rebuild: true },
    {
      name: "numbers",
      aad: aad(2),
      payload: { t: "n", att: [{ blob_id: "9", name: "n.bin", type: "", size: 9007199254740991, w: 0.1, h: 1e21, key: fileKey2, duration: 1.5e-7 }], flags: -1.23456e-8 },
      rebuild: true,
    },
    { name: "sticker only", aad: aad(0), payload: { sticker }, rebuild: true },
    {
      name: "wrong types, webhook fields and unknown members",
      aad: aad(5),
      payload: {
        t: "x",
        att: [
          notes,
          { blob_id: "1", name: "no key", type: "", size: 1 },
          { blob_id: "2", name: "webhook file", type: "text/plain", size: 3, key: "", plain: true, alt: "alt text" },
          { blob_id: "3", name: "fractional size", type: "", size: 1.5, key: "" },
          { blob_id: "4", name: "negative size", type: "", size: -1, key: "" },
          "not an object",
          null,
          { blob_id: "5", name: "wrong optional types", type: "", size: 2, key: "", w: "10", spoiler: "yes", duration: null },
        ],
        embeds: [
          { url: "javascript:alert(1)" },
          { url: "https://ok.example/", image: "data:image/png;base64,AAAA", title: 5, image_w: "10", extra: "dropped" },
          { url: "//elsewhere.example/x" },
          { url: "/relative/path", image: "HTTPS://Upper.Example/i.png" },
          { url: "https://tab\there.example/" },
          { url: "https://nbsp\u00a0here.example/" },
          { url: "https://nel\u0085here.example/" },
          { url: "https://bom\ufeffhere.example/" },
          { url: "https://back\\slash.example/" },
          { url: "ftp://files.example/" },
          { title: "no url" },
          "a string",
        ],
        sticker: { id: 5 },
        flags: "1",
        zz_future: { nested: [1, "two", null, { deep: true }] },
      },
    },
    { name: "only an unknown member", aad: aad(0), payload: { zz_future: true } },
    { name: "empty object", aad: aad(0), payload: {} },
    { name: "text of the wrong type", aad: aad(0), payload: { t: 5 } },
    { name: "null text", aad: aad(0), payload: { t: null } },
    { name: "empty attachment list", aad: aad(0), payload: { att: [] } },
    { name: "only an unusable embed", aad: aad(0), payload: { embeds: [{ url: "javascript:alert(1)" }] } },
    { name: "sticker without an id", aad: aad(0), payload: { sticker: { name: "x" } } },
    { name: "array", aad: aad(0), payload: [1, 2] },
    { name: "string", aad: aad(0), payload: "hi" },
    { name: "null", aad: aad(0), payload: null },
  ];
  const messages: MessageVector[] = [];
  for (const c of cases) {
    const key = channelKey(root, c.aad.channelId);
    const { out: envelope, random } = await rec(() => encryptMessage(key, c.aad, c.payload as MessagePayload));
    messages.push({
      name: c.name,
      random: enc(random),
      root: enc(root),
      aad: c.aad,
      plaintext: enc(utf8.enc(JSON.stringify(c.payload))),
      envelope,
      ...(await decryptedOrNull(key, envelope, c.aad)),
      rebuild: c.rebuild ?? false,
    });
  }

  const files: FileVector[] = [];
  const fileCases: [string, number][] = [
    ["empty", 0],
    ["one byte", 1],
    ["small", 1000],
    ["one full chunk", CHUNK],
    ["across a chunk boundary", CHUNK + 1000],
  ];
  for (const [name, size] of fileCases) {
    const plain = pattern(size);
    const { out, random } = await rec(() => encryptFile(new Blob([plain])));
    const cipher = new Uint8Array(await out.blob.arrayBuffer());
    expect(cipher.length).toBe(encryptedSize(size));
    expect(equal(new Uint8Array(await (await decryptFile(out.blob, out.key)).arrayBuffer()), plain)).toBe(true);
    files.push({
      name,
      size,
      random: enc(random),
      key: enc(out.key),
      baseIv: enc(cipher.subarray(4, 12)),
      cipherSha256: hex(sha256(cipher)),
      ...(size < CHUNK ? { cipher: enc(cipher) } : {}),
    });
  }
  const encryptedSizes = [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 5, 5 * 1024 ** 3].map((size) => ({ size, encrypted: encryptedSize(size) }));

  const bot = await newId();
  const token = (await rec(newBotToken)).out;
  const longToken = b64url(rng.take(48));
  const botTokens = [
    { token, valid: true },
    { token: longToken, valid: true },
    { token: "A".repeat(42), valid: false },
    { token: "A".repeat(43), valid: true },
    { token: "-_".repeat(128), valid: true },
    { token: "A".repeat(257), valid: false },
    { token: `${token.slice(0, 42)}+`, valid: false },
    { token: `${token.slice(0, 42)}/`, valid: false },
    { token: `${token}=`, valid: false },
    { token: ` ${token}`, valid: false },
    { token: `${token}\n`, valid: false },
    { token: "é".repeat(43), valid: false },
    { token: "", valid: false },
  ];
  const botWraps: Vectors["botWraps"] = [];
  for (const t of [token, longToken]) {
    const { out: wrapped, random } = await rec(() => wrapBotIdentity(bot, t));
    botWraps.push({ random: enc(random), token: t, tokenHash: enc(botTokenHash(t)), priv: enc(bot.privateKey), pub: enc(bot.publicKey), wrapped: enc(wrapped) });
  }
  const { out: escrow, random: escrowRandom } = await rec(() => sealBotEscrow(alice.publicKey, bot));
  const botEscrows = [
    { random: enc(escrowRandom), ownerPriv: enc(alice.privateKey), ownerPub: enc(alice.publicKey), botPriv: enc(bot.privateKey), botPub: enc(bot.publicKey), escrow: enc(escrow) },
  ];
  const created = (await rec(() => createBotIdentity(alice.publicKey))).out;
  const reset = (await rec(() => rewrapBotIdentity(alice.privateKey, alice.publicKey, created.escrow, created.identity.publicKey))).out;
  const botCreated = {
    ownerPriv: enc(alice.privateKey),
    ownerPub: enc(alice.publicKey),
    token: created.token,
    tokenHash: enc(created.tokenHash),
    botPriv: enc(created.identity.privateKey),
    botPub: enc(created.identity.publicKey),
    wrapped: enc(created.wrapped),
    escrow: enc(created.escrow),
    newToken: reset.token,
    newTokenHash: enc(reset.tokenHash),
    rewrapped: enc(reset.wrapped),
  };

  return {
    comment: "Written by web/src/crypto/vectors.test.ts (WRITE_VECTORS=1 npx vitest run src/crypto/vectors.test.ts); checked by internal/e2ee. Do not edit.",
    identities,
    sealed,
    sealedBad,
    grants,
    channelKeys,
    messages,
    files,
    encryptedSizes,
    botTokens,
    botWraps,
    botEscrows,
    botCreated,
  };
}

async function verify(v: Vectors): Promise<void> {
  for (const id of v.identities) expect(enc(publicKeyOf(dec(id.priv)))).toBe(id.pub);

  for (const s of [...v.sealed, ...v.grants]) {
    expect(enc(await open(dec(s.recipientPriv), dec(s.recipientPub), dec(s.blob))), s.name).toBe(s.data);
    if (s.random) expect(enc(await replaying(s.random, () => seal(dec(s.recipientPub), dec(s.data)))), s.name).toBe(s.blob);
  }
  for (const s of v.sealedBad) {
    await expect(open(dec(s.recipientPriv), dec(s.recipientPub), dec(s.blob)), s.name).rejects.toBeInstanceOf(DecryptError);
  }

  for (const c of v.channelKeys) {
    expect(enc(channelKey(dec(c.root), c.channelId))).toBe(c.chanKey);
    expect(enc(voiceFrameKey(dec(c.root), c.channelId))).toBe(c.voiceKey);
  }

  for (const m of v.messages) {
    const key = channelKey(dec(m.root), m.aad.channelId);
    const json = utf8.dec(dec(m.plaintext));
    // the other side wrote exactly what JSON.stringify would
    expect(JSON.stringify(JSON.parse(json)), m.name).toBe(json);
    expect(await replaying(m.random, () => encryptMessage(key, m.aad, JSON.parse(json) as MessagePayload)), m.name).toEqual(m.envelope);
    const got = await decryptedOrNull(key, m.envelope, m.aad);
    expect(got, m.name).toEqual({ decrypted: m.decrypted, error: m.error });
  }

  for (const f of v.files) {
    const plain = pattern(f.size);
    const out = await replaying(f.random, () => encryptFile(new Blob([plain])));
    const cipher = new Uint8Array(await out.blob.arrayBuffer());
    expect(enc(out.key), f.name).toBe(f.key);
    expect(enc(cipher.subarray(4, 12)), f.name).toBe(f.baseIv);
    expect(hex(sha256(cipher)), f.name).toBe(f.cipherSha256);
    if (f.cipher !== undefined) expect(enc(cipher), f.name).toBe(f.cipher);
    // what the other side wrote (the same bytes, the hash says) opens here
    const theirs = f.cipher !== undefined ? dec(f.cipher) : cipher;
    const back = await decryptFile(new Blob([bufferSource(theirs)]), dec(f.key));
    expect(equal(new Uint8Array(await back.arrayBuffer()), plain), f.name).toBe(true);
  }
  for (const s of v.encryptedSizes) expect(encryptedSize(s.size)).toBe(s.encrypted);

  for (const t of v.botTokens) expect(isBotToken(t.token), JSON.stringify(t.token)).toBe(t.valid);
  for (const w of v.botWraps) {
    expect(enc(botTokenHash(w.token))).toBe(w.tokenHash);
    expect(enc((await unwrapBotIdentity(dec(w.wrapped), w.token, dec(w.pub))).privateKey)).toBe(w.priv);
    const again = await replaying(w.random, () => wrapBotIdentity({ publicKey: dec(w.pub), privateKey: dec(w.priv) }, w.token));
    expect(enc(again)).toBe(w.wrapped);
  }
  for (const e of v.botEscrows) {
    expect(enc((await openBotEscrow(dec(e.ownerPriv), dec(e.ownerPub), dec(e.escrow), dec(e.botPub))).privateKey)).toBe(e.botPriv);
    const again = await replaying(e.random, () => sealBotEscrow(dec(e.ownerPub), { publicKey: dec(e.botPub), privateKey: dec(e.botPriv) }));
    expect(enc(again)).toBe(e.escrow);
  }
  const c = v.botCreated;
  expect(enc(botTokenHash(c.token))).toBe(c.tokenHash);
  expect(enc(botTokenHash(c.newToken))).toBe(c.newTokenHash);
  expect(enc((await unwrapBotIdentity(dec(c.wrapped), c.token, dec(c.botPub))).privateKey)).toBe(c.botPriv);
  expect(enc((await openBotEscrow(dec(c.ownerPriv), dec(c.ownerPub), dec(c.escrow), dec(c.botPub))).privateKey)).toBe(c.botPriv);
  expect(enc((await unwrapBotIdentity(dec(c.rewrapped), c.newToken, dec(c.botPub))).privateKey)).toBe(c.botPriv);
  await expect(unwrapBotIdentity(dec(c.rewrapped), c.token, dec(c.botPub))).rejects.toBeInstanceOf(DecryptError);
  await expect(unwrapBotIdentity(dec(c.wrapped), c.newToken, dec(c.botPub))).rejects.toBeInstanceOf(DecryptError);
}

describe("cross-language vectors", () => {
  it("still writes the vectors checked in for Go, and can replay them", async () => {
    const fresh = JSON.parse(JSON.stringify(await generate())) as Vectors;
    await verify(fresh);
    if (WRITE) {
      writeFileSync(TS_VECTORS, `${JSON.stringify(fresh, null, 2)}\n`);
      return;
    }
    expect(fresh).toEqual(JSON.parse(readFileSync(TS_VECTORS, "utf8")));
  }, 60_000);

  it("opens Go's vectors and reproduces them byte for byte", async () => {
    await verify(JSON.parse(readFileSync(GO_VECTORS, "utf8")) as Vectors);
  }, 60_000);
});
