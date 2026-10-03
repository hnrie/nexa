#!/usr/bin/env python3
"""Writes app/src/main/assets/lucide.json from the web client's lucide-react.

Every Lucide icon, keyed by its file name ("triangle-alert"), as a list of SVG
path strings (circles, ellipses, rects, lines, polylines and polygons turned
into paths here), plus an alias table from every exported component name
("AlertTriangle", "Loader2") to its file. The app draws them at 24 x 24 with a
2 px round stroke, as lucide-react does, so a glyph looks the same in both.

  python3 android/tools/lucide_assets.py
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ESM = ROOT / "web/node_modules/lucide-react/dist/esm"
OUT = ROOT / "android/app/src/main/assets/lucide.json"

NODE = re.compile(r'\[\s*"(\w+)"\s*,\s*\{([^}]*)\}\s*\]')
ATTR = re.compile(r'(\w+):\s*"([^"]*)"')


def f(v):
    x = float(v)
    return ("%g" % x)


def to_path(tag, a):
    if tag == "path":
        return a["d"]
    if tag == "circle":
        cx, cy, r = float(a["cx"]), float(a["cy"]), float(a["r"])
        return f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0"
    if tag == "ellipse":
        cx, cy, rx, ry = float(a["cx"]), float(a["cy"]), float(a["rx"]), float(a["ry"])
        return f"M{f(cx - rx)} {f(cy)}a{f(rx)} {f(ry)} 0 1 0 {f(2 * rx)} 0a{f(rx)} {f(ry)} 0 1 0 {f(-2 * rx)} 0"
    if tag == "rect":
        x, y, w, h = float(a.get("x", 0)), float(a.get("y", 0)), float(a["width"]), float(a["height"])
        rx = float(a.get("rx", a.get("ry", 0)))
        ry = float(a.get("ry", a.get("rx", 0)))
        rx, ry = min(rx, w / 2), min(ry, h / 2)
        if rx == 0 and ry == 0:
            return f"M{f(x)} {f(y)}h{f(w)}v{f(h)}h{f(-w)}Z"
        return (f"M{f(x + rx)} {f(y)}h{f(w - 2 * rx)}a{f(rx)} {f(ry)} 0 0 1 {f(rx)} {f(ry)}v{f(h - 2 * ry)}"
                f"a{f(rx)} {f(ry)} 0 0 1 {f(-rx)} {f(ry)}h{f(-(w - 2 * rx))}a{f(rx)} {f(ry)} 0 0 1 {f(-rx)} {f(-ry)}"
                f"v{f(-(h - 2 * ry))}a{f(rx)} {f(ry)} 0 0 1 {f(rx)} {f(-ry)}Z")
    if tag == "line":
        return f"M{f(a['x1'])} {f(a['y1'])}L{f(a['x2'])} {f(a['y2'])}"
    if tag in ("polyline", "polygon"):
        nums = [float(n) for n in re.split(r"[\s,]+", a["points"].strip()) if n]
        pts = list(zip(nums[0::2], nums[1::2]))
        d = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts)
        return d + ("Z" if tag == "polygon" else "")
    raise ValueError(tag)


icons = {}
for p in sorted((ESM / "icons").glob("*.mjs")):
    text = p.read_text()
    m = re.search(r"node:\s*\[(.*)\]\s*\};", text, re.S)
    if not m:
        continue
    paths = []
    for tag, attrs in NODE.findall(m.group(1)):
        a = dict(ATTR.findall(attrs))
        paths.append(to_path(tag, a))
    icons[p.stem] = paths

aliases = {}
for line in (ESM / "lucide-react.mjs").read_text().splitlines():
    m = re.match(r"export \{ (.*) \} from '\./icons/([\w-]+)\.mjs';", line)
    if not m:
        continue
    for name in re.findall(r"default as (\w+)", m.group(1)):
        if name.startswith("Lucide") or name.endswith("Icon"):
            continue
        aliases[name] = m.group(2)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"icons": icons, "aliases": aliases}, separators=(",", ":")))
print(f"{len(icons)} icons, {len(aliases)} names, {OUT.stat().st_size // 1024} KiB -> {OUT.relative_to(ROOT)}")
