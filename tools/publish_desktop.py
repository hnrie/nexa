#!/usr/bin/env python3
"""Publishes a desktop app release built by electron-builder.

  python3 tools/publish_desktop.py [desktop/dist] [--to data/desktop]

Copies the installers, the Mac update zips, their blockmaps and the update
manifests (latest*.yml) into chatd's DESKTOP_DIR, then writes manifest.json,
which /api/v1/desktop/latest serves to the download page and banner. Files of
older releases are left in place, so updates already downloading can finish;
the update manifests always name the newest.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# electron-builder.yml names artifacts nexa[-Setup]-<version>-<os>-<arch>.<ext>
PATTERN = re.compile(r"^nexa-(?:Setup-)?(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?P<os>win|mac|linux)-(?P<arch>x64|arm64|x86_64|amd64|aarch64)\.(?P<ext>exe|dmg|zip|AppImage|deb)$")
KIND = {"exe": "installer", "dmg": "installer", "zip": "zip", "AppImage": "appimage", "deb": "deb"}
OS = {"win": "windows", "mac": "mac", "linux": "linux"}
ARCH = {"x64": "x64", "x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", nargs="?", default=str(ROOT / "desktop/dist"))
    ap.add_argument("--to", default=os.environ.get("DESKTOP_DIR") or str(ROOT / "data/desktop"))
    args = ap.parse_args()
    dist, dest = Path(args.dist), Path(args.to)
    if not dist.is_dir():
        print(f"no build at {dist}", file=sys.stderr)
        return 1

    found = []
    for p in sorted(dist.iterdir()):
        m = PATTERN.match(p.name)
        if m and p.is_file():
            found.append((p, m))
    if not found:
        print(f"no nexa artifacts in {dist}", file=sys.stderr)
        return 1
    versions = {m["version"] for _, m in found}
    if len(versions) != 1:
        print(f"more than one version in {dist}: {sorted(versions)}", file=sys.stderr)
        return 1
    version = versions.pop()
    manifests = [p for p in dist.glob("latest*.yml")]
    if not manifests:
        print("no latest*.yml update manifests: was electron-builder run with the publish config?", file=sys.stderr)
        return 1

    dest.mkdir(parents=True, exist_ok=True)
    files = []
    for p, m in found:
        shutil.copy2(p, dest / p.name)
        blockmap = p.with_name(p.name + ".blockmap")
        if blockmap.exists():
            shutil.copy2(blockmap, dest / blockmap.name)
        files.append({"os": OS[m["os"]], "arch": ARCH[m["arch"]], "kind": KIND[m["ext"]], "name": p.name, "size": p.stat().st_size, "sha256": sha256(p)})
        print(f"  {p.name} ({p.stat().st_size / 1048576:.1f} MB)")
    # Sign the manifests before they are published. Without a signature the
    # only thing an app can check is a hash that came from the same host as
    # the file, which catches a bad download and nothing else.
    sign = subprocess.run(
        ["node", "scripts/sign-release.mjs", str(dist)],
        cwd=str(ROOT / "desktop"), capture_output=True, text=True,
    )
    if sign.returncode != 0:
        print(sign.stdout + sign.stderr, file=sys.stderr)
        print("could not sign the release; nothing was published", file=sys.stderr)
        return 1
    print(sign.stdout.rstrip())

    # the update manifests and their signatures go last, once everything they
    # name is in place
    for y in manifests:
        for src in (y, y.with_name(y.name + ".sig")):
            if not src.exists():
                print(f"missing {src.name}", file=sys.stderr)
                return 1
            tmp = dest / (src.name + ".tmp")
            shutil.copy2(src, tmp)
            tmp.replace(dest / src.name)
    manifest = {"version": version, "released_at": int(time.time() * 1000), "files": files}
    tmp = dest / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2))
    tmp.replace(dest / "manifest.json")
    print(f"published {version} to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
