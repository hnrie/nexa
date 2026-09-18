import { b64 } from "./bytes";
import { fingerprint, fingerprintOfB64 } from "./fingerprint";

/**
 * The same key `android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt` pins
 * as `identityPub`, so the two platforms are checked against one value rather
 * than each against itself. If this expectation and the Kotlin one ever
 * disagree, two people comparing safety numbers across a phone and a browser
 * would be told they are talking to an impostor when they are not.
 */
const IDENTITY_PUB = "cy7fq5I66k0o8YehEg1rHNCyrLM3Y+RQ1915E+EiYE0=";
const IDENTITY_FP = "84234 17400 39277 85751 92324 02841";

/** A second vector with no structure to it, in case the first is ever regenerated. */
const COUNTING_KEY = new Uint8Array(32).map((_, i) => i);
const COUNTING_FP = "61271 82505 00669 17367 22914 44410";

describe("fingerprint", () => {
  it("matches the Android test vector for the same key", () => {
    expect(fingerprint(b64.dec(IDENTITY_PUB))).toBe(IDENTITY_FP);
  });

  it("matches the second cross-platform vector", () => {
    expect(fingerprint(COUNTING_KEY)).toBe(COUNTING_FP);
  });

  it("is thirty digits in six groups of five", () => {
    const groups = fingerprint(COUNTING_KEY).split(" ");
    expect(groups).toHaveLength(6);
    for (const g of groups) expect(g).toMatch(/^\d{5}$/);
  });

  it("changes completely when one bit of the key does", () => {
    const flipped = new Uint8Array(COUNTING_KEY);
    flipped[31] = (flipped[31] ?? 0) ^ 1;
    const a = fingerprint(COUNTING_KEY).split(" ");
    const b = fingerprint(flipped).split(" ");
    // Not one group in common: a person comparing only the first group has to
    // see a difference too, which is what the iterated hash is there to buy.
    expect(a.filter((g, i) => g === b[i])).toEqual([]);
  });

  it("refuses anything that is not a 32-byte identity key", () => {
    expect(() => fingerprint(new Uint8Array(31))).toThrow();
    expect(() => fingerprint(new Uint8Array(33))).toThrow();
    expect(() => fingerprint(new Uint8Array(0))).toThrow();
  });

  it("takes a key in the shape the API carries it, and answers null for a missing one", () => {
    expect(fingerprintOfB64(IDENTITY_PUB)).toBe(IDENTITY_FP);
    // The cached second call has to agree with the first.
    expect(fingerprintOfB64(IDENTITY_PUB)).toBe(IDENTITY_FP);
    expect(fingerprintOfB64("")).toBeNull();
    expect(fingerprintOfB64(null)).toBeNull();
    expect(fingerprintOfB64("not base64 at all")).toBeNull();
    expect(fingerprintOfB64(b64.enc(new Uint8Array(16)))).toBeNull();
  });
});
