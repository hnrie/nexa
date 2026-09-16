#!/usr/bin/env python3
"""Publishes the Android app so chatd can serve it.

  python3 tools/publish_android.py [android/app/build/outputs/apk/release/app-release.apk] [--to data/android]

Copies the APK into chatd's ANDROID_DIR under a name that carries its version,
then writes manifest.json, which /api/v1/android/latest serves to the download
page and the banner. The APK's own details (version, minimum Android, the
processors it carries code for, the certificate it is signed with) are read
from the file itself with the SDK's tools, so the page cannot claim something
the build does not say. Older builds are left in place, so a download already
running can finish.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SDK = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "/usr/local/share/android-commandlinetools"


def sdk_tool(name: str) -> str | None:
    """The newest build-tools copy of a tool, if the SDK is here."""
    tools = sorted((Path(SDK) / "build-tools").glob(f"*/{name}"), reverse=True)
    return str(tools[0]) if tools else shutil.which(name)


def run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True).stdout


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def badging(apk: Path) -> dict:
    """version, version code, minimum sdk and ABIs, as aapt2 reads them."""
    aapt = sdk_tool("aapt2")
    if not aapt:
        return {}
    out = run(aapt, "dump", "badging", str(apk))
    info = {}
    if m := re.search(r"versionName='([^']+)'", out):
        info["version"] = m.group(1)
    if m := re.search(r"versionCode='(\d+)'", out):
        info["version_code"] = int(m.group(1))
    if m := re.search(r"(?:minS|s)dkVersion:'(\d+)'", out):
        info["min_sdk"] = int(m.group(1))
    abis = re.findall(r"native-code: (.+)", out)
    if abis:
        info["abis"] = sorted({a.strip("'") for a in abis[0].split()})
    return info


def signing_cert(apk: Path) -> str:
    """The signing certificate's SHA-256, as Android wants it for app links."""
    signer = sdk_tool("apksigner")
    if not signer:
        return ""
    out = run(signer, "verify", "--print-certs", str(apk))
    m = re.search(r"certificate SHA-256 digest: ([0-9a-fA-F]{64})", out)
    if not m:
        return ""
    raw = m.group(1).upper()
    return ":".join(raw[i : i + 2] for i in range(0, len(raw), 2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("apk", nargs="?", default=str(ROOT / "android/app/build/outputs/apk/release/app-release.apk"))
    ap.add_argument("--to", default=os.environ.get("ANDROID_DIR") or str(ROOT / "data/android"))
    ap.add_argument("--version", help="only needed when the SDK's aapt2 is not here")
    args = ap.parse_args()

    apk, dest = Path(args.apk), Path(args.to)
    if not apk.is_file():
        print(f"no APK at {apk}", file=sys.stderr)
        return 1

    info = badging(apk)
    version = args.version or info.get("version")
    if not version:
        print("could not read the version: pass --version, or install the SDK build-tools", file=sys.stderr)
        return 1

    dest.mkdir(parents=True, exist_ok=True)
    name = f"evilion-chat-{version}.apk"
    target = dest / name
    if target.resolve() != apk.resolve():
        shutil.copy2(apk, target)

    manifest = {
        "version": version,
        "version_code": info.get("version_code", 0),
        "released_at": int(time.time() * 1000),
        "name": name,
        "size": target.stat().st_size,
        "sha256": sha256(target),
        "min_sdk": info.get("min_sdk", 0),
        "abis": info.get("abis", []),
        "signing_sha256": signing_cert(target),
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"published {name} ({manifest['size'] / (1 << 20):.1f} MB) to {dest}")
    if not manifest["signing_sha256"]:
        print("note: no signing certificate read, so app links will stay off until apksigner is available")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
