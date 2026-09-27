#!/usr/bin/env python3
"""Phase-1 check of Nexa's bot API with an unmodified discord.py (2.3 or newer).

It logs in, waits for on_ready, then drives one text channel through what a
basic bot does: send, see its own MESSAGE_CREATE, reply, edit, type, read
history, fetch, delete. With NEXA_WAIT_HUMAN set it also waits for a person to
type "!ping" and answers "pong", which proves MESSAGE_CREATE arrives with the
content of somebody else's message. Every check prints one PASS or FAIL line;
the exit status is 0 only when nothing failed.

Environment:
  NEXA_API            REST base with the version, e.g. http://127.0.0.1:1234/api/v10   (required)
  NEXA_TOKEN          the bot's token                                                   (required)
  NEXA_GATEWAY        gateway URL; default: what GET {NEXA_API}/gateway returns, else
                      ws(s)://<host of NEXA_API>/gateway/bot
  NEXA_CHANNEL        id of a text channel to test in; default: the first one the bot can
                      send messages in
  NEXA_WAIT_HUMAN     seconds to wait for someone to type "!ping" (default 0: skip)
  NEXA_TIMEOUT        seconds allowed for each step (default 20)
  NEXA_EPOCH          snowflake epoch in ms (default 1767225600000, Nexa's; Discord's is 1420070400000)
  NEXA_CONTENT_INTENT 1 to ask for the message content intent (default 1)
  NEXA_BURST          send this many messages at once to exercise 429 handling (default 0)
  NEXA_CDN            base for avatar/icon URLs, e.g. https://chat.evilion.xyz/cdn (optional)

Pointing discord.py somewhere else takes two assignments, both made before the
client is created (Route builds its URL from Route.BASE when it is made, and
since 2.3 the gateway URL is DiscordWebSocket.DEFAULT_GATEWAY: discord.py no
longer asks GET /gateway, and it falls back to that URL after
INVALID_SESSION and after a failed resume).
"""
from __future__ import annotations

import asyncio
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

import discord
import yarl
from discord.gateway import DiscordWebSocket

API = os.environ.get("NEXA_API", "").rstrip("/")
TOKEN = os.environ.get("NEXA_TOKEN", "").strip()
TIMEOUT = float(os.environ.get("NEXA_TIMEOUT", "20"))
WAIT_HUMAN = float(os.environ.get("NEXA_WAIT_HUMAN", "0"))
EPOCH = int(os.environ.get("NEXA_EPOCH", "1767225600000"))
CONTENT_INTENT = os.environ.get("NEXA_CONTENT_INTENT", "1") == "1"
BURST = int(os.environ.get("NEXA_BURST", "0"))
CHANNEL_ID = int(os.environ["NEXA_CHANNEL"]) if os.environ.get("NEXA_CHANNEL") else None

results: list[tuple[bool, str]] = []


def report(ok: bool, what: str, detail: str = "") -> bool:
    results.append((ok, what))
    print(f"{'PASS' if ok else 'FAIL'} {what}{(': ' + detail) if detail else ''}", flush=True)
    return ok


def info(msg: str) -> None:
    print(f"INFO {msg}", flush=True)


def gateway_url() -> str:
    if os.environ.get("NEXA_GATEWAY"):
        return os.environ["NEXA_GATEWAY"]
    try:
        # GET /gateway takes no token on Discord either
        with urllib.request.urlopen(API + "/gateway", timeout=10) as res:
            return json.load(res)["url"]
    except Exception as exc:  # noqa: BLE001 - any failure falls back to the default path
        u = urllib.parse.urlsplit(API)
        guess = f"{'wss' if u.scheme == 'https' else 'ws'}://{u.netloc}/gateway/bot"
        info(f"GET /gateway failed ({exc!r}); using {guess}")
        return guess


def point_discord_py_at_nexa() -> str:
    discord.http.Route.BASE = API
    gw = gateway_url()
    DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL(gw)
    # created_at and time-based history paging read the epoch at call time
    discord.utils.DISCORD_EPOCH = EPOCH
    if os.environ.get("NEXA_CDN"):
        discord.asset.Asset.BASE = os.environ["NEXA_CDN"].rstrip("/")
    return gw


