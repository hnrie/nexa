import { beforeEach, vi } from "vitest";
import { checkKey, closePins, forgetPin, hasPins, learnedThisSession, notePublicKey, openPins, pinKey, pinnedKey, startedWithNoPins } from "./keyPins";

const ALICE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const MALLORY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=";

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
    map,
  };
}

describe("key pins", () => {
  let store: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    closePins();
    openPins("me");
  });

  afterEach(() => {
    closePins();
    vi.unstubAllGlobals();
  });

  it("knows nothing before the first key it sees", () => {
    expect(hasPins()).toBe(false);
    expect(checkKey("1", ALICE)).toBe("first");
    expect(pinnedKey("1")).toBeNull();
  });

  it("pins the first key and recognises it afterwards", () => {
    expect(notePublicKey("1", ALICE)).toBe("first");
    expect(hasPins()).toBe(true);
    expect(notePublicKey("1", ALICE)).toBe("same");
    expect(pinnedKey("1")).toBe(ALICE);
  });

  it("reports a different key as changed and never records it on its own", () => {
    notePublicKey("1", ALICE);
    expect(notePublicKey("1", MALLORY)).toBe("changed");
    // The pin is untouched, so nothing later mistakes the swap for the truth.
    expect(pinnedKey("1")).toBe(ALICE);
    expect(notePublicKey("1", MALLORY)).toBe("changed");
  });

  it("takes a change only when it is said explicitly", () => {
    notePublicKey("1", ALICE);
    pinKey("1", MALLORY);
    expect(checkKey("1", MALLORY)).toBe("same");
  });

  it("has no opinion about a user with no key", () => {
    expect(notePublicKey("1", "")).toBe("unknown");
    expect(notePublicKey("1", null)).toBe("unknown");
    expect(hasPins()).toBe(false);
  });

  it("survives the account signing out and back in on the same device", () => {
    notePublicKey("1", ALICE);
    closePins();
    openPins("me");
    expect(checkKey("1", ALICE)).toBe("same");
    expect(checkKey("1", MALLORY)).toBe("changed");
  });

  it("keeps one account's memory apart from another's on a shared device", () => {
    notePublicKey("1", ALICE);
    closePins();
    openPins("someone-else");
    expect(checkKey("1", MALLORY)).toBe("first");
    closePins();
    openPins("me");
    expect(checkKey("1", MALLORY)).toBe("changed");
  });

  it("does not call a key it learned a moment ago one it remembers", () => {
    // A second device pins everybody within a second of connecting. Telling the
    // reader "same key as before" straight afterwards would claim a check that
    // never happened, so the interface asks this instead of the pin.
    expect(startedWithNoPins()).toBe(true);
    notePublicKey("1", ALICE);
    expect(checkKey("1", ALICE)).toBe("same");
    expect(learnedThisSession("1")).toBe(true);

    // Next session, the same key really is one this device remembered.
    closePins();
    openPins("me");
    expect(startedWithNoPins()).toBe(false);
    expect(learnedThisSession("1")).toBe(false);
    expect(checkKey("1", ALICE)).toBe("same");
  });

  it("counts an accepted key change as remembered, not as freshly learned", () => {
    notePublicKey("1", ALICE);
    expect(learnedThisSession("1")).toBe(true);
    pinKey("1", MALLORY);
    expect(learnedThisSession("1")).toBe(false);
  });

  it("forgets one person on request, so the next key is pinned afresh", () => {
    notePublicKey("1", ALICE);
    forgetPin("1");
    expect(checkKey("1", MALLORY)).toBe("first");
  });

  it("starts over rather than throwing when the stored file is nonsense", () => {
    closePins();
    store.map.set("ec.keypins.me", "{not json");
    openPins("me");
    expect(checkKey("1", ALICE)).toBe("first");
  });

  it("says nothing at all while no account is open", () => {
    closePins();
    expect(checkKey("1", ALICE)).toBe("unknown");
    expect(notePublicKey("1", ALICE)).toBe("unknown");
  });
});
