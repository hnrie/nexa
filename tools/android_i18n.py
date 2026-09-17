#!/usr/bin/env python3
"""Puts the Android app's text in the catalogue the web client already has.

The app was written with its words inline, the way Compose invites. This finds
them, points each at a key, and rewrites the source to ask for the key instead.
A string whose English already exists in the catalogue reuses that key and so
arrives translated; the rest are added to English for a translator (or this
script's caller) to fill in.

  python3 tools/android_i18n.py --dry     # what it would do
  python3 tools/android_i18n.py --write   # do it, and list what needs translating
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "android/app/src/main/java"
PKG = "xyz/evilion/chat"
CATALOG = ROOT / "web/src/i18n/locales/en.json"
ADDED = ROOT / "tools/android_i18n_added.json"

# Files whose strings are protocol, not text: crypto, the HTTP layer, the
# generated icon set, the theme's colour names.
SKIP = re.compile(
    r"/(crypto/|i18n/|net/(ApiClient|Endpoints|Models|Gateway)\.kt|voice/(FrameCryptoNative|SfuTransport)\.kt"
    r"|ui/icons/Lucide\.kt|ui/theme/)"
)
LIT = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
# The directories that are about how the app is built, not what part of it a
# string belongs to: the file's own name reads better as the area.
FILE_IS_AREA = {"data", "net", "media", "service", "voice", "notify", "chat"}


def looks_ui(s: str) -> bool:
    """Whether a literal is text a person reads."""
    if len(s) < 3:
        return False
    if not re.match(r"^[A-Z@#]", s):
        return False
    if re.search(r"[/\\<>|=]", s):
        return False
    if re.fullmatch(r"[A-Z0-9_]+", s):
        return False
    # a CamelCase or camelCase word with no space is an identifier
    if " " not in s and re.match(r"^[A-Z][a-z]*[A-Z]", s):
        return False
    return bool(re.search(r"[A-Za-z]{3,}", s))


def camel(text: str, limit: int = 6) -> str:
    """A key fragment from the words themselves, as the web extractor names them."""
    words = re.findall(r"[A-Za-z0-9]+", text)[:limit]
    if not words:
        return "text"
    out = words[0].lower() + "".join(w[:1].upper() + w[1:].lower() for w in words[1:])
    return re.sub(r"^\d+", "n", out) or "text"


def area_of(rel: str) -> str:
    """The namespace for a file's keys: <area>.<file>, or just <file> where the directory says nothing."""
    parts = Path(rel).parts
    stem = camel(re.sub(r"(?<!^)(?=[A-Z])", " ", Path(rel).stem))
    folder = parts[-2] if len(parts) > 1 else ""
    if not folder or folder in FILE_IS_AREA:
        return stem
    return f"{folder}.{stem}"


def branch_label(line: str, end: int) -> bool:
    """Whether a literal is a `when` branch being matched, not text being shown."""
    return line[end:].lstrip().startswith("->")


def compared(line: str, start: int) -> bool:
    """Whether a literal is on the right of a comparison."""
    return bool(re.search(r"(==|!=|\.equals\(|contains\(|startsWith\(|endsWith\()\s*$", line[:start]))


# The brand reads the same in every language.
NOT_UI = {"Nexa"}


def not_text(line: str, start: int) -> bool:
    """Whether a literal is for the machine: a header, a log tag, a constant, a programmer's assertion."""
    before = line[:start]
    if re.search(r"(\.header|Log\.[a-z]+)\(\s*$", before):
        return True
    if re.search(r"\b(requireNotNull|require|check|checkNotNull|error)\(", before):
        return True
    return bool(re.search(r"\bconst val [A-Z][A-Z0-9_]*\s*(:[^=]+)?=\s*$", before))


def scan() -> list[tuple[Path, int, int, int, str]]:
    """Every UI literal, as (file, line number, start, end, text)."""
    found = []
    for p in sorted((SRC / PKG).rglob("*.kt")):
        rel = str(p.relative_to(SRC / PKG))
        if SKIP.search("/" + rel):
            continue
        for i, line in enumerate(p.read_text().splitlines(), 1):
            st = line.strip()
            if st.startswith(("//", "*", "/*")):
                continue
            cut = line.find("//")
            code = line if cut < 0 else line[:cut]
            for m in LIT.finditer(code):
                s = m.group(1)
                if not looks_ui(s) or s in NOT_UI:
                    continue
                # a template needs a placeholder, which is a person's decision
                if "$" in s or "%" in s or "{" in s:
                    continue
                if branch_label(code, m.end()) or compared(code, m.start()) or not_text(code, m.start()):
                    continue
                found.append((p, i, m.start(), m.end(), s))
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if not args.write:
        args.dry = True

    catalog = json.loads(CATALOG.read_text())
    by_text: dict[str, str] = {}
    for key, value in catalog.items():
        if isinstance(value, str):
            by_text.setdefault(value.strip(), key)

    hits = scan()
    # one key per distinct string, named after the first file that shows it
    keys: dict[str, str] = {}
    added: dict[str, str] = {}
    reused = 0
    for p, _i, _a, _b, text in hits:
        if text in keys:
            continue
        have = by_text.get(text)
        if have:
            keys[text] = have
            reused += 1
            continue
        rel = str(p.relative_to(SRC / PKG))
        base = f"{area_of(rel)}.{camel(text)}"
        key = base
        n = 2
        while key in catalog and catalog[key] != text:
            key = f"{base}{n}"
            n += 1
        keys[text] = key
        catalog[key] = text
        added[key] = text
        by_text.setdefault(text, key)

    # rewrite each file once, line by line, leaving everything else alone
    per_file: dict[Path, dict[int, list[tuple[int, int, str]]]] = {}
    for p, i, a, b, text in hits:
        per_file.setdefault(p, {}).setdefault(i, []).append((a, b, text))

    changed = 0
    for p, lines in per_file.items():
        src = p.read_text().split("\n")
        for i, spots in lines.items():
            line = src[i - 1]
            for a, b, text in sorted(spots, reverse=True):
                line = line[:a] + f't("{keys[text]}")' + line[b:]
            src[i - 1] = line
        body = "\n".join(src)
        if "import xyz.evilion.chat.i18n.t" not in body:
            body = add_import(body)
        if args.write:
            p.write_text(body)
        changed += 1

    if args.write:
        CATALOG.write_text(json.dumps({k: catalog[k] for k in sorted(catalog)}, ensure_ascii=False, indent=2) + "\n")
        ADDED.write_text(json.dumps(added, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(hits)} strings in {changed} files: {reused} already translated, {len(added)} new")
    print(f"{len(catalog)} keys in the catalogue" + ("" if args.write else " (nothing written)"))
    return 0


def add_import(body: str) -> str:
    """Puts the translator's import with the others, in order."""
    lines = body.split("\n")
    want = "import xyz.evilion.chat.i18n.t"
    at = None
    for n, line in enumerate(lines):
        if line.startswith("import "):
            if line > want:
                at = n
                break
            at = n + 1
    if at is None:
        for n, line in enumerate(lines):
            if line.startswith("package "):
                at = n + 2
                lines.insert(n + 1, "")
                break
    lines.insert(at, want)
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
