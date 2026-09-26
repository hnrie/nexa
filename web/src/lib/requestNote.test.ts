import { describe, expect, it } from "vitest";
import { b64, utf8 } from "@/crypto/bytes";
import { generateIdentity, open, seal } from "@/crypto/keys";
import { REQUEST_NOTE_MAX, cleanRequestNote, openRequestNote, sealRequestNote } from "./requestNote";

const sam = generateIdentity();
const eve = generateIdentity();

describe("a friend request's note", () => {
  it("opens for the person it was sealed to, and reads the same", async () => {
    const note = "Hi, it's Sam from the climbing gym 🧗 مرحبا";
    const sealed = await sealRequestNote(sam.publicKey, note);
    expect(await openRequestNote(sam, sealed)).toBe(note);
    // what the server is given is a sealed box and nothing readable
    expect(sealed).not.toContain("climbing");
    expect(b64.dec(sealed).length).toBe(32 + 12 + utf8.enc(note).length + 16);
  });

  it("is sealed afresh every time", async () => {
    const a = await sealRequestNote(sam.publicKey, "same words");
    const b = await sealRequestNote(sam.publicKey, "same words");
    expect(a).not.toBe(b);
  });

  it("does not open for anyone else", async () => {
    const sealed = await sealRequestNote(sam.publicKey, "for Sam only");
    expect(await openRequestNote(eve, sealed)).toBeNull();
  });

  it("shows nothing for a note that is damaged, not base64, empty or not text", async () => {
    const sealed = b64.dec(await sealRequestNote(sam.publicKey, "hello"));
    sealed[sealed.length - 1]! ^= 1;
    expect(await openRequestNote(sam, b64.enc(sealed))).toBeNull();
    expect(await openRequestNote(sam, "not base64!")).toBeNull();
    expect(await openRequestNote(sam, "")).toBeNull();
    expect(await openRequestNote(sam, await sealRequestNote(sam.publicKey, "   "))).toBeNull();
    // bytes that are not UTF-8, sealed properly, are still not a note
    expect(await openRequestNote(sam, b64.enc(await seal(sam.publicKey, new Uint8Array([0xff, 0xfe, 0x80]))))).toBeNull();
  });

  it("opens with the same sealed box conversation keys use", async () => {
    const sealed = await sealRequestNote(sam.publicKey, "plain sealed box");
    expect(utf8.dec(await open(sam.privateKey, sam.publicKey, b64.dec(sealed)))).toBe("plain sealed box");
  });
});

describe("cleaning a note before it is sent", () => {
  it("trims it, and an empty one is no note", () => {
    expect(cleanRequestNote("  Hi there \n")).toBe("Hi there");
    expect(cleanRequestNote(" \n\t ")).toBe("");
  });

  it("keeps it to the most the field allows", () => {
    expect(cleanRequestNote("a".repeat(REQUEST_NOTE_MAX))).toHaveLength(REQUEST_NOTE_MAX);
    expect(cleanRequestNote("a".repeat(REQUEST_NOTE_MAX + 20))).toHaveLength(REQUEST_NOTE_MAX);
  });

  it("does not cut an emoji in half at the limit", () => {
    const note = "a".repeat(REQUEST_NOTE_MAX - 1) + "🧗";
    const out = cleanRequestNote(note);
    expect(out).toBe("a".repeat(REQUEST_NOTE_MAX - 1));
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
  });

  it("fits the server's limit for the sealed box whatever the script", async () => {
    // three bytes of UTF-8 for every code unit is the most a note can take
    const widest = "語".repeat(REQUEST_NOTE_MAX);
    const sealed = b64.dec(await sealRequestNote(sam.publicKey, cleanRequestNote(widest)));
    expect(sealed.length).toBeLessThanOrEqual(1024);
    expect(sealed.length).toBeGreaterThanOrEqual(60);
  });
});
