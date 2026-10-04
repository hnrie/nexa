// electron-builder's afterPack hook: signs the Mac app ad hoc as soon as it is
// packed, on any machine.
//
// Apple silicon runs no code without a signature, and macOS calls a
// downloaded app "damaged" when its bundle is not sealed. Electron's binaries
// arrive with only the stub signature the linker gives them, which covers
// neither the Info.plist electron-builder rewrites nor the resources it adds,
// and electron-builder signs only on a Mac with a signing identity. An ad hoc
// signature needs no Apple account: it is the hashes macOS checks, and the
// Gatekeeper prompt it leaves is the one the download page explains.
//
// rcodesign (github.com/indygreg/apple-platform-rs) signs from Linux, and
// Apple's codesign stands in for it on a Mac. A Mac app that cannot be signed
// fails the build, so an unsigned one is never published again.
//
// The signature names the app by its bundle identifier. macOS keeps what a
// person allowed (recording the screen, the microphone, the camera) against
// an app's designated requirement, and an ad hoc signature's own is the hash
// of that one build, so after every update macOS took Nexa for an app it had
// never seen: Screen Recording read as on in System Settings while nothing
// could be recorded, until Nexa was taken out of the list and added again.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** `identifier "<id>"` as a compiled code requirement, which is what `csreq -b` writes and rcodesign reads. */
function requirement(identifier) {
  const id = Buffer.from(identifier);
  const blob = Buffer.alloc(20 + Math.ceil(id.length / 4) * 4);
  blob.writeUInt32BE(0xfade0c00, 0);
  blob.writeUInt32BE(blob.length, 4);
  // an expression, whose one operation is the identifier
  blob.writeUInt32BE(1, 8);
  blob.writeUInt32BE(2, 12);
  blob.writeUInt32BE(id.length, 16);
  id.copy(blob, 20);
  return blob;
}
exports.requirement = requirement;

exports.default = async function signMac(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const id = context.packager.appInfo.id;
  const rcodesign = process.env.RCODESIGN || "rcodesign";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexa-sign-"));
  try {
    const designated = path.join(dir, "designated.req");
    fs.writeFileSync(designated, requirement(id));
    // it narrates every file it signs; that is only worth showing when it fails.
    // The requirement is the app's own (@main): what is nested in it keeps its own.
    execFileSync(rcodesign, ["sign", "--code-requirements-file", `@main:${designated}`, app], { stdio: "pipe" });
    console.log(`  • signed ad hoc with rcodesign  app=${app}`);
    return;
  } catch (err) {
    if (err.code !== "ENOENT" || process.platform !== "darwin") {
      if (err.stderr?.length) process.stderr.write(err.stderr);
      throw new Error(`could not sign ${app} ad hoc (${err.code === "ENOENT" ? "rcodesign is not installed; set RCODESIGN to it" : err.message})`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // everything nested first, then the app on its own with its requirement
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--force", "--sign", "-", "--requirements", `=designated => identifier "${id}"`, app], { stdio: "inherit" });
  console.log(`  • signed ad hoc with codesign  app=${app}`);
};
