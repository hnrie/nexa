#!/usr/bin/env python3
"""Builds the colour font the app draws emoji in text with.

Text boxes, names, statuses and menus are plain text, so they cannot hold the
Twemoji pictures that messages show; they draw emoji with this font instead
(web/src/styles/fonts.css). It is built from the very SVGs those pictures are,
so the two look the same:

- Every shape of a picture is a layer of its glyph (COLR/CPAL version 0, which
  every browser draws), painted in the picture's own order. Only shapes of one
  colour that follow each other share a layer. The prebuilt font this replaced
  joined shapes of one colour from anywhere in a picture, which moved some of
  them under shapes they should cover: 🥹's left pupil went under the white of
  its eye.
- A sequence (a skin tone, a flag, a keycap, a ZWJ sequence) is a ligature,
  spelled with and without each of its U+FE0F. Chromium drops the variation
  selectors before it forms ligatures and Firefox keeps them, so a font with
  only one spelling showed 🏳️‍🌈 as a white flag and a rainbow in one of them.

Rerun after upgrading @twemoji/svg or emojibase-data, then check the result
against the pictures:

  tools/.venv/bin/pip install -r tools/requirements.txt
  tools/.venv/bin/python tools/twemoji_font.py
  tools/.venv/bin/python tools/twemoji_font_check.py
"""
import argparse
import itertools
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pathops
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from picosvg.svg import SVG
from picosvg.svg_pathops import skia_path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SVG_DIR = WEB / "node_modules/@twemoji/svg"
EMOJIBASE = WEB / "node_modules/emojibase-data/en/compact.json"
OUT = WEB / "src/assets/fonts/twemoji-colr.woff2"

# The em is 512 units and a picture (36 units square) fills it, standing 64
# units below the baseline, as in the font this replaced: text around emoji
# keeps its line height and the emoji keep their place on the line.
UPEM = 512
SCALE = UPEM / 36
TOP = 448
ASCENT, DESCENT, LINE_GAP = 477, -91, 46
# How far a curve may move, in font units, when it is redrawn with the
# quadratic curves TrueType outlines are made of.
CURVE_ERROR = 0.25

ZWJ, VS16, KEYCAP = 0x200D, 0xFE0F, 0x20E3
STAMP = timestampFromString("Wed Jan  1 00:00:00 2025")
TAGS = range(0xE0020, 0xE0080)


def glyph_name(codes):
    return "u" + "_".join(format(c, "x") for c in codes)


