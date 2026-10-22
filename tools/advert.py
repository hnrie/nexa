#!/usr/bin/env python3
"""Nexa's advert: filmed from the real app, cut to a song, with a thumbnail.

Two plain accounts, test1 and test2, on a throwaway server, filmed the way
tools/trailer.py films (its cursor, its human pointer, its recorder). Every
take logs when things happen in it (a theme put on, a message landing), and
the edit lines those moments up with the song's beats: the song is measured
first (tempo, the first downbeat, where the drops are) and the cut is laid on
that grid. The edit is an HTML page drawn frame by frame in headless Chrome
(the takes as picture frames, in a window on a coloured stage, with the
titles), so every frame is exact, then joined with the song by ffmpeg.

  tools/.venv/bin/python tools/advert.py film   [--only shot,shot]
  tools/.venv/bin/python tools/advert.py edit   --song music.mp3 [--cut trailer|fast|short] [--bpm 140] [--out advert.mp4] [--from 0 --to 84]
  tools/.venv/bin/python tools/advert.py thumb  [--out thumbnail.png]

film needs E2E_CHATD and E2E_WEB_DIST (see tools/e2e.py); build the web with
VITE_ALL_SEASONS=1 so the seasonal themes are there to film. edit needs
numpy and librosa (in a venv of its own: ADVERT_PYTHON names its python).
Takes and frames go to ADVERT_WORK (default /tmp/nexa-advert).
"""
import argparse, json, os, random, shutil, subprocess, sys, time, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
os.environ.setdefault("TRAILER_WORK", os.environ.get("ADVERT_WORK", "/tmp/nexa-advert"))
import trailer  # noqa: E402
from trailer import ADDRESS, VIEW, Actor, TlsFront, World, click_point, end_of, render, say, spa, start  # noqa: E402
from e2e import Server  # noqa: E402

WORK = trailer.WORK
TAKES = WORK / "takes"
random.seed(11)

# ---------------------------------------------------------------------------
# Filming
# ---------------------------------------------------------------------------

SHOTS = {}


def shot(fn):
    SHOTS[fn.__name__] = fn
    return fn


class Take:
    """Films one or more actors at once and keeps when things happened, in
    seconds from the start of the film, for the edit to cut on."""

    def __init__(self, name, *views, lead=0.8, tail=1.2):
        self.name, self.views, self.lead, self.tail = name, views, lead, tail
        self.marks = {}

    def mark(self, label):
        self.marks[label] = round(time.time() - self.t0, 3)

    def __enter__(self):
        for actor, _ in self.views:
            actor.record_start()
        self.t0 = min(a.started for a, _ in self.views)
        time.sleep(self.lead)
        return self

    def __exit__(self, kind, err, tb):
        if kind:
            for actor, _ in self.views:
                try:
                    actor.record_stop(f"failed-{self.name}")
                except Exception:
                    pass
            return False
        time.sleep(self.tail)
        info = {"marks": self.marks, "views": {}}
        for actor, view in self.views:
            raw = actor.record_stop(f"{self.name}-{view}")
            dest = TAKES / f"{self.name}-{view}.mp4"
            TAKES.mkdir(parents=True, exist_ok=True)
            shutil.move(str(raw), dest)
            # each view's own start, so marks line up in every view
            info["views"][view] = {"file": dest.name, "offset": round(actor.started - self.t0, 3), "phone": actor.phone}
        (TAKES / f"{self.name}.json").write_text(json.dumps(info, indent=1))
        print(f"    filmed {self.name}: {self.marks}")


def typed(actor, text, delay=70):
    """The other person typing, off camera, so their typing shows for whoever watches."""
    box = actor.page.locator("textarea[aria-label^='Message']").first
    box.click()
    for ch in text:
        actor.page.keyboard.type(ch)
        time.sleep(random.uniform(0.05, 0.12) * delay / 70)
    actor.page.keyboard.press("Enter")


def wait_message(actor, text, timeout=15000):
    actor.page.locator(f"[data-id]:has-text({json.dumps(text)})").last.wait_for(timeout=timeout)


