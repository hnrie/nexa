#!/usr/bin/env node
// Compare Android's actual native frame implementation with the browser's
// WebCrypto implementation. All build output goes into a throwaway directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { buildSync } = require("esbuild");
const scratch = mkdtempSync(join(tmpdir(), "nexa-frame-check-"));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
try {
  const target = join(scratch, "rust");
  run(process.env.CARGO || join(homedir(), ".cargo/bin/cargo"), ["build", "--manifest-path", "android/frame-crypto/Cargo.toml", "--target-dir", target, "--release", "--locked"]);
  const native = join(scratch, "native");
  const frame = resolve(root, "android/app/src/main/cpp/frame");
  run(process.env.CXX || "c++", ["-std=c++17", "-O2", `-I${frame}`, "tools/frame_crypto_check.cc", `${frame}/aes_gcm.cc`, `${frame}/sealed_frame.cc`, `${frame}/h264.cc`, `${target}/release/libnexa_frame_crypto.a`, "-o", native, ...(process.platform === "linux" ? ["-ldl", "-lpthread", "-lm"] : [])]);
  run(native, ["keys"]);
  const bundle = buildSync({ stdin: { contents: 'export * from "./web/src/voice/frameCrypto"; export * from "./web/src/voice/h264.fixture";', resolveDir: root }, bundle: true, platform: "node", format: "cjs", write: false });
  const modulePath = join(scratch, "browser.cjs");
  writeFileSync(modulePath, bundle.outputFiles[0].contents);
  const web = require(modulePath);
  globalThis.crypto ??= webcrypto;
  const key = new Uint8Array(32).fill(1), iv = web.frameIv(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]), 0x0101012a);
  const cryptoKey = await web.importFrameKey(key), keys = new Map([[7, cryptoKey]]);
  const hex = (bytes) => Buffer.from(bytes).toString("hex");
  function call(operation, kind, data, reject = false) {
    const result = spawnSync(native, [operation, kind, hex(key), hex(iv), hex(data)], { encoding: "utf8" });
    assert.equal(result.status, reject ? 2 : 0, `${operation} ${kind}: ${result.stderr}`);
    return Uint8Array.from(Buffer.from(result.stdout.trim(), "hex"));
  }
  const cases = [
    ...[0, 1, 2, 255, 2000].map((length) => ({ kind: "audio", data: Uint8Array.from({ length }, (_, i) => i * 37 & 255), clear: 1 })),
    { kind: "video", data: Uint8Array.from([0, 0, 0, 0x9d, 1, 0x2a, 96, 0, 40, 0, 17, 18, 19]), clear: 10 },
    { kind: "video", data: Uint8Array.from([1, 0, 0, 17, 18, 19, 20]), clear: 3 },
    ...web.TINY_HIGH_FRAMES.map((offset, i, offsets) => ({ kind: "h264", data: web.TINY_HIGH.slice(offset, offsets[i + 1]), clear: 0 })),
  ];
  for (const { kind, data, clear } of cases) {
    const sealed = kind === "h264" ? await web.sealH264Frame(cryptoKey, 7, iv, data) : await web.sealFrame(cryptoKey, 7, iv, data, clear);
    assert.ok(sealed, `${kind} fixture must be sealable`);
    const nativeSealed = call("seal", kind, data);
    assert.deepEqual(nativeSealed, sealed, `${kind} produces identical bytes`);
    const opened = kind === "h264" ? await web.openH264Frame(keys, nativeSealed) : await web.openFrame(keys, nativeSealed, clear);
    assert.ok(opened);
    assert.deepEqual(call("open", kind, sealed), opened, `${kind} decrypts across implementations`);
    for (const offset of [0, sealed.length - 2, sealed.length - 14]) {
      const tampered = sealed.slice(); tampered[offset] ^= 8;
      call("open", kind, tampered, true);
      assert.equal(kind === "h264" ? await web.openH264Frame(keys, tampered) : await web.openFrame(keys, tampered, clear), null);
    }
  }
  console.log(`${cases.length} native/WebCrypto vectors passed, including tampering and empty frames`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
