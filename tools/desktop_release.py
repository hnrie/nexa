#!/usr/bin/env python3
"""Builds the desktop app for every platform and publishes it.

  python3 tools/desktop_release.py [--if-changed] [--republish]

Runs on the Linux server, where `make build` calls it with --if-changed: a
release is built only when desktop/package.json names a version newer than
the one published in DESKTOP_DIR (every release bumps it). chatd offers what
is published at once, and the apps update themselves to it.

- Windows and Linux: electron-builder's own targets (electron-builder.yml)
- the Mac apps: electron-builder's dir target for x64 and arm64, each signed
  ad hoc as it is packed (desktop/sign-mac.cjs, rcodesign on the PATH), then
  tools/mac_package.py checks the signatures and makes the zips, disk images
  and latest-mac.yml
- then tools/publish_desktop.py copies the release into DESKTOP_DIR
"""
from __future__ import annotations

import argparse, json, os, shutil, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_desktop import PATTERN, version_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT / "desktop"


def published(dest: Path) -> str | None:
    """The newest version published in `dest`, by its files."""
    versions = [m["version"] for p in dest.glob("*") if (m := PATTERN.match(p.name))] if dest.is_dir() else []
    return max(versions, key=version_key) if versions else None


def run(*cmd: str, cwd: Path = ROOT) -> None:
    print("  $", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--if-changed", action="store_true", help="only when desktop/package.json's version is not published yet")
    ap.add_argument("--republish", action="store_true", help="publish over a version that is already out")
    ap.add_argument("--to", default=os.environ.get("DESKTOP_DIR") or str(ROOT / "data/desktop"))
    args = ap.parse_args()

    version = json.loads((DESKTOP / "package.json").read_text())["version"]
    out = published(Path(args.to))
    if args.if_changed and out and version_key(out) >= version_key(version):
        print(f"desktop: {out} is published and desktop/package.json says {version}; nothing to build")
        return 0
    print(f"desktop: building {version} for every platform (published: {out or 'nothing'})")

    # publish_desktop.py refuses a dist holding two versions
    shutil.rmtree(DESKTOP / "dist", ignore_errors=True)
    run("npm", "ci", "--no-audit", "--no-fund", cwd=DESKTOP)
    run("npm", "run", "build", cwd=DESKTOP)
    run("npx", "electron-builder", "--win", "--linux", "--publish", "never", cwd=DESKTOP)
    run("npx", "electron-builder", "--mac", "dir", "--x64", "--arm64", "--publish", "never", cwd=DESKTOP)
    run(sys.executable, "tools/mac_package.py", str(DESKTOP / "dist"))
    run(sys.executable, "tools/publish_desktop.py", str(DESKTOP / "dist"), "--to", args.to, *(["--republish"] if args.republish else []))
    return 0


if __name__ == "__main__":
    sys.exit(main())
