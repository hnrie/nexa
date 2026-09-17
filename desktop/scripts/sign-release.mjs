#!/usr/bin/env node
/**
 * Signs the update manifests, so an app will only install a build this
 * machine released.
 *
 * The app's own check was the sha512 in the manifest, fetched from the same
 * host as the file it describes: that catches a corrupted download and
 * nothing else. Whoever can write to the release directory could serve a
 * build of their own with a matching hash, and every running client would
 * take it. macOS would not object either — the bundles are ad-hoc signed,
 * which anyone can do, and the installer strips the quarantine flag.
 *
 * So the manifests are signed here with a key that never leaves this machine,
 * and the app carries the public half. A manifest that does not verify is not
 * an update.
 *
 *   node scripts/sign-release.mjs <dir>      sign every latest*.yml in <dir>
 *   node scripts/sign-release.mjs --setup    make the key, print the public half
 *
 * The private key lives at desktop/update-key.pem and is gitignored, like the
 * Android keystore. Losing it means releases can no longer be signed and
 * every installed app stops updating until a new public key ships in a build
 * people install by hand — so keep a copy somewhere safe.
 */
import { generateKeyPairSync, sign, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KEY = join(here, "..", "update-key.pem");
const PUBLIC_TS = join(here, "..", "src", "main", "update", "releaseKey.ts");

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return publicKey;
}

function writePublic(publicKey) {
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
  writeFileSync(
    PUBLIC_TS,
    `/**\n` +
      ` * The public half of the key releases are signed with.\n` +
      ` *\n` +
      ` * Written by scripts/sign-release.mjs. The private half is on the machine\n` +
      ` * that publishes and is in no repository. An update whose manifest does not\n` +
      ` * verify against this is refused, so replacing the release files is not\n` +
      ` * enough to make an app install something.\n` +
      ` */\n` +
      `export const RELEASE_PUBLIC_KEY = \`${pem}\n\`;\n`,
  );
}

const arg = process.argv[2];

if (arg === "--setup") {
  if (existsSync(KEY)) {
    console.error(`${KEY} already exists; refusing to replace it`);
    process.exit(1);
  }
  writePublic(makeKey());
  console.log(`wrote ${KEY} (keep a copy somewhere safe) and ${PUBLIC_TS}`);
  process.exit(0);
}

if (!arg) {
  console.error("usage: sign-release.mjs <dir> | --setup");
  process.exit(2);
}

const dir = resolve(arg);
if (!existsSync(KEY)) {
  console.error(`no signing key at ${KEY}. Run: node scripts/sign-release.mjs --setup`);
  process.exit(1);
}
const priv = createPrivateKey(readFileSync(KEY));
// keep the committed public key in step with the key actually being used
writePublic(createPublicKey(priv));

const manifests = readdirSync(dir).filter((n) => /^latest.*\.yml$/.test(n));
if (manifests.length === 0) {
  console.error(`no latest*.yml in ${dir}`);
  process.exit(1);
}
for (const name of manifests) {
  const body = readFileSync(join(dir, name));
  writeFileSync(join(dir, `${name}.sig`), sign(null, body, priv).toString("base64") + "\n");
  console.log(`  signed ${name}`);
}
