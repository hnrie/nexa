#!/usr/bin/env python3
"""Pulls the English strings out of the web client and puts t() in their place.

Two shapes cover nearly everything people read:

  <div>Some words</div>                 -> <div>{t("area.someWords")}</div>
  <input placeholder="Search" />        -> <input placeholder={t("area.search")} />

Anything with markup or an expression inside it is left alone and listed at the
end, so the ones that need a person are obvious rather than silently skipped.

  python3 tools/i18n_extract.py --dry     # what it would do
  python3 tools/i18n_extract.py --write   # do it
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web/src"
CATALOG = ROOT / "web/src/i18n/locales/en.json"

# Attributes whose value a person reads.
ATTRS = ("label", "placeholder", "title", "aria-label", "description", "confirmLabel",
         "hint", "subtitle", "alt", "emptyText", "tooltip")

# Files that hold no interface text, or whose strings are not for reading.
SKIP_DIRS = ("i18n", "test")
SKIP_FILES = ("vite-env.d.ts",)

# A string that is not a sentence: a class, a key, an id, a colour, a URL.
NOT_TEXT = re.compile(
    r"^(?:[a-z0-9_\-]+|#[0-9a-fA-F]{3,8}|https?://.*|/[\w/.-]*|[\w.-]+\.(?:png|svg|json|webp|css|ts|tsx)|"
    r"[A-Z_]+|\d+(?:\.\d+)?[a-z%]*|)$"
)


def is_text(s: str) -> bool:
    """Whether a string is something a person reads."""
    s = s.strip()
    if len(s) < 2 or len(s) > 400:
        return False
    if NOT_TEXT.match(s):
        return False
    # has to contain a letter and, usually, a space or sentence punctuation
    if not re.search(r"[A-Za-z]", s):
        return False
    if s[0].islower() and " " not in s and not s.endswith((".", "?", "!")):
        return False
    return True


def area_of(path: Path) -> str:
    """A key's first part, from where the file lives."""
    rel = path.relative_to(SRC)
    parts = list(rel.parts)
    if parts[0] in ("components", "pages", "lib", "stores", "markdown", "voice", "gateway", "api"):
        parts = parts[1:] if len(parts) > 1 else parts
    stem = Path(parts[-1]).stem
    head = parts[0] if len(parts) > 1 else ""
    name = re.sub(r"(Page|Modal|Panel|Screen|View|Sheet)$", "", stem)
    bits = [b for b in (head, name) if b]
    return ".".join(re.sub(r"[^A-Za-z0-9]", "", b)[:1].lower() + re.sub(r"[^A-Za-z0-9]", "", b)[1:] for b in bits)


def slug(s: str, used: set) -> str:
    words = re.findall(r"[A-Za-z0-9]+", s)[:6]
    if not words:
        words = ["text"]
    key = words[0].lower() + "".join(w[:1].upper() + w[1:].lower() for w in words[1:])
    key = key[:48]
    base, n = key, 2
    while key in used:
        key = f"{base}{n}"
        n += 1
    used.add(key)
    return key


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if not args.write and not args.dry:
        args.dry = True

    catalog = {}
    if CATALOG.exists():
        catalog = json.loads(CATALOG.read_text() or "{}")
    seen_by_text = {k: v for v, k in catalog.items()} if False else {}
    for k, v in catalog.items():
        if isinstance(v, str):
            seen_by_text.setdefault(v, k)

    files = sorted(p for p in SRC.rglob("*.tsx") if not p.name.endswith(".test.tsx"))
    changed, added, left = 0, 0, []
    for path in files:
        if any(part in SKIP_DIRS for part in path.relative_to(SRC).parts) or path.name in SKIP_FILES:
            continue
        text = path.read_text()
        area = area_of(path)
        # Some files already use `t` for something of their own — a tile, a
        # target. Rather than rename their code, the translator comes in under
        # another name in those few files.
        fn = "t"
        if re.search(r"\(\s*t\s*[,:)]|\bconst t\b|\blet t\b|\bt\s*=>", text):
            fn = "tr_"
        used = {k.split(".", 1)[1] for k in catalog if k.startswith(area + ".")}
        out = text
        local_added = {}

        def key_for(s: str) -> str:
            s = s.strip()
            if s in seen_by_text:
                return seen_by_text[s]
            k = f"{area}.{slug(s, used)}"
            local_added[k] = s
            seen_by_text[s] = k
            return k

        # attributes: label="Some words"
        def attr_sub(m):
            name, value = m.group(1), m.group(2)
            if not is_text(value):
                return m.group(0)
            return f'{name}={{{fn}("{key_for(value)}")}}'

        out = re.sub(r'\b(' + "|".join(re.escape(a) for a in ATTRS) + r')="([^"{}<>\n]+)"', attr_sub, out)

        # plain text between tags, with nothing else in it
        def text_sub(m):
            open_tag, body, close = m.group(1), m.group(2), m.group(3)
            if not is_text(body):
                return m.group(0)
            lead = body[: len(body) - len(body.lstrip())]
            trail = body[len(body.rstrip()) :]
            return f'{open_tag}{lead}{{{fn}("{key_for(body)}")}}{trail}{close}'

        out = re.sub(r"(>)([^<>{}\n]{2,300}?)(</)", text_sub, out)

        if out == text:
            continue
        # every file that gained a t() needs it in scope; it is a plain
        # function, not a hook, so a helper outside a component can use it too
        if 'from "@/i18n"' not in out:
            # after the last import statement, which may run over several lines
            ends = [m.end() for m in re.finditer(r'^import [^;]*?;\s*$', out, re.M | re.S)]
            at = ends[-1] if ends else 0
            imp = '{ t }' if fn == "t" else '{ t as ' + fn + ' }'
            out = out[:at] + '\nimport ' + imp + ' from "@/i18n";' + out[at:]
        if local_added:
            catalog.update(local_added)
            added += len(local_added)
        if args.write:
            path.write_text(out)
        changed += 1

    # what still needs a person: strings with markup or values in them
    for path in files:
        if any(part in SKIP_DIRS for part in path.relative_to(SRC).parts):
            continue
        for i, line in enumerate(path.read_text().split("\n"), 1):
            for m in re.finditer(r'>([^<>{}\n]*\{[^}]+\}[^<>\n]*)<', line):
                body = m.group(1)
                if is_text(re.sub(r"\{[^}]*\}", "", body)):
                    left.append(f"{path.relative_to(SRC)}:{i}: {body.strip()[:70]}")

    if args.write:
        CATALOG.parent.mkdir(parents=True, exist_ok=True)
        CATALOG.write_text(json.dumps(dict(sorted(catalog.items())), ensure_ascii=False, indent=2) + "\n")

    print(f"{changed} files {'rewritten' if args.write else 'would change'}, {added} strings added, {len(catalog)} in the catalogue")
    if left:
        print(f"\n{len(left)} strings hold markup or a value and need a person:")
        for line in left[:40]:
            print("  " + line)
        if len(left) > 40:
            print(f"  … and {len(left) - 40} more")
    return 0


sys.exit(main())