# the colour names the pictures use, and black, which a shape with no fill is
NAMED = {"black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "navy": "#000080", "azure": "#f0ffff"}


def colour(fill, alpha):
    """An SVG fill as CPAL's red, green, blue and alpha, each 0 to 1."""
    f = fill.strip().lower()
    f = NAMED.get(f, f)
    if not f.startswith("#") or len(f) not in (4, 7):
        raise ValueError(f"unexpected fill {fill!r}")
    if len(f) == 4:
        f = "#" + "".join(ch * 2 for ch in f[1:])
    r, g, b = (int(f[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return (round(r, 4), round(g, 4), round(b, 4), round(alpha, 4))


def outline(path):
    """A simplified pathops path in the picture's units as a TrueType glyph's points."""
    # the picture's y runs down and the font's up
    path = path.transform(SCALE, 0, 0, -SCALE, 0, TOP)
    for reverse in (True, False):
        pen = TTGlyphPen(None)
        path.draw(Cu2QuPen(pen, CURVE_ERROR, reverse_direction=reverse))
        g = pen.glyph()
        if g.numberOfContours == 0:
            return None
        area = AreaPen()
        g.draw(area, None)
        # TrueType winds outer contours clockwise, which AreaPen counts as negative
        if area.value < 0:
            break
    return (tuple(g.coordinates), bytes(g.flags), tuple(g.endPtsOfContours))


def union(a, b):
    """Two simplified paths as one, or None where Skia got it wrong: two shapes
    that start at the same point can lose one of them (a ray of 🎇), so the
    result has to cover as much as the two do."""
    try:
        both = pathops.op(a, b, pathops.PathOp.UNION, fix_winding=True)
        common = pathops.op(a, b, pathops.PathOp.INTERSECTION, fix_winding=True)
    except pathops.PathOpsError:
        return None
    if abs(both.area - (a.area + b.area - common.area)) > 0.01 + 0.001 * (a.area + b.area):
        return None
    return both


def square():
    p = pathops.Path()
    p.moveTo(0, 0)
    p.lineTo(36, 0)
    p.lineTo(36, 36)
    p.lineTo(0, 36)
    p.close()
    return p


def clipped(p):
    """What of a simplified path shows inside the picture's square: a shape
    may run off the edge, and a picture is cut off there."""
    x0, y0, x1, y1 = p.bounds
    if x0 >= 0 and y0 >= 0 and x1 <= 36 and y1 <= 36:
        return p
    try:
        inside = pathops.op(p, square(), pathops.PathOp.INTERSECTION, fix_winding=True)
        outside = pathops.op(p, square(), pathops.PathOp.DIFFERENCE, fix_winding=True)
    except pathops.PathOpsError:
        return p
    return inside if abs(inside.area + outside.area - p.area) <= 0.01 + 0.001 * p.area else p


def layers_of(name):
    """One picture as its layers, in painting order: (colour, points)."""
    pico = SVG.parse(str(SVG_DIR / f"{name}.svg")).topicosvg()
    shapes = []
    for s in pico.shapes():
        if s.fill in ("none", ""):
            continue
        alpha = float(s.fill_opacity) * float(s.opacity)
        if alpha <= 0:
            continue
        path = s.as_path().absolute(inplace=False).explicit_lines(inplace=False).arcs_to_cubics(inplace=False)
        p = skia_path(path.as_cmd_seq(), s.fill_rule)
        # no overlaps, the nonzero rule TrueType fills by, and outer contours wound one way
        p.simplify(fix_winding=True)
        shapes.append((colour(s.fill, alpha), p))
    # Shapes of one opaque colour that follow each other are one layer: nothing
    # comes between them. A see-through one keeps its own, since where two of
    # them overlap the picture is painted twice.
    merged = []
    for c, p in shapes:
        joined = union(merged[-1][1], p) if merged and merged[-1][0] == c and c[3] >= 1 else None
        if joined is not None:
            merged[-1] = (c, joined)
        else:
            merged.append((c, p))
    out = []
    for c, p in merged:
        pts = outline(clipped(p))
        if pts:
            out.append((c, pts))
    return name, out


def forms(codes):
    """A sequence spelled with and without each of its U+FE0F, the full spelling first."""
    at = [i for i, c in enumerate(codes) if c == VS16]
    for k in range(len(at) + 1):
        for drop in itertools.combinations(at, k):
            yield tuple(c for i, c in enumerate(codes) if i not in drop)


def twemoji_file(text, files):
    """The picture a fully spelled emoji is drawn from in messages (web/src/lib/twemoji.ts twemojiFiles)."""
    zwj = chr(ZWJ) in text
    codes = ["-".join(format(ord(ch), "x") for ch in (text if zwj else text.replace(chr(VS16), "")))]
    if zwj:
        codes.append("-".join(format(ord(ch), "x") for ch in text.replace(chr(VS16), "")))
    return next((c for c in codes if c in files), None)


def sequences(files):
    """Every spelling of every emoji with a picture, and the picture it gets."""
    spelled = {}

    def add(codes, file):
        for form in forms(codes):
            # a single code point is the character map's
            if len(form) > 1 and spelled.setdefault(form, file) != file and form not in names:
                raise SystemExit(f"twemoji_font: {'-'.join(format(c, 'x') for c in form)} spells both {spelled[form]} and {file}")

    # the pictures' own names first, so no other spelling can take one of them
    names = {tuple(int(h, 16) for h in f.split("-")): f for f in sorted(files)}
    spelled.update((codes, f) for codes, f in names.items() if len(codes) > 1)
    for codes, f in names.items():
        add(codes, f)
    # then each emoji as Unicode spells it in full, as the picker and keyboards send it
    data = json.loads(EMOJIBASE.read_text(encoding="utf-8"))
    for e in data:
        for text in [e["unicode"], *(s["unicode"] for s in e.get("skins", []))]:
            f = twemoji_file(text, files)
            if f:
                add(tuple(ord(ch) for ch in text), f)
    return spelled


def build(out: Path, jobs: int) -> None:
    files = sorted(p.stem for p in SVG_DIR.glob("*.svg"))
    if not files:
        raise SystemExit("twemoji_font: no pictures in web/node_modules/@twemoji/svg; run npm install in web/")
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        drawn = dict(pool.map(layers_of, files, chunksize=16))

    seqs = sequences(set(files))
    # Code points with no picture of their own: joiners, selectors, tags and the
    # keys of a keycap. They only ever appear inside a ligature, and draw nothing.
    singles = {int(f, 16) for f in files if "-" not in f}
    parts = sorted({c for form in seqs for c in form} - singles)

    glyphs, metrics, cmap = {".notdef": None}, {}, {}
    layer_of, palette, colr = {}, {}, {}
    for f in files:
        codes = [int(h, 16) for h in f.split("-")]
        base = glyph_name(codes)
        glyphs[base] = None
        if len(codes) == 1:
            cmap[codes[0]] = base
        records = []
        for c, pts in drawn[f]:
            layer = layer_of.get(pts)
            if layer is None:
                layer = layer_of[pts] = f"l{len(layer_of)}"
                glyphs[layer] = pts
            records.append((layer, palette.setdefault(c, len(palette))))
        colr[base] = records
    for c in parts:
        name = glyph_name([c])
        glyphs[name] = None
        cmap[c] = name
        # a joiner, selector, tag or the keycap mark takes no room of its own
        if c in (ZWJ, VS16, KEYCAP) or c in TAGS:
            metrics[name] = 0

    fb = FontBuilder(UPEM, isTTF=True)
    order = list(glyphs)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    ttglyphs = {}
    for name, pts in glyphs.items():
        g = Glyph()
        if pts:
            coords, flags, ends = pts
            g.numberOfContours = len(ends)
            g.coordinates = GlyphCoordinates(coords)
            g.flags = bytearray(flags)
            g.endPtsOfContours = list(ends)
            g.program = ttProgram.Program()
            g.program.fromBytecode(b"")
        else:
            g.numberOfContours = 0
        ttglyphs[name] = g
    fb.setupGlyf(ttglyphs)
    glyf = fb.font["glyf"]
    hmtx = {}
    for name in order:
        g = glyf[name]
        g.recalcBounds(glyf)
        hmtx[name] = (metrics.get(name, UPEM), getattr(g, "xMin", 0) if g.numberOfContours else 0)
    fb.setupHorizontalMetrics(hmtx)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT, lineGap=LINE_GAP)
    version = json.loads((SVG_DIR / "package.json").read_text())["version"]
    fb.setupNameTable(
        {
            "copyright": "Twemoji artwork copyright 2019 Twitter, Inc and other contributors, CC-BY 4.0",
            "familyName": "Twemoji Text",
            "styleName": "Regular",
            "uniqueFontIdentifier": f"Twemoji Text {version}",
            "fullName": "Twemoji Text",
            "psName": "TwemojiText-Regular",
            "version": f"Version {version}",
            "licenseDescription": "Twemoji artwork: Creative Commons Attribution 4.0 International",
            "licenseInfoURL": "https://creativecommons.org/licenses/by/4.0/",
        }
    )
    fb.setupOS2(
        sTypoAscender=TOP,
        sTypoDescender=TOP - UPEM,
        sTypoLineGap=LINE_GAP,
        usWinAscent=ASCENT,
        usWinDescent=-DESCENT,
        # regular, and the typographic metrics above are the ones to use
        fsSelection=0x40 | 0x80,
        fsType=0,
        achVendID="NEXA",
        version=4,
    )
    fb.setupPost(keepGlyphNames=False)
    # a fixed date, so the same pictures always build the same file
    fb.updateHead(created=STAMP, modified=STAMP)
    fb.font.recalcTimestamp = False
    fb.font["COLR"] = buildCOLR(colr, version=0)
    colours = sorted(palette, key=palette.get)
    fb.font["CPAL"] = buildCPAL([colours])

    lines = ["languagesystem DFLT dflt;", "feature ccmp {"]
    for form, f in sorted(seqs.items(), key=lambda kv: (-len(kv[0]), kv[0])):
        lines.append(f"  sub {' '.join(glyph_name([c]) for c in form)} by {glyph_name([int(h, 16) for h in f.split('-')])};")
    lines.append("} ccmp;")
    addOpenTypeFeaturesFromString(fb.font, "\n".join(lines))

    fb.font.flavor = "woff2"
    out.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(out))
    records = sum(len(v) for v in colr.values())
    print(
        f"twemoji_font: {len(files)} pictures, {len(layer_of)} layer outlines in {records} layers, "
        f"{len(colours)} colours, {len(seqs)} spellings of sequences; {out.stat().st_size / 1024:.0f} KiB -> {out}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    build(args.out, args.jobs)


if __name__ == "__main__":
    sys.exit(main())
