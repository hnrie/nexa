#!/usr/bin/env python3
"""Traces the flat-colour brand artwork into an SVG the app can colour.

The wordmark is two flat colours on transparency: the letters and the two
sparkles. A PNG of it is fine at one size and fuzzy at every other, so this
walks the edges of each colour and writes them out as paths. The letters come
out as `currentColor` so they follow the theme; the sparkles keep the brand
purple.

  python3 tools/trace_wordmark.py <source.png> <out.svg>
"""
import struct, sys, zlib
from pathlib import Path


def read_rgba(path: Path):
    data = path.read_bytes()
    i, idat, w, h = 8, b"", 0, 0
    while i < len(data):
        ln = struct.unpack(">I", data[i : i + 4])[0]
        tag, body = data[i + 4 : i + 8], data[i + 8 : i + 8 + ln]
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            if depth != 8 or ctype != 6:
                raise SystemExit("expects 8-bit RGBA")
        elif tag == b"IDAT":
            idat += body
        i += 12 + ln
    raw, stride, out = zlib.decompress(idat), w * 4, bytearray(w * h * 4)
    prev, pos = bytearray(stride), 0
    for y in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if f == 1:
            for x in range(4, stride):
                line[x] = (line[x] + line[x - 4]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                b, c = prev[x], (prev[x - 4] if x >= 4 else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return w, h, out


def masks(w: int, h: int, px: bytearray):
    """Letters and sparkles, as one byte per pixel."""
    letters = bytearray(w * h)
    spark = bytearray(w * h)
    for i in range(w * h):
        o = i * 4
        a = px[o + 3]
        if a < 128:
            continue
        r, g, b = px[o], px[o + 1], px[o + 2]
        # purple is the brand colour; anything else opaque is a letter
        if b > 120 and b - g > 60 and r < 200:
            spark[i] = 1
        else:
            letters[i] = 1
    return letters, spark


def contours(mask: bytearray, w: int, h: int):
    """Every boundary of the mask, as closed rings of unit steps.

    Walks the edges between a filled cell and an empty one. Each edge is a
    directed segment with the filled side on its left, so following them
    closes outlines clockwise and holes counter-clockwise, which is what the
    even-odd fill rule wants.
    """
    at = lambda x, y: mask[y * w + x] if 0 <= x < w and 0 <= y < h else 0
    edges = {}
    for y in range(h):
        row = y * w
        for x in range(w):
            if not mask[row + x]:
                continue
            if not at(x, y - 1):
                edges.setdefault((x, y), []).append((x + 1, y))
            if not at(x + 1, y):
                edges.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if not at(x, y + 1):
                edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if not at(x - 1, y):
                edges.setdefault((x, y + 1), []).append((x, y))
    rings = []
    while edges:
        start = next(iter(edges))
        ring, point = [start], start
        while True:
            nxt = edges.get(point)
            if not nxt:
                break
            step = nxt.pop()
            if not nxt:
                del edges[point]
            point = step
            if point == start:
                break
            ring.append(point)
        if len(ring) > 3:
            rings.append(ring)
    return rings


def simplify(ring, tol: float):
    """Douglas-Peucker, run on the ring split at its two furthest points."""
    def dp(pts):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1
        span = (dx * dx + dy * dy) ** 0.5 or 1
        worst, at = 0.0, 0
        for i in range(1, len(pts) - 1):
            x, y = pts[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / span
            if d > worst:
                worst, at = d, i
        if worst <= tol:
            return [pts[0], pts[-1]]
        return dp(pts[: at + 1])[:-1] + dp(pts[at:])
    if len(ring) < 4:
        return ring
    half = len(ring) // 2
    a = dp(ring[: half + 1])
    b = dp(ring[half:] + [ring[0]])
    return a[:-1] + b[:-1]


def path_of(rings, ox: float, oy: float, scale: float) -> str:
    out = []
    for ring in rings:
        pts = [(round((x - ox) * scale, 2), round((y - oy) * scale, 2)) for x, y in ring]
        out.append("M" + " ".join(f"{x} {y}" for x, y in pts) + "Z")
    return "".join(out)


def main() -> int:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    w, h, px = read_rgba(src)
    letters, spark = masks(w, h, px)
    both = bytearray(a | b for a, b in zip(letters, spark))
    xs = [i % w for i, v in enumerate(both) if v]
    ys = [i // w for i, v in enumerate(both) if v]
    ox, oy = min(xs), min(ys)
    bw, bh = max(xs) - ox + 1, max(ys) - oy + 1
    scale = 100 / bh  # a height of 100 keeps the numbers short
    sys.setrecursionlimit(20000)
    parts = []
    for name, mask, fill in (("letters", letters, "currentColor"), ("spark", spark, "var(--brand, #8000ff)")):
        rings = [simplify(r, 2.0) for r in contours(mask, w, h)]
        parts.append(f'<path fill="{fill}" fill-rule="evenodd" d="{path_of(rings, ox, oy, scale)}"/>')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(bw * scale, 2)} 100" '
        f'role="img" aria-label="Nexa">{"".join(parts)}</svg>\n'
    )
    dst.write_text(svg)
    print(f"{dst}: {round(bw * scale, 2)}x100, {len(svg)} bytes")
    return 0


sys.exit(main())