def seed(w):
    print("seeding")
    # the first account is the instance's admin and wears its crown; it stays out of shot
    owner = Actor(w.browser, w.base, "hostadmin", "Host")
    owner.register("Host")
    owner.close()
    for name in ("test1", "test2"):
        a = Actor(w.browser, w.base, name, name)
        a.register(name)
        w.people[name] = a
    t1, t2 = w["test1"], w["test2"]
    t1.add_friend("test2")
    t2.accept_friend("test1")
    t1.open_dm_with("test2")
    w.dm = t1.page.url.rstrip("/").split("/")[-1]
    p = t1.page
    p.goto(w.base + "/channels/@me", wait_until="networkidle")
    p.click("button[aria-label='Add a Server']")
    p.fill("[data-testid=server-name]", "test server")
    p.click("[data-testid=create-server-submit]")
    p.wait_for_url("**/channels/*/*", timeout=30000)
    p.wait_for_selector("textarea[aria-label='Message #general']", timeout=20000)
    w.server_id = p.url.split("/channels/")[1].split("/")[0]
    link = trailer.invite_link(t1)
    t2.page.goto(link, wait_until="networkidle")
    t2.page.click("[data-testid=invite-join]")
    t2.page.wait_for_url(f"**/channels/{w.server_id}/*", timeout=30000)
    w.channels = trailer.channel_ids(p)
    for a in (t1, t2):
        w.go(a, w.channel_url("general"))
    say(t2, "hi")
    say(t1, "hey")


def dm_url(w):
    return f"{w.base}/channels/@me/{w.dm}"


@shot
def hi(w):
    """A conversation starts: test2 says hi, test1 answers."""
    t1, t2 = w["test1"], w["test2"]
    w.go(t1, dm_url(w))
    w.go(t2, dm_url(w))
    start(t1, 0.62, 0.62)
    with Take("hi", (t1, "a")) as tk:
        typed(t2, "hi")
        wait_message(t1, "hi")
        tk.mark("hi")
        t1.rest(0.7)
        t1.click("textarea[aria-label^='Message']")
        t1.type("hey!")
        tk.mark("hey-enter")
        t1.key("Enter", after=0.3)
        tk.mark("hey")
        t1.rest(0.6)
        typed(t2, "how are you")
        wait_message(t1, "how are you")
        tk.mark("how")
        t1.rest(0.5)
        t1.type("good :)")
        t1.key("Enter", after=0.2)
        tk.mark("good")
        t1.rest(0.8)


@shot
def react(w):
    """A reaction and a reply."""
    t1 = w["test1"]
    w.go(t1, dm_url(w))
    start(t1, 0.7, 0.45)
    with Take("react", (t1, "a")) as tk:
        row = t1.page.locator("[data-id]:has-text('how are you')").last
        t1.hover(row, fx=0.35)
        t1.rest(0.3)
        t1.click(row.locator("button[aria-label='Add Reaction']").first)
        t1.rest(0.25)
        t1.type("wave")
        t1.rest(0.35)
        t1.click("[role=dialog][aria-label='Expression Picker'] button[data-emoji]")
        tk.mark("reacted")
        t1.rest(0.6)
        if t1.page.locator("[role=dialog][aria-label='Expression Picker']").count():
            t1.key("Escape")
        t1.hover(row, fx=0.35)
        t1.rest(0.2)
        t1.click(row.locator("button[aria-label='Reply']"))
        t1.rest(0.2)
        t1.type("all good here")
        t1.key("Enter", after=0.2)
        tk.mark("replied")
        t1.rest(0.8)


FORMATS = [
    ("bold", "this is **bold**, *italic* and __underlined__"),
    ("colour", "and [colours]{pink} [too]{on blue}"),
    ("spoiler", "||a spoiler||"),
    ("code", "```js\nconsole.log(\"hi\")\n```"),
    ("quote", "> hi from a quote\n# and a heading"),
]


