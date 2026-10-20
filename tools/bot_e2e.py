#!/usr/bin/env python3
"""Runs real bot libraries against a throwaway chatd: the bots people write
for Discord, pointed at Nexa as the developer portal tells them to.

  tools/bot_e2e.py [--keep] [--only dpy|js|go]

It starts its own chatd (E2E_CHATD and E2E_WEB_DIST name a scratch build, as
for tools/e2e.py), registers alice and bob in a headless browser, has alice
make a server and an application whose bot she adds to it, then runs each
library's test bot (tools/bots/) and, as bob, uses the bot's slash command,
context menu entries, buttons, select menu, autocomplete and form, checking
what the bot and the server say at each step.

discord.py comes from BOT_E2E_PYTHON (a Python with discord.py installed),
discord.js from BOT_E2E_NODE_MODULES (a node_modules holding discord.js),
discordgo from BOT_E2E_GOPATH (a module directory that requires it).
"""
import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

# a bot library's ids are Nexa's plus this (internal/botproto)
OFFSET = (1767225600000 - 1420070400000) << 22


def nexa_id(v):
    n = int(v)
    return str(n - OFFSET if n >= OFFSET else n)


def bot_id(v):
    n = int(v)
    return str(n + OFFSET if n < OFFSET else n)


class API:
    """Nexa's own API, as a signed-in person."""

    def __init__(self, base, token):
        self.base, self.token = base, token

    def call(self, method, path, body=None, expect=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.token)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            raw, status = e.read(), e.code
        try:
            out = json.loads(raw) if raw else None
        except ValueError:
            out = raw.decode(errors="replace")
        if expect is not None and status != expect:
            raise AssertionError(f"{method} {path}: {status} {out}")
        return status, out


class Bot:
    """A bot process whose JSON lines are read as they come."""

    def __init__(self, name, argv, cwd=None, env=None):
        self.name = name
        self.lines = queue.Queue()
        self.log = []
        self.proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            line = line.rstrip("\n")
            self.log.append(line)
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if isinstance(ev, dict) and "kind" in ev:
                self.lines.put(ev)

    def wait(self, kind, timeout=30):
        """The next line of a kind, failing on an error line or a timeout."""
        end = time.time() + timeout
        while time.time() < end:
            try:
                ev = self.lines.get(timeout=max(0.1, end - time.time()))
            except queue.Empty:
                break
            if ev["kind"] == "error":
                raise AssertionError(f"{self.name}: {ev}")
            if ev["kind"] == kind:
                return ev
        tail = "\n".join(self.log[-40:])
        raise AssertionError(f"{self.name}: no {kind!r} within {timeout}s; last output:\n{tail}")

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def check(cond, what):
    if not cond:
        raise AssertionError(what)
    print("  ok:", what)


def setup(base, alice, bob, out):
    """alice's server, bob in it, and an application whose bot is in it."""
    a = API(base, alice.page.evaluate("localStorage.getItem('ec.token')"))
    b = API(base, bob.page.evaluate("localStorage.getItem('ec.token')"))
    _, srv = a.call("POST", "/api/v1/servers", {"name": "Bot Lab"}, expect=201)
    server = srv.get("server", srv)
    sid = server["id"]
    _, chans = a.call("GET", f"/api/v1/servers/{sid}/channels", expect=200)
    general = next(c for c in chans if c["name"] == "general")
    _, inv = a.call("POST", f"/api/v1/channels/{general['id']}/invites", {}, expect=201)
    code = inv["code"]
    st, _ = b.call("POST", f"/api/v1/invites/{code}")
    check(st in (200, 201), "bob joins the server")
    _, made = a.call("POST", "/api/v1/applications", {"name": "Lab Bot"}, expect=200)
    app, token = made["application"], made["token"]
    check(token.count(".") == 2, "a bot token comes back once, shaped as libraries expect")
    a.call("PATCH", f"/api/v1/applications/{app['id']}", {"intents": {"presence": True, "members": True, "message_content": True},
                                                       "description": "A bot for testing"}, expect=200)
    query = f"client_id={app['protocol_id']}&scope=bot%20applications.commands&permissions=8"
    _, info = a.call("GET", f"/api/v1/oauth2/authorize?{query}", expect=200)
    check(any(s["id"] == sid for s in info["servers"]), "the consent screen offers alice's server")
    _, done = a.call("POST", "/api/v1/oauth2/authorize", {"query": query, "guild_id": sid}, expect=200)
    check(done["location"] is None, "adding the bot needs no redirect")
    _, members = a.call("GET", f"/api/v1/servers/{sid}/members?limit=100", expect=200)
    check(any(m["user_id"] == app["id"] for m in members["members"]), "the bot is a member of the server")
    return a, b, sid, general["id"], app, token


def interact(api, payload, expect=200):
    st, res = api.call("POST", "/api/v1/interactions", payload)
    if st != expect:
        raise AssertionError(f"interaction {payload.get('type')}: {st} {res}")
    return res


