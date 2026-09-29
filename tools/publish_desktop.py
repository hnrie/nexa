#!/usr/bin/env python3
"""Publishes a desktop app release built by electron-builder.

  python3 tools/publish_desktop.py [desktop/dist] [--to data/desktop]

Copies the installers, the Mac update zips, their blockmaps and the update
manifests (latest*.yml) into chatd's DESKTOP_DIR, then writes manifest.json,
which /api/v1/desktop/latest serves to the download page and banner. Files of
older releases are left in place, so updates already downloading can finish;
the update manifests always name the newest.

The Mac manifest is published as latest-mac-2.yml, the feed the Mac app reads
from 1.1.0 on (desktop/src/main/update/mac.ts). latest-mac.yml belongs to the
copies before that, which cannot update themselves to this version; it and the
files it names stay as they are, and the page offers those copies the new
version as a download instead (web/src/lib/macReplacement.ts).
"""
import argparse, hashlib, json, os, re, shutil, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# electron-builder.yml names artifacts nexa[-Setup]-<version>-<os>-<arch>.<ext>
PATTERN = re.compile(r"^nexa-(?:Setup-)?(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?P<os>win|mac|linux)-(?P<arch>x64|arm64|x86_64|amd64|aarch64)\.(?P<ext>exe|dmg|zip|AppImage|deb)$")
KIND = {"exe": "installer", "dmg": "installer", "zip": "zip", "AppImage": "appimage", "deb": "deb"}
OS = {"win": "windows", "mac": "mac", "linux": "linux"}
# electron-builder's name for a feed, and the name it is published under
FEEDS = {"latest.yml": "latest.yml", "latest-linux.yml": "latest-linux.yml", "latest-mac.yml": "latest-mac-2.yml"}
OLD_MAC_FEED = "latest-mac.yml"
ARCH = {"x64": "x64", "x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def version_key(v: str) -> tuple:
    """Newest first, with a pre-release sorting below the release it precedes."""
    core, _, pre = v.partition("-")
    return tuple(int(n) for n in core.split(".")), (1, "") if not pre else (0, pre)


def prune(dest: Path, keep: int) -> None:
    """
    Leaves the newest `keep` releases and removes the rest.

    The previous release is kept deliberately — an update already downloading
    names a file by version and has to be able to finish — but nothing ever
    removed the ones before it, and at roughly 750 MB a release, on the same
    volume as the database and the media blobs, that is a full disk a handful
    of releases away rather than a tidiness question.
    """
    if keep <= 0:
        return
    by_version: dict[str, list[Path]] = {}
    for p in dest.iterdir():
        if not p.is_file():
            continue
        m = PATTERN.match(p.name[: -len(".blockmap")] if p.name.endswith(".blockmap") else p.name)
        if m:
            by_version.setdefault(m["version"], []).append(p)
    old = sorted(by_version, key=version_key, reverse=True)[keep:]
    if not old:
        return
    # what latest-mac.yml names stays: copies older than its release still update to it
    feed = dest / OLD_MAC_FEED
    named = set(re.findall(r"nexa-[^\s'\"]+", feed.read_text())) if feed.is_file() else set()
    freed = 0
    for v in old:
        for p in by_version[v]:
            if p.name.removesuffix(".blockmap") in named:
                continue
            freed += p.stat().st_size
            p.unlink()
    print(f"removed {', '.join(sorted(old, key=version_key))} ({freed / (1 << 30):.1f} GB); kept the newest {keep}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", nargs="?", default=str(ROOT / "desktop/dist"))
    ap.add_argument("--to", default=os.environ.get("DESKTOP_DIR") or str(ROOT / "data/desktop"))
    ap.add_argument("--keep", type=int, default=2, help="how many releases to leave in place, newest first (0 keeps everything)")
    ap.add_argument("--republish", action="store_true", help="overwrite a version that is already published")
    args = ap.parse_args()
    # Absolute, because the signer runs with its own working directory
    # (desktop/) and a relative "desktop/dist" resolved against that became
    # "desktop/desktop/dist" — so signing failed and, correctly, nothing was
    # published. The Makefile passes exactly that relative path.
    dist, dest = Path(args.dist).resolve(), Path(args.to).resolve()
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

    # Publishing over a version that is already out is a silent trap: the files
    # are replaced in place while every client's version comparison sees no
    # change, so nobody updates and the build that is live is not the build
    # anyone thinks is live.
    if not args.republish and any(PATTERN.match(p.name) and PATTERN.match(p.name)["version"] == version for p in dest.glob("*") if p.is_file()):
        print(f"{version} is already published in {dest}. Bump desktop/package.json, or pass --republish.", file=sys.stderr)
        return 1

    unknown = [y.name for y in manifests if y.name not in FEEDS]
    if unknown:
        print(f"update manifests this script does not know where to publish: {', '.join(unknown)}", file=sys.stderr)
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
    # the update manifests go last, once everything they name is in place
    for y in manifests:
        tmp = dest / (FEEDS[y.name] + ".tmp")
        shutil.copy2(y, tmp)
        tmp.replace(dest / FEEDS[y.name])
    manifest = {"version": version, "released_at": int(time.time() * 1000), "files": files}
    tmp = dest / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2))
    tmp.replace(dest / "manifest.json")
    print(f"published {version} to {dest}")
    prune(dest, keep=args.keep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