@shot
def formatting(w):
    """Every kind of formatting, written as it is typed."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1, 0.62, 0.3)
    t1.page.click("textarea[aria-label^='Message']")
    with Take("formatting", (t1, "a"), lead=0.4) as tk:
        for name, text in FORMATS:
            tk.mark(f"{name}-start")
            t1.type(text, speed=1.6)
            t1.key("Enter", after=0.05)
            tk.mark(name)
            t1.rest(0.9)
            if name == "spoiler":
                sp = t1.page.locator("[data-id]").last.get_by_role("button", name=__import__("re").compile("spoiler", 2)).first
                t1.click(sp)
                tk.mark("spoiler-open")
                t1.rest(0.8)
                t1.click("textarea[aria-label^='Message']")
        t1.rest(0.6)


@shot
def editor(w):
    """A message built in the formatting editor: a heading, then a callout."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1, 0.7, 0.35)
    tray = "[data-testid=format-toolbar] button[aria-label='{}']"
    with Take("editor", (t1, "a")) as tk:
        t1.click("[data-testid=format-open]")
        t1.page.wait_for_selector("[data-testid=format-editor]", timeout=10000)
        tk.mark("open")
        t1.rest(0.3)
        t1.click("[data-testid=format-surface]")
        t1.type("hi everyone")
        t1.key("Meta+a", after=0.2)
        t1.click(tray.format("Text Style"))
        t1.rest(0.25)
        t1.click("[role=group][aria-label='Text Style'] button >> nth=1")
        tk.mark("heading")
        t1.rest(0.5)
        t1.click("[data-testid=format-surface]", fx=0.9, fy=0.2)
        t1.key("End", after=0.1)
        t1.key("Enter", after=0.1)
        t1.type("this was made in the editor")
        t1.key("Shift+Home", after=0.2)
        t1.click(tray.format("Quote or Callout"))
        t1.rest(0.25)
        t1.click("[role=group][aria-label='Quote or Callout'] button[data-kind=tip]")
        tk.mark("callout")
        t1.rest(0.7)
        t1.click("[data-testid=format-send]")
        t1.page.wait_for_selector("[data-testid=format-editor]", state="detached", timeout=10000)
        tk.mark("sent")
        t1.rest(1.2)


@shot
def typing(w):
    """test2's own typing indicator, as test1 sees it."""
    t1, t2 = w["test1"], w["test2"]
    t2.open_settings("profiles")
    t2.page.click("[data-testid=designer-part-typing]")
    t2.page.click("[data-testid=typing-surprise]")
    t2.page.wait_for_timeout(400)
    t2.page.locator("[role=dialog] button:has-text('Save Changes')").last.click()
    t2.page.wait_for_timeout(1200)
    t2.close_settings()
    w.go(t1, dm_url(w))
    w.go(t2, dm_url(w))
    start(t1, 0.8, 0.3)
    with Take("typing", (t1, "a")) as tk:
        box = t2.page.locator("textarea[aria-label^='Message']").first
        box.click()
        tk.mark("start")
        for ch in "are you coming tonight":
            t2.page.keyboard.type(ch)
            time.sleep(random.uniform(0.09, 0.16))
        time.sleep(1.2)
        t2.page.keyboard.press("Enter")
        wait_message(t1, "are you coming tonight")
        tk.mark("sent")
        t1.rest(1.0)


@shot
def voice(w):
    """Both join the voice channel; the speaking rings light up."""
    t1, t2 = w["test1"], w["test2"]
    url = w.channel_url("general")
    w.go(t2, url)
    trailer.join_voice(t2, url)
    w.go(t1, url)
    start(t1, 0.35, 0.5)
    with Take("voice", (t1, "a")) as tk:
        t1.click("[data-channel]:has(span:text-is('General')) button")
        t1.page.wait_for_function("() => document.querySelectorAll('[data-peer-state=connected][data-user]').length >= 2", timeout=60000)
        tk.mark("joined")
        t1.rest(3.0)
        t1.click("[data-testid=voice-mute]")
        tk.mark("mute")
        t1.rest(1.0)
        t1.click("[data-testid=voice-mute]")
        t1.rest(1.5)


