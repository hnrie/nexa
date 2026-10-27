#!/usr/bin/env python3
"""Publishes a desktop app release built by electron-builder.

  python3 tools/publish_desktop.py [desktop/dist] [--to data/desktop]

Copies the installers, the Mac update zips, their blockmaps and the update
manifests (latest*.yml) into chatd's DESKTOP_DIR, then writes manifest.json,
which /api/v1/desktop/latest serves to the download page and banner. Files of
older releases are left in place, so updates already downloading can finish;
the update manifests always name the newest.

Manifests are signed before any artifacts are published, with private local key
material from ~/.local/share/nexa-signing/update-key.pem (or
NEXA_DESKTOP_SIGNING_KEY). The public half is pinned in the desktop source.
Dedicated signed-latest*.yml feeds leave every legacy latest*.yml feed intact;
clients before 1.2.8 must install the new trust anchor manually once.

"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# electron-builder.yml names artifacts nexa[-Setup]-<version>-<os>-<arch>.<ext>
PATTERN = re.compile(r"^nexa-(?:Setup-)?(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?P<os>win|mac|linux)-(?P<arch>x64|arm64|x86_64|amd64|aarch64)\.(?P<ext>exe|dmg|zip|AppImage|deb)$")
KIND = {"exe": "installer", "dmg": "installer", "zip": "zip", "AppImage": "appimage", "deb": "deb"}
OS = {"win": "windows", "mac": "mac", "linux": "linux"}
# electron-builder's name for a feed, and the name it is published under
FEEDS = {"latest.yml": "signed-latest.yml", "latest-linux.yml": "signed-latest-linux.yml", "latest-mac.yml": "signed-latest-mac.yml"}
LEGACY_FEEDS = ("latest.yml", "latest-linux.yml", "latest-mac.yml", "latest-mac-2.yml")
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
    # Legacy clients keep their existing feed and its named artifacts until replaced.
    named = set()
    for name in LEGACY_FEEDS:
        feed = dest / name
        if feed.is_file():
            named.update(re.findall(r"nexa-[^\s'\"]+", feed.read_text()))
    freed = 0
    for v in old:
        for p in by_version[v]:
            if p.name.removesuffix(".blockmap") in named:
                continue
            freed += p.stat().st_size
            p.unlink()
    print(f"removed {', '.join(sorted(old, key=version_key))} ({freed / (1 << 30):.1f} GB); kept the newest {keep}")


def atomic_copy(source: Path, target: Path) -> None:
    """Expose a complete artifact only after copying it successfully."""
    fd, name = tempfile.mkstemp(dir=target.parent, prefix="." + target.name + "-", suffix=".tmp")
    os.close(fd)
    temporary = Path(name)
    try:
        shutil.copy2(source, temporary)
        with temporary.open("rb") as copied:
            os.fsync(copied.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


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

    # A stale platform feed can survive even when all installers name one
    # version. Refuse it before writing any part of the release.
    for feed in manifests:
        match = re.search(r"(?m)^version:\s*['\"]?([^\s'\"]+)", feed.read_text())
        if match is None or match[1] != version:
            print(f"{feed.name} does not name build {version}", file=sys.stderr)
            return 1

    # Sign all exact published feed names before exposing any release files.
    # Missing or mismatched signing material refuses publication.
    with tempfile.TemporaryDirectory(prefix="nexa-signed-feeds-") as directory:
        signed = Path(directory)
        for feed in manifests:
            shutil.copy2(feed, signed / FEEDS[feed.name])
        result = subprocess.run(["node", str(ROOT / "desktop/scripts/sign-release.mjs"), str(signed)])
        if result.returncode:
            return 1
        signed_feeds = {name: (signed / name).read_bytes() for feed in manifests
                        for name in (FEEDS[feed.name], FEEDS[feed.name] + ".sig")}

    dest.mkdir(parents=True, exist_ok=True)
    files = []
    for p, m in found:
        atomic_copy(p, dest / p.name)
        blockmap = p.with_name(p.name + ".blockmap")
        if blockmap.exists():
            atomic_copy(blockmap, dest / blockmap.name)
        files.append({"os": OS[m["os"]], "arch": ARCH[m["arch"]], "kind": KIND[m["ext"]], "name": p.name, "size": p.stat().st_size, "sha256": sha256(p)})
        print(f"  {p.name} ({p.stat().st_size / 1048576:.1f} MB)")
    # the update manifests go last, once everything they name is in place
    for name, body in signed_feeds.items():
        tmp = dest / (name + ".tmp")
        tmp.write_bytes(body)
        tmp.replace(dest / name)
    manifest = {"version": version, "released_at": int(time.time() * 1000), "files": files}
    tmp = dest / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2))
    tmp.replace(dest / "manifest.json")
    print(f"published {version} to {dest}")
    prune(dest, keep=args.keep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
