"""The edit of tools/advert.py: the song measured, the cut laid on its beats,
drawn frame by frame, and the thumbnail.

The cut is a list of items (a take in a window, two windows side by side, a
phone beside a desk, a title, the wordmark), each with when it is on screen.
stage.html draws any moment of it; this file works out the moments from the
song and the takes, pulls the frames each take needs out of its film, and has
headless Chrome draw every frame of the advert, several pages at once.
"""
import json, math, os, re, shutil, subprocess, sys, time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("ADVERT_WORK", "/tmp/nexa-advert"))
TAKES = WORK / "takes"
FRAMES = WORK / "frames"
FPS = 60

# ---------------------------------------------------------------------------
# The song
# ---------------------------------------------------------------------------


def analyse(song, bpm=None):
    """The song's beat grid and its shape: when the drums first come in (the
    first drop), the gap where they stop (the breakdown) and come back (the
    second drop), and when they stop for good (the outro). Every one of those
    is put on a bar line counted from the first drop."""
    import librosa
    y, sr = librosa.load(song, sr=22050, mono=True)
    hop = 256
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    # librosa can take a song for two thirds or half its real tempo; bpm says
    # roughly where it is and the beats are still found in the audio
    tempo = bpm or float(np.atleast_1d(librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=hop))[0])
    _, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop, start_bpm=tempo, units="time", tightness=800)
    beats = np.asarray(beats)
    # one steady period from the tracked beats: the cut needs a grid, not a wobble
    period = float(np.median(np.diff(beats)))
    k = np.round((beats - beats[0]) / period)
    period, phase = np.polyfit(k, beats, 1)
    # the drums: low, percussive energy, beat by beat
    _, perc = librosa.effects.hpss(y)
    spec = np.abs(librosa.stft(perc, hop_length=hop))
    low = spec[librosa.fft_frequencies(sr=sr) < 150].sum(0)
    t = librosa.times_like(low, sr=sr, hop_length=hop)
    n0 = int(np.ceil(-phase / period))
    grid = phase + period * np.arange(n0, int((len(y) / sr - phase) / period))
    per = np.array([low[(t >= b) & (t < b + period)].mean() for b in grid])
    drums = per > 0.25 * np.percentile(per, 90)
    # runs of beats with drums, ignoring single beats either way
    runs, i = [], 0
    while i < len(drums):
        if drums[i]:
            j = i
            while j < len(drums) and (drums[j] or (j + 1 < len(drums) and drums[j + 1])):
                j += 1
            if j - i >= 8:
                runs.append((i, j))
            i = j
        i += 1
    if len(runs) < 2:
        raise SystemExit(f"could not find the song's shape (drum runs: {runs})")
    gaps = [(runs[r + 1][0] - runs[r][1], r) for r in range(len(runs) - 1)]
    _, r = max(gaps)
    i_d1, i_b, i_d2, i_o = runs[0][0], runs[r][1], runs[r + 1][0], runs[-1][1]
    # a drop is the hardest hit of the song around where its drums start: the
    # run is only sure of itself a beat or two later, so look two bars back
    times = np.arange(len(env)) * hop / sr

    def hit(i):
        m = (times > grid[i] - 8 * period) & (times < grid[i] + period / 2)
        return float(times[m][np.argmax(env[m])])
    d1 = hit(i_d1)
    bar = 4 * period

    def on_bar(x):
        return d1 + round((x - d1) / bar) * bar
    out = {
        "period": float(period), "bar": float(bar), "d1": d1,
        "breakdown": on_bar(grid[i_b]), "d2": on_bar(hit(i_d2)), "outro": on_bar(grid[i_o]),
        "end": len(y) / sr, "bpm": 60 / float(period),
    }
    print("song: %.1f bpm, first drop %.2f s, breakdown %.2f s, second drop %.2f s, outro %.2f s, ends %.2f s" % (
        out["bpm"], out["d1"], out["breakdown"], out["d2"], out["outro"], out["end"]))
    return out