@shot
def share(w):
    """test2 shares a screen at 60 fps and test1 watches."""
    t1 = w["test1"]
    url = w.channel_url("general")
    sharer = Actor(w.browser, w.base, "test2", "test2", share=True)
    sharer.login()
    w.go(w["test2"], w.base + "/channels/@me")
    sharer.page.goto(url, wait_until="networkidle")
    trailer.join_voice(sharer, url)
    if not t1.page.locator("[data-testid=voice-status]").count():
        w.go(t1, url)
        trailer.join_voice(t1, url)
    t1.page.wait_for_function("() => document.querySelectorAll('[data-peer-state=connected][data-user]').length >= 2", timeout=60000)
    start(t1, 0.5, 0.55)
    try:
        with Take("share", (t1, "a")) as tk:
            sp = sharer.page
            sp.click("[data-testid=screen-share]")
            sp.click("[data-testid=share-mode-performance]")
            sp.click("[data-testid=go-live]")
            t1.page.wait_for_selector("[data-testid=watch-stream]", timeout=30000)
            t1.rest(0.6)
            t1.click("[data-testid=watch-stream]")
            tk.mark("watch")
            t1.rest(5.0)
    finally:
        sharer.close()
        for a in (t1,):
            try:
                if a.page.locator("[data-testid=voice-status-leave]").count():
                    a.page.click("[data-testid=voice-status-leave]")
            except Exception:
                pass


THEMES = ["midnight", "forest", "rose", "amber", "ocean", "sky", "nexa-light", "season-halloween", "season-spring", "season-summer-night"]


@shot
def themes(w):
    """Themes put on one after another, each moment logged to cut on the beat."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1)
    with Take("themes", (t1, "a")) as tk:
        t1.click("button[aria-label='User Settings']")
        t1.rest(0.4)
        t1.click("[data-nav=appearance]")
        t1.rest(0.8)
        for i, theme in enumerate(THEMES):
            card = f"[data-theme-id='{theme}']"
            if not t1.page.locator(card).count():
                continue
            t1.hover(card)
            t1.rest(0.08)
            t1.page.mouse.down()
            time.sleep(0.06)
            t1.page.mouse.up()
            tk.mark(f"theme{i}")
            t1.rest(0.55)
        t1.rest(0.5)


@shot
def snow(w):
    """Winter Night: snow falls behind the messages while test1 says hi."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    t1.open_settings("appearance")
    t1.page.click("[data-theme-id='season-winter-night']")
    t1.page.wait_for_timeout(600)
    t1.close_settings()
    start(t1, 0.7, 0.4)
    with Take("snow", (t1, "a"), lead=1.5) as tk:
        t1.click("textarea[aria-label^='Message']")
        t1.type("it's snowing")
        t1.key("Enter", after=0.2)
        tk.mark("sent")
        t1.glide(VIEW[0] * 0.78, VIEW[1] * 0.3)
        t1.rest(3.0)
    t1.open_settings("appearance")
    t1.page.click("[data-theme-id='dark']")
    t1.page.wait_for_timeout(600)
    t1.close_settings()


@shot
def e2ee(w):
    """The front page's two views of one chat: as people read it, and as the server keeps it."""
    trailer.c_front_duo(w)
    src = trailer.WORK / "raw" / "unique" / "e2ee-what-the-server-sees.mp4"
    TAKES.mkdir(parents=True, exist_ok=True)
    take = [t for t in trailer.TAKES if t[0] == "unique/e2ee-what-the-server-sees"][-1]
    shutil.move(str(take[1]), TAKES / "e2ee-a.mp4")
    (TAKES / "e2ee.json").write_text(json.dumps({"marks": {"cut": take[3]}, "views": {"a": {"file": "e2ee-a.mp4", "offset": 0, "phone": False}}}))
    print("    filmed e2ee", src.name)


@shot
def safety(w):
    """The safety number two people compare to be sure nobody is in between."""
    t1 = w["test1"]
    w.go(t1, dm_url(w))
    start(t1, 0.55, 0.6)
    with Take("safety", (t1, "a")) as tk:
        t1.click("[data-testid=key-chip]")
        tk.mark("open")
        t1.rest(3.6)
        t1.key("Escape", after=0.5)


NAME_FONTS = ["pacifico", "bungee", "playfair", "pixelify", "lobster", "orbitron", "caveat", "shrikhand"]
NAME_EFFECTS = ["gradient", "glow", "candy", "aurora", "chrome"]


