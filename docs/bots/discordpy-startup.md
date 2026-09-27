# discord.py against Nexa: the minimal startup contract

What a Nexa server must answer for `discord.Client.run(token)` to reach `on_ready`, receive one
`on_message`, and answer it with `channel.send()`. Checked against discord.py master (2.8.0a,
commit 65232c3) and the 2.7.1 release; the gateway URL handling below is the same in 2.3.2, 2.4.0,
2.5.2 and 2.6.4 (checked). `mock-nexa.py` in this folder answers exactly this contract, and
`test-bot.py` passes 19/19 checks against it (unmodified discord.py 2.7.1, Python 3.11).

Legend: **R** = read with `data['x']` (a missing key raises `KeyError`/`TypeError` inside the
library, which usually kills the connection or the call); *o* = read with `.get()`, or only
inside `try/except KeyError` (optional). "Rec." = optional, but send it: Discord always does and
some code paths expect it.

## 0. Pointing discord.py at Nexa (bot code, before the client is created)

```python
import discord, yarl
from discord.gateway import DiscordWebSocket
discord.http.Route.BASE = "https://chat.evilion.xyz/api/v10"          # every REST call
DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("wss://chat.evilion.xyz/gateway/bot")  # the socket
discord.utils.DISCORD_EPOCH = 1767225600000   # Nexa ids count from 2026-01-01, not 2015 (created_at)
discord.asset.Asset.BASE = "https://chat.evilion.xyz/cdn"             # optional: avatars, icons
discord.invite.Invite.BASE = "https://chat.evilion.xyz/invite"       # optional: invite.url
```

* `Route.BASE` is a class attribute read in `Route.__init__` (http.py), so it must be set before
  any request is built. Never call `discord.http._set_api_version()` afterwards: it resets BASE to
  discord.com.
* discord.py does **not** ask `GET /gateway` or `GET /gateway/bot` (only `AutoShardedClient` with
  no `shard_count` calls `/gateway/bot`, shard.py `launch_shards`). `DiscordWebSocket.from_client`
  (gateway.py) connects to `DEFAULT_GATEWAY`, reconnects to `READY.resume_gateway_url`, and falls
  back to `DEFAULT_GATEWAY` after `INVALID_SESSION` (op 9). Master also falls back after a 5xx
  handshake on the resume URL. So the override is mandatory, not just for the first connection.
* The URL is always rewritten with `yarl.URL.with_query(v=10, encoding="json",
  compress="zlib-stream")` (or `compress="zstd-stream"` when `zstandard` is installed, 2.5+, or
  Python 3.14 has `compression.zstd`, 2.6+). `with_query` **replaces** any query string, so Nexa must tell the
  bot dialect apart by path (`/gateway/bot`), never by a query parameter.

## 1. REST calls before the socket (Client.login)

Every request carries `Authorization: Bot <token>` and
`User-Agent: DiscordBot (https://github.com/Rapptz/discord.py 2.x) Python/3.x aiohttp/3.x`.

**Response rule that breaks everything if missed:** `json_or_text()` (http.py) parses JSON only
when the response header is exactly `Content-Type: application/json`. With
`application/json; charset=utf-8` every body arrives as a `str`, and the first call fails with
`TypeError: string indices must be integers` (reproduced with the mock). Nexa's `WriteJSON`
(internal/api/respond.go) already sends the exact value; keep it that way on every bot route.

### 1.1 `GET /api/v10/users/@me` (HTTPClient.static_login)
401 → `discord.LoginFailure`. 200 body = user object, parsed by `ClientUser` (user.py
`BaseUser._update`, `ClientUser._update`):

| field | | Nexa source |
|---|---|---|
| `id` (string) | R | users.id |
| `username` | R | users.username |
| `discriminator` | R | always `"0"` (discord.py then prints the name alone) |
| `avatar` (hash or null) | R | avatar blob id as a string; prefix `a_` when animated (picks .gif) |
| `global_name` | o | display_name |
| `bot` | o, Rec. `true` | FlagBot |
| `banner`, `accent_color`, `public_flags`, `flags`, `system`, `verified`, `mfa_enabled`, `locale`, `avatar_decoration_data`, `primary_guild`, `collectibles` | o | |

