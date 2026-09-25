#!/usr/bin/env python3
"""How much a visitor downloads to open the app, against what the front page claims.

    tools/app_size.py <built dist directory>

Sums the gzipped size of the script and styles web/index.html makes every page
load (the entry module, the chunks it preloads and the stylesheets), and fails
when that is over LOAD_KB_LIMIT in web/src/pages/HomePage.tsx, which is the
number the front page prints. The claim there was once a measurement nobody
repeated, and a year of features later it was wrong by half.
"""
import gzip
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    dist = Path(sys.argv[1])
    html = (dist / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'<script[^>]+type="module"[^>]+src="(/[^"]+\.js)"', html)
    refs += re.findall(r'<link[^>]+rel="modulepreload"[^>]+href="(/[^"]+\.js)"', html)
    refs += re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="(/[^"]+\.css)"', html)
    if not refs:
        print("no scripts or styles found in index.html")
        return 1
    total = 0
    for ref in dict.fromkeys(refs):
        size = len(gzip.compress((dist / ref.lstrip("/")).read_bytes(), compresslevel=6))
        total += size
        print(f"  {ref}: {size / 1000:.1f} kB gzipped")
    home = (ROOT / "web/src/pages/HomePage.tsx").read_text(encoding="utf-8")
    limit = int(re.search(r"LOAD_KB_LIMIT = (\d+)", home).group(1))
    print(f"{total / 1000:.1f} kB to open the app; the front page says under {limit} kB")
    if total > limit * 1000:
        print("over: make the app smaller or change LOAD_KB_LIMIT (and so the front page) to the truth")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
