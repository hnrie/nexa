#!/usr/bin/env python3
"""Writes the name style fonts into the Android app's res/font, from the same
Fontsource files the web serves (web/node_modules/@fontsource), so a name
looks the same in both apps.

Each font's Latin and Latin Extended subsets are merged into one TTF (Android
cannot read WOFF2); letters a font lacks fall back to the app's own font, as
on the web. Run it from the repository root after adding or upgrading one:

    tools/.venv/bin/python android/tools/name_fonts.py

The list must match NAME_FONTS in web/src/lib/nameStyle.ts.
"""
import os
import sys
import tempfile

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

# id, Fontsource package, weight (the one cut the web imports)
FONTS = [
    ("comic", "comic-neue", 700),
    ("fraunces", "fraunces", 700),
    ("playfair", "playfair-display", 700),
    ("dmserif", "dm-serif-display", 400),
    ("youngserif", "young-serif", 400),
    ("syne", "syne", 700),
    ("bricolage", "bricolage-grotesque", 700),
    ("spacegrotesk", "space-grotesk", 700),
    ("outfit", "outfit", 600),
    ("lexend", "lexend", 600),
    ("sora", "sora", 700),
    ("rubik", "rubik", 700),
    ("fredoka", "fredoka", 600),
    ("comfortaa", "comfortaa", 700),
    ("baloo", "baloo-2", 700),
    ("quicksand", "quicksand", 700),
    ("bungee", "bungee", 400),
    ("righteous", "righteous", 400),
    ("chewy", "chewy", 400),
    ("shrikhand", "shrikhand", 400),
    ("titan", "titan-one", 400),
    ("orbitron", "orbitron", 700),
    ("pacifico", "pacifico", 400),
    ("lobster", "lobster", 400),
    ("kalam", "kalam", 700),
    ("patrick", "patrick-hand", 400),
    ("caveat", "caveat", 700),
    ("pixelify", "pixelify-sans", 600),
    ("spacemono", "space-mono", 700),
]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "web", "node_modules", "@fontsource")
OUT = os.path.join(ROOT, "android", "app", "src", "main", "res", "font")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        for fid, pkg, weight in FONTS:
            parts = []
            for subset in ("latin", "latin-ext"):
                path = os.path.join(SRC, pkg, "files", f"{pkg}-{subset}-{weight}-normal.woff2")
                if not os.path.exists(path):
                    continue
                font = TTFont(path)
                font.flavor = None
                plain = os.path.join(tmp, f"{fid}-{subset}.ttf")
                font.save(plain)
                parts.append(plain)
            if not parts:
                print(f"{pkg}: no files, run npm install in web/", file=sys.stderr)
                return 1
            merged = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
            dest = os.path.join(OUT, f"name_{fid}.ttf")
            merged.save(dest)
            print(f"{dest} {os.path.getsize(dest) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
