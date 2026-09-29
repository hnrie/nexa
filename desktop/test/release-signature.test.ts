/**
 * The updater's only real check that a build came from us.
 *
 * The sha512 in a manifest says the download matches what the manifest
 * describes, and the manifest comes from the same host as the download — so
 * on its own it catches a corrupted file and nothing else. These assert that
 * the signature is what decides, and that it cannot be talked round.
 */
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RELEASE_PUBLIC_KEY } from "../src/main/update/releaseKey";

const manifest = "version: 1.0.5\nfiles:\n  - url: nexa-1.0.5-mac-arm64.zip\n    sha512: abc\n    size: 1\n";

/** What mac.ts does, kept here so the check itself is under test. */
function ours(body: string, signature: string, key = RELEASE_PUBLIC_KEY): boolean {
  try {
    return verify(null, Buffer.from(body), createPublicKey(key), Buffer.from(signature.trim(), "base64"));
  } catch {
    return false;
  }
}

describe("release signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const good = sign(null, Buffer.from(manifest), privateKey).toString("base64");

  it("accepts a manifest signed by the release key", () => {
    expect(ours(manifest, good, pem)).toBe(true);
  });

  it("refuses a manifest with no signature at all", () => {
    expect(ours(manifest, "", pem)).toBe(false);
  });

  it("refuses a manifest whose bytes were changed after signing", () => {
    expect(ours(manifest.replace("1.0.5", "9.9.9"), good, pem)).toBe(false);
  });

  it("refuses a manifest signed by somebody else's key", () => {
    const other = generateKeyPairSync("ed25519");
    const theirs = sign(null, Buffer.from(manifest), other.privateKey).toString("base64");
    expect(ours(manifest, theirs, pem)).toBe(false);
  });

  it("refuses a signature that is not even base64", () => {
    expect(ours(manifest, "not a signature", pem)).toBe(false);
  });

  it("ships a real public key, so a build is actually checked against something", () => {
    expect(RELEASE_PUBLIC_KEY).toContain("BEGIN PUBLIC KEY");
    expect(() => createPublicKey(RELEASE_PUBLIC_KEY)).not.toThrow();
  });
});