### 1.2 `GET /api/v10/oauth2/applications/@me` (Client.application_info → AppInfo.__init__, appinfo.py)

| field | | notes |
|---|---|---|
| `id` | R | the application id; make it equal to the bot user id |
| `name`, `description` | R | `description` may be `""` |
| `icon` | R (may be null) | |
| `bot_public`, `bot_require_code_grant` | R | booleans |
| `owner` | R | a user object (§1.1 fields); `commands.Bot.is_owner()` compares against it |
| `verify_key` | R | any 64 hex chars until HTTP interactions exist |
| `flags` | o, Rec. | GATEWAY_PRESENCE 1<<12, GATEWAY_GUILD_MEMBERS 1<<14, GATEWAY_MESSAGE_CONTENT 1<<18 for the toggles that are on |
| `interactions_endpoint_url` | o | leave null/absent: a value makes discord.py warn that it will receive no interactions |
| `team`, `rpc_origins`, `guild_id`, `primary_sku_id`, `slug`, `cover_image`, `terms_of_service_url`, `privacy_policy_url`, `tags`, `custom_install_url`, `install_params`, `redirect_uris`, `approximate_guild_count`, `integration_types_config` | o | |

Then `setup_hook()` runs (a bot that calls `tree.sync()` here issues
`PUT /applications/{id}/commands` before the socket opens; see design.md, phase 2).

## 2. The socket

Connect: `GET wss://…/gateway/bot?v=10&encoding=json&compress=zlib-stream` (aiohttp, no Origin
header, `compress=0` so no permessage-deflate). Frames are JSON objects
`{"op": int, "d": any, "s": int|null, "t": string|null}`.

**Compression:** the server may ignore `compress=` and send **text** frames:
`received_message` only decompresses `bytes` frames, in every version checked (verified: the mock
ignores it). zlib-stream (one shared deflate context, each message ending in a Z_SYNC_FLUSH
`00 00 ff ff`, `compress/zlib` `Flush()` in Go) is an optional later optimisation; zstd-stream
needs a third-party Go library, so answer text frames when `compress=zstd-stream`.

| # | direction | frame | requirement |
|---|---|---|---|
| 1 | server → | `{"op":10,"d":{"heartbeat_interval":41250},"s":null,"t":null}` | must be the **first** frame: `from_client` reads exactly one frame before identifying, and only op 10 starts the heartbeat thread. `d.heartbeat_interval` R (ms). |
| 2 | → server | `{"op":1,"d":null}` | sent immediately after HELLO, **before** IDENTIFY. Nexa's current gateway closes a socket whose first frame is not identify (internal/gateway/conn.go ServeHTTP): the bot dialect must accept it and answer `{"op":11}`. |
| 3 | → server | IDENTIFY, below | within 60 s of connecting (`asyncio.wait_for(…, 60)` in Client.connect) |
| 4 | server → | READY, then one GUILD_CREATE per server | `on_ready` fires 2 s (`guild_ready_timeout`) after the last GUILD_CREATE |
| … | → server | `{"op":1,"d":<last s>}` every interval | answer each with `{"op":11,"d":null}`. The client gives up after 60 s without any frame (`heartbeat_timeout`), so ACKs are enough to keep it alive. |
| … | server → | `{"op":1}` | optional: asks for an immediate heartbeat |

IDENTIFY as discord.py sends it (gateway.py `DiscordWebSocket.identify`):

```json
{"op": 2, "d": {"token": "<token without 'Bot '>",
  "properties": {"os": "linux", "browser": "discord.py", "device": "discord.py"},
  "compress": true, "large_threshold": 250,
  "intents": 53608189,
  "presence": {"status": "online", "game": null, "since": 0, "afk": false},
  "shard": [0, 1]}}
```
`presence` only when the client was given `status=`/`activity=`; `shard` only with
`shard_id`+`shard_count`. `intents`: `Intents.default()` = 53575421; with `message_content` =
53608189; `Intents.all()` = 53608447. Privileged bits: GUILD_MEMBERS 1<<1, GUILD_PRESENCES 1<<8,
MESSAGE_CONTENT 1<<15. `compress: true` (per-payload zlib) must be ignored.