def commands_for(api, channel):
    _, res = api.call("GET", f"/api/v1/channels/{channel}/commands", expect=200)
    return {c["name"]: c for c in res["commands"]}, res


def exercise(lib, bot, a, b, sid, general, app):
    """What every library's bot is put through: its own steps, then bob using it."""
    ready = bot.wait("ready", 60)
    check(nexa_id(ready["id"]) == app["id"], f"{lib}: the bot is told who it is")
    check(nexa_id(sid) in [nexa_id(g) for g in ready["guilds"]], f"{lib}: the bot is told of its server")
    guild = bot.wait("guild", 30)
    check("general" in guild["channels"], f"{lib}: the server comes with its channels")
    synced = bot.wait("synced", 30)
    check({"ping", "echo", "slow", "fruit", "form"} <= set(synced["names"]), f"{lib}: the commands are registered")
    sent = bot.wait("sent", 30)
    msg = nexa_id(sent["message"])
    fetched = bot.wait("fetched", 30)
    check(fetched["content"] == "hello, edited", f"{lib}: an edit reads back")
    check(fetched["embeds"] == 1 and fetched["components"] >= 1, f"{lib}: embeds and components read back")
    check(fetched["reactions"], f"{lib}: its reaction reads back")
    bot.wait("history", 30)
    bot.wait("role", 30)
    bot.wait("thread", 30)
    pins = bot.wait("pins", 30)
    check(pins["count"] >= 1, f"{lib}: a pin lists")
    bot.wait("steps_done", 30)
    # what the bot sent, as people see it
    _, msgs = a.call("GET", f"/api/v1/channels/{general}/messages?limit=20", expect=200)
    mine = next((m for m in msgs if m["id"] == msg), None)
    check(mine is not None and mine.get("webhook") and mine["author_id"] == app["id"], f"{lib}: people see the bot's message, under the bot")
    check(mine["webhook"]["content"] == "hello, edited", f"{lib}: and its words, as edited")
    # bob uses the slash commands
    cmds, listed = commands_for(b, general)
    check({"ping", "echo", "slow", "fruit", "form", "Inspect", "Quote"} <= set(cmds), f"{lib}: bob is offered its commands and menu entries")
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["ping"]["id"], "options": []}})
    check(res["type"] == 4 and res["message"]["webhook"]["content"] == "pong", f"{lib}: /ping answers pong")
    ping = bot.wait("ping", 15)
    check(nexa_id(ping["message"]) == res["message"]["id"], f"{lib}: the answer is the interaction's original response")
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["echo"]["id"], "options": [{"name": "text", "value": "hi"}, {"name": "times", "value": 3}]}})
    check(res["type"] == 4 and res["message"]["flags"] & 64 and res["message"]["webhook"]["content"] == "hi hi hi", f"{lib}: /echo answers only bob")
    st, bad = b.call("POST", "/api/v1/interactions", {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["echo"]["id"], "options": [{"name": "text", "value": "x"}, {"name": "times", "value": 9}]}})
    check(st == 400, f"{lib}: an option out of its range is refused")
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["slow"]["id"], "options": []}})
    check(res["type"] == 5 and res["message"]["flags"] & 128, f"{lib}: /slow thinks first")
    bot.wait("slow", 15)
    _, after = a.call("GET", f"/api/v1/channels/{general}/messages/{res['message']['id']}", expect=200)
    check(after["webhook"]["content"] == "thought about it" and not after["flags"] & 128, f"{lib}: the thinking message is filled in")
    res = interact(b, {"type": 4, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["fruit"]["id"], "options": [{"name": "name", "value": "ap", "focused": True}]}})
    check(res["type"] == 8 and [c["value"] for c in res["choices"]] == ["apple", "apricot"], f"{lib}: autocomplete suggests")
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["form"]["id"], "options": []}})
    check(res["type"] == 9 and res["modal"]["title"] == "Tell Me", f"{lib}: /form opens a form")
    field = res["modal"]["components"][0]["component"]["custom_id"]
    sub = interact(b, {"type": 5, "application_id": app["id"], "channel_id": general, "modal_of": res["id"], "data": {"custom_id": res["modal"]["custom_id"], "fields": [{"custom_id": field, "value": "forty two"}]}})
    check(sub["type"] == 4 and sub["message"]["webhook"]["content"] == "form said forty two", f"{lib}: the form's answer reaches the bot")
    # the menus of a person and of a message
    _, me_b = b.call("GET", "/api/v1/users/@me", expect=200)
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["Inspect"]["id"], "target_id": me_b["id"]}})
    check(res["type"] == 4 and "that is bob" in res["message"]["webhook"]["content"], f"{lib}: a person's menu entry works")
    res = interact(b, {"type": 2, "application_id": app["id"], "channel_id": general, "data": {"id": cmds["Quote"]["id"], "target_id": msg}})
    check(res["type"] == 4 and "hello, edited" in res["message"]["webhook"]["content"], f"{lib}: a message's menu entry reads the message")
    # the button and the select menu on the bot's message
    res = interact(b, {"type": 3, "application_id": app["id"], "channel_id": general, "message_id": msg, "data": {"custom_id": "press", "component_type": 2}})
    check(res["type"] == 7 and res["message"]["webhook"]["content"] == "pressed by bob", f"{lib}: a button press edits the message")
    res = interact(b, {"type": 3, "application_id": app["id"], "channel_id": general, "message_id": msg, "data": {"custom_id": "pick", "component_type": 3, "values": ["blue"]}})
    check(res["type"] == 4 and "picked blue" in res["message"]["webhook"]["content"], f"{lib}: a select menu pick reaches the bot")
    st, _ = b.call("POST", "/api/v1/interactions", {"type": 3, "application_id": app["id"], "channel_id": general, "message_id": msg, "data": {"custom_id": "pick", "component_type": 3, "values": ["green"]}})
    check(st == 400, f"{lib}: a pick that is not on the menu is refused")


