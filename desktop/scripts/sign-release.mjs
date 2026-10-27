#!/usr/bin/env node
// Sign staged feeds only with the pinned private key. No setup/generation
// or public-key rewriting: an absent/wrong key must stop publication.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const feeds = new Set(["signed-latest.yml", "signed-latest-linux.yml", "signed-latest-mac.yml"]);
try {
  if (process.argv.length !== 3) throw new Error("usage: sign-release.mjs <staged-feed-directory>");
  const pinnedText = readFileSync(join(root, "src/main/update/releaseKey.ts"), "utf8");
  const pem = pinnedText.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)?.[0];
  if (!pem) throw new Error("the pinned release public key is missing");
  const keyPath = process.env.NEXA_DESKTOP_SIGNING_KEY || join(homedir(), ".local/share/nexa-signing/update-key.pem");
  const key = createPrivateKey(readFileSync(keyPath));
  if (key.asymmetricKeyType !== "ed25519" || !createPublicKey(key).export({ type: "spki", format: "der" }).equals(createPublicKey(pem).export({ type: "spki", format: "der" })))
    throw new Error("the private key does not match the pinned release public key");
  const dir = resolve(process.argv[2]);
  const names = readdirSync(dir).filter((name) => feeds.has(name));
  if (names.length === 0) throw new Error("no supported update feeds to sign");
  for (const name of names) {
    const body = readFileSync(join(dir, name));
    if (body.length > 1 << 20) throw new Error("update manifest too large");
    const message = Buffer.concat([Buffer.from(`nexa-desktop-update/v1\0${name}\0`, "utf8"), body]);
    writeFileSync(join(dir, `${name}.sig`), sign(null, message, key).toString("base64") + "\n");
  }
} catch (error) {
  console.error(`Desktop release signing failed: ${error.message}`);
  process.exitCode = 1;
}
