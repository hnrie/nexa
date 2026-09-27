#!/usr/bin/env python3
"""A throwaway stand-in for Nexa's planned bot API (aiohttp).

It implements exactly the minimal contract in discordpy-startup.md: the three
REST calls discord.py makes before connecting, the gateway handshake, READY
and one GUILD_CREATE, MESSAGE_CREATE/UPDATE/DELETE, and the message routes
test-bot.py uses. It is an executable form of that document, for checking
discord.py against it without a Nexa build; it is not Nexa code.

    python3 mock-nexa.py --port 1234 [--human-ping 3] [--rl-every 0] [--no-via]

--human-ping N   N seconds after READY, "alice" posts "!ping" in #general
--rl-every N     answer every Nth message POST with a 429 (tests retry handling)
--no-via         send that 429 without a Via header (discord.py then raises)
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import secrets
import time

from aiohttp import WSMsgType, web

NEXA_EPOCH = 1767225600000  # internal/ids: 2026-01-01T00:00:00Z
_seq_lock = 0


def new_id() -> str:
    global _seq_lock
    _seq_lock = (_seq_lock + 1) & 0xFFF
    return str(((int(time.time() * 1000) - NEXA_EPOCH) << 22) | _seq_lock)


def iso(ms: int | None = None) -> str:
    t = dt.datetime.fromtimestamp((ms or time.time() * 1000) / 1000, dt.timezone.utc)
    return t.isoformat(timespec="microseconds")


TOKEN = "Mjk.test-token"
BOT = {"id": new_id(), "username": "testbot", "discriminator": "0", "global_name": "Test Bot", "avatar": None,
       "bot": True, "system": False, "public_flags": 0, "flags": 0, "banner": None, "accent_color": None}
OWNER = {"id": new_id(), "username": "nora", "discriminator": "0", "global_name": "Nora", "avatar": None,
         "public_flags": 0, "flags": 0}
ALICE = {"id": new_id(), "username": "alice", "discriminator": "0", "global_name": "Alice", "avatar": None,
         "public_flags": 0, "flags": 0}
GUILD_ID = new_id()
BOT_ROLE = new_id()
CHANNEL_ID = new_id()
CATEGORY_ID = new_id()
PERMS_EVERYONE = str((1 << 10) | (1 << 11) | (1 << 16) | (1 << 6) | (1 << 14) | (1 << 15))
PERMS_BOT = str((1 << 10) | (1 << 11) | (1 << 13) | (1 << 16))
MESSAGE_CONTENT = 1 << 15
MEMBERS = 1 << 1
PRESENCES = 1 << 8

messages: dict[str, dict] = {}  # id -> message object, #general only
sessions: set = set()
state = {"posts": 0}


def member_obj(user: dict, roles: list[str], with_user: bool = True) -> dict:
    m = {"roles": roles, "joined_at": iso(), "deaf": False, "mute": False, "flags": 0, "pending": False,
         "nick": None, "avatar": None, "banner": None, "premium_since": None, "communication_disabled_until": None}
    if with_user:
        m["user"] = user
    return m


def role(id_: str, name: str, perms: str, position: int, bot_id: str | None = None) -> dict:
    r = {"id": id_, "name": name, "permissions": perms, "position": position, "color": 0,
         "colors": {"primary_color": 0, "secondary_color": None, "tertiary_color": None}, "hoist": False,
         "managed": bot_id is not None, "mentionable": False, "icon": None, "unicode_emoji": None, "flags": 0}
    if bot_id:
        r["tags"] = {"bot_id": bot_id}
    return r


def channel_obj(with_guild: bool = True) -> dict:
    c = {"id": CHANNEL_ID, "type": 0, "name": "general", "position": 0, "parent_id": CATEGORY_ID, "topic": None,
         "nsfw": False, "rate_limit_per_user": 0, "last_message_id": None, "permission_overwrites": [], "flags": 0}
    if with_guild:
        c["guild_id"] = GUILD_ID
    return c


def guild_create() -> dict:
    return {
        "id": GUILD_ID, "name": "Test Server", "icon": None, "banner": None, "splash": None, "discovery_splash": None,
        "description": None, "owner_id": OWNER["id"], "afk_channel_id": None, "afk_timeout": 300,
        "verification_level": 0, "default_message_notifications": 0, "explicit_content_filter": 0, "mfa_level": 0,
        "nsfw_level": 0, "premium_tier": 0, "premium_subscription_count": 0, "preferred_locale": "en-US",
        "system_channel_id": CHANNEL_ID, "system_channel_flags": 0, "rules_channel_id": None,
        "public_updates_channel_id": None, "safety_alerts_channel_id": None, "features": [],
        "vanity_url_code": None, "premium_progress_bar_enabled": False, "nsfw": False,
        "unavailable": False, "large": False, "joined_at": iso(), "member_count": 3,
        "roles": [role(GUILD_ID, "@everyone", PERMS_EVERYONE, 0), role(BOT_ROLE, "Test Bot", PERMS_BOT, 1, BOT["id"])],
        "emojis": [], "stickers": [], "soundboard_sounds": [],
        "channels": [
            {"id": CATEGORY_ID, "type": 4, "name": "Text Channels", "position": 0, "parent_id": None,
             "nsfw": False, "permission_overwrites": [], "flags": 0},
            channel_obj(with_guild=False),
        ],
        "threads": [], "voice_states": [], "presences": [], "stage_instances": [], "guild_scheduled_events": [],
        # the bot's own member is always included (guild.me); the rest only with the members intent
        "members": [member_obj(BOT, [BOT_ROLE]), member_obj(OWNER, []), member_obj(ALICE, [])],
    }


def message_obj(author: dict, content: str, *, roles=None, nonce=None, reference=None, mentions=None) -> dict:
    mid = new_id()
    m = {"id": mid, "channel_id": CHANNEL_ID, "guild_id": GUILD_ID, "author": author,
         "member": member_obj(author, roles or [], with_user=False), "content": content, "timestamp": iso(),
         "edited_timestamp": None, "tts": False, "mention_everyone": False, "mentions": mentions or [],
         "mention_roles": [], "attachments": [], "embeds": [], "reactions": [], "pinned": False,
         "type": 19 if reference else 0, "flags": 0, "components": []}
    if nonce is not None:
        m["nonce"] = nonce
    if reference:
        m["message_reference"] = {"type": 0, "message_id": reference, "channel_id": CHANNEL_ID, "guild_id": GUILD_ID}
        m["referenced_message"] = messages.get(reference)
    return m


def for_session(msg: dict, sess) -> dict:
    """What one bot session sees of a message: no content without the intent."""
    if sess.intents & MESSAGE_CONTENT or msg["author"]["id"] == BOT["id"] or any(u["id"] == BOT["id"] for u in msg["mentions"]):
        return msg
    return {**msg, "content": "", "embeds": [], "attachments": [], "components": []}


def dj(data, status=200, headers=None):
    # exactly "application/json": discord.py compares the header as a whole
    # string, and aiohttp's content_type= would add "; charset=utf-8", which
    # makes every answer arrive as text (TypeError: string indices must be
    # integers, on the first call)
    h = {"Content-Type": "application/json", **(headers or {})}
    return web.Response(status=status, body=json.dumps(data).encode(), headers=h)


def derr(status, code, message):
    return dj({"message": message, "code": code}, status)


class Session:
    def __init__(self, ws):
        self.ws = ws
        self.seq = 0
        self.intents = 0
        self.id = secrets.token_hex(16)

    async def dispatch(self, t, d):
        self.seq += 1
        await self.ws.send_str(json.dumps({"op": 0, "t": t, "s": self.seq, "d": d}))


async def broadcast(t, msg_or_payload, *, message=False):
    for s in list(sessions):
        try:
            await s.dispatch(t, for_session(msg_or_payload, s) if message else msg_or_payload)
        except ConnectionError:
            sessions.discard(s)


# --- REST -------------------------------------------------------------------------

@web.middleware
async def auth_mw(request, handler):
    p = request.path
    # GET /gateway needs no token, and neither does the socket: IDENTIFY carries it
    public = p.endswith("/gateway") or not p.startswith("/api/")
    if not public and request.headers.get("Authorization") != f"Bot {TOKEN}":
        return derr(401, 0, "401: Unauthorized")
    return await handler(request)


async def users_me(r):
    return dj({**BOT, "verified": True, "mfa_enabled": False, "locale": "en-US", "email": None})


async def app_me(r):
    return dj({"id": BOT["id"], "name": "Test Bot", "description": "", "icon": None, "bot_public": False,
               "bot_require_code_grant": False, "owner": OWNER, "team": None, "verify_key": "0" * 64,
               "flags": (1 << 18) | (1 << 14), "interactions_endpoint_url": None, "redirect_uris": [], "tags": [],
               "install_params": {"scopes": ["bot", "applications.commands"], "permissions": PERMS_BOT},
               "approximate_guild_count": 1, "bot": BOT})


def gw_url(r):
    host = r.headers.get("Host", r.host)
    return f"ws://{host}/gateway/bot"


async def gateway(r):
    return dj({"url": gw_url(r)})


async def gateway_bot(r):
    return dj({"url": gw_url(r), "shards": 1, "session_start_limit": {"total": 1000, "remaining": 999,
                                                                        "reset_after": 86400000, "max_concurrency": 1}})


def check_channel(r):
    if r.match_info["cid"] != CHANNEL_ID:
        return derr(404, 10003, "Unknown Channel")
    return None


async def get_channel(r):
    return check_channel(r) or dj(channel_obj())


async def get_guild(r):
    if r.match_info["gid"] != GUILD_ID:
        return derr(404, 10004, "Unknown Guild")
    g = guild_create()
    for k in ("members", "channels", "threads", "voice_states", "presences", "joined_at", "large", "member_count"):
        g.pop(k, None)
    return dj(g)


async def post_message(r):
    if (e := check_channel(r)):
        return e
    state["posts"] += 1
    every = r.app["rl_every"]
    if every and state["posts"] % every == 0:
        headers = {"Retry-After": "1", "X-RateLimit-Limit": "5", "X-RateLimit-Remaining": "0",
                   "X-RateLimit-Reset": f"{time.time() + 0.5:.3f}", "X-RateLimit-Reset-After": "0.500",
                   "X-RateLimit-Bucket": "channel-messages", "X-RateLimit-Scope": "user"}
        if not r.app["no_via"]:
            headers["Via"] = "1.1 nexa"
        return dj({"message": "You are being rate limited.", "retry_after": 0.5, "global": False}, 429, headers)
    if r.content_type.startswith("multipart/"):
        form = await r.post()
        body = json.loads(form["payload_json"])
    else:
        body = await r.json()
    content = body.get("content") or ""
    if not content and not body.get("embeds"):
        return dj({"message": "Cannot send an empty message", "code": 50006}, 400)
    ref = (body.get("message_reference") or {}).get("message_id")
    if ref is not None and str(ref) not in messages:
        return dj({"message": "Invalid Form Body", "code": 50035, "errors": {"message_reference": {"_errors": [
            {"code": "MESSAGE_REFERENCE_UNKNOWN_MESSAGE", "message": "Unknown message"}]}}}, 400)
    # mentions come from the content, as the server works them out
    mentions = [u for u in (BOT, OWNER, ALICE) if f"<@{u['id']}>" in content or f"<@!{u['id']}>" in content]
    m = message_obj(BOT, content, roles=[BOT_ROLE], nonce=body.get("nonce"), reference=str(ref) if ref else None,
                    mentions=mentions)
    messages[m["id"]] = m
    await broadcast("MESSAGE_CREATE", m, message=True)
    return dj(m)


async def list_messages(r):
    if (e := check_channel(r)):
        return e
    limit = min(int(r.query.get("limit", 50)), 100)
    before = int(r.query.get("before", 1 << 62))
    out = sorted((m for m in messages.values() if int(m["id"]) < before), key=lambda m: -int(m["id"]))
    return dj(out[:limit])


async def get_message(r):
    if (e := check_channel(r)):
        return e
    m = messages.get(r.match_info["mid"])
    return dj(m) if m else derr(404, 10008, "Unknown Message")


async def patch_message(r):
    if (e := check_channel(r)):
        return e
    m = messages.get(r.match_info["mid"])
    if not m:
        return derr(404, 10008, "Unknown Message")
    if m["author"]["id"] != BOT["id"]:
        return derr(403, 50005, "Cannot edit a message authored by another user")
    body = await r.json()
    if "content" in body:
        m["content"] = body["content"] or ""
    m["edited_timestamp"] = iso()
    await broadcast("MESSAGE_UPDATE", m, message=True)
    return dj(m)


async def delete_message(r):
    if (e := check_channel(r)):
        return e
    m = messages.pop(r.match_info["mid"], None)
    if not m:
        return derr(404, 10008, "Unknown Message")
    await broadcast("MESSAGE_DELETE", {"id": m["id"], "channel_id": CHANNEL_ID, "guild_id": GUILD_ID})
    return web.Response(status=204)


async def typing(r):
    if (e := check_channel(r)):
        return e
    await broadcast("TYPING_START", {"channel_id": CHANNEL_ID, "guild_id": GUILD_ID, "user_id": BOT["id"],
                                     "timestamp": int(time.time()), "member": member_obj(BOT, [BOT_ROLE])})
    return web.Response(status=204)


async def not_found(r):
    return derr(404, 0, "404: Not Found")


# --- gateway ----------------------------------------------------------------------

async def human_ping(delay):
    await asyncio.sleep(delay)
    m = message_obj(ALICE, "!ping")
    messages[m["id"]] = m
    await broadcast("MESSAGE_CREATE", m, message=True)


async def gateway_ws(r):
    ws = web.WebSocketResponse(heartbeat=None, autoping=True)
    await ws.prepare(r)
    q = r.query
    print(f"gateway: connect v={q.get('v')} encoding={q.get('encoding')} compress={q.get('compress')}")
    sess = Session(ws)
    await ws.send_str(json.dumps({"op": 10, "d": {"heartbeat_interval": 41250}, "s": None, "t": None}))
    identified = False
    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        f = json.loads(msg.data)
        op, d = f.get("op"), f.get("d")
        if op == 1:
            await ws.send_str(json.dumps({"op": 11, "d": None, "s": None, "t": None}))
        elif op == 2 and not identified:
            if d.get("token") != TOKEN:
                await ws.close(code=4004, message=b"Authentication failed.")
                break
            sess.intents = int(d.get("intents") or 0)
            print(f"gateway: IDENTIFY intents={sess.intents} properties={d.get('properties')} "
                  f"presence={d.get('presence')} shard={d.get('shard')}")
            if sess.intents & (MEMBERS | PRESENCES) and r.app["deny_privileged"]:
                await ws.close(code=4014, message=b"Disallowed intent(s).")
                break
            identified = True
            sessions.add(sess)
            await sess.dispatch("READY", {
                "v": 10, "user": {**BOT, "verified": True, "mfa_enabled": False},
                "guilds": [{"id": GUILD_ID, "unavailable": True}], "session_id": sess.id,
                "resume_gateway_url": gw_url(r), "application": {"id": BOT["id"], "flags": (1 << 18) | (1 << 14)},
                "private_channels": [], "relationships": [], "presences": [], "guild_join_requests": [],
                "geo_ordered_rtc_regions": [], "user_settings": {}, "shard": [0, 1], "_trace": ["mock-nexa"]})
            await sess.dispatch("GUILD_CREATE", guild_create())
            if r.app["human_ping"]:
                asyncio.ensure_future(human_ping(r.app["human_ping"]))
        elif op == 6:
            # no replay buffer: tell the client to identify afresh
            await ws.send_str(json.dumps({"op": 9, "d": False, "s": None, "t": None}))
        elif op == 3:
            print(f"gateway: PRESENCE {d}")
        elif op == 8:
            members = [member_obj(u, [BOT_ROLE] if u is BOT else []) for u in (BOT, OWNER, ALICE)]
            await sess.dispatch("GUILD_MEMBERS_CHUNK", {"guild_id": d["guild_id"], "members": members,
                                                         "chunk_index": 0, "chunk_count": 1, "not_found": [],
                                                         "nonce": d.get("nonce")})
        elif not identified:
            await ws.close(code=4003, message=b"Not authenticated.")
            break
    sessions.discard(sess)
    return ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=1234)
    ap.add_argument("--human-ping", type=float, default=0)
    ap.add_argument("--rl-every", type=int, default=0)
    ap.add_argument("--no-via", action="store_true")
    ap.add_argument("--deny-privileged", action="store_true")
    a = ap.parse_args()
    app = web.Application(middlewares=[auth_mw])
    app["human_ping"], app["rl_every"], app["no_via"], app["deny_privileged"] = a.human_ping, a.rl_every, a.no_via, a.deny_privileged
    for v in ("/api/v10", "/api/v9"):
        app.router.add_get(v + "/users/@me", users_me)
        app.router.add_get(v + "/oauth2/applications/@me", app_me)
        app.router.add_get(v + "/applications/@me", app_me)
        app.router.add_get(v + "/gateway", gateway)
        app.router.add_get(v + "/gateway/bot", gateway_bot)
        app.router.add_get(v + "/guilds/{gid}", get_guild)
        app.router.add_get(v + "/channels/{cid}", get_channel)
        app.router.add_post(v + "/channels/{cid}/messages", post_message)
        app.router.add_get(v + "/channels/{cid}/messages", list_messages)
        app.router.add_get(v + "/channels/{cid}/messages/{mid}", get_message)
        app.router.add_patch(v + "/channels/{cid}/messages/{mid}", patch_message)
        app.router.add_delete(v + "/channels/{cid}/messages/{mid}", delete_message)
        app.router.add_post(v + "/channels/{cid}/typing", typing)
    app.router.add_get("/gateway/bot", gateway_ws)
    app.router.add_route("*", "/{tail:.*}", not_found)
    print(f"mock-nexa on http://127.0.0.1:{a.port}  token={TOKEN}  channel={CHANNEL_ID}  bot={BOT['id']}")
    web.run_app(app, host="127.0.0.1", port=a.port, print=None)


if __name__ == "__main__":
    main()