Close codes the dialect must use (discord.py `_can_handle_close` and `Client.connect`):
4004 bad token (no reconnect, raises `ConnectionClosed`), 4014 privileged intent not enabled for
this bot (raises `PrivilegedIntentsRequired`, verified), 4013 invalid intents, 4012 bad `v`,
4010/4011 shard errors (no reconnect); 4000/4001/4002/4003/4005/4007/4008/4009 and 1001 make it
reconnect and try RESUME. A clean close with 1000 from the server also makes it reconnect.

### 2.1 READY (op 0, `t:"READY"`)

```json
{"op": 0, "t": "READY", "s": 1, "d": {
  "v": 10,
  "user": {"id": "…", "username": "testbot", "discriminator": "0", "global_name": "Test Bot",
           "avatar": null, "bot": true, "verified": true, "mfa_enabled": false, "flags": 0},
  "guilds": [{"id": "<server id>", "unavailable": true}],
  "session_id": "<opaque string>",
  "resume_gateway_url": "wss://chat.evilion.xyz/gateway/bot",
  "application": {"id": "<application id>", "flags": 278528},
  "private_channels": [], "relationships": [], "presences": [], "guild_join_requests": [],
  "geo_ordered_rtc_regions": [], "user_settings": {}, "shard": [0, 1], "_trace": ["nexa"]}}
```

| field | | where |
|---|---|---|
| frame `s` | R | gateway.py `received_message`: `self.sequence = msg['s']` on READY |
| `d.session_id` | R | same place |
| `d.resume_gateway_url` | R | same place; wrapped in `yarl.URL`, used for RESUME |
| `d.user` | R | state.py `parse_ready` → `ClientUser` (fields of §1.1) |
| `d.guilds` | R | list; each item goes through `Guild(data=…)`: only `id` is R. Send `{"id", "unavailable": true}` stubs and the real data in GUILD_CREATE. |
| `d.application` | o | read only if `application_id` is still unset (it is set by login); then `application['flags']` is R |
| everything else | o | ignored by discord.py |

### 2.2 GUILD_CREATE (one per server, straight after READY; also when the bot is added later)

discord.py (`parse_guild_create`, `Guild._from_data` in guild.py): only `id` is R at the top level;
every other top-level key is `.get()` or `if 'x' in guild`. But each **nested** object has hard
fields:

| nested | R fields (constructor) | rec. fields |
|---|---|---|
| `roles[]` → Role (role.py `_update`) | `id`, `name` | `permissions` (decimal string, as Discord sends; `int()` also takes a number), `position`, `colors: {"primary_color","secondary_color","tertiary_color"}` (2.6+ reads colour only from `colors`, 2.5 and older from `color`: send both), `hoist`, `managed`, `mentionable`, `icon`, `unicode_emoji`, `flags`, `tags: {"bot_id"}` for the bot's own role |
| `channels[]` → factory by `type` (channel.py `_guild_channel_factory`) | `type`; text (0): `id`,`name`,`position`; voice (2): `id`,`name`,`position`,`bitrate`,`user_limit`; category (4): `id`,`name`,`position` | `parent_id`, `topic`, `nsfw`, `rate_limit_per_user`, `last_message_id`, `permission_overwrites: [{"id","type":0 role/1 member,"allow":"str","deny":"str"}]` (each overwrite: `id`,`type` R) |
| `members[]` → Member (member.py `__init__`) | `user` (§1.1 R fields), `roles` (list of id strings), **`flags`** (int) | `joined_at`, `nick`, `avatar`, `banner`, `pending`, `premium_since`, `communication_disabled_until`, `deaf`, `mute`, `permissions` |
| `emojis[]` (cached only with GUILD_EXPRESSIONS, which `Intents.default()` has) | `id`, `name` | `animated`, `available`, `require_colons`, `managed`, `roles`, `user` |
| `stickers[]` | `id`, `name`, `description`, `format_type`, `tags`, `guild_id` | `available` |
| `voice_states[]` | `channel_id`, `user_id` | the rest |
| `presences[]` | `user.id`, `status`, `client_status`, `activities` | |
| `threads[]` | `id`,`parent_id`,`owner_id`,`name`,`type`,`message_count`,`member_count`,`thread_metadata` | |

