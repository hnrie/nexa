import { equal, utf8 } from "./bytes";
import {
  DEFAULT_KDF,
  deriveAuthKey,
  deriveEncKey,
  deriveMaster,
  deriveSettingsKey,
  newRecoveryKey,
  recoveryKeyToBytes,
  recoveryToKeys,
  type KdfParams,
} from "./kdf";

// Deliberately tiny so the suite stays fast; production uses DEFAULT_KDF.
const FAST: KdfParams = { m: 1024, t: 1, p: 1, v: 1 };
const SALT = utf8.enc("0123456789abcdef");

describe("DEFAULT_KDF", () => {
  it("pins the production parameters", () => {
    expect(DEFAULT_KDF).toEqual({ m: 65536, t: 3, p: 1, v: 1 });
  });
});

describe("deriveMaster", () => {
  it("is deterministic and 32 bytes", async () => {
    const a = await deriveMaster("correct horse battery staple", SALT, FAST);
    const b = await deriveMaster("correct horse battery staple", SALT, FAST);
    expect(a.length).toBe(32);
    expect(equal(a, b)).toBe(true);
  });

  it("depends on the salt", async () => {
    const a = await deriveMaster("pw", SALT, FAST);
    const b = await deriveMaster("pw", utf8.enc("fedcba9876543210"), FAST);
    expect(equal(a, b)).toBe(false);
  });

  it("depends on the password", async () => {
    const a = await deriveMaster("pw", SALT, FAST);
    const b = await deriveMaster("pW", SALT, FAST);
    expect(equal(a, b)).toBe(false);
  });

  it("depends on the parameters", async () => {
    const a = await deriveMaster("pw", SALT, FAST);
    const b = await deriveMaster("pw", SALT, { ...FAST, t: 2 });
    expect(equal(a, b)).toBe(false);
  });

  it("normalises the password with NFKC", async () => {
    // U+FB01 LATIN SMALL LIGATURE FI folds to "fi" under NFKC.
    const ligature = await deriveMaster("ﬁne", SALT, FAST);
    const plain = await deriveMaster("fine", SALT, FAST);
    expect(equal(ligature, plain)).toBe(true);

    // Decomposed e + combining acute composes to U+00E9.
    const nfd = await deriveMaster("café", SALT, FAST);
    const nfc = await deriveMaster("café", SALT, FAST);
    expect(equal(nfd, nfc)).toBe(true);
  });

  it("accepts the default parameter shape at a larger memory size", async () => {
    const params: KdfParams = { ...DEFAULT_KDF, m: 8192 };
    const a = await deriveMaster("pw", SALT, params);
    const b = await deriveMaster("pw", SALT, params);
    expect(a.length).toBe(32);
    expect(equal(a, b)).toBe(true);
    expect(equal(a, await deriveMaster("pw", SALT, FAST))).toBe(false);
  });
});

describe("sub-key derivation", () => {
  const master = new Uint8Array(32).fill(7);

  it("derives distinct 32-byte auth and enc keys", () => {
    const auth = deriveAuthKey(master);
    const enc = deriveEncKey(master);
    expect(auth.length).toBe(32);
    expect(enc.length).toBe(32);
    expect(equal(auth, enc)).toBe(false);
  });

  it("is deterministic", () => {
    expect(equal(deriveAuthKey(master), deriveAuthKey(master))).toBe(true);
    expect(equal(deriveEncKey(master), deriveEncKey(master))).toBe(true);
  });

  it("depends on the master key", () => {
    const other = new Uint8Array(32).fill(8);
    expect(equal(deriveAuthKey(master), deriveAuthKey(other))).toBe(false);
    expect(equal(deriveEncKey(master), deriveEncKey(other))).toBe(false);
  });

  it("derives a settings key distinct from the auth and enc keys", () => {
    const settings = deriveSettingsKey(master);
    expect(settings.length).toBe(32);
    expect(equal(settings, deriveSettingsKey(master))).toBe(true);
    expect(equal(settings, deriveAuthKey(master))).toBe(false);
    expect(equal(settings, deriveEncKey(master))).toBe(false);
    expect(equal(settings, deriveSettingsKey(new Uint8Array(32).fill(9)))).toBe(false);
  });
});

describe("recovery keys", () => {
  it("generates 32 bytes displayed as 8 groups of 8 uppercase hex characters", () => {
    const { bytes, display } = newRecoveryKey();
    expect(bytes.length).toBe(32);
    expect(display).toMatch(/^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/);
    expect(display.replace(/-/g, "").length).toBe(64);
  });

  it("generates a different key each time", () => {
    expect(newRecoveryKey().display).not.toBe(newRecoveryKey().display);
  });

  it("round trips display to bytes", () => {
    const { bytes, display } = newRecoveryKey();
    expect(equal(recoveryKeyToBytes(display), bytes)).toBe(true);
  });

  it("accepts lowercase, missing dashes and stray whitespace", () => {
    const { bytes, display } = newRecoveryKey();
    const plain = display.replace(/-/g, "");
    expect(equal(recoveryKeyToBytes(display.toLowerCase()), bytes)).toBe(true);
    expect(equal(recoveryKeyToBytes(plain), bytes)).toBe(true);
    expect(equal(recoveryKeyToBytes(plain.toLowerCase()), bytes)).toBe(true);
    expect(equal(recoveryKeyToBytes(`  ${display}  `), bytes)).toBe(true);
    expect(equal(recoveryKeyToBytes(display.replace(/-/g, " ")), bytes)).toBe(true);
    expect(equal(recoveryKeyToBytes(`${plain.slice(0, 10)}\n\t ${plain.slice(10)}`), bytes)).toBe(true);
  });

  it("rejects malformed recovery keys", () => {
    const ok = "A".repeat(64);
    const bad = [
      "A".repeat(63),
      "A".repeat(65),
      "",
      "-".repeat(8),
      `${"A".repeat(63)}G`,
      `${"A".repeat(62)}xy`,
      `${ok}A`,
    ];
    for (const s of bad) {
      expect(() => recoveryKeyToBytes(s)).toThrow("invalid recovery key");
    }
    expect(recoveryKeyToBytes(ok).length).toBe(32);
  });

  it("derives distinct auth and enc keys from the recovery bytes", () => {
    const { bytes } = newRecoveryKey();
    const { authKey, encKey } = recoveryToKeys(bytes);
    expect(authKey.length).toBe(32);
    expect(encKey.length).toBe(32);
    expect(equal(authKey, encKey)).toBe(false);

    const again = recoveryToKeys(bytes);
    expect(equal(again.authKey, authKey)).toBe(true);
    expect(equal(again.encKey, encKey)).toBe(true);
  });

  it("derives recovery keys unrelated to the password sub-keys", () => {
    const bytes = new Uint8Array(32).fill(7);
    const { authKey, encKey } = recoveryToKeys(bytes);
    expect(equal(authKey, deriveAuthKey(bytes))).toBe(false);
    expect(equal(encKey, deriveEncKey(bytes))).toBe(false);
  });

  it("depends on the recovery bytes", () => {
    const a = recoveryToKeys(new Uint8Array(32).fill(1));
    const b = recoveryToKeys(new Uint8Array(32).fill(2));
    expect(equal(a.authKey, b.authKey)).toBe(false);
    expect(equal(a.encKey, b.encKey)).toBe(false);
  });
});