@shot
def namestyle(w):
    """test1 styles their name: fonts, then effects, each logged for the beat."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1)
    with Take("namestyle", (t1, "a")) as tk:
        t1.click("button[aria-label='User Settings']")
        t1.rest(0.35)
        t1.click("[data-nav=profiles]")
        t1.rest(0.7)
        t1.click("[data-testid=designer-part-nameStyle]")
        t1.page.wait_for_selector("[data-testid=name-style-preview]", timeout=10000)
        tk.mark("open")
        t1.rest(0.5)
        for i, f in enumerate(NAME_FONTS):
            t1.click(f"[data-testid=name-font-{f}]", pause=0.05, after=0.0)
            tk.mark(f"font{i}")
            t1.rest(0.45)
        for i, e in enumerate(NAME_EFFECTS):
            t1.click(f"[data-testid=name-effect-{e}]", pause=0.05, after=0.0)
            tk.mark(f"effect{i}")
            t1.rest(0.5)
        save = t1.page.locator("[role=dialog] button:has-text('Save Changes')").last
        if save.count():
            t1.click(save)
            tk.mark("saved")
        t1.rest(1.0)
        t1.key("Escape", after=0.6)
        t1.key("Escape", after=0.8)


@shot
def profile(w):
    """test2 opens test1's profile, with the styled name."""
    t2 = w["test2"]
    w.go(t2, w.channel_url("general"))
    start(t2, 0.6, 0.6)
    with Take("profile", (t2, "a")) as tk:
        t2.click("[data-testid=member-list] [data-user]:has-text('test1')")
        t2.page.wait_for_selector("[data-testid=profile-modal], [role=dialog]", timeout=15000)
        tk.mark("open")
        t2.rest(2.8)
        t2.key("Escape", after=0.5)


@shot
def notes(w):
    """test1 and test2 write in one note at once, each seeing the other's caret."""
    t1, t2 = w["test1"], w["test2"]
    m, t = t1.page, t2.page
    surface = "[data-testid=note-surface]"
    m.goto(w.base + "/channels/@me/notes", wait_until="networkidle")
    m.click("[data-testid=note-new]")
    m.wait_for_selector("[data-testid=note-title]")
    m.fill("[data-testid=note-title]", "test")
    m.click(surface)
    for i, line in enumerate(["hi", "", "- one", "- two"]):
        if i:
            m.keyboard.press("Enter")
        m.keyboard.type(line, delay=3)
    m.wait_for_timeout(1500)
    note = m.url
    m.click("[data-testid=note-share]")
    m.wait_for_selector("[data-testid=share-note]")
    m.click("[data-testid=note-invite-role-2]")
    m.click("[data-testid=note-invite-row][data-user=test2] button")
    m.wait_for_timeout(800)
    m.keyboard.press("Escape")
    t.goto(w.base + "/channels/@me/notes", wait_until="networkidle")
    t.click("[data-testid=note-request-accept]")
    t.wait_for_timeout(800)
    t.goto(note, wait_until="networkidle")
    t.wait_for_selector(surface)
    t1.mouse = (VIEW[0] * 0.8, VIEW[1] * 0.75)
    t2.mouse = (VIEW[0] * 0.75, VIEW[1] * 0.8)
    for a in (t1, t2):
        a.page.mouse.move(*a.mouse)
    with Take("notes", (t1, "a"), (t2, "b")) as tk:
        click_point(t2, *end_of(t2, "two", surface))
        t2.rest(0.4)
        click_point(t1, *end_of(t1, "hi", surface))
        tk.mark("typing")
        t2.key("Enter", after=0.2)
        hers, his = " from test1", "three"
        for i in range(max(len(hers), len(his))):
            if i < len(hers):
                m.keyboard.type(hers[i])
            if i < len(his):
                t.keyboard.type(his[i])
            time.sleep(random.uniform(0.07, 0.13))
        tk.mark("typed")
        t1.glide(VIEW[0] * 0.82, VIEW[1] * 0.35)
        t2.glide(VIEW[0] * 0.8, VIEW[1] * 0.7)
        t1.rest(1.2)


