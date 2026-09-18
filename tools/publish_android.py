#!/usr/bin/env python3
"""Publishes the Android app so chatd can serve it.

  python3 tools/publish_android.py [android/app/build/outputs/apk/release] [--to data/android] [--notes "what changed"]

Copies every APK the release build produced — the one that runs on any phone,
and the smaller ones carrying code for a single processor — into chatd's
ANDROID_DIR under names that carry their version, then writes manifest.json,
which /api/v1/android/latest serves to the download page, the banner and the
app's own updater. Each APK's details (version, minimum Android, processors,
signing certificate) are read from the file itself with the SDK's tools, so
nothing here can claim something a build does not say. Older builds are left
in place, so a download already running can finish.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time, zipfile
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


# The certificate in android/release.jks, which is the only one Android will
# accept as an update for an app already installed from this instance. It is
# written down here so that a build signed with anything else — the debug key,
# after a lost or mistyped keystore.properties, or a keystore replaced outright
# — cannot be published. This value also reaches /.well-known/assetlinks.json
# through the manifest, so getting it wrong breaks App Links at the same time.
EXPECTED_CERT = "1C:44:61:22:7C:06:8E:AF:55:91:FC:52:13:2E:8E:8B:BF:45:87:94:72:5A:8F:3E:FD:25:DF:6D:F2:6A:37:CA"


def baked_server(apk: Path) -> str:
    """The server BuildConfig.DEFAULT_SERVER points at, read out of the dex."""
    with zipfile.ZipFile(apk) as z:
        names = [n for n in z.namelist() if n.startswith("classes") and n.endswith(".dex")]
        for name in names:
            found = re.findall(rb"https?://[A-Za-z0-9.:/_-]{4,}", z.read(name))
            for url in found:
                text = url.decode("ascii", "replace")
                if "/" not in text.split("://", 1)[1].rstrip("/"):
                    return text
    return ""


def looks_local(url: str) -> bool:
    """A build pointed at a machine on this desk rather than at the internet."""
    host = url.split("://", 1)[-1].split("/")[0].split(":")[0]
    return host in ("localhost", "10.0.2.2", "10.0.3.2", "127.0.0.1", "::1") or host.endswith(".local")


def apk_kind(apk: Path, info: dict) -> str:
    """Which processor a build is for, or "universal" when it carries them all."""
    abis = info.get("abis") or []
    if len(abis) == 1:
        return abis[0]
    for abi in ("arm64-v8a", "armeabi-v7a", "x86_64", "x86"):
        if abi in apk.name:
            return abi
    return "universal"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("apk", nargs="?", default=str(ROOT / "android/app/build/outputs/apk/release"))
    ap.add_argument("--to", default=os.environ.get("ANDROID_DIR") or str(ROOT / "data/android"))
    ap.add_argument("--version", help="only needed when the SDK's aapt2 is not here")
    ap.add_argument("--notes", default="", help="what changed, shown by the app when it offers the update")
    ap.add_argument("--skip-cert-check", action="store_true", help="publish without confirming the signing certificate (only when the SDK build-tools are unavailable)")
    args = ap.parse_args()

    src, dest = Path(args.apk), Path(args.to)
    apks = sorted(src.glob("*.apk")) if src.is_dir() else [src]
    apks = [p for p in apks if p.is_file()]
    if not apks:
        print(f"no APK at {src}", file=sys.stderr)
        return 1

    builds = []
    for apk in apks:
        info = badging(apk)
        version = args.version or info.get("version")
        if not version:
            print("could not read the version: pass --version, or install the SDK build-tools", file=sys.stderr)
            return 1
        # `gradle assembleRelease -PserverUrl=…` leaves a perfectly ordinary,
        # release-signed APK in the usual place, pointed at whatever server was
        # being tested against. One of those was one command away from being
        # published, so it is checked here rather than remembered.
        server = baked_server(apk)
        if looks_local(server):
            print(f"{apk.name} is built against {server}, not the real server. Rebuild with: make android", file=sys.stderr)
            return 1
        cert = signing_cert(apk)
        if not cert and not args.skip_cert_check:
            print(f"could not read {apk.name}'s signing certificate; install the SDK build-tools, or pass --skip-cert-check if you are certain", file=sys.stderr)
            return 1
        if cert and cert != EXPECTED_CERT:
            print(f"{apk.name} is signed with {cert},\nnot the key this instance publishes under ({EXPECTED_CERT}).\nNo installed app could take this update. Check android/keystore.properties.", file=sys.stderr)
            return 1
        builds.append((apk, info, version, apk_kind(apk, info)))

    versions = {b[2] for b in builds}
    if len(versions) != 1:
        print(f"more than one version in {src}: {sorted(versions)}", file=sys.stderr)
        return 1
    version = versions.pop()

    universal = next((b for b in builds if b[3] == "universal"), builds[0])
    dest.mkdir(parents=True, exist_ok=True)

    files = []
    for apk, info, _, kind in builds:
        name = f"evilion-chat-{version}.apk" if kind == "universal" else f"evilion-chat-{version}-{kind}.apk"
        target = dest / name
        if target.resolve() != apk.resolve():
            shutil.copy2(apk, target)
        entry = {"abi": kind, "name": name, "size": target.stat().st_size, "sha256": sha256(target)}
        files.append(entry)
        if apk == universal[0]:
            universal_entry = entry
        print(f"  {kind:12} {name}  {entry['size'] / (1 << 20):.1f} MB")

    files.sort(key=lambda f: (f["abi"] != "universal", f["abi"]))
    info = universal[1]
    manifest = {
        "version": version,
        "version_code": info.get("version_code", 0),
        "released_at": int(time.time() * 1000),
        "name": universal_entry["name"],
        "size": universal_entry["size"],
        "sha256": universal_entry["sha256"],
        "min_sdk": info.get("min_sdk", 0),
        "files": files,
        "abis": info.get("abis", []),
        "signing_sha256": signing_cert(dest / universal_entry["name"]),
    }
    if args.notes:
        manifest["notes"] = args.notes
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"published {version} ({len(files)} build{'s' if len(files) != 1 else ''}) to {dest}")
    if not manifest["signing_sha256"]:
        print("note: no signing certificate read, so app links will stay off until apksigner is available")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
