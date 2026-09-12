import { equal, randomBytes } from "./bytes";
import { newRootKey } from "./conv";
import { generateIdentity } from "./keys";
import { keystore } from "./keystore";

let counter = 0;
/** Every test gets its own user so the shared database stays predictable. */
function freshUser(): string {
  counter++;
  return `user-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("keystore identity", () => {
  it("round trips an identity", async () => {
    const userId = freshUser();
    const id = generateIdentity();
    await keystore.saveIdentity(userId, id);
    const out = await keystore.loadIdentity(userId);
    expect(out).not.toBeNull();
    expect(out?.publicKey).toBeInstanceOf(Uint8Array);
    expect(out?.privateKey).toBeInstanceOf(Uint8Array);
    expect(equal(out?.publicKey ?? new Uint8Array(0), id.publicKey)).toBe(true);
    expect(equal(out?.privateKey ?? new Uint8Array(0), id.privateKey)).toBe(true);
  });

  it("returns null for an unknown user", async () => {
    expect(await keystore.loadIdentity(freshUser())).toBeNull();
  });

  it("overwrites an existing identity", async () => {
    const userId = freshUser();
    await keystore.saveIdentity(userId, generateIdentity());
    const second = generateIdentity();
    await keystore.saveIdentity(userId, second);
    const out = await keystore.loadIdentity(userId);
    expect(equal(out?.privateKey ?? new Uint8Array(0), second.privateKey)).toBe(true);
  });

  it("keeps users separate", async () => {
    const a = freshUser();
    const b = freshUser();
    const idA = generateIdentity();
    const idB = generateIdentity();
    await keystore.saveIdentity(a, idA);
    await keystore.saveIdentity(b, idB);
    expect(equal((await keystore.loadIdentity(a))?.publicKey ?? new Uint8Array(0), idA.publicKey)).toBe(true);
    expect(equal((await keystore.loadIdentity(b))?.publicKey ?? new Uint8Array(0), idB.publicKey)).toBe(true);
  });
});

describe("keystore roots", () => {
  it("returns an empty list for an unknown user", async () => {
    expect(await keystore.loadRoots(freshUser())).toEqual([]);
  });

  it("stores roots per conversation and epoch", async () => {
    const userId = freshUser();
    const r1 = newRootKey();
    const r2 = newRootKey();
    const r3 = newRootKey();
    await keystore.saveRoot(userId, "conv-a", 0, r1);
    await keystore.saveRoot(userId, "conv-a", 1, r2);
    await keystore.saveRoot(userId, "conv-b", 0, r3);

    const rows = await keystore.loadRoots(userId);
    expect(rows.length).toBe(3);
    const find = (conv: string, epoch: number) => rows.find((r) => r.conv === conv && r.epoch === epoch);
    expect(equal(find("conv-a", 0)?.root ?? new Uint8Array(0), r1)).toBe(true);
    expect(equal(find("conv-a", 1)?.root ?? new Uint8Array(0), r2)).toBe(true);
    expect(equal(find("conv-b", 0)?.root ?? new Uint8Array(0), r3)).toBe(true);
    for (const row of rows) expect(row.root).toBeInstanceOf(Uint8Array);
  });

  it("replaces a root stored for the same conversation and epoch", async () => {
    const userId = freshUser();
    const second = newRootKey();
    await keystore.saveRoot(userId, "conv-a", 4, newRootKey());
    await keystore.saveRoot(userId, "conv-a", 4, second);
    const rows = await keystore.loadRoots(userId);
    expect(rows.length).toBe(1);
    expect(equal(rows[0]?.root ?? new Uint8Array(0), second)).toBe(true);
  });

  it("only returns the requested user's roots", async () => {
    const a = freshUser();
    const b = freshUser();
    await keystore.saveRoot(a, "conv-shared", 0, newRootKey());
    await keystore.saveRoot(a, "conv-shared", 1, newRootKey());
    await keystore.saveRoot(b, "conv-shared", 0, newRootKey());
    expect((await keystore.loadRoots(a)).length).toBe(2);
    expect((await keystore.loadRoots(b)).length).toBe(1);
  });
});

describe("keystore clear", () => {
  it("removes the identity and every root of one user only", async () => {
    const mine = freshUser();
    const theirs = freshUser();
    const theirIdentity = generateIdentity();
    const theirRoot = newRootKey();

    await keystore.saveIdentity(mine, generateIdentity());
    await keystore.saveRoot(mine, "conv-a", 0, newRootKey());
    await keystore.saveRoot(mine, "conv-a", 1, newRootKey());
    await keystore.saveRoot(mine, "conv-b", 0, newRootKey());

    await keystore.saveIdentity(theirs, theirIdentity);
    await keystore.saveRoot(theirs, "conv-a", 0, theirRoot);

    await keystore.clear(mine);

    expect(await keystore.loadIdentity(mine)).toBeNull();
    expect(await keystore.loadRoots(mine)).toEqual([]);

    const left = await keystore.loadIdentity(theirs);
    expect(equal(left?.privateKey ?? new Uint8Array(0), theirIdentity.privateKey)).toBe(true);
    const rows = await keystore.loadRoots(theirs);
    expect(rows.length).toBe(1);
    expect(equal(rows[0]?.root ?? new Uint8Array(0), theirRoot)).toBe(true);
  });

  it("is a no-op for a user with nothing stored", async () => {
    const userId = freshUser();
    await expect(keystore.clear(userId)).resolves.toBeUndefined();
    expect(await keystore.loadIdentity(userId)).toBeNull();
    expect(await keystore.loadRoots(userId)).toEqual([]);
  });

  it("lets the same user be re-provisioned after a clear", async () => {
    const userId = freshUser();
    await keystore.saveIdentity(userId, generateIdentity());
    await keystore.saveRoot(userId, "conv-a", 0, randomBytes(32));
    await keystore.clear(userId);

    const id = generateIdentity();
    const root = newRootKey();
    await keystore.saveIdentity(userId, id);
    await keystore.saveRoot(userId, "conv-a", 0, root);
    expect(equal((await keystore.loadIdentity(userId))?.publicKey ?? new Uint8Array(0), id.publicKey)).toBe(true);
    const rows = await keystore.loadRoots(userId);
    expect(rows.length).toBe(1);
    expect(equal(rows[0]?.root ?? new Uint8Array(0), root)).toBe(true);
  });

  it("survives concurrent writes", async () => {
    const userId = freshUser();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => keystore.saveRoot(userId, "conv-a", i, newRootKey())),
    );
    const rows = await keystore.loadRoots(userId);
    expect(rows.length).toBe(10);
    expect(rows.map((r) => r.epoch).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
