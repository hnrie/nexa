#!/usr/bin/env python3
"""Checks the emoji font against the Twemoji pictures, in a real browser.

Every emoji is drawn twice on a canvas, once as text in the font and once as
its SVG, at the same size in the same place, and the two are compared pixel by
pixel. Anti-aliasing makes edges differ a little everywhere, so a flaw is a
patch of pixels that differ a lot: a shape painted under one it should cover, a
missing layer, a wrong colour. A sequence that falls apart into pieces is
caught by its width. Each emoji is drawn as its picture is named and as Unicode
spells it, with and without its U+FE0F, since browsers treat those differently.

  tools/.venv/bin/python tools/twemoji_font_check.py [--font F] [--browser chromium|firefox|webkit]

Exits non-zero when anything is wrong, listing the worst first.
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SVG_DIR = WEB / "node_modules/@twemoji/svg"
EMOJIBASE = WEB / "node_modules/emojibase-data/en/compact.json"
FONT = WEB / "src/assets/fonts/twemoji-colr.woff2"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from twemoji_font import forms, twemoji_file  # noqa: E402

# The picture's size on the canvas, and where the font puts its top: 448 of 512
# units above the baseline (tools/twemoji_font.py). The margin around it shows
# a glyph that runs past the edge, where the picture is cut off.
SIZE = 128
MARGIN = 8
BASELINE = SIZE * 448 / 512
# A pixel differs a lot when a channel is this far off, and a flaw is more
# pixels like that than an edge could make, once a pixel's neighbours all have to differ too.
FAR = 56
FLAW = 12

JS = r"""
async ([items, size, margin, baseline, far]) => {
  await document.fonts.load(`${size}px T`, '\u{1F600}');
  const c = document.createElement('canvas');
  const w = size + 2 * margin;
  c.width = w; c.height = w;
  const g = c.getContext('2d', { willReadFrequently: true });
  const draw = (fn) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, w);
    fn();
    return g.getImageData(0, 0, w, w).data;
  };
  const images = new Map();
  const out = [];
  for (const [text, file] of items) {
    let img = images.get(file);
    if (!img) {
      img = new Image();
      img.src = `svg/${file}.svg`;
      try { await img.decode(); } catch { out.push({ text, file, err: 'no picture' }); continue; }
      images.set(file, img);
    }
    g.font = `${size}px T`;
    const width = g.measureText(text).width;
    const a = draw(() => { g.textBaseline = 'alphabetic'; g.fillStyle = '#000'; g.fillText(text, margin, margin + baseline); });
    const b = draw(() => g.drawImage(img, margin, margin, size, size));
    const bad = new Uint8Array(w * w);
    let sum = 0;
    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      sum += d;
      if (d > far) bad[p] = 1;
    }
    let flaw = 0;
    for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (bad[p] && bad[p - 1] && bad[p + 1] && bad[p - w] && bad[p + w] && bad[p - w - 1] && bad[p - w + 1] && bad[p + w - 1] && bad[p + w + 1]) flaw++;
    }
    out.push({ text, file, width: width / size, flaw, mean: sum / (w * w) });
  }
  return out;
}
"""


def code(text):
    return "-".join(format(ord(ch), "x") for ch in text)


def spellings():
    """Every emoji with a picture, as its picture is named and as Unicode spells it."""
    files = {p.stem for p in SVG_DIR.glob("*.svg")}
    items = {}
    for f in sorted(files):
        items["".join(chr(int(h, 16)) for h in f.split("-"))] = f
    for e in json.loads(EMOJIBASE.read_text(encoding="utf-8")):
        for text in [e["unicode"], *(s["unicode"] for s in e.get("skins", []))]:
            f = twemoji_file(text, files)
            if not f:
                continue
            for form in forms(tuple(ord(ch) for ch in text)):
                items.setdefault("".join(chr(c) for c in form), f)
    return sorted(items.items(), key=lambda kv: (kv[1], kv[0]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--font", type=Path, default=FONT)
    ap.add_argument("--browser", default="chromium", choices=["chromium", "firefox", "webkit"])
    ap.add_argument("--json", type=Path, help="write every result here")
    ap.add_argument("--only", help="comma-separated picture names to check")
    args = ap.parse_args()
    items = spellings()
    if args.only:
        wanted = set(args.only.split(","))
        items = [(t, f) for t, f in items if f in wanted]
    font = args.font.resolve().read_bytes()
    page_html = "<!doctype html><meta charset=utf-8><style>@font-face { font-family: T; src: url(font.woff2) format('woff2'); }</style>"
    with sync_playwright() as pw:
        browser = getattr(pw, args.browser).launch()
        page = browser.new_page()

        def serve(route):
            path = route.request.url.split("://", 1)[1].split("/", 1)[1]
            if path == "":
                route.fulfill(body=page_html, content_type="text/html")
            elif path == "font.woff2":
                route.fulfill(body=font, content_type="font/woff2")
            elif path.startswith("svg/") and (SVG_DIR / path[4:]).is_file():
                route.fulfill(body=(SVG_DIR / path[4:]).read_bytes(), content_type="image/svg+xml")
            else:
                route.fulfill(status=404)

        page.route("http://emoji.test/**", serve)
        page.goto("http://emoji.test/")
        results = []
        for i in range(0, len(items), 400):
            results += page.evaluate(JS, [items[i : i + 400], SIZE, MARGIN, BASELINE, FAR])
        browser.close()
    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False))
    split = [r for r in results if "width" in r and r["width"] > 1.05]
    flawed = [r for r in results if "width" in r and r["width"] <= 1.05 and r["flaw"] > FLAW]
    missing = [r for r in results if "err" in r]
    print(f"twemoji_font_check ({args.browser}): {len(results)} spellings of {len({r['file'] for r in results})} pictures")
    for r in sorted(split, key=lambda r: -r["width"])[:40]:
        print(f"  falls apart ({r['width']:.2f} em wide): {r['text']} {code(r['text'])}")
    for r in sorted(flawed, key=lambda r: -r["flaw"])[:60]:
        print(f"  differs from its picture ({r['flaw']} px): {r['text']} {code(r['text'])} (picture {r['file']})")
    for r in missing[:20]:
        print(f"  {r['err']}: {r['file']}")
    print(f"  {len(split)} fall apart, {len(flawed)} differ, {len(missing)} without a picture")
    sys.exit(1 if split or flawed or missing else 0)


if __name__ == "__main__":
    main()