Rules that matter:
* **`@everyone` role id = server id.** `Guild.default_role` is `get_role(guild.id)` and
  `_fill_overwrites` treats the overwrite with `id == guild.id` as @everyone. Nexa already does
  this (internal/store/servers.go CreateServer).
* **Always include the bot's own member** in `members`, whatever the intents: `guild.me` is
  `get_member(self_id)`, and permission checks (`channel.permissions_for(guild.me)`,
  `commands.bot_has_permissions`) fail without it.
* `owner_id` Rec. (owner gets every permission in `permissions_for`), `member_count` Rec.
* Chunking: with the members intent, discord.py sends op 8 REQUEST_GUILD_MEMBERS for every server
  where `member_count != len(members)` and waits up to `max(5, member_count/10000)` s per server
  before `on_ready`. Sending **all** members with an exact `member_count` makes the server count as
  chunked and skips op 8 (verified: on_ready after 2.0 s, `chunked=True`). Otherwise answer op 8
  with `GUILD_MEMBERS_CHUNK {guild_id, members, chunk_index, chunk_count, not_found, nonce}`,
  echoing the request's `nonce` (the request is only completed when
  `chunk_index + 1 == chunk_count` for that nonce).
* Other recommended top-level fields (all `.get()`): `name`, `icon`, `banner`, `description`,
  `system_channel_id`, `features: []`, `afk_timeout`, `verification_level`,
  `default_message_notifications`, `explicit_content_filter`, `mfa_level`, `nsfw_level`,
  `premium_tier`, `preferred_locale`, `unavailable: false`, `large`, `joined_at`.

## 3. MESSAGE_CREATE (and MESSAGE_UPDATE)

`parse_message_create` → `Message.__init__` (message.py). MESSAGE_UPDATE goes through the same
constructor (`parse_message_update`), so it must be a **full** message too, never a partial.

```json
{"op": 0, "t": "MESSAGE_CREATE", "s": 7, "d": {
  "id": "…", "channel_id": "…", "guild_id": "…", "type": 0, "content": "!ping",
  "author": {"id": "…", "username": "alice", "discriminator": "0", "global_name": "Alice", "avatar": null},
  "member": {"roles": [], "joined_at": "2026-09-26T21:00:00.000000+00:00", "flags": 0, "nick": null,
             "pending": false, "deaf": false, "mute": false},
  "mentions": [], "mention_roles": [], "mention_everyone": false,
  "attachments": [], "embeds": [], "components": [], "reactions": [],
  "timestamp": "2026-09-26T21:00:00.000000+00:00", "edited_timestamp": null,
  "tts": false, "pinned": false, "flags": 0, "nonce": "…"}}
```

| field | | why |
|---|---|---|
| `id`, `type`, `content` | R | constructor |
| `channel_id` | R | `_get_guild_channel` |
| `guild_id` | R for server messages; **absent** for DMs | its absence is how a DM is recognised (`DMChannel._from_message`) |
| `author` | R in practice | `__slots__` attribute with no default: without it `message.author` raises `AttributeError` in every handler |
| `mentions`, `mention_roles`, `components` | R in practice | same: slots with no default, set only by `_handle_*` when the key is present |
| `member` | o, Rec. in servers | when present: `roles` R, and `flags` R if the author is not cached |
| `attachments[]` | o | each: `id`, `size`, `filename`, `url`, `proxy_url` R; `url` must be fetchable **without** an Authorization header (`Attachment.read` uses `get_from_cdn`) |
| `embeds`, `reactions`, `timestamp`, `edited_timestamp`, `tts`, `pinned`, `flags`, `nonce`, `message_reference`, `referenced_message`, `webhook_id`, `application_id`, `interaction_metadata`, `sticker_items`, `poll`, `thread` | o | `created_at` comes from the id, not `timestamp` |

