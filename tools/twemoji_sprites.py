#!/usr/bin/env python3
"""Draws the emoji picker's Twemoji into sprite sheets.

The picker used to put one SVG <img> in every cell. Chromium builds a whole
SVG document on the main thread for each of those, so a fast scroll that
brought a few hundred new cells into view stalled for hundreds of
milliseconds and showed empty rows. A sheet is one raster image, decoded off
the main thread once, and every cell is a piece of it.

One sheet per picker category, in the picker's order, and one per skin tone
holding the toned variants. Rerun after upgrading @twemoji/svg or
emojibase-data:

  tools/.venv/bin/python tools/twemoji_sprites.py
"""
import base64, json, math
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SVG_DIR = WEB / "node_modules/@twemoji/svg"
OUT = WEB / "src/assets/twemoji-sprites"
# drawn at 64 px (a 32 px cell on a 2x screen) with a clear 2 px border, so a
# scaled-down cell never samples its neighbour
CELL, PAD, COLS = 64, 2, 24
PITCH = CELL + 2 * PAD
ZWJ, VS16 = "\u200d", "\ufe0f"
TONES = {0x1F3FB: 1, 0x1F3FC: 2, 0x1F3FD: 3, 0x1F3FE: 4, 0x1F3FF: 5}


def code(text):
    source = text if ZWJ in text else text.replace(VS16, "")
    return "-".join(format(ord(ch), "x") for ch in source) or None


def candidate(text, available):
    """The Twemoji file an emoji is drawn from (web/src/lib/twemoji.ts twemojiCandidates)."""
    codes = [code(text)]
    if ZWJ in text:
        stripped = code(text.replace(VS16, ""))
        if stripped not in codes:
            codes.append(stripped)
    return next((c for c in codes if c in available), None)


def tone_of(hexcode):
    tones = [TONES[int(h, 16)] for h in hexcode.split("-") if int(h, 16) in TONES]
    return tones


def main():
    available = {p.stem for p in SVG_DIR.glob("*.svg")}
    data = json.loads((WEB / "node_modules/emojibase-data/en/compact.json").read_text())
    entries = sorted((e for e in data if e.get("group") is not None and e["group"] != 2), key=lambda e: e.get("order", 0))
    sheets = {}
    for e in entries:
        base = candidate(e["unicode"], available)
        if not base:
            continue
        sheets.setdefault(f"g{e['group']}", []).append(base)
        for s in e.get("skins") or []:
            tones = tone_of(s["hexcode"])
            if not tones or len(set(tones)) != 1:
                continue
            c = candidate(s["unicode"], available)
            if c:
                sheets.setdefault(f"t{tones[0]}", []).append(c)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    index = {"cell": CELL, "pad": PAD, "pitch": PITCH, "cols": COLS, "sheets": {}, "at": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content("<canvas id=c></canvas>")
        for name, codes in sheets.items():
            # the same emoji can sit in two places (a base that is also a variant); draw it once
            seen = []
            for c in codes:
                if c not in seen and c not in index["at"]:
                    seen.append(c)
            rows = math.ceil(len(seen) / COLS)
            w, h = COLS * PITCH, rows * PITCH
            items = [{"x": (i % COLS) * PITCH + PAD, "y": (i // COLS) * PITCH + PAD, "src": "data:image/svg+xml;base64," + base64.b64encode((SVG_DIR / f"{c}.svg").read_bytes()).decode()} for i, c in enumerate(seen)]
            url = page.evaluate(
                """async ({ w, h, cell, items }) => {
                    const canvas = document.getElementById('c');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, w, h);
                    for (const it of items) {
                        const img = new Image(cell, cell);
                        img.src = it.src;
                        await img.decode();
                        ctx.drawImage(img, it.x, it.y, cell, cell);
                    }
                    return canvas.toDataURL('image/webp', 0.9);
                }""",
                {"w": w, "h": h, "cell": CELL, "items": items},
            )
            raw = base64.b64decode(url.split(",", 1)[1])
            (OUT / f"{name}.webp").write_bytes(raw)
            index["sheets"][name] = {"w": w, "h": h}
            for i, c in enumerate(seen):
                index["at"][c] = [name, i]
            print(f"{name}: {len(seen)} emoji, {w}x{h}, {len(raw) // 1024} KB")
        browser.close()
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print("index:", len(index["at"]), "emoji")


if __name__ == "__main__":
    main()
