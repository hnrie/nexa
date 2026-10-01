import { describe, expect, it } from "vitest";
import { DecryptError, generateIdentity } from "./keys";
import {
  b64url,
  newNoteKey,
  newNoteLink,
  noteKeyAt,
  noteLinkPath,
  noteTokenHash,
  openNote,
  openNoteCursor,
  openNoteKey,
  openNoteLink,
  parseNoteLink,
  sealNote,
  sealNoteCursor,
  sealNoteKey,
  sealNoteLink,
  unwrapNoteKeyFromLink,
  unwrapPreviousKey,
  wrapNoteKeyForLink,
  wrapPreviousKey,
} from "./notes";

/** What the server takes as sealed text (internal/api/note_handlers.go, sealed). */
const SEALED = /^[A-Za-z0-9+/=_.-]+$/;

describe("a note's seal", () => {
  it("opens with the key it was sealed with, and reads as nothing without it", async () => {
    const key = newNoteKey();
    const sealed = await sealNote(key, "body", { md: "my plans\n", files: {} });
    expect(sealed).toMatch(SEALED);
    expect(sealed).not.toContain("plans");
    expect(await openNote(key, "body", sealed)).toEqual({ md: "my plans\n", files: {} });
    await expect(openNote(newNoteKey(), "body", sealed)).rejects.toBeInstanceOf(DecryptError);
  });

  it("is different every time, so two saves of the same words do not look alike", async () => {
    const key = newNoteKey();
    expect(await sealNote(key, "head", { title: "x" })).not.toBe(await sealNote(key, "head", { title: "x" }));
  });

  it("cannot be passed off as another part of the note, or be changed", async () => {
    const key = newNoteKey();
    const head = await sealNote(key, "head", { title: "Budget" });
    // a server that swapped a note's head in for its body gets nowhere
    await expect(openNote(key, "body", head)).rejects.toBeInstanceOf(DecryptError);
    const [v, iv, ct] = head.split(".") as [string, string, string];
    const flipped = `${v}.${iv}.${ct.slice(0, -2)}${ct.endsWith("AA") ? "BB" : "AA"}`;
    await expect(openNote(key, "head", flipped)).rejects.toBeInstanceOf(DecryptError);
    for (const bad of ["", "v1", "v2." + iv + "." + ct, "v1..", "not sealed at all", "v1.@@.@@"]) {
      await expect(openNote(key, "head", bad)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("gives its key to a person so that only they can open it", async () => {
    const key = newNoteKey();
    const ada = generateIdentity();
    const eve = generateIdentity();
    const sealed = await sealNoteKey(ada.publicKey, key);
    expect(sealed).toMatch(SEALED);
    expect(sealed.length).toBeLessThanOrEqual(512);
    expect(await openNoteKey(ada, sealed)).toEqual(key);
    await expect(openNoteKey(eve, sealed)).rejects.toBeInstanceOf(DecryptError);
    await expect(openNoteKey(ada, "not base64 !")).rejects.toBeInstanceOf(DecryptError);
    // a sealed box holding something that is not a note's key
    await expect(openNoteKey(ada, await sealNoteKey(ada.publicKey, new Uint8Array(8)))).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("a note's earlier keys", () => {
  it("open one from the next, back to the key a version was sealed with", async () => {
    const k0 = newNoteKey();
    const k1 = newNoteKey();
    const k2 = newNoteKey();
    const wrapped = { 0: await wrapPreviousKey(k1, k0), 1: await wrapPreviousKey(k2, k1) };
    expect(wrapped[0]).toMatch(SEALED);
    expect(wrapped[0].length).toBeLessThanOrEqual(512);
    const old = await sealNote(k0, "body", { md: "the first draft", files: {} });
    expect(await openNote(await noteKeyAt(k2, 2, 0, wrapped), "body", old)).toEqual({ md: "the first draft", files: {} });
    expect(await noteKeyAt(k2, 2, 2, wrapped)).toEqual(k2);
    expect(await noteKeyAt(k2, 2, 1, wrapped)).toEqual(k1);
  });

  it("are closed to someone who only has an older key", async () => {
    const k0 = newNoteKey();
    const k1 = newNoteKey();
    const wrapped = { 0: await wrapPreviousKey(k1, k0) };
    // taken out of the note before the key changed: the old key opens nothing newer
    await expect(unwrapPreviousKey(k0, wrapped[0])).rejects.toBeInstanceOf(DecryptError);
    await expect(noteKeyAt(k1, 1, 2, wrapped)).rejects.toBeInstanceOf(DecryptError);
    await expect(noteKeyAt(k1, 3, 0, wrapped)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe("a share link", () => {
  it("opens the note for whoever holds the whole link", async () => {
    const key = newNoteKey();
    const link = newNoteLink();
    const wrapped = await wrapNoteKeyForLink(link, key);
    expect(wrapped).toMatch(SEALED);
    expect(wrapped.length).toBeLessThanOrEqual(512);
    expect(await unwrapNoteKeyFromLink(link, wrapped)).toEqual(key);
  });

  it("opens nothing with the token alone, which is all the server ever sees", async () => {
    const key = newNoteKey();
    const link = newNoteLink();
    const wrapped = await wrapNoteKeyForLink(link, key);
    // another link's key, and this link's key under another token
    await expect(unwrapNoteKeyFromLink({ token: link.token, key: newNoteLink().key }, wrapped)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapNoteKeyFromLink({ token: newNoteLink().token, key: link.key }, wrapped)).rejects.toBeInstanceOf(DecryptError);
    await expect(unwrapNoteKeyFromLink({ token: link.token, key: "short" }, wrapped)).rejects.toBeInstanceOf(DecryptError);
  });

  it("is known to the server by a hash of its token, the same one the server computes", () => {
    // sha256("nexa-note-link\0" + token), as noteTokenHash in internal/api/note_handlers.go
    expect(noteTokenHash("dG9rZW4tZm9yLWEtbm90ZS1saW5r")).toBe("cd8f0bdc6fa9e52c5416e896e4770b3a179c0b8cc530091ca70831d47354324b");
    expect(noteTokenHash("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(noteTokenHash("a")).not.toBe(noteTokenHash("b"));
  });

  it("can be copied again by the note's members, who hold its key", async () => {
    const key = newNoteKey();
    const link = newNoteLink();
    const sealed = await sealNoteLink(key, link);
    expect(sealed).toMatch(SEALED);
    expect(sealed.length).toBeLessThanOrEqual(1024);
    expect(await openNoteLink(key, sealed)).toEqual(link);
    await expect(openNoteLink(newNoteKey(), sealed)).rejects.toBeInstanceOf(DecryptError);
    // sealed as a link, it is not a head or a body
    await expect(openNote(key, "head", sealed)).rejects.toBeInstanceOf(DecryptError);
  });

  it("is an address whose key sits after the #, and reads back from one", () => {
    const link = newNoteLink();
    const path = noteLinkPath(link);
    expect(path).toBe(`/note/${link.token}#${link.key}`);
    expect(parseNoteLink("https://chat.example" + path, "https://chat.example")).toEqual(link);
    expect(parseNoteLink(path, "https://chat.example")).toEqual(link);
    expect(parseNoteLink(`https://chat.example/note/${link.token}/#${link.key}`, "https://chat.example")).toEqual(link);
    // another site's address, a link with no key, and things that are not links
    expect(parseNoteLink("https://elsewhere.example" + path, "https://chat.example")).toBeNull();
    expect(parseNoteLink(`https://chat.example/note/${link.token}`, "https://chat.example")).toBeNull();
    expect(parseNoteLink(`https://chat.example/notes/${link.token}#${link.key}`, "https://chat.example")).toBeNull();
    expect(parseNoteLink("not a link", "https://chat.example")).toBeNull();
  });

  it("writes base64 an address can carry", () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3]);
    const text = b64url.enc(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b64url.dec(text)).toEqual(bytes);
    expect(() => b64url.dec("a+b/c=")).toThrow();
  });
});

describe("a cursor in a note", () => {
  it("is sealed with the note's key, in what the gateway takes, and opens only as a cursor", async () => {
    const key = newNoteKey();
    const sealed = await sealNoteCursor(key, { s: "tab1", a: { b: 0, o: 3, k: "x" }, f: { b: 0, o: 3, k: "x" } });
    // the gateway takes base64url and dots only (internal/gateway/conn.go, sealedText)
    expect(sealed).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(sealed.length).toBeLessThan(2048);
    expect(await openNoteCursor(key, sealed)).toEqual({ s: "tab1", a: { b: 0, o: 3, k: "x" }, f: { b: 0, o: 3, k: "x" } });
    await expect(openNoteCursor(newNoteKey(), sealed)).rejects.toBeInstanceOf(DecryptError);
    // a cursor is not a note's head, and the other way round
    await expect(openNote(key, "head", sealed)).rejects.toBeInstanceOf(DecryptError);
    await expect(openNoteCursor(key, await sealNote(key, "head", { title: "x" }))).rejects.toBeInstanceOf(DecryptError);
  });
});
