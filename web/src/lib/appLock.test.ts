import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateIdentity } from "@/crypto/keys";
import type { KdfParams } from "@/crypto/kdf";
import {
  clearLock,
  enableLock,
  hasLock,
  isNumeric,
  loadLock,
  MAX_FAILURES,
  passcodeProblem,
  patchLock,
  saveLock,
  triesLeft,
  unlockIdentity,
  WrongPasscode,
} from "./appLock";

// The real cost would make this file take half a minute; the code path is the same.
const FAST: KdfParams = { m: 1024, t: 1, p: 1, v: 1 };
const USER = "1234567890";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("passcodeProblem", () => {
  it("rejects the ones that are not worth having", () => {
    expect(passcodeProblem("123")).toMatch(/at least 4/i);
    expect(passcodeProblem("0000")).toMatch(/repeated/i);
    expect(passcodeProblem("x".repeat(200))).toMatch(/too long/i);
    expect(passcodeProblem("1379")).toBeNull();
    expect(passcodeProblem("correct horse")).toBeNull();
  });
});

describe("enableLock", () => {
  it("wraps the identity so the passcode brings it back", async () => {
    const id = generateIdentity();
    expect(hasLock(USER)).toBe(false);
    await enableLock(USER, id, "1379", { kdf: FAST });
    expect(hasLock(USER)).toBe(true);

    const cfg = loadLock(USER);
    expect(cfg?.wrapped).toBeTruthy();
    expect(cfg?.wrapped).not.toContain(btoa(String.fromCharCode(...id.privateKey)));

    const back = await unlockIdentity(USER, "1379");
    expect(back.privateKey).toEqual(id.privateKey);
    expect(back.publicKey).toEqual(id.publicKey);
  });

  it("refuses a passcode that is too weak to bother with", async () => {
    await expect(enableLock(USER, generateIdentity(), "12", { kdf: FAST })).rejects.toThrow(/at least 4/i);
    expect(hasLock(USER)).toBe(false);
  });

  it("keeps the timing preferences when the passcode changes", async () => {
    const id = generateIdentity();
    await enableLock(USER, id, "1379", { kdf: FAST, autoLockMs: 60_000, lockOnBlur: true, blurDelayMs: 30_000 });
    await enableLock(USER, id, "2468", { kdf: FAST });
    const cfg = loadLock(USER);
    expect(cfg?.autoLockMs).toBe(60_000);
    expect(cfg?.lockOnBlur).toBe(true);
    expect(cfg?.blurDelayMs).toBe(30_000);
    await expect(unlockIdentity(USER, "1379")).rejects.toThrow(WrongPasscode);
  });
});

describe("unlockIdentity", () => {
  it("counts wrong tries down and clears them after a good one", async () => {
    const id = generateIdentity();
    await enableLock(USER, id, "1379", { kdf: FAST });
    expect(triesLeft(USER)).toBe(MAX_FAILURES);

    await expect(unlockIdentity(USER, "9999")).rejects.toThrow(WrongPasscode);
    expect(triesLeft(USER)).toBe(MAX_FAILURES - 1);

    await unlockIdentity(USER, "1379");
    expect(triesLeft(USER)).toBe(MAX_FAILURES);
  });

  it("throws the wrapped key away once the tries run out", async () => {
    const id = generateIdentity();
    await enableLock(USER, id, "1379", { kdf: FAST });
    const cfg = loadLock(USER)!;
    saveLock(USER, { ...cfg, failures: MAX_FAILURES - 1 });

    await expect(unlockIdentity(USER, "9999")).rejects.toMatchObject({ left: 0 });
    expect(hasLock(USER)).toBe(false);
    await expect(unlockIdentity(USER, "1379")).rejects.toThrow(/no passcode/i);
  });

  it("reports how many tries are left in the message", async () => {
    await enableLock(USER, generateIdentity(), "1379", { kdf: FAST });
    await expect(unlockIdentity(USER, "9999")).rejects.toThrow(/9 tries left/);
  });
});

describe("numeric", () => {
  it("records whether the passcode is digits, so a phone offers the right keyboard", async () => {
    const id = generateIdentity();
    await enableLock(USER, id, "1379", { kdf: FAST });
    expect(loadLock(USER)?.numeric).toBe(true);
    await enableLock(USER, id, "blue42", { kdf: FAST });
    expect(loadLock(USER)?.numeric).toBe(false);
    expect(isNumeric("0042")).toBe(true);
    expect(isNumeric("12 34")).toBe(false);
  });

  it("learns it on the next unlock for a record made before it was kept", async () => {
    await enableLock(USER, generateIdentity(), "1379", { kdf: FAST });
    const { numeric: _dropped, ...old } = loadLock(USER)!;
    saveLock(USER, old);
    expect(loadLock(USER)?.numeric).toBeUndefined();
    await unlockIdentity(USER, "1379");
    expect(loadLock(USER)?.numeric).toBe(true);
  });
});

describe("patchLock", () => {
  it("changes the timings without disturbing the key", async () => {
    const id = generateIdentity();
    await enableLock(USER, id, "1379", { kdf: FAST });
    const before = loadLock(USER)!.wrapped;
    patchLock(USER, { autoLockMs: 900_000, lockOnBlur: true });
    const after = loadLock(USER)!;
    expect(after.autoLockMs).toBe(900_000);
    expect(after.lockOnBlur).toBe(true);
    expect(after.wrapped).toBe(before);
    expect((await unlockIdentity(USER, "1379")).privateKey).toEqual(id.privateKey);
  });

  it("does nothing for a device with no passcode", () => {
    expect(patchLock(USER, { autoLockMs: 1000 })).toBeNull();
  });
});

describe("clearLock", () => {
  it("forgets the record entirely", async () => {
    await enableLock(USER, generateIdentity(), "1379", { kdf: FAST });
    clearLock(USER);
    expect(loadLock(USER)).toBeNull();
    expect(hasLock(USER)).toBe(false);
  });
});