@shot
def subchat(w):
    """A side conversation inside the DM, locked with its own password."""
    t1 = w["test1"]
    w.go(t1, dm_url(w))
    start(t1, 0.62, 0.55)
    with Take("subchat", (t1, "a")) as tk:
        t1.click("[data-testid=subchats-button]")
        t1.rest(0.4)
        t1.click("[data-testid=subchat-with-password]")
        t1.rest(0.3)
        t1.click("[data-testid=subchat-modal-name]")
        t1.type("secret")
        t1.click("[role=dialog] label:has(input[role=switch])")
        t1.rest(0.2)
        t1.click("[data-testid=subchat-modal-password]")
        t1.type("hunter2")
        t1.click("[role=dialog] input[type=password] >> nth=1")
        t1.type("hunter2")
        t1.click("[data-testid=subchat-modal-save]")
        t1.page.wait_for_selector("[role=dialog] [data-testid=subchat-modal-save]", state="detached", timeout=20000)
        tk.mark("made")
        t1.rest(0.5)
        t1.click(t1.page.locator(":text('secret'):visible").first)
        t1.page.wait_for_selector("[data-testid=subchat-parent]", timeout=20000)
        tk.mark("inside")
        t1.click("textarea[aria-label^='Message']")
        t1.type("hi")
        t1.key("Enter", after=0.2)
        tk.mark("sent")
        t1.rest(0.8)


PLUGIN = """export default {
  name: "Wave",
  description: "Adds /wave to the message box.",
  version: "1.0.0",
  author: "test1",
  start(api) {
    api.commands.register({
      name: "wave",
      description: "Say hi with a wave",
      run() { return "hi \U0001f44b"; },
    });
  },
};
"""