class TestBot(discord.Client):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.message_content = CONTENT_INTENT
        super().__init__(intents=intents)
        self.pongs = 0
        self.done = asyncio.Event()

    async def setup_hook(self) -> None:
        # login() has run: GET /users/@me and GET /oauth2/applications/@me succeeded
        report(self.user is not None and self.user.bot, "login (GET /users/@me)", f"{self.user} id={self.user.id if self.user else '?'} bot={getattr(self.user, 'bot', None)}")
        report(self.application_id is not None, "application (GET /oauth2/applications/@me)", f"application_id={self.application_id}")
        asyncio.create_task(self.watchdog())

    async def watchdog(self) -> None:
        try:
            await asyncio.wait_for(self.wait_until_ready(), timeout=TIMEOUT + 5)
        except asyncio.TimeoutError:
            report(False, "on_ready", f"not reached within {TIMEOUT + 5:.0f}s (HELLO, IDENTIFY, READY, GUILD_CREATE?)")
            await self.close()

    async def on_ready(self) -> None:
        guilds = ", ".join(f"{g.name} ({len(g.channels)} channels, me={'yes' if g.me else 'MISSING'})" for g in self.guilds)
        report(True, "on_ready", f"{len(self.guilds)} server(s): {guilds or '-'}; latency={self.latency * 1000:.0f}ms")
        report(all(g.me is not None for g in self.guilds), "GUILD_CREATE includes the bot's own member (guild.me)")
        try:
            await self.checks()
        except Exception as exc:  # noqa: BLE001 - report and stop instead of hanging
            report(False, "unexpected error", repr(exc))
        finally:
            self.done.set()
            await self.close()

    def pick_channel(self) -> discord.TextChannel | None:
        if CHANNEL_ID is not None:
            ch = self.get_channel(CHANNEL_ID)
            return ch if isinstance(ch, discord.TextChannel) else None
        for g in self.guilds:
            for ch in g.text_channels:
                if g.me and ch.permissions_for(g.me).send_messages:
                    return ch
        return None

    async def expect(self, event: str, check, what: str):
        try:
            return await self.wait_for(event, check=check, timeout=TIMEOUT)
        except asyncio.TimeoutError:
            report(False, what, f"no {event} within {TIMEOUT:.0f}s")
            return None

    async def checks(self) -> None:
        ch = self.pick_channel()
        if not report(ch is not None, "a text channel to test in", f"#{ch.name} ({ch.id})" if ch else "set NEXA_CHANNEL or add the bot to a server"):
            return
        me = self.user
        assert me is not None

        # 1. send, and see our own MESSAGE_CREATE come back over the gateway
        text = f"nexa test-bot {datetime.datetime.now(datetime.timezone.utc):%H:%M:%S} <@{me.id}>"
        echo = asyncio.ensure_future(self.expect("message", lambda m: m.author.id == me.id and m.content == text, "MESSAGE_CREATE for our own message"))
        sent = await ch.send(text)
        report(sent.content == text and sent.author.id == me.id, "POST /channels/{id}/messages", f"id={sent.id}")
        report(any(u.id == me.id for u in sent.mentions), "server fills mentions from <@id> in content", f"mentions={[u.id for u in sent.mentions]}")
        got = await echo
        if got is not None:
            report(got.id == sent.id, "MESSAGE_CREATE for our own message", f"id={got.id}")
            report(got.guild is not None and got.channel.id == ch.id, "MESSAGE_CREATE has guild_id and channel_id")
        age = abs((datetime.datetime.now(datetime.timezone.utc) - sent.created_at).total_seconds())
        report(age < 300, "snowflake epoch (message.created_at is now)", f"off by {age:.0f}s")

        # 2. reply (message_reference), edit (MESSAGE_UPDATE)
        reply = await sent.reply("reply test", mention_author=False)
        report(reply.reference is not None and reply.reference.message_id == sent.id, "reply (message_reference)", f"type={reply.type}")
        edited = asyncio.ensure_future(self.expect("raw_message_edit", lambda p: p.message_id == reply.id, "MESSAGE_UPDATE after edit"))
        reply = await reply.edit(content="reply test (edited)")
        report(reply.content == "reply test (edited)" and reply.edited_at is not None, "PATCH /channels/{id}/messages/{id}")
        if await edited is not None:
            report(True, "MESSAGE_UPDATE after edit")

        # 3. typing, history, fetch
        await ch.typing()
        report(True, "POST /channels/{id}/typing")
        history = [m async for m in ch.history(limit=20)]
        report(any(m.id == sent.id for m in history), "GET /channels/{id}/messages (history)", f"{len(history)} message(s)")
        fetched = await ch.fetch_message(sent.id)
        report(fetched.content == text, "GET /channels/{id}/messages/{id}")

        # 4. delete (MESSAGE_DELETE)
        deleted = asyncio.ensure_future(self.expect("raw_message_delete", lambda p: p.message_id == reply.id, "MESSAGE_DELETE after delete"))
        await reply.delete()
        report(True, "DELETE /channels/{id}/messages/{id}")
        if await deleted is not None:
            report(True, "MESSAGE_DELETE after delete")

        # 5. optional: a burst, which should be paced by 429 answers rather than fail
        if BURST > 0:
            try:
                burst = await asyncio.gather(*(ch.send(f"burst {i + 1}/{BURST}") for i in range(BURST)))
                report(len(burst) == BURST, f"{BURST} messages at once (429 handled by waiting)")
                for m in burst:
                    await m.delete()
            except discord.HTTPException as exc:
                report(False, f"{BURST} messages at once", f"{exc.status} {exc.text!r} (a 429 needs a Via header and a JSON retry_after)")

        # 6. optional: a person's message, with content
        if WAIT_HUMAN > 0:
            info(f"type !ping in #{ch.name} within {WAIT_HUMAN:.0f}s")
            try:
                await self.wait_for("message", check=lambda m: m.channel.id == ch.id and not m.author.bot and m.content.startswith("!ping"), timeout=WAIT_HUMAN)
                await asyncio.sleep(0.5)  # on_message answers it
                report(self.pongs > 0, "a person's MESSAGE_CREATE arrives with content, and the bot answers")
            except asyncio.TimeoutError:
                report(False, "a person's MESSAGE_CREATE", f"no !ping within {WAIT_HUMAN:.0f}s" + ("" if CONTENT_INTENT else " (content intent is off, so content is empty)"))
        await sent.delete()

    async def on_message(self, message: discord.Message) -> None:
        # the whole of a basic bot
        if message.author.bot:
            return
        if message.content.startswith("!ping"):
            await message.channel.send("pong")
            self.pongs += 1


