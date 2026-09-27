import {
  BOT_TOKEN_BYTES,
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
import { concat, equal, utf8 } from "./bytes";
import { sha256 } from "@noble/hashes/sha256";
import { DecryptError, generateIdentity, seal, wrapGrant } from "./keys";

describe("bot tokens", () => {
  it("are 32 random bytes in unpadded base64url", () => {
    const token = newBotToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(atob(token.replace(/-/g, "+").replace(/_/g, "/") + "=").length).toBe(BOT_TOKEN_BYTES);
    expect(isBotToken(token)).toBe(true);
    expect(newBotToken()).not.toBe(token);
  });

  it("has a shape check that takes 43 to 256 url-safe characters", () => {
    expect(isBotToken("A".repeat(43))).toBe(true);
    expect(isBotToken("-_".repeat(128))).toBe(true);
    for (const bad of ["A".repeat(42), "A".repeat(257), `${"A".repeat(42)}+`, `${"A".repeat(43)}=`, `${"A".repeat(43)}\n`, "", "é".repeat(43)]) {
      expect(isBotToken(bad)).toBe(false);
    }
  });

  it("hashes to SHA-256 of the token's characters", () => {
    const token = newBotToken();
    expect(equal(botTokenHash(token), sha256(utf8.enc(token)))).toBe(true);
  });
});

describe("wrapBotIdentity / unwrapBotIdentity", () => {
  it("round trips the identity under its token, in 61 bytes", async () => {
    const bot = generateIdentity();
    const token = newBotToken();
    const wrapped = await wrapBotIdentity(bot, token);
    expect(wrapped.length).toBe(61);
    expect(wrapped[0]).toBe(1);
    const back = await unwrapBotIdentity(wrapped, token, bot.publicKey);
    expect(equal(back.privateKey, bot.privateKey)).toBe(true);
    expect(equal(back.publicKey, bot.publicKey)).toBe(true);
  });

  it("refuses another token, another public key and any change", async () => {
    const bot = generateIdentity();
    const token = newBotToken();
    const wrapped = await wrapBotIdentity(bot, token);
    await expect(unwrapBotIdentity(wrapped, newBotToken(), bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapBotIdentity(wrapped, "short", bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapBotIdentity(wrapped, token, generateIdentity().publicKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapBotIdentity(wrapped.subarray(0, 60), token, bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    for (const at of [0, 1, 13, 30, 60]) {
      const bad = wrapped.slice();
      bad[at] = (bad[at] ?? 0) ^ 1;
      await expect(unwrapBotIdentity(bad, token, bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("will not wrap a key pair that does not match, or under something that is not a token", async () => {
    const bot = generateIdentity();
    await expect(wrapBotIdentity({ publicKey: generateIdentity().publicKey, privateKey: bot.privateKey }, newBotToken())).rejects.toThrow();
    await expect(wrapBotIdentity(bot, "not a token")).rejects.toThrow();
  });
});

describe("sealBotEscrow / openBotEscrow", () => {
  it("lets the owner, and only the owner, open the identity again", async () => {
    const owner = generateIdentity();
    const bot = generateIdentity();
    const escrow = await sealBotEscrow(owner.publicKey, bot);
    const back = await openBotEscrow(owner.privateKey, owner.publicKey, escrow, bot.publicKey);
    expect(equal(back.privateKey, bot.privateKey)).toBe(true);
    const stranger = generateIdentity();
    await expect(openBotEscrow(stranger.privateKey, stranger.publicKey, escrow, bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    await expect(openBotEscrow(owner.privateKey, owner.publicKey, escrow, generateIdentity().publicKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it("does not take a conversation grant, or a mismatched pair, for an escrow", async () => {
    const owner = generateIdentity();
    const bot = generateIdentity();
    const grant = await wrapGrant(owner.publicKey, new Uint8Array(32).fill(1));
    await expect(openBotEscrow(owner.privateKey, owner.publicKey, grant, bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
    const crossed = await seal(owner.publicKey, concat(utf8.enc("nexa/bot-escrow/v1"), bot.publicKey, generateIdentity().privateKey));
    await expect(openBotEscrow(owner.privateKey, owner.publicKey, crossed, bot.publicKey)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("createBotIdentity / rewrapBotIdentity", () => {
  it("makes everything the server keeps, and a token reset keeps the identity", async () => {
    const owner = generateIdentity();
    const bot = await createBotIdentity(owner.publicKey);
    expect(isBotToken(bot.token)).toBe(true);
    expect(equal(bot.tokenHash, botTokenHash(bot.token))).toBe(true);
    const opened = await unwrapBotIdentity(bot.wrapped, bot.token, bot.identity.publicKey);
    expect(equal(opened.privateKey, bot.identity.privateKey)).toBe(true);

    const reset = await rewrapBotIdentity(owner.privateKey, owner.publicKey, bot.escrow, bot.identity.publicKey);
    expect(reset.token).not.toBe(bot.token);
    expect(equal(reset.tokenHash, botTokenHash(reset.token))).toBe(true);
    const again = await unwrapBotIdentity(reset.wrapped, reset.token, bot.identity.publicKey);
    expect(equal(again.privateKey, bot.identity.privateKey)).toBe(true);
    await expect(unwrapBotIdentity(reset.wrapped, bot.token, bot.identity.publicKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it("refuses a reset by anyone but the owner", async () => {
    const owner = generateIdentity();
    const bot = await createBotIdentity(owner.publicKey);
    const stranger = generateIdentity();
    await expect(rewrapBotIdentity(stranger.privateKey, stranger.publicKey, bot.escrow, bot.identity.publicKey)).rejects.toBeInstanceOf(DecryptError);
  });
});