# ---------------------------------------------------------------------------
# Takes
# ---------------------------------------------------------------------------


class Takes:
    def __init__(self):
        self.info = {}
        for f in TAKES.glob("*.json"):
            self.info[f.stem] = json.loads(f.read_text())
        self.ranges = {}  # (take, view) -> [lo, hi] of source time wanted

    def mark(self, take, label, view="a"):
        info = self.info[take]
        return info["marks"][label] - info["views"][view]["offset"]

    def has(self, take, label=None):
        return take in self.info and (label is None or label in self.info[take]["marks"])

    def file(self, take, view="a"):
        return TAKES / self.info[take]["views"][view]["file"]

    def want(self, take, view, lo, hi):
        key = (take, view)
        a, b = self.ranges.get(key, (lo, hi))
        self.ranges[key] = [min(a, lo), max(b, hi)]

    def extract(self, scale_w):
        """Pulls out the frames each take needs, as JPEGs at 60 a second."""
        FRAMES.mkdir(parents=True, exist_ok=True)
        out = {}
        for (take, view), (lo, hi) in sorted(self.ranges.items()):
            lo, hi = max(0.0, lo - 0.1), hi + 0.1
            src = self.file(take, view)
            phone = self.info[take]["views"][view]["phone"]
            d = FRAMES / f"{take}-{view}"
            stamp = d / "range.json"
            want = {"lo": round(lo, 3), "hi": round(hi, 3), "w": scale_w, "mtime": src.stat().st_mtime}
            if not (stamp.exists() and json.loads(stamp.read_text()) == want):
                shutil.rmtree(d, ignore_errors=True)
                d.mkdir(parents=True)
                size = "scale=-2:2340" if phone else f"scale={scale_w}:-2"
                subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{lo:.3f}", "-i", str(src), "-t", f"{hi - lo:.3f}",
                                "-vf", f"fps={FPS},{size}:flags=lanczos", "-q:v", "2", str(d / "%05d.jpg")], check=True)
                stamp.write_text(json.dumps(want))
            n = len(list(d.glob("*.jpg")))
            out[f"{take}-{view}"] = {"dir": d.as_uri(), "lo": lo, "n": n}
            print(f"  frames {take}-{view}: {n}")
        return out


# ---------------------------------------------------------------------------
# The cut
# ---------------------------------------------------------------------------