async def main() -> int:
    if not API or not TOKEN:
        print(__doc__)
        print("FAIL configuration: set NEXA_API and NEXA_TOKEN")
        return 2
    gw = point_discord_py_at_nexa()
    info(f"discord.py {discord.__version__}; REST {discord.http.Route.BASE}; gateway {DiscordWebSocket.DEFAULT_GATEWAY}; epoch {EPOCH}")
    if gw.startswith("wss://gateway.discord.gg"):
        report(False, "gateway URL", "GET /gateway pointed back at Discord")
        return 1
    bot = TestBot()
    try:
        async with bot:
            await bot.start(TOKEN, reconnect=False)
    except discord.LoginFailure:
        report(False, "login", "401 from GET /users/@me: the token was refused")
    except discord.PrivilegedIntentsRequired:
        report(False, "IDENTIFY", "closed with 4014: turn on Message Content for this bot, or set NEXA_CONTENT_INTENT=0")
    except discord.ConnectionClosed as exc:
        if not bot.done.is_set():
            report(False, "gateway", f"closed with {exc.code} {exc.reason!r}")
    except discord.HTTPException as exc:
        report(False, "REST", f"{exc.status} {exc.text!r}")
    except Exception as exc:  # noqa: BLE001
        if not bot.done.is_set():
            report(False, "startup", repr(exc))
    failed = [w for ok, w in results if not ok]
    print(f"{'PASS' if not failed and results else 'FAIL'} summary: {len(results) - len(failed)} passed, {len(failed)} failed", flush=True)
    return 0 if results and not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