Content: send the text only to sessions that asked for MESSAGE_CONTENT (1<<15), except the bot's
own messages, DMs to the bot and messages that mention it; otherwise `content: ""`,
`embeds: []`, `attachments: []`, `components: []` (Discord's rule; the mock does this).

MESSAGE_DELETE: `{"id","channel_id","guild_id"}` (`id`, `channel_id` R).
TYPING_START: `{"channel_id","guild_id","user_id","timestamp"(unix seconds, R),"member"}`.

## 4. Answering: `channel.send("pong")`

`POST /api/v10/channels/{channel_id}/messages`, `Content-Type: application/json` (abc.py
`Messageable.send` → `handle_message_parameters`):

```json
{"content": "pong", "tts": false, "nonce": "1234567890123456789", "enforce_nonce": true}
```
Optionally `allowed_mentions`, `message_reference` (`reply()` sends `{message_id, channel_id,
guild_id}`; a `MessageReference` object adds `fail_if_not_exists` and `type`), `embeds`,
`components`, `flags`, `sticker_ids`, `poll`. Ids inside bodies are JSON **numbers** larger than
2^53 (`message_id`, `allowed_mentions.users`, …): decode with `json.Decoder.UseNumber()` or into
`ids.ID` (which accepts both), never through `float64`.
With files it is `multipart/form-data`: `payload_json` plus `files[0]`, `files[1]`…
(field names unescaped, `quote_fields=False`), and `attachments: [{"id": 0, "filename": …}]` inside
`payload_json`. Nexa's `readWebhookBody` (internal/api/webhook_handlers.go) already reads this form.

Answer `200` with the created message in the §3 shape (the author is the bot user;
`state.create_message` builds a `Message` from it). A repeated `nonce` from the same bot in the same
channel within a few minutes returns the existing message (Nexa's `MessageByNonce` already does).
The same message must also go out as MESSAGE_CREATE to the bot's own session.

## 5. What else a basic bot touches (all verified by test-bot.py against the mock)

| call | route | answer |
|---|---|---|
| `message.reply()` | POST messages with `message_reference` | message with `type: 19`, `message_reference`, `referenced_message` |
| `message.edit()` | PATCH `/channels/{c}/messages/{m}` | full message, `edited_timestamp` set; MESSAGE_UPDATE (full) |
| `message.delete()` | DELETE `/channels/{c}/messages/{m}` | 204; MESSAGE_DELETE |
| `channel.typing()` | POST `/channels/{c}/typing` | 204 |
| `channel.history()` | GET `/channels/{c}/messages?limit=&before=&after=&around=` | array, newest first |
| `channel.fetch_message()` | GET `/channels/{c}/messages/{m}` | message |
| `client.fetch_channel()` | GET `/channels/{c}` | channel with `guild_id` |

Errors: `{"message": "...", "code": <Discord JSON code>, "errors": {...}}` with the HTTP status
(403 → `Forbidden`, 404 → `NotFound`, 5xx retried 5 times). A 429 must carry a `Via` header and a
JSON body with `retry_after` (seconds, float) and `global`; without `Via` discord.py raises instead
of waiting (verified). If a response carries `X-RateLimit-Remaining` it must also carry
`X-RateLimit-Reset-After` or `X-RateLimit-Reset`, or discord.py raises `KeyError`.

## 6. RESUME, the cheap way

After a drop, discord.py connects to `resume_gateway_url` and sends
`{"op":6,"d":{"token","session_id","seq"}}`. Until Nexa keeps a replay buffer, answer
`{"op":9,"d":false}`: discord.py forgets the session, reconnects to `DEFAULT_GATEWAY`, waits 5 s
(the `before_identify` hook) and identifies again, receiving READY and every GUILD_CREATE afresh
(events in the gap are lost). `{"op":9,"d":true}` would make it try to resume again.

## 7. Timeline of a successful start (mock, discord.py 2.7.1)

```
GET  /api/v10/users/@me                       200
GET  /api/v10/oauth2/applications/@me         200   -> setup_hook()
WS   /gateway/bot?v=10&encoding=json&compress=zlib-stream
<- op 10 HELLO(41250)   -> op 1 (d:null)   <- op 11
-> op 2 IDENTIFY(intents 53608189)
<- READY(s=1)  <- GUILD_CREATE(s=2)          (2 s of quiet)  -> on_ready
<- MESSAGE_CREATE "!ping" from a person       -> on_message
POST /api/v10/channels/{id}/messages {"content":"pong",...}   200
<- MESSAGE_CREATE "pong" (the bot's own)
```