def message_content(lib, bot, alice, bob, base, sid, general):
    """A bot holding Message Content reads what people type: their apps hand it
    the server's keys, and the server opens their messages for it."""
    for sess in (alice, bob):
        sess.page.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        sess.dismiss_whats_new()
    # give the members' apps a moment to hand the bot its keys
    time.sleep(3)
    bob.send("!hello")
    seen = bot.wait("message", 30)
    check(seen["content"] == "!hello", f"{lib}: the bot reads what bob typed")
    b = API(base, bob.page.evaluate("localStorage.getItem('ec.token')"))
    reply = None
    for _ in range(50):
        _, msgs = b.call("GET", f"/api/v1/channels/{general}/messages?limit=10", expect=200)
        reply = next((m for m in msgs if (m.get("webhook") or {}).get("content") == "hello back"), None)
        if reply:
            break
        time.sleep(0.2)
    check(reply is not None and reply["reply_to_id"] == nexa_id(seen["id"]), f"{lib}: its reply answers bob's message")
    bob.wait_text("hello back")
    check(True, f"{lib}: and bob sees it")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--only", choices=["dpy", "js", "go"])
    args = ap.parse_args()
    out = ROOT / "tools/out/bot-e2e"
    out.mkdir(parents=True, exist_ok=True)
    srv = Server(keep=args.keep)
    failed = False
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            alice = Session(browser, srv.base, "alice", out)
            alice.register()
            bob = Session(browser, srv.base, "bob", out)
            bob.register()
            a, b, sid, general, app, token = setup(srv.base, alice, bob, out)
            libs = []
            py = os.environ.get("BOT_E2E_PYTHON")
            if py and args.only in (None, "dpy"):
                libs.append(("discord.py", [py, str(ROOT / "tools/bots/dpy_bot.py"), srv.base, token, bot_id(sid)], None, None))
            nm = os.environ.get("BOT_E2E_NODE_MODULES")
            if nm and args.only in (None, "js"):
                env = dict(os.environ, NODE_PATH=nm)
                libs.append(("discord.js", ["node", str(ROOT / "tools/bots/djs_bot.js"), srv.base, token, bot_id(sid)], None, env))
            gp = os.environ.get("BOT_E2E_GOPATH")
            if gp and args.only in (None, "go"):
                # the bot's source is kept out of this module's builds by its
                # build tag; it runs from the module that requires discordgo
                src = (ROOT / "tools/bots/dgo_bot.go").read_text().replace("//go:build ignore\n", "", 1)
                (Path(gp) / "main.go").write_text(src)
                build = subprocess.run(["go", "build", "-o", "dgo_bot", "."], cwd=gp, capture_output=True, text=True)
                if build.returncode != 0:
                    print(build.stdout, build.stderr)
                    return 1
                libs.append(("discordgo", [str(Path(gp) / "dgo_bot"), srv.base, token, bot_id(sid)], gp, None))
            if not libs:
                print("no library to test: set BOT_E2E_PYTHON, BOT_E2E_NODE_MODULES or BOT_E2E_GOPATH")
                return 2
            for i, (name, argv, cwd, env) in enumerate(libs):
                print(f"== {name}")
                if i:
                    # bob uses each library's bot as fast as a script can, and a
                    # person may use apps 20 times at once, then once a second
                    # (limInteract): let his allowance fill again first
                    time.sleep(20)
                bot = Bot(name, argv, cwd, env)
                try:
                    exercise(name, bot, a, b, sid, general, app)
                    if name == "discord.py":
                        message_content(name, bot, alice, bob, srv.base, sid, general)
                except AssertionError as e:
                    failed = True
                    print(f"FAIL {name}: {e}")
                    print("\n".join(bot.log[-60:]))
                finally:
                    bot.stop()
            browser.close()
    finally:
        if failed or args.keep:
            print("server log:", srv.dir / "chatd.log")
        srv.keep = srv.keep or failed
        srv.stop()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