class Cut:
    def __init__(self, song, takes):
        self.s, self.t = song, takes
        self.items = []
        self.bg = []

    # --- time ----------------------------------------------------------------

    def beat(self, n, base=None):
        return (self.s["d1"] if base is None else base) + n * self.s["period"]

    def bars(self, n, base=None):
        return self.beat(4 * n, base)

    # --- pictures --------------------------------------------------------------

    def source(self, take, view, t0, t1, anchors=(), src_in=None, speed=1.0, hold_until=None):
        """How timeline time maps to the take's own time between t0 and t1.
        anchors are (mark, timeline time): each logged moment lands on the
        moment of the song it is given, the film running a little faster or
        slower between them. Without anchors it runs from src_in."""
        pts = [(tl, self.t.mark(take, m, view)) for m, tl in anchors]
        if not pts:
            pts = [(t0, src_in)]
        pts.sort()
        for (a, sa), (b, sb) in zip(pts, pts[1:]):
            sp = (sb - sa) / (b - a)
            if not 0.6 <= sp <= 1.7:
                print(f"  note: {take} runs at {sp:.2f}x between {a:.2f} and {b:.2f}")
        first, last = pts[0], pts[-1]
        start = (t0, first[1] - (first[0] - t0) * speed)
        end = (t1, last[1] + (t1 - last[0]) * speed)
        pts = [start] + [p for p in pts if t0 < p[0] < t1] + [end]
        if hold_until:
            # still on its first frame until then, as a picture waiting to play
            held = float(np.interp(hold_until, [a for a, _ in pts], [b for _, b in pts]))
            pts = [(t0, held), (hold_until, held)] + [q for q in pts if q[0] > hold_until]
        lo, hi = min(p[1] for p in pts), max(p[1] for p in pts)
        self.t.want(take, view, lo, hi)
        return {"key": f"{take}-{view}", "map": [[round(a, 4), round(b, 4)] for a, b in pts]}

    def window(self, take, t0, t1, view="a", cam=None, enter="cut", rise=0.8, caption=None, **src):
        self.items.append({"kind": "window", "t0": t0, "t1": t1, "src": self.source(take, view, t0, t1, **src),
                           "cam": cam or [[t0, 1.0, 0.5, 0.5], [t1, 1.05, 0.5, 0.55]], "enter": enter, "riseDur": rise})
        if caption:
            self.caption(caption, t0, t1)

    def montage(self, take, labels, t0, n_beats, view="a", lead=0.06, cam=None, caption=None):
        """One beat for each logged moment, the cut on the beat and the change
        (a theme, a font) on it too."""
        p = self.s["period"]
        labels = [l for l in labels if self.t.has(take, l)][:n_beats]
        for i, label in enumerate(labels):
            a = t0 + i * p
            b = t0 + (i + 1) * p if i < len(labels) - 1 else t0 + n_beats * p
            m = self.t.mark(take, label, view)
            src = self.source(take, view, a, b, src_in=m - lead)
            self.items.append({"kind": "window", "t0": a, "t1": b, "src": src, "cam": cam or [[a, 1.0, 0.5, 0.5]], "enter": "cut"})
        if caption:
            self.caption(caption, t0, t0 + n_beats * p)

    def split(self, take, t0, t1, views=("a", "b"), caption=None, cam=None, **src):
        srcs = [self.source(take, v, t0, t1, **src) for v in views]
        self.items.append({"kind": "split", "t0": t0, "t1": t1, "srcs": srcs, "cam": cam or [[t0, 1.0, 0.5, 0.5]]})
        if caption:
            self.caption(caption, t0, t1)

    def duo(self, take, t0, t1, caption=None, **src):
        self.items.append({"kind": "duo", "t0": t0, "t1": t1,
                           "srcs": [self.source(take, "a", t0, t1, **src), self.source(take, "b", t0, t1, **src)]})
        if caption:
            self.caption(caption, t0, t1)

    # --- words -------------------------------------------------------------------

    def caption(self, text, t0, t1, delay=None):
        """A line above the window, coming in a beat after the cut."""
        d = self.s["period"] * 0.5 if delay is None else delay
        self.items.append({"kind": "caption", "t0": t0 + d, "t1": t1, "text": text})

    def card(self, words, t0, t1, size=124, y=540, beats=None, weight=700):
        """Big words in the middle of the stage, one at a time on the beats."""
        p = self.s["period"]
        times = beats or [t0 + i * p for i in range(len(words))]
        self.items.append({"kind": "card", "t0": t0, "t1": t1, "words": words, "times": times, "size": size, "y": y, "weight": weight})

    def colours(self, t, a, b, glow=1.0):
        self.bg.append([t, a, b, glow])

    # --- the advert --------------------------------------------------------------

    def build(self):
        s, T, p = self.s, self.t, self.s["period"]
        d1, d2, brk, outro, end = s["d1"], s["d2"], s["breakdown"], s["outro"], s["end"]
        B = lambda n, base=d1: self.bars(n, base)  # noqa: E731
        b = lambda n, base=d1: self.beat(n, base)  # noqa: E731

        # the intro: "hi", typed on the notes, then the wordmark, then the app rises to the drop
        intro_bars = [d1 - k * s["bar"] for k in range(6, 0, -1)]
        self.colours(0, "#0a0910", "#0a0910", 0.0)
        self.colours(intro_bars[0], "#2a1450", "#120c22", 0.45)
        self.items.append({"kind": "type", "t0": 0.35, "t1": intro_bars[2] + p, "text": "hi",
                           "times": [intro_bars[0], intro_bars[0] + p]})
        self.items.append({"kind": "wordmark", "t0": intro_bars[2] + p * 0.5, "t1": intro_bars[4] + 0.35, "size": 150, "y": 520})
        self.window("hi", intro_bars[4], B(4), enter="rise", rise=d1 - intro_bars[4],
                    anchors=[("hi", b(1)), ("hey", b(7)), ("how", b(11)), ("good", b(14))],
                    cam=[[intro_bars[4], 1.0, 0.5, 0.5], [d1, 1.0, 0.5, 0.5], [b(3), 1.28, 0.4, 0.62], [B(4), 1.34, 0.4, 0.66]],
                    hold_until=d1)
        self.colours(d1, "#4c1d95", "#0f2a4a", 1.0)
        self.caption("Say hi.", d1, B(4))

        # formatting, one kind a bar, close up on the newest message
        self.colours(B(4), "#6d1d5b", "#1b1650", 1.0)
        fm = [("bold", 0.5, 0.8), ("colour", 0.5, 0.8), ("spoiler-open", 0.5, 0.8), ("code", 0.5, 0.78)]
        for i, (label, fx, fy) in enumerate(fm):
            if not T.has("formatting", label):
                continue
            t0, t1 = B(4 + i), B(5 + i)
            self.window("formatting", t0, t1, anchors=[(label, t0 + 2 * p)],
                        cam=[[t0, 1.65, fx, fy], [t1, 1.75, fx, fy]])
        self.caption("Say it your way.", B(4), B(8))

        # calls
        self.colours(B(8), "#0c4a4a", "#13204d", 1.0)
        if T.has("voice"):
            self.window("voice", B(8), B(10), anchors=[("joined", b(33))], caption="Talk.",
                        cam=[[B(8), 1.0, 0.5, 0.5], [B(10), 1.08, 0.5, 0.45]])
        if T.has("share"):
            self.window("share", B(10), B(12), anchors=[("watch", b(41))], caption="Share your screen in 1080p60.",
                        cam=[[B(10), 1.0, 0.5, 0.5], [B(12), 1.1, 0.55, 0.45]])

        # looks
        self.colours(B(12), "#5a2a0c", "#3a0f3f", 1.0)
        if T.has("themes"):
            self.montage("themes", [f"theme{i}" for i in range(12)], B(12), 8, caption="Make it yours.",
                         cam=[[B(12), 1.3, 0.62, 0.42]])
        if T.has("snow"):
            self.colours(B(14), "#0f2f5c", "#0a1530", 1.0)
            self.window("snow", B(14), brk, anchors=[("sent", B(14) + 3 * p)], caption="With themes for every season.",
                        cam=[[B(14), 1.12, 0.6, 0.55], [brk, 1.2, 0.6, 0.5]])

        # the breakdown: privacy, said plainly
        self.colours(brk, "#0b0b14", "#0b0b14", 0.2)
        self.card(["Every", "message."], brk, B(1, brk) - 0.02)
        self.card(["End-to-end", "encrypted."], B(1, brk), B(2, brk) - 0.02)
        if T.has("e2ee"):
            self.colours(B(2, brk), "#1d1342", "#0b0b14", 0.6)
            self.window("e2ee", B(2, brk), d2 - p, src_in=T.mark("e2ee", "cut") + 2.6, enter="rise",
                        cam=[[B(2, brk), 1.0, 0.5, 0.5], [d2 - p, 1.08, 0.5, 0.5]], caption="Not even the server can read it.")
        self.colours(d2 - p, "#000000", "#000000", 0.0)

        # names and profiles
        self.colours(d2, "#7a2e12", "#4a1060", 1.0)
        if T.has("namestyle"):
            labels = [f"font{i}" for i in range(4)] + [f"effect{i}" for i in range(4)]
            self.montage("namestyle", labels, d2, 8, caption="Your name, your style.", cam=[[d2, 1.55, 0.865, 0.32]])
        if T.has("css"):
            self.window("css", B(2, d2), B(4, d2), anchors=[("closed", b(13, d2))], caption="Or restyle everything.",
                        cam=[[B(2, d2), 1.3, 0.5, 0.45], [b(12.6, d2), 1.3, 0.5, 0.45], [b(13.6, d2), 1.0, 0.5, 0.5], [B(4, d2), 1.04, 0.5, 0.5]])

        # writing together
        self.colours(B(4, d2), "#123e6b", "#2a1458", 1.0)
        if T.has("notes"):
            self.split("notes", B(4, d2), B(8, d2), anchors=[("typing", b(18, d2))], caption="Write together, live.",
                       cam=[[B(4, d2), 1.75, 0.62, 0.3], [B(8, d2), 1.85, 0.62, 0.3]])

        # locked chats and plugins
        self.colours(B(8, d2), "#0f4a33", "#1a1c4d", 1.0)
        if T.has("subchat"):
            self.window("subchat", B(8, d2), B(10, d2), anchors=[("made", b(33, d2)), ("inside", b(36, d2))],
                        caption="Lock a chat with a password.", cam=[[B(8, d2), 1.3, 0.45, 0.6], [B(10, d2), 1.38, 0.42, 0.72]])
        if T.has("plugins"):
            self.window("plugins", B(10, d2), B(12, d2), anchors=[("waved", b(46, d2))], caption="Add your own plugins.",
                        cam=[[B(10, d2), 1.05, 0.5, 0.65], [B(12, d2), 1.12, 0.5, 0.7]])

        # everywhere, then everything once more, a beat each
        self.colours(B(12, d2), "#3b1a6e", "#0d2f4f", 1.0)
        if T.has("phone"):
            self.duo("phone", B(12, d2), B(14, d2), anchors=[("arrived", b(51, d2)), ("back", b(55, d2))], caption="On every screen.")
        recap = [("react", "reacted", 0.5, 1.35, 0.32, 0.62), ("themes", "theme3", 0.3, 1.0, 0.5, 0.5),
                 ("voice", "joined", 1.5, 1.2, 0.45, 0.4), ("share", "watch", 1.6, 1.1, 0.55, 0.45),
                 ("notes", "typed", -0.2, 1.3, 0.5, 0.35), ("namestyle", "effect3", 0.2, 1.0, 0.5, 0.5),
                 ("safety", "open", 1.0, 1.15, 0.5, 0.5), ("snow", "sent", 0.8, 1.15, 0.6, 0.5)]
        recap = [r for r in recap if T.has(r[0], r[1])]
        for i, (take, label, off, z, fx, fy) in enumerate(recap[:8]):
            a, c = b(56 + i, d2), b(57 + i, d2)
            self.items.append({"kind": "window", "t0": a, "t1": c, "enter": "cut",
                               "src": self.source(take, "a", a, c, src_in=T.mark(take, label) + off),
                               "cam": [[a, z, fx, fy], [c, z + 0.03, fx, fy]]})

        # the end
        self.colours(outro, "#3d1478", "#0c0a1a", 0.8)
        self.items.append({"kind": "wordmark", "t0": outro + p, "t1": end, "size": 170, "y": 470})
        self.card(["Free.", "Private.", "Yours."], B(1, outro), end, size=64, y=640, weight=600)
        self.items.append({"kind": "url", "t0": B(2, outro) + 2 * p, "t1": end, "text": "nexa.fish"})
        self.fade = [end - 2.6, end - 0.5]
        return {"fps": FPS, "dur": end, "items": self.items, "bg": self.bg, "fade": self.fade}


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def brand_paths():
    src = (ROOT / "web/src/components/common/Brand.tsx").read_text()
    grab = lambda name: re.search(name + r'\s*=\s*"([^"]+)"', src).group(1)  # noqa: E731
    return {"letters": grab("WORDMARK_LETTERS"), "spark": grab("WORDMARK_SPARK"), "mark": grab("const MARK")}


