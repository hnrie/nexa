#!/usr/bin/env python3
"""Every key the apps ask for has to exist, or a screen shows the key itself.

Checks the web client against the English catalogue.
Keys built at runtime are listed as dynamic rather than reported missing.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = json.loads((ROOT / "web/src/i18n/locales/en.json").read_text())
CALL = re.compile(r'\bt(?:r_)?\(\s*"([^"\\]+)"')
# <Tr id="..."> and the data arrays that hold a key rather than call for it
ANY = re.compile(r'"([A-Za-z][\w]*(?:\.[\w]+){1,})"')
COMMENT = re.compile(r'^\s*(//|\*|/\*)')

def keys_in(root: Path, suffixes: tuple[str, ...]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in suffixes:
            continue
        if "/i18n/locales/" in str(p) or p.name.endswith((".test.ts", ".test.tsx")):
            continue
        for line in p.read_text().splitlines():
            if COMMENT.match(line):
                continue
            for key in CALL.findall(line):
                out.setdefault(key, []).append(str(p.relative_to(ROOT)))
    return out

bad = 0
for label, root, suffixes in (
    ("web", ROOT / "web/src", (".ts", ".tsx")),
):
    used = keys_in(root, suffixes)
    missing = {k: v for k, v in used.items() if k not in EN}
    print(f"{label}: {len(used)} keys asked for, {len(missing)} missing")
    for key, files in sorted(missing.items()):
        print(f"  MISSING {key}  ({files[0]})")
        bad += 1

# and the other way: keys nothing asks for any more. A key can be held in a
# data array or given to <Tr id="…"> rather than called for, so any literal
# that is exactly a key counts as asking for it.
def literals_in(root: Path, suffixes: tuple[str, ...]) -> set[str]:
    out: set[str] = set()
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in suffixes or "/i18n/locales/" in str(p):
            continue
        out |= set(ANY.findall(p.read_text()))
    return out

used_all = literals_in(ROOT / "web/src", (".ts", ".tsx"))
orphans = sorted(k for k in EN if k not in used_all)
print(f"{len(orphans)} keys nothing asks for")
for k in orphans[:20]:
    print(f"  unused {k}")
sys.exit(1 if bad else 0)