@shot
def plugins(w):
    """A plugin added by pasting its code, then the command it adds."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1)
    with Take("plugins", (t1, "a")) as tk:
        t1.click("button[aria-label='User Settings']")
        t1.rest(0.4)
        t1.click("[data-nav=plugins]")
        t1.rest(0.6)
        t1.click("[data-testid=plugin-open-code]")
        t1.rest(0.3)
        t1.click("[data-testid=plugin-code]")
        t1.paste(PLUGIN, after=0.5)
        tk.mark("pasted")
        t1.click("[data-testid=plugin-continue]")
        t1.page.wait_for_selector("[data-testid=plugin-review]", timeout=10000)
        t1.rest(0.6)
        if t1.page.locator("[data-testid=plugin-agree]").count():
            t1.click("[data-testid=plugin-agree]")
            t1.rest(0.2)
        t1.click("[data-testid=plugin-add]")
        t1.page.wait_for_selector("[data-testid=plugin-item]", timeout=20000)
        tk.mark("added")
        t1.rest(1.0)
        t1.key("Escape", after=0.4)
        if t1.page.locator("[role=dialog][aria-label='User Settings']").count():
            t1.key("Escape", after=0.4)
        t1.click("textarea[aria-label^='Message']")
        t1.type("/wave")
        t1.rest(0.5)
        t1.key("Enter", after=0.3)
        if t1.page.locator("textarea[aria-label^='Message']").first.input_value().strip():
            t1.key("Enter", after=0.2)
        t1.page.wait_for_selector("[data-id]:has(img[alt='👋'])", timeout=15000)
        tk.mark("waved")
        t1.rest(1.2)


CSS = """:root {
  --brand: #ff5c8a;
  --bg-base: #24121f;
  --bg-raised: #2e1828;
}
"""


@shot
def css(w):
    """The app restyled by custom CSS as it is typed."""
    t1 = w["test1"]
    w.go(t1, w.channel_url("general"))
    start(t1)
    with Take("css", (t1, "a")) as tk:
        t1.click("button[aria-label='User Settings']")
        t1.rest(0.4)
        t1.click("[data-nav=customCss]")
        t1.rest(0.6)
        if not t1.page.locator("[role=dialog] input[role=switch]").first.is_checked():
            t1.click("[role=dialog] label:has(input[role=switch])")
            t1.rest(0.3)
        t1.click("[data-testid=css-snippet]")
        tk.mark("typing")
        t1.type(CSS, speed=2.2)
        tk.mark("typed")
        t1.click("[data-testid=save]")
        t1.rest(0.6)
        t1.key("Escape", after=0.4)
        tk.mark("closed")
        t1.rest(1.6)
    t1.open_settings("customCss")
    if t1.page.locator("[role=dialog] input[role=switch]").first.is_checked():
        t1.page.locator("[role=dialog] label:has(input[role=switch])").first.click()
    t1.page.locator("[data-testid=css-snippet]").first.fill("")
    try:
        t1.page.click("[data-testid=save]", timeout=3000)
    except Exception:
        pass
    t1.page.wait_for_timeout(800)
    t1.close_settings()


@shot
def phone(w):
    """test2 on a phone and test1 at a desk, filmed at the same moment."""
    t1 = w["test1"]
    ph = Actor(w.browser, w.base, "test2", "test2", phone=True)
    ph.login()
    try:
        ph.page.goto(dm_url(w), wait_until="networkidle")
        ph.page.wait_for_timeout(1000)
        w.go(t1, dm_url(w))
        start(ph, 0.5, 0.5)
        start(t1, 0.75, 0.5)
        with Take("phone", (t1, "a"), (ph, "b")) as tk:
            ph.click("textarea[aria-label^='Message']")
            ph.type("hi from my phone")
            ph.click("button[aria-label='Send Message']")
            wait_message(t1, "hi from my phone")
            tk.mark("arrived")
            t1.rest(0.4)
            t1.click("textarea[aria-label^='Message']")
            t1.type("hi!")
            t1.key("Enter", after=0.2)
            wait_message(ph, "hi!")
            tk.mark("back")
            ph.rest(1.0)
    finally:
        ph.close()


ORDER = ["hi", "react", "formatting", "editor", "typing", "safety", "subchat", "phone", "themes", "snow", "namestyle", "profile",
         "voice", "share", "notes", "plugins", "css", "e2ee"]


def film(only):
    chosen = only or ORDER
    for sub in ("raw", "assets"):
        shutil.rmtree(WORK / sub, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    srv = Server(public_url=ADDRESS)
    front = TlsFront(srv.port)
    front.start()
    front.ready.wait(10)
    failed = []
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chromium", args=[
                f"--host-resolver-rules=MAP nexa.fish 127.0.0.1:{front.port}",
                "--ignore-certificate-errors", "--auto-accept-this-tab-capture",
                "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
                "--mute-audio", "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
            ])
            w = World(browser, srv, ADDRESS)
            seed(w)
            for name in chosen:
                print("shot:", name)
                try:
                    SHOTS[name](w)
                except Exception:
                    traceback.print_exc()
                    failed.append(name)
                    for a in w.people.values():
                        try:
                            a.page.screenshot(path=str(WORK / f"failed-{name}-{a.name}.png"))
                            if a.filming:
                                a.record_stop(f"failed-{name}-{a.name}")
                            a.page.keyboard.press("Escape")
                            a.page.goto(w.base + "/channels/@me", wait_until="networkidle")
                        except Exception:
                            pass
            browser.close()
    finally:
        srv.stop()
    if failed:
        print("failed:", ", ".join(failed))
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["film", "edit", "thumb"])
    ap.add_argument("--only", default="")
    ap.add_argument("--song", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--from", dest="t_from", type=float, default=None)
    ap.add_argument("--to", dest="t_to", type=float, default=None)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--cut", choices=["trailer", "fast", "short"], default="trailer",
                    help="edit: the trailer, a faster cut of it, or a 9:16 short for phones")
    ap.add_argument("--bpm", type=float, default=None, help="edit: the song's tempo, roughly, if the measured one is off")
    ap.add_argument("--frame-key", default="namestyle-a", help="thumb: which take's frames to show")
    ap.add_argument("--frame-index", type=int, default=1, help="thumb: which of its frames")
    ap.add_argument("--line", default="Private Chat<br>with All the<br>Fun Left In", help="thumb: the headline (HTML)")
    args = ap.parse_args()
    if args.what == "film":
        only = [n.strip() for n in args.only.split(",") if n.strip()]
        bad = [n for n in only if n not in SHOTS]
        if bad:
            print("no such shot:", ", ".join(bad), "(have", ", ".join(SHOTS) + ")", file=sys.stderr)
            return 2
        return film(only)
    import advert_edit
    if args.what == "edit":
        return advert_edit.edit(args)
    return advert_edit.thumb(args)


if __name__ == "__main__":
    sys.exit(main())
