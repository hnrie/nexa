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
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function signMac(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const rcodesign = process.env.RCODESIGN || "rcodesign";
  try {
    // it narrates every file it signs; that is only worth showing when it fails
    execFileSync(rcodesign, ["sign", app], { stdio: "pipe" });
    console.log(`  • signed ad hoc with rcodesign  app=${app}`);
    return;
  } catch (err) {
    if (err.code !== "ENOENT" || process.platform !== "darwin") {
      if (err.stderr?.length) process.stderr.write(err.stderr);
      throw new Error(`could not sign ${app} ad hoc (${err.code === "ENOENT" ? "rcodesign is not installed; set RCODESIGN to it" : err.message})`);
    }
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  console.log(`  • signed ad hoc with codesign  app=${app}`);
};