def font_url():
    f = ROOT / "web/node_modules/@fontsource-variable/wix-madefor-display/files/wix-madefor-display-latin-wght-normal.woff2"
    return f.as_uri()


def stage_page(spec):
    html = (ROOT / "tools/advert_stage.html").read_text()
    html = html.replace("%FONT%", font_url()).replace("/*SPEC*/null", json.dumps(spec)).replace("/*BRAND*/null", json.dumps(brand_paths()))
    page = WORK / "stage.html"
    page.write_text(html)
    return page


def render_range(page_path, out, first, last, fps):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chromium", args=["--allow-file-access-from-files", "--disable-web-security"])
        pg = br.new_page(viewport={"width": 1920, "height": 1080})
        pg.goto(page_path.as_uri())
        pg.wait_for_function("() => window.ready === true", timeout=60000)
        for i in range(first, last):
            pg.evaluate("(t) => window.draw(t)", i / fps)
            pg.screenshot(path=str(out / f"{i:05d}.jpg"), type="jpeg", quality=93)
        br.close()


def edit(args):
    if not args.song:
        print("--song is needed", file=sys.stderr)
        return 2
    song = analyse(args.song, args.bpm)
    takes = Takes()
    if not takes.info:
        print("no takes in", TAKES, "(film first)", file=sys.stderr)
        return 1
    print("takes:", ", ".join(sorted(takes.info)))
    cut = Cut(song, takes)
    spec = cut.build()
    spec["frames"] = takes.extract(2560)
    (WORK / "cut.json").write_text(json.dumps(spec, indent=1))
    page = stage_page(spec)
    fps = args.fps
    t_from = args.t_from or 0.0
    t_to = min(args.t_to or spec["dur"], spec["dur"])
    out = WORK / "render"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    first, last = int(round(t_from * fps)), int(round(t_to * fps))
    workers = int(os.environ.get("ADVERT_WORKERS", "4"))
    step = math.ceil((last - first) / workers)
    print(f"drawing {last - first} frames with {workers} pages")
    started = time.time()
    procs = []
    for w in range(workers):
        a, z = first + w * step, min(last, first + (w + 1) * step)
        if a >= z:
            continue
        procs.append(subprocess.Popen([sys.executable, __file__, "render", str(page), str(out), str(a), str(z), str(fps)]))
    if any(p.wait() for p in procs):
        print("a page failed to draw", file=sys.stderr)
        return 1
    print(f"drawn in {time.time() - started:.0f} s")
    dest = Path(args.out or (WORK / "advert.mp4"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-start_number", str(first), "-i", str(out / "%05d.jpg"),
                    "-ss", f"{t_from:.3f}", "-t", f"{t_to - t_from:.3f}", "-i", args.song,
                    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p",
                    "-profile:v", "high", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", str(dest)], check=True)
    print("wrote", dest)
    return 0


def thumb(args):
    """A still that makes people look: the app, a styled name and the line, big."""
    from playwright.sync_api import sync_playwright
    spec = json.loads((WORK / "cut.json").read_text())
    spec["thumb"] = True
    page = stage_page(spec)
    dest = Path(args.out or (WORK / "thumbnail.png"))
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chromium", args=["--allow-file-access-from-files", "--disable-web-security"])
        pg = br.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1.5)
        pg.goto(page.as_uri())
        pg.wait_for_function("() => window.ready === true", timeout=60000)
        pg.evaluate("(a) => window.drawThumb(...a)", [args.frame_key, args.frame_index, args.line, ""])
        pg.screenshot(path=str(dest))
        br.close()
    print("wrote", dest)
    return 0


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "render":
    _, _, page, out, a, z, fps = sys.argv
    render_range(Path(page), Path(out), int(a), int(z), int(fps))
