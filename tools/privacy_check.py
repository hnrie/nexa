#!/usr/bin/env python3
"""Reject private artifacts in the Git index, and optionally all reachable history.

Run alongside Gitleaks; this checks artifact paths and commit identities, not every
possible secret. Ignored files on the deployment machine are intentionally allowed.
"""
from __future__ import annotations

import argparse
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def private_path(name: str) -> bool:
    p = PurePosixPath(name)
    base = p.name.lower()
    if "workspace" in p.parts or name.startswith(("data/", "data-dev/", "logs/", "backup/")):
        return True
    if name.startswith("android/signing/"):
        return name not in {"android/signing/README.md", "android/signing/release.properties.example"}
    if name.startswith("docs/design/reference/") and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        return True
    if base in {"chatd.env", "keystore.properties", "local.properties", ".ds_store", ".git-credentials", ".env"}:
        return True
    if base.startswith(".env.") and not base.endswith(".example"):
        return True
    if base.startswith("._") or "__pycache__" in p.parts:
        return True
    if p.suffix.lower() in {".jks", ".keystore", ".p12", ".pfx", ".pem", ".key", ".pyc", ".apk"}:
        return True
    return name in {"prompt.txt", "sample.txt", "chatmigrate", "downloads/android/manifest.json"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--history", action="store_true", help="also check every reachable revision and commit identity")
    args = ap.parse_args()
    paths = set(git("ls-files", "-z").decode().split("\0")) - {""}
    if args.history:
        for line in git("rev-list", "--objects", "--all").decode().splitlines():
            _, sep, name = line.partition(" ")
            if sep:
                paths.add(name)
    errors = [f"Private/generated artifact tracked: {p}" for p in sorted(paths) if private_path(p)]
    # Print file names only, never the matching credential.
    pem = subprocess.run(["git", "grep", "--cached", "-I", "-l", "-E",
                          "^-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----"],
                         cwd=ROOT, capture_output=True, text=True)
    if pem.returncode not in (0, 1):
        raise RuntimeError("could not scan the Git index for private keys")
    errors.extend(f"Private key content tracked: {p}" for p in pem.stdout.splitlines())
    if args.history:
        for line in git("log", "--all", "--format=%H%x09%ae%x09%ce").decode().splitlines():
            commit, *emails = line.split("\t")
            if any(not (email.endswith("@users.noreply.github.com") or email == "noreply@anthropic.com") for email in emails):
                errors.append(f"Personal email in commit identity: {commit[:12]}")
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("Repository privacy checks passed" + (" (all reachable history)." if args.history else " (Git index)."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
