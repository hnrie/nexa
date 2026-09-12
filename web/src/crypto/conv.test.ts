import { equal, randomBytes } from "./bytes";
import { KeyRing, channelKey, newRootKey } from "./conv";

describe("newRootKey", () => {
  it("returns 32 fresh random bytes", () => {
    const a = newRootKey();
    expect(a.length).toBe(32);
    expect(equal(a, newRootKey())).toBe(false);
  });
});

describe("channelKey", () => {
  const root = new Uint8Array(32).fill(11);

  it("is deterministic and 32 bytes", () => {
    const k = channelKey(root, "general");
    expect(k.length).toBe(32);
    expect(equal(k, channelKey(root, "general"))).toBe(true);
  });

  it("differs per channel", () => {
    expect(equal(channelKey(root, "general"), channelKey(root, "random"))).toBe(false);
    expect(equal(channelKey(root, "a"), channelKey(root, "ab"))).toBe(false);
    expect(equal(channelKey(root, ""), channelKey(root, "general"))).toBe(false);
  });

  it("differs per root key", () => {
    expect(equal(channelKey(root, "general"), channelKey(new Uint8Array(32).fill(12), "general"))).toBe(false);
    expect(equal(channelKey(newRootKey(), "general"), channelKey(newRootKey(), "general"))).toBe(false);
  });
});

describe("KeyRing", () => {
  it("stores and reads a root per conversation and epoch", () => {
    const ring = new KeyRing();
    const r0 = newRootKey();
    const r1 = newRootKey();
    ring.set("conv-a", 0, r0);
    ring.set("conv-a", 1, r1);
    expect(equal(ring.get("conv-a", 0) ?? new Uint8Array(0), r0)).toBe(true);
    expect(equal(ring.get("conv-a", 1) ?? new Uint8Array(0), r1)).toBe(true);
  });

  it("returns undefined for unknown conversations and epochs", () => {
    const ring = new KeyRing();
    ring.set("conv-a", 0, newRootKey());
    expect(ring.get("conv-a", 5)).toBeUndefined();
    expect(ring.get("conv-b", 0)).toBeUndefined();
    expect(ring.latest("conv-b")).toBeUndefined();
  });

  it("overwrites an existing epoch", () => {
    const ring = new KeyRing();
    const first = newRootKey();
    const second = newRootKey();
    ring.set("conv-a", 3, first);
    ring.set("conv-a", 3, second);
    expect(equal(ring.get("conv-a", 3) ?? new Uint8Array(0), second)).toBe(true);
    expect(ring.epochs("conv-a")).toEqual([3]);
  });

  it("reports the highest epoch as the latest, whatever the insertion order", () => {
    const ring = new KeyRing();
    const r7 = newRootKey();
    ring.set("conv-a", 2, newRootKey());
    ring.set("conv-a", 7, r7);
    ring.set("conv-a", 5, newRootKey());
    const latest = ring.latest("conv-a");
    expect(latest?.epoch).toBe(7);
    expect(equal(latest?.root ?? new Uint8Array(0), r7)).toBe(true);
  });

  it("tracks membership", () => {
    const ring = new KeyRing();
    expect(ring.has("conv-a")).toBe(false);
    ring.set("conv-a", 0, newRootKey());
    expect(ring.has("conv-a")).toBe(true);
    expect(ring.has("conv-b")).toBe(false);
  });

  it("lists conversations and ascending epochs", () => {
    const ring = new KeyRing();
    ring.set("conv-b", 4, newRootKey());
    ring.set("conv-a", 9, newRootKey());
    ring.set("conv-a", 1, newRootKey());
    ring.set("conv-a", 3, newRootKey());
    expect(ring.convs().sort()).toEqual(["conv-a", "conv-b"]);
    expect(ring.epochs("conv-a")).toEqual([1, 3, 9]);
    expect(ring.epochs("conv-b")).toEqual([4]);
    expect(ring.epochs("conv-missing")).toEqual([]);
  });

  it("clears everything", () => {
    const ring = new KeyRing();
    ring.set("conv-a", 0, newRootKey());
    ring.set("conv-b", 1, newRootKey());
    ring.clear();
    expect(ring.convs()).toEqual([]);
    expect(ring.has("conv-a")).toBe(false);
    expect(ring.get("conv-a", 0)).toBeUndefined();
    expect(ring.latest("conv-b")).toBeUndefined();
  });

  it("keeps stored roots isolated from later mutation of the caller's array", () => {
    const ring = new KeyRing();
    const root = randomBytes(32);
    ring.set("conv-a", 0, root);
    const stored = ring.get("conv-a", 0);
    expect(stored).toBeDefined();
    expect(equal(stored ?? new Uint8Array(0), root)).toBe(true);
  });
});
