# Nexa bot platform: design

Research for running unmodified discord.py bots against Nexa. Sources: Nexa at `4e7a168`
(`/home/user/nexa`), discord.py master 2.8.0a (`65232c3`) with 2.3.2 to 2.7.1 spot-checked, the
official API docs in `../discord-api-docs`. Companion files: `discordpy-startup.md` (the exact
startup contract), `test-bot.py` (phase-1 acceptance test, PASS/FAIL lines), `mock-nexa.py` (an
aiohttp stand-in answering that contract; `test-bot.py` passes 19/19 against it with discord.py 2.7.1).

## 0. Executive summary

**Goal.** A discord.py bot runs against Nexa when you point it at Nexa's base URL and give it a
Nexa bot token. People get the same new features (slash commands in the composer, buttons,
select menus, modals, threads, polls).

**What discord.py needs to be pointed elsewhere.** It needs two assignments, plus one for correct
timestamps: `discord.http.Route.BASE = ".../api/v10"`,
`DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("wss://.../gateway/bot")`, and
`discord.utils.DISCORD_EPOCH = 1767225600000`. Since 2.3, discord.py never calls `GET /gateway`: it
connects to the hardcoded `DEFAULT_GATEWAY` and falls back to it after INVALID_SESSION. Nexa ids
count from 2026, so without the epoch line `created_at` is 11 years off. Bot code is otherwise
unchanged. Ship the lines as a `nexa_compat.patch(url)` snippet in the developer docs.

**Hard compatibility facts** (1, 2 and 4 reproduced with the mock and discord.py 2.7.1; 3 read in the code and exercised by the mock):
1. Every JSON answer needs exactly `Content-Type: application/json`. With `; charset=utf-8`,
   discord.py treats bodies as text and fails on the first call. Nexa's `WriteJSON` is already correct.
2. A 429 needs a `Via` header, `retry_after` (float seconds) and `global` in a JSON body. Without
   `Via`, discord.py raises instead of waiting. This is a **bug in today's webhooks**:
   `hookAllow` (internal/api/webhook_handlers.go) sends no `Via`, so discord.py's `Webhook` gives
   up on the first 429. The fix is one line.
3. The gateway sends HELLO first. The client heartbeats **before** IDENTIFY. READY carries `s`,
   `session_id` and `resume_gateway_url`. MESSAGE_CREATE/UPDATE are full messages with `author`,
   `mentions`, `mention_roles` and `components`. Members have `roles` and `flags`. GUILD_CREATE
   always includes the bot's own member. Nexa's gateway does none of this today: it is string-op,
   identify-first, and uses one global sequence. **A second protocol dialect is needed**, not a
   tweak.
4. Text frames are fine even though discord.py asks for `compress=zlib-stream` (or `zstd-stream`
   on Python 3.14).

**Encryption, the crux.** Bots cannot run the browser crypto.

*Recommendation:* design 1, **server-held bot identity**. The bot has an ordinary X25519 identity.
Its private key is stored wrapped under a key derived from the bot token. The server keeps only
that wrapped key, the public key and the token's SHA-256. Members' clients grant conversation keys
to the bot's public key through the existing `keys_needed` flow. The installing admin's client
grants them on the spot.

Two refinements keep the exposure as small as the feature allows:
(a) A bot receives keys in a server only if it has **Read Messages** access there. This needs the
app's Message Content toggle plus the installing admin's consent. Without that access it gets no
keys, sees no content, and its own posts are stored as plaintext app messages, like webhooks.
(b) An **escrow copy** of the identity is sealed to the owner's key. This lets a token reset keep
the same identity, so no re-grants and no key-change alerts.

*What changes for users:* while such a bot runs, the Nexa server can read the channels it can see.
That must be said plainly on install, in the channel header and in the privacy policy.

Design 2 (a sidecar that holds the key on the developer's machine) keeps full E2EE. It is
specified as a later "Encrypted Apps" mode that reuses the same wire format. Design 3 (channels
that switch off E2EE) is rejected: it stores people's messages as plaintext at rest.

**Phases.**
- **P0** groundwork: `Via`, shared Discord serializers, docs.
- **P1** log in, READY/GUILD_CREATE, MESSAGE_CREATE with content, send/reply/edit/delete. This
  includes bot accounts, the portal, OAuth2 install and server-side bot crypto. It is the largest
  phase, because crypto and installs cannot be deferred.
- **P2** application commands, interactions, components, modals and ephemeral messages, in the
  composer and chat for people too.
- **P3** members and chunking, roles, channels, moderation, audit log, reactions, pins, presence,
  RESUME and rate-limit headers.
- **P4** threads and forums, for people too.
- **P5** polls (people get a poll composer), stickers, invites and CDN polish.
- **P6** Encrypted Apps sidecar, sharding, HTTP interactions endpoint.

Bot **voice audio is not feasible**. Nexa calls are WebRTC with frame E2EE, and the tunnel carries
only HTTP. Voice *states* and voice moderation are (P3).

**Biggest risks.**
- The E2EE promise narrows for bot-visible channels. This is a product and legal decision.
- Key availability: a bot can neither read nor send until a key holder grants it.
- Faithfulness to a large, moving API. discord.py 2.6+ already uses the new pins route, role
  `colors` objects, components v2 and modal labels; 2.5+ uses `with_response` callbacks.
- Load: every bot connection needs its own translated, decrypted copy of each event.
- The UI-copy rule against comparing Nexa to Discord, which bites in developer docs.

## 1. What discord.py does on startup (task a)

Full field lists are in `discordpy-startup.md`. Here: the sequence, the overrides, and the
hard (`data['x']`) versus soft (`.get()`) reads, with file:function.

### 1.1 Overrides and how to point discord.py elsewhere

| knob | where | notes |
|---|---|---|
| `discord.http.Route.BASE` | http.py `Route` (class attr, read in `Route.__init__`) | default `https://discord.com/api/v10`. Also used by the webhook adapters (webhook/async_.py, sync.py) because they build `Route`s too. `_set_api_version(9/10)` **resets** it to discord.com. |
| `DiscordWebSocket.DEFAULT_GATEWAY` | gateway.py | used by `from_client` (`gateway or cls.DEFAULT_GATEWAY`) and after op 9 with `d:false` (`received_message`), identically in 2.3.2, 2.4.0, 2.5.2, 2.6.4, 2.7.1 and master. Master also falls back to it when the resume URL fails the handshake with a 5xx. |
| query `v`, `encoding`, `compress` | `from_client`: `gateway.with_query(v=INTERNAL_API_VERSION, encoding='json', compress=_ActiveDecompressionContext.COMPRESSION_TYPE)` | `compress` is `zlib-stream`. It is `zstd-stream` if `zstandard` is importable (2.5+) or on Python 3.14 with `compression.zstd` (2.6+) (utils.py). `with_query` replaces any existing query, so Nexa must choose the dialect by path. |
| `discord.utils.DISCORD_EPOCH` | utils.py `snowflake_time`, `time_snowflake` read it at call time | abc.py `_purge_helper` hardcodes `1420070400000` for its 14-day rule. With Nexa ids every message looks older than 14 days, so `purge()` deletes one by one instead of in bulk: slower, still correct. |
| `discord.asset.Asset.BASE`, `discord.invite.Invite.BASE` | asset.py, invite.py | CDN (`/avatars/{uid}/{hash}.png?size=1024`, `/icons/…`, `/emojis/…`, `/embed/avatars/{n}.png`) and `discord.gg`. Hardcoded, no knob: `utils.oauth_url` (discord.com/oauth2/authorize), `Message.jump_url` (discord.com/channels), `Webhook.url`, `Sticker.url`. |
| `HTTPClient(proxy=…)`, `Client(max_ratelimit_timeout=…)`, `heartbeat_timeout` (60 s), `guild_ready_timeout` (2 s), `chunk_guilds_at_startup` | Client options | nothing Nexa needs to change |

Ids: keep Nexa's ids as they are, with no translation. Translating to Discord's epoch
(`id + (Δepoch << 22)`) would remove the epoch line. But it would also break every id a person
copies from the Nexa UI and pastes into a bot command (`!ban 9747…`), and it would force rewriting
`<@id>` tokens inside message text. Rejected.

### 1.2 Request sequence of `Client.run(token)`

| # | call | code path | Nexa must |
|---|---|---|---|
| 1 | `GET /users/@me` | client.py `Client.login` → http.py `HTTPClient.static_login` | 200 user. 401 raises `LoginFailure`. `id`, `username`, `discriminator`, `avatar` are R. |
| 2 | `GET /oauth2/applications/@me` | `Client.login` → `Client.application_info` → appinfo.py `AppInfo.__init__` | R: `id`, `name`, `description`, `icon`, `bot_public`, `bot_require_code_grant`, `owner` (user), `verify_key`. `flags` sets `application_flags`. `interactions_endpoint_url` must stay null. |
| 3 | `setup_hook()` | user code | often `await tree.sync()` → `PUT /applications/{app}/commands` (P2; in P1 answer `[]` with 200) |
| 4 | WS connect `DEFAULT_GATEWAY?v=10&encoding=json&compress=zlib-stream` | `Client.connect` → gateway.py `DiscordWebSocket.from_client` (60 s `wait_for`) | accept without an `Authorization` header or `Origin` |
| 5 | ← op 10 HELLO | `from_client` → `poll_event` → `received_message` | `d.heartbeat_interval` R. Must be the first frame. |
| 6 | → op 1 `{d:null}` | HELLO branch sends a heartbeat at once, starts `KeepAliveHandler` | answer op 11 even before IDENTIFY |
| 7 | → op 2 IDENTIFY | `DiscordWebSocket.identify` | token, properties, `compress:true` (ignore), `large_threshold:250`, `intents`, optional `presence{status,game,since,afk}` and `shard` |
| 8 | ← READY, ← GUILD_CREATE × n | state.py `parse_ready`, `_delay_ready`, `parse_guild_create` | see 1.3 |
| 9 | op 8 → (only with the members intent and an unchunked server) | `_delay_ready` → `chunk_guild` → `chunker` → `request_chunks` | GUILD_MEMBERS_CHUNK echoing `nonce`, else a wait of `max(5 s, n/10000)` per server |
| 10 | `on_ready` | `_delay_ready` after 2 s without GUILD_CREATE | |

Reconnect behaviour (`Client.connect`, `DiscordWebSocket._can_handle_close`):
- Codes 1000 (own close), 4004, 4010, 4011, 4012, 4013 and 4014 are final. 4014 raises
  `PrivilegedIntentsRequired`.
- Everything else, including a server-side 1000, reconnects to `resume_gateway_url` and sends
  RESUME `{token, session_id, seq}`.
- Op 9 with `d:false` resets to `DEFAULT_GATEWAY`. It is followed by a 5 s `before_identify`
  sleep and a fresh IDENTIFY.
- Op 7 RECONNECT resumes.
- The client closes with 4000 after 60 s without any frame (`KeepAliveHandler.run`,
  `poll_event` timeout).
- The client limits itself to 110 frames per 60 s (`GatewayRatelimiter`).

### 1.3 READY and GUILD_CREATE: hard versus soft reads

READY is read by gateway.py `received_message` and state.py `parse_ready`:
- R: frame `s`, `d.session_id`, `d.resume_gateway_url`, `d.user`, `d.guilds` (each item needs
  `id`).
- `d.application` is soft, but `application['flags']` is R if it is present and `application_id`
  is unset.
- Everything else (`v`, `private_channels`, `relationships`, `presences`, `shard`, `_trace`,
  `user_settings`) is ignored.

GUILD_CREATE is read by `parse_guild_create` → `_get_create_guild` → guild.py `Guild._from_data`.
- At the top level only `id` is R. Everything else is `.get()` or `'x' in guild`.
- `unavailable: true` makes discord.py drop the event.
- Nested objects have R fields:

| object | reader | R |
|---|---|---|
| role | role.py `Role.__init__`/`_update` | `id`, `name` (2.6+ reads colour only from `colors.primary_color`, 2.5 from `color`: send both) |
| text/news channel | channel.py `TextChannel._update` | `id`, `name`, `position` (+ `type` for the factory) |
| voice/stage | `VocalGuildChannel._update` | + `bitrate`, `user_limit` |
| category | `CategoryChannel._update` | `id`, `name`, `position` |
| forum/media | `ForumChannel._update` | `id`, `name`, `position` |
| overwrite | abc.py `_Overwrites` | `id`, `type` (0 role, 1 member) |
| member | member.py `Member.__init__` | `user` (with R user fields), `roles`, `flags` |
| user | user.py `BaseUser._update` | `id`, `username`, `discriminator`, `avatar` |
| emoji (with GUILD_EXPRESSIONS) | emoji.py `Emoji._from_data` | `id`, `name` |
| guild sticker | sticker.py `GuildSticker._from_data` | `id`, `name`, `description`, `format_type`, `tags`, `guild_id` |
| presence | presences.py `RawPresenceUpdateEvent` | `user.id`, `status`, `client_status`, `activities` |
| voice state | guild.py `_update_voice_state` | `channel_id`, `user_id` |
| thread | threads.py `Thread._from_data` | `id`, `parent_id`, `owner_id`, `name`, `type`, `message_count`, `member_count`, `thread_metadata` |

Semantics discord.py assumes, and Nexa already matches:
- The @everyone role id equals the guild id (`Guild.default_role`, `_fill_overwrites`); Nexa's
  store/servers.go does the same.
- Permission bits have Discord's values (internal/perms/perms.go).
- Mention syntax is `<@id>`, `<@&id>`, `<#id>` (web/src/components/composer/mentions.ts).

Semantics Nexa must add:
- The bot's own member is always in `members` (`Guild.me`).
- `owner_id` is set.
- Chunking completes: `Guild.chunked` is `member_count == len(members)`.

### 1.4 Messages: MESSAGE_CREATE, MESSAGE_UPDATE, REST answers

`Message.__init__` (message.py) reads the following:
- R: `id`, `type`, `content`.
- `channel_id` is R (in `_get_guild_channel`).
- The absence of `guild_id` means a DM.
- `author`, `mentions`, `mention_roles` and `components` are set only by `_handle_*` when the key
  exists. They are `__slots__` with no default, so omitting any of them makes
  `message.author` / `.mentions` raise `AttributeError` later. Treat them as R.
- `member` is soft, but when present its `roles` are R, and `flags` is R if the author is uncached
  (`Member._from_message`).
- Each attachment has R fields `id`, `size`, `filename`, `url`, `proxy_url`.
  `Attachment.read()` fetches `url` through `get_from_cdn`, with **no auth header**.
- MESSAGE_UPDATE builds a new `Message` (`parse_message_update`), so it must be a full message.
- Reactions: `RawReactionActionEvent` needs `message_id`, `channel_id`, `user_id`, `type`, and
  `emoji` (`PartialEmoji.from_dict`).
- `RawTypingEvent` needs `timestamp` in unix seconds.

`Messageable.send` (abc.py) always adds a 64-bit `nonce` and `enforce_nonce: true`. Its bodies
carry ids as JSON numbers above 2^53, so decode with `UseNumber` (webhook_parse.go already does).

## 2. HTTP behaviour Nexa's answers must not break (task b)

`HTTPClient.request` (http.py) works like this:
- It serialises requests per bucket key (`"{METHOD} {path}:{channel_id+guild_id+webhook_id+token}"`,
  or the `X-RateLimit-Bucket` hash once one is seen). It waits on a client-wide `_global_over`
  event.
- It makes up to 5 attempts. `json_or_text` parses only an exact `application/json`.
- On 2xx, the data is returned.
- If `X-Ratelimit-Remaining` is present (and the status is not 429), `Ratelimit.update` reads:
  - `X-Ratelimit-Limit` (default 1);
  - `X-Ratelimit-Remaining`;
  - `X-Ratelimit-Reset-After` (float seconds), or else `X-Ratelimit-Reset` (epoch seconds). One of
    the two **must** be present, or it raises `KeyError`.
  - The bucket then pre-emptively sleeps when `remaining` hits 0.
- With **no** rate-limit headers, the default bucket (`limit=1`) runs one request at a time per
  route key with no delay. That is fine for P1.
- On 429:
  - If there is **no `Via` header** or the body is not JSON, it raises `HTTPException`. It assumes
    a Cloudflare ban.
  - Otherwise it reads `retry_after` (R) and `global` (soft), then sleeps.
  - If `global` is true, it blocks every request until the sleep ends.
  - If `retry_after > max_ratelimit_timeout`, it raises `RateLimited`.
  - After 5 attempts it raises.
- 500/502/504/524 are retried after `1 + 2·try` s. 403 → `Forbidden`, 404 → `NotFound`,
  other ≥500 → `DiscordServerError`, anything else → `HTTPException`.
- The error body: `errors.py` `HTTPException` reads `code` (int), `message`, and `errors`. It
  flattens `errors` via `_errors[].message` for `CommandSyncFailure` and friends.
  `app_commands.CommandTree.sync` turns `400` + `code 50035` into `CommandSyncFailure`.
- The webhook adapters (`AsyncWebhookAdapter.request`, `SyncWebhookAdapter`) behave the same:
  `Via` is needed on 429, `X-Ratelimit-Remaining: "0"` triggers a delay through
  `_parse_ratelimit_header` (which also needs Reset-After or Reset), and 5xx is retried. They send
  **no Authorization** on interaction callbacks and webhook-token routes.
- Requests carry `X-Audit-Log-Reason`, URL-quoted with `quote(reason, safe='/ ')`.
  `auditReason()` (webhook_handlers.go) already unquotes it.

What Nexa sends on every bot route:
- Discord-shaped errors `{"message","code","errors"?}` with Discord codes. Reuse
  `dError`/`writeDiscordError` from webhook_errors.go, moved to a shared file.
- 429s with `Via: 1.1 nexa`, `Retry-After`, `X-RateLimit-Limit/Remaining/Reset/Reset-After/Bucket`,
  `X-RateLimit-Scope` (`user`, `shared` or `global`), `X-RateLimit-Global` on global limits, and
  the JSON body.
- From P3, accurate headers on successes too. The bucket per route and major parameter would be
  channel-messages 5/5 s (Nexa's `limMsg` today), plus a global 50/s per bot.
  `ratelimit.Limiter.Allow` returns only `(ok, retry)`, so it needs a `Peek` that reports remaining
  tokens and time to full.
- A Discord-shaped catch-all 404 for `/api/v{9,10}/…`. Today the Nexa-shaped catch-all in
  router.go answers `{"error":{…}}`.

The Cloudflare tunnel:
- A WAF/rate-limit HTML 429 from Cloudflare is correctly treated as a ban by discord.py.
- Check that `Via` from the origin survives the tunnel.
- The 100 MB body cap applies to multipart uploads.
- The WS idle timeout (100 s) sits above the 41.25 s heartbeat.

## 3. discord.py areas and what Nexa has (tasks c and d)

Effort: **S** is a file or two. **M** is several files on one side, or small on both sides.
**L** is a new subsystem, or server plus client plus i18n. "Nexa has" cites the closest existing code.

| area | discord.py needs (routes, events, R fields) | Nexa has | gap | effort |
|---|---|---|---|---|
| Transport | `Authorization: Bot`, `/api/v10`, exact JSON content type, Discord errors, 429 + `Via`, header rules (§2) | Bearer sessions with a TTL (auth/middleware.go `BearerToken`); Discord errors and 429 only on webhook-token routes (webhook_errors.go, `hookAllow`) | bot-token auth (no TTL, no session row), compat router at `/api/v9`+`/api/v10`, shared Discord errors, `Via`, headers | M |
| Gateway core | ops 0,1,2,3,4,6,7,8,9,10,11; HELLO first; heartbeat before IDENTIFY; per-session `s`; `resume_gateway_url`; close codes 4004/4013/4014; intents filtering | string-op protocol (gateway/protocol.go), identify-first `ServeHTTP` (conn.go), hub-global `nextSeq`, no resume, 12 s protocol pings with 8 s timeout, 256-frame send buffer | new dialect endpoint `/gateway/bot`, per-bot event translator, intent gating, larger buffer, heartbeat-based liveness instead of the 8 s ping deadline (a busy Python loop answers pings late) | L |
| Users | `GET /users/@me`, `PATCH /users/@me` (username, avatar data URI), `GET /users/{id}`, USER_UPDATE; user object | users/@me, users/{id}, avatar upload (user_handlers.go) | Discord user serializer (`discriminator:"0"`, `global_name`, `avatar` = blob id, `a_` if animated), FlagBot | S |
| Guilds | GUILD_CREATE/UPDATE/DELETE; `GET /guilds/{id}` (`with_counts`), `GET /users/@me/guilds`, `DELETE /users/@me/guilds/{id}`, `PATCH /guilds/{id}` | `ServerView` (server_glue.go: channels, roles, ≤500 members, count, my_permissions); server routes (server_handlers.go) | serializer, bot view of hidden channels, events | M |
| Members, chunking, intents | GUILD_MEMBER_ADD/UPDATE/REMOVE (GUILD_MEMBERS 1<<1, privileged); op 8 → GUILD_MEMBERS_CHUNK (`nonce`, `chunk_index/count`, `not_found`, `presences`); `GET /guilds/{g}/members?limit&after`, `/members/search?query`, `GET/PATCH/DELETE /members/{u}` (`nick`, `roles`, `mute`, `deaf`, `channel_id`, `communication_disabled_until`), `PATCH /members/@me`, `PUT/DELETE /members/{u}/roles/{r}` | members list with `after`/`limit`/`q`, member get/patch (nick, timeout), kick, role add/remove, voice patch (server_handlers.go) | chunking, privileged intent toggles and 4014, member serializer (`flags`, ISO times), `search` route, `roles` array replace in PATCH | M |
| Roles | GUILD_ROLE_CREATE/UPDATE/DELETE; `GET/POST/PATCH(positions)/PATCH/DELETE /guilds/{g}/roles` | full CRUD and positions, @everyone id = server id | serializer (`colors{}`, string permissions), **managed bot role** created on install (`tags.bot_id`, cannot be deleted or assigned by hand) | S-M |
| Channels | types 0/2/4 (+1 DM, 3 group); CHANNEL_CREATE/UPDATE/DELETE; `GET/PATCH/DELETE /channels/{c}`, `POST/PATCH /guilds/{g}/channels`, `PUT/DELETE /channels/{c}/permissions/{t}` | text/voice/category, dm/group_dm/**subchat** (DM-only nested chats), all routes, overwrites | serializer (type ints, `permission_overwrites` with 0/1), hide subchats from bots, `channel_positions` → several CHANNEL_UPDATEs; news 5, stage 13, forum 15, media 16 absent | M |
| Threads | 10/11/12; THREAD_CREATE/UPDATE/DELETE/LIST_SYNC/MEMBER(S)_UPDATE; `POST /channels/{c}/threads`, `/messages/{m}/threads`, thread-members, archived lists, `GET /guilds/{g}/threads/active` | none (subchats are DM-only) | a new feature for people too, including keys for private threads (§4.7) | L |
| Forum | type 15, `available_tags`, posts are threads with a starter message | none | builds on threads | L |
| Messages | JSON and multipart (`payload_json`, `files[n]`, `attachments[{id,filename,description}]`), nonce, `message_reference`, `allowed_mentions`, ≤10 `embeds`, `flags` (4, 4096, 32768; 64 for interactions), edit, delete, `bulk-delete` (2-100, <14 days), history `before/after/around/limit`, `GET /messages/{m}` | messages CRUD, bulk delete, nonce dedupe, replies, mention metadata (message_handlers.go); Discord body parser, multipart reader, mention resolver, Discord message serializer for webhooks (webhook_parse.go `parseWebhookBody`, `parseAllowedMentions`, webhook_message.go `webhookMentions`, `discordMessage`) | server-side encrypt/decrypt for bots (§4), a Discord-extras section in the encrypted payload (rich embeds, components, poll) that clients render with the webhook renderers, mentions derived from content, `allowed_mentions`, reply-type mapping | L |
| Attachments | multipart upload; `url`/`proxy_url` fetchable without auth | encrypted ECF1 files with the key inside the message (web/src/crypto/fileChunks.ts); plaintext webhook files at `/media/attachments/{blob}` (auth plus channel access) | Go ECF1 encrypt on upload; **signed, self-authorising, decrypting** download URLs for bots (`?k=<file key sealed with the server secret>&ex=&hm=`) | M |
| Pins | `PUT/DELETE /channels/{c}/messages/pins/{m}`, `GET /channels/{c}/messages/pins` → `{items:[{pinned_at,message}],has_more}` (2.6+); legacy `/pins`; CHANNEL_PINS_UPDATE | pins routes, `pin_update` | paths, the new shape, event | S |
| Reactions | `PUT/DELETE …/reactions/{e}/@me`, `DELETE …/{e}/{user}`, `DELETE …/reactions`, `DELETE …/reactions/{e}`, `GET …/{e}?after&limit&type`; MESSAGE_REACTION_ADD/REMOVE/REMOVE_ALL/REMOVE_EMOJI (`type` R) | add/remove own, reactors list; the emoji format is already `name:id` or unicode (`parseEmoji`) | remove others', remove all (MANAGE_MESSAGES), events | S-M |
| Typing | `POST /channels/{c}/typing` → 204; TYPING_START | yes (`Typing`, `typing` event) | mapping | S |
| Polls | `poll` on send; MESSAGE_POLL_VOTE_ADD/REMOVE; `GET /channels/{c}/polls/{m}/answers/{a}`; `POST …/expire` | webhook polls, vote routes and events (poll_handlers.go, store/polls.go); **people cannot create polls** | bot polls with encrypted question and answers but server-side tallies; expire; a Create Poll composer for people | M |
| Stickers | `sticker_ids` on send, `sticker_items`; `GET /stickers/{id}`, guild sticker CRUD, GUILD_STICKERS_UPDATE | user-owned shareable packs (expression_handlers.go), no guild stickers | read-only mapping of packs to stickers; send by id | M |
| Emojis | guild emoji CRUD (image data URI), GUILD_EMOJIS_UPDATE; application emojis | server emoji CRUD (`/servers/{id}/emojis`) | serializer, data-URI upload | S |
| Invites | `POST /channels/{c}/invites` (`max_age`, `max_uses`, `temporary`, `unique`), `GET/DELETE /invites/{code}`, channel and guild lists; INVITE_CREATE/DELETE | invites whose URL fragment can carry the server key | a bot's invite carries no key, so joiners wait for a grant from a holder (document it) | S |
| Webhooks | channel/guild lists, create, `GET/PATCH/DELETE /webhooks/{id}` with bot auth, token routes, WEBHOOKS_UPDATE | complete for people (webhook_handlers.go), token routes at `/api/v10/webhooks/{wid}/{token}` | bot-auth management routes; `{wid}` may be an **application id** (interaction follow-ups share these paths: dispatch on the id's kind); `@original`; `Via` | S |
| Audit log | `GET /guilds/{g}/audit-logs?user_id&action_type&before&after&limit` → `{audit_log_entries,users,webhooks,integrations,application_commands,threads,…}`; `X-Audit-Log-Reason`; GUILD_AUDIT_LOG_ENTRY_CREATE | audit table with string actions and a changes JSON, reason (`s.audit`) | action map (`member_ban`→22, `member_kick`→20, `channel_create`→10 …), `changes[{key,old_value,new_value}]`, reason header on every bot route, event | M |
| Bans and moderation | `GET /bans` (`limit/before/after`), `GET/PUT/DELETE /bans/{u}` (`delete_message_seconds`), `POST /bulk-ban`, kick, timeout; GUILD_BAN_ADD/REMOVE | bans (`delete_message_days`), kick, timeout (`TimeoutUntil`) | shapes, seconds to days, bulk-ban | S-M |
| App commands | `GET/POST/PUT(bulk)/PATCH/DELETE /applications/{a}/commands` and `/guilds/{g}/commands`; `GET …/commands/permissions`; APPLICATION_COMMAND_PERMISSIONS_UPDATE; option types 1-11, choices, `autocomplete`, min/max, `channel_types`, `default_member_permissions`, `contexts`, `integration_types`, `nsfw`, localizations | composer built-ins and plugin commands only (components/composer/commands.ts) | storage, validation (Discord's name regex and limits), routes, command index per channel, composer UI, permission checks | L |
| Interactions | INTERACTION_CREATE types 2 command, 3 component, 4 autocomplete, 5 modal submit. R: `id`, `type`, `token`, `version`, `application_id`, `attachment_size_limit`; `member` (with `permissions`) or `user`; `channel`; `app_permissions`; `context`; `authorizing_integration_owners`. `POST /interactions/{id}/{token}/callback?with_response=1` → **200** `{interaction:{id,type,response_message_id,…},resource:{type,message}}` (types 1,4,5,6,7,8,9); follow-ups `POST /webhooks/{app}/{token}?wait=1`, `GET/PATCH/DELETE …/messages/@original|{id}`; flag 64 ephemeral; 3 s to answer, 15 min token | none | everything, plus client work: invoking, "is thinking", ephemeral messages, "the app did not respond" | L |
| Components | buttons (styles 1-5), selects 3/5/6/7/8 (`default_values`), v2 (9 section, 10 text, 11 thumbnail, 12 gallery, 13 file, 14 separator, 17 container), modals: 4 text input inside 18 label, selects in modals. The view store matches `(component_type, custom_id)` plus `message.id` | parser and **renderer** for link buttons and the v2 layout (webhook_parse.go `parseComponents`, web/src/components/chat/webhook/HookComponents.tsx) | interactive buttons and selects, disabled state, component interactions, a modal dialog | M-L |
| Presence | IDENTIFY `presence` (`game`), op 3 `{status, activities, since, afk}`; PRESENCE_UPDATE (`user.id`, `status`, `client_status`, `activities` R; GUILD_PRESENCES 1<<8, privileged) | presence status, custom status and activities, already in Discord's activity shape (gateway/activity.go `Activity`) | op 3 to presence, serializer, privileged gating, bots shown online | S-M |
| Voice | op 4, VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE, the voice WS plus UDP RTP (Opus, AEAD, DAVE) | WebRTC calls through the Cloudflare SFU or P2P, frame E2EE with keys from the conversation root (`voiceFrameKey`), voice registry, server mute/deafen/move | **states and moderation feasible** (VOICE_STATE_UPDATE, `guild.voice_states`, PATCH member `channel_id/mute/deaf`); **audio not feasible**: a different transport and crypto, and the tunnel carries only HTTP. Never send VOICE_SERVER_UPDATE (`connect()` then times out after 30 s; say so in the docs) | S-M / — |
| DMs | `POST /users/@me/channels {recipient_id}`; DM MESSAGE_CREATE without `guild_id` (DIRECT_MESSAGES) | DMs with `dm_privacy` (friends, or friends and co-members) | bots may open DMs with co-members; the DM key for the bot (§4.7); disclosure in the DM header | S-M |
| Application and portal | `/oauth2/applications/@me`, `GET/PATCH /applications/@me`; OAuth2 authorize (`bot`, `applications.commands`, `permissions`, `guild_id`, `disable_guild_select`) | none | §5 | L |
| Everything else | automod, scheduled events, stage instances, soundboard, SKUs and entitlements, templates, onboarding, welcome screen, widget, integrations, vanity URL | none | answer empty lists or 404 in Discord's shape so bots degrade gracefully; list them in the docs | S |
| CDN | `Asset.BASE` + `/avatars/{u}/{h}.{png,gif}?size=`, `/icons/…`, `/banners/…`, `/emojis/{id}.{png,gif}`, `/embed/avatars/{n}.png` | `/media/{kind}/{id}` | redirect routes under `/cdn` | S |

Areas needing more than a row:

**Event translation.** The hub fans out Nexa frames, for example `message_create` with a
`*store.Message`. The bot dialect needs per-bot output: decrypted content, intent filtering and
Discord shapes. So bot connections get their own sink. `Hub.EmitUsers` / `EmitConn` /
`emitUsersExcept` / `EmitAll` push the unencoded `ServerFrame` to a `botSink` queue. A translator
goroutine per bot session maps it (appendix A) and writes its own sequence. Human connections are
untouched, and the frames stay shared-encoded.

Events for bots never reach human-only paths:
- `keys_needed`, `key_rotation_needed`, `read_state`, `settings_update` and `relationship_*` are
  dropped.
- `key_grant` updates the bot's keyring.

**Interactions flow.**
1. A person runs a command. The client sends
   `POST /api/v1/interactions {type, application_id, channel_id, guild_id?, data, nonce}`.
2. The server checks `USE_APPLICATION_COMMANDS` (1<<31, a new bit), the command's
   `default_member_permissions` and contexts. It creates an interaction row (token: 32 random
   bytes, stored hashed, valid 15 min) and sends INTERACTION_CREATE to one session of the bot.
3. It holds the HTTP request open for up to 3 s waiting for the callback. It answers the client
   with the callback type (and the modal, or autocomplete choices), or with
   `{error:"app_did_not_respond"}`.
4. Callback types:
   - 4 creates a message (author = bot, `interaction_metadata` stored as plaintext metadata);
   - 5 shows "{App} is thinking..." until the `@original` PATCH;
   - 6 and 7 are for components;
   - 8 returns choices;
   - 9 sends the modal to that one connection (Nexa event `interaction_modal`).
5. Ephemeral messages (flag 64) are delivered only to the invoking user's connections. They are
   kept in memory (or a TTL table) for 15 minutes so follow-ups can edit them. They are never
   stored as channel history. They are plaintext: the server made them.

## 4. End-to-end encryption and bots (task e)

### 4.1 How a new member gets keys today

1. A conversation has root keys in numbered epochs. Server channels normally use the **server's**
   conversation (`KeyConvID = server id`). A private channel gets its own epochs
   (`store.ChannelByID`: `LatestEpoch(channel)` exists → `KeyConvID = channel id`). DMs and groups
   use their own id.
2. Channel key = HKDF-SHA256(root, info `"chan:"+channelId`) (web/src/crypto/conv.ts).
   A message is an AES-256-GCM envelope `{v:1, conv, epoch, iv, ct}` with AAD
   `"conv|epoch|channelId|authorId"` over JSON `{t, att[], sticker, embeds(link previews), flags}`.
   Clients drop unknown payload fields (`sanitizePayload`, web/src/crypto/message.ts).
3. A grant is `seal(recipientPub, root)`: ephemeral X25519, HKDF(info `"evilion-chat/seal/v1"` ‖
   ephPub ‖ recipientPub), AES-GCM with AAD ephPub (web/src/crypto/keys.ts).
4. Entitlement: `store.Entitled(conv)` (internal/store/keys.go) returns DM and group participants,
   **server members** for the server conversation, and **channel viewers** for a private channel.
5. When membership grows, the server calls `KeysMaybeNeeded(conv)`. On an invite join this is in
   server_handlers.go, for the server conversation and each own-key channel the newcomer can see.
   `Hub.KeysMaybeNeeded` (hub.go) computes `entitled − holders` for the latest epoch and emits
   `keys_needed` to **online holders**. Each holder's client runs `putGrantsFor`
   (web/src/stores/keys.ts):
   - `recipientsFor` keeps only ids in the membership this device knows. It fails open (with an
     alert) when the list is not loaded.
   - `judgeKey` withholds the grant if the recipient's key differs from the one pinned (TOFU).
   - It then wraps and `POST /api/v1/keys/grants`.
   - The server (`handleKeyGrantsPut`) checks that the caller is entitled and a holder, and that
     the recipient is entitled. It emits `key_grant` to the recipient.
6. On connect, clients call `GET /keys/needs` (`reconcile`), so a grant owed while nobody was
   online is paid later.
7. Only the **latest epoch** is granted. A newcomer reads history back to the last rotation, not
   before.
8. When someone loses access (`removeMember`, server_handlers.go), the server root and every
   private channel they could see are flagged `needs_rotation`, and `key_rotation_needed` goes to
   the remaining members. The first online holder creates the next epoch and grants it to
   everyone entitled (`createAndGrant`).

### 4.2 Design 1: server-held bot identity, unwrapped with the token (recommended)

**Keys.** Each bot has an X25519 identity. The browser that creates the bot, in the Developer
Portal, generates the key pair and the token (below). It uploads the following (this was the draft;
[crypto.md](crypto.md) §3 has the scheme as built, with a version byte, the public key as AAD and a
labelled escrow):
- `public_key`;
- `wrapped = iv ‖ AES-256-GCM(K_tok, iv, priv, aad "bot-identity/v1|"+appId)`, where
  `K_tok = HKDF-SHA256(token, info "nexa/bot-identity/v1|"+appId)`. HKDF is enough because the
  token carries 256 random bits.
- `escrow = seal(ownerPub, priv)`;
- `token_hash = SHA-256(token)`.

The server stores only these. It never generates or keeps the token.

**Runtime.** On IDENTIFY or any REST call, the server:
1. hashes the token, finds the application, and derives `K_tok`;
2. unwraps `priv` and checks `X25519(priv) == public_key`;
3. opens the bot's grants (`GrantsForUser`) into a keyring.

This bot runtime is kept while a gateway session is open and for 10 minutes after the last REST
call, then zeroed. The server:
- decrypts envelopes for MESSAGE_CREATE/UPDATE, history and fetch;
- encrypts what the bot sends under the latest epoch of the channel's key conversation, with AAD
  author = bot id;
- ECF1-encrypts bot uploads and serves bots decrypting signed URLs;
- updates the keyring on `key_grant`.

Go 1.27's standard library has everything: `crypto/ecdh` X25519, `crypto/hkdf`, `crypto/aes` and
`cipher.NewGCM`. New package `internal/e2ee` (identity, seal/open, channel key, envelope,
ECF1, keyring, bot identity; built, see [crypto.md](crypto.md)). It is tested against vectors
generated by web/src/crypto, and web/src/crypto against vectors it generates, so both sides agree
byte for byte.

**Grant flow changes.**
- `Entitled()` includes a bot user only where it has Read Messages access: the column
  `application_installs.content_access`, or DM participation.
- The OAuth2 authorize page, running in the installing admin's browser, holds the server key. Right
  after the install it grants the latest server epoch, and each own-key channel the bot can see
  and the admin holds, to the bot. So the bot can work immediately even when nobody else is online.
- `keys_needed` then covers later channels, rotations and visibility changes.
- Bots are never asked to grant: skip bot users in the holder audience and in
  `key_rotation_needed` targets.
- Revoking content access, or removing the bot, runs the `removeMember` rotation path.
- A bot opening a DM with a person creates epoch 0 of that DM **server-side**. It seals the root
  to the person's and the bot's public keys; the client accepts grants wrapped by another
  participant as it does today.

**What the operator can read.**
- At rest (database, backups, `data/`): nothing new. The token is only hashed, and the wrapped key
  needs it.
- In a running server: the plaintext of everything a bot reads or writes, and, with a modified
  binary, the token itself. With the token, the bot's keys open every conversation the bot holds,
  from the epoch it was granted until a rotation removes it (not earlier epochs).
- So: *channels an app with Read Messages can see are readable by whoever runs the server*.
  Interaction data and ephemeral replies are always visible to the server.

**Developer experience.** Unmodified discord.py. Plaintext `content`. Zero crypto.

**Failure mode.** Before any grant, sending in a channel returns
`403 {"code":50001,"message":"Missing Access: this app has no key for this channel yet"}`. Received
messages arrive with `content:""` plus a Nexa extra, `"nexa_undecryptable": true`.

**UI disclosure** (drafts in §4.8):
- the install screen;
- an "APP" tag on the bot's name everywhere;
- a lock-off icon on its messages (the webhook style);
- a channel-header notice when an app with Read Messages can see the channel;
- Server Settings → Integrations → Apps (who has Read Messages, with a toggle);
- Server Settings → Encryption, listing "Apps that hold this server's key";
- the privacy policy and Terms.

### 4.3 Design 2: a local sidecar holds the key

The developer runs `nexa-bridge`. It generates and stores the identity locally and registers only
the public key. It talks to Nexa with the bot token and exposes a Discord-compatible API on
`127.0.0.1`; discord.py points there.

To avoid re-implementing Discord in the sidecar, the **server keeps the whole compat layer** in
design 1's shape. It passes ciphertext through a Nexa extra field (`nexa_envelope` on messages,
`nexa_sealed` on interaction data sealed to the bot's key). The sidecar only swaps those for
`content`/`embeds`/`components`/`attachments`: it decrypts inbound, encrypts outbound, rewrites
attachment URLs through itself, and opens grants from `key_grant` frames. Mentions for
notifications are derived by the sidecar from the text and sent as plaintext metadata, as clients
do today.

- **Operator reads:** nothing, the same as for a person. Interactions are also sealed to the bot.
- **Developer experience:** one more process to deploy and a key file to back up (lose it and
  every grant must be redone). Hosts such as Replit or Heroku make a second process awkward.
  An in-process Python variant could wrap discord.py's `HTTPClient` and gateway, but it would be
  per-library.
- **Grant flow:** identical to design 1, minus server-side unwrap.
- **UI:** the app is marked "Encrypted App", with no server-readability notice.
- **Effort:** L. About 1.5-3k lines in the sidecar, plus passthrough mode on the server.

### 4.4 Design 3: channels or servers that switch off E2EE

Adding a bot, or an admin toggle, marks a channel or server "not end-to-end encrypted". From
then on everyone's messages there are stored readable (`messages.plain`, like webhooks) and bots
need no keys.

- **Operator reads:** everything in those channels, **at rest and in backups**, forever.
- **Developer experience:** the simplest server (no bot crypto).
- **Grant flow:** unused.
- **Costs:**
  - The web client needs a second send path (plaintext composer, attachments, search, export).
  - History before the switch stays unreadable to bots.
  - A single toggle downgrades every person in a server.
  - It contradicts the README's first sentence far more than design 1 does.

### 4.5 Comparison

| | 1 server-held identity | 2 sidecar | 3 opt-out |
|---|---|---|---|
| operator can read, at rest | nothing new | nothing | everything in those channels |
| operator can read, live | channels the app can read, while it runs | nothing | everything in those channels |
| bot code change | none | none, plus run a sidecar | none |
| people's clients change | install-time grant; render app messages | same as 1 | plaintext send path |
| key availability | needs a grant (the installer gives one) | same | none needed |
| server effort | L (compat and crypto) | L (compat and passthrough) + L (sidecar) | M (compat only) |
| history before install | not readable (earlier epochs) | same | not readable |

### 4.6 Recommendation

Build design 1 now, with the two refinements:
- **Read Messages is opt-in per server.** It needs the app's Message Content toggle and the
  installer's consent. Apps without it get no keys at all: slash-command and component bots keep
  the channel fully E2EE, and their own posts are plaintext app messages.
- **Escrow**, so token resets keep the identity.

Reasons:
1. Of the designs that keep people's messages encrypted at rest, it is the only one that meets
   "change the URL and the token, nothing else" everywhere, including hosted bots.
2. It keeps data at rest as protected as today, and it limits live exposure to channels an admin
   chose to let an app read.
3. Most modern bots are interaction-only and need no keys at all.
4. It changes no cryptography: bots are ordinary key recipients.
5. It leaves a clean path to design 2. The wire format (`nexa_envelope` passthrough) can be added
   later without changing bots, clients or storage.

Reject design 3.

### 4.7 Changes this implies in the key flow

- **store/keys.go**:
  - `Entitled` excludes FlagBot users without content access. It is
    `serverMemberIDs`/`channelViewers` filtered by `application_installs`.
  - `heldLatest`/`Needs` skip bots as holders. `Lacking` is unchanged.
- **hub.go**: `KeysMaybeNeeded` computes online holders without bots. The bot translator drops
  key events except `key_grant`.
- **key_handlers.go**: no change for grants *to* bots. Reject grants and epochs *from* bot
  sessions except server-side DM epoch 0 (an internal call, not the route).
- **server_handlers.go**: the install path (a new `oauth2_handlers.go`) reuses the invite-join tail
  (`member_add`, `KeysMaybeNeeded`, system message). Revoking access reuses `removeMember`'s
  rotation block (factor it out as `rotateAfterLoss(server, user)`).
- **web/src/stores/keys.ts**:
  - `recipientsFor` treats bots like members (they are in the member list).
  - The authorize page calls `grantTo` for the latest server epoch and own-key channels.
  - Key alerts gain "granted to an app" entries, shown on the Encryption page.
- **web/src/crypto/message.ts**: a new optional payload member `x` (Discord extras: rich `embeds`,
  `components`, `poll`, `stickers`) with its own sanitizer. The same shape as
  `messages.webhook`/`lib/webhookMessage.ts`, so `HookComponents`/`RichEmbeds`/`HookPoll` render
  app messages whether they were encrypted (design 1 with Read Messages) or plain (without).
- **Threads (P4)**: public threads use the parent's key conversation; private threads get their
  own epochs with thread members entitled.

### 4.8 Disclosure copy (drafts; English, following CLAUDE.md)

- Install screen heading "Add to Server". The Read Messages checkbox label is sentence case: "Let
  this app read messages in channels it can see". Hint: "While the app is running, the server can
  read those messages too, and so can whoever runs the app."
- An app message's hint: "Sent by an app. Messages from apps are not end-to-end encrypted."
- Channel header notice: "An app can read this channel."
- Integrations page: section "Apps", button "Remove App", toggle "Read messages".

What's New (release id = deploy date): "Apps and bots" (icon `Bot`); in P2 "Slash commands"; in
P4 "Threads". All strings use `t()` in the eleven locales, and `python3 tools/i18n_check.py` must
pass.

## 5. Applications, bot accounts, Developer Portal (task f)

**Data (one migration, `NNNN_applications`, in both the sqlite and postgres folders. Use the next
free number: 0020 is the request notes, and 0021 is reserved in `unfinishedbotwork.md` for the
group-chat work):**
- `applications`:
  - `id` (= bot user id);
  - `owner_id`, `name`, `description`, `icon_id`;
  - `bot_public` (default false), `flags` (privileged intent toggles as Discord's app flags:
    1<<12 presence, 1<<14 members, 1<<18 message content);
  - `token_hash`, `wrapped_identity`, `identity_escrow`, `token_reset_at`;
  - `created_at`, `updated_at`.
- `application_installs(application_id, server_id, installed_by, scopes, permissions,
  content_access, created_at)`.
- `application_commands(id, application_id, server_id NULL, type, name, payload_json, version)`.
- `interactions(id, application_id, type, user_id, channel_id, server_id, token_hash,
  response_type, original_message_id, expires_at)`.
- `messages` gains `application_id` and `interaction_json` (plaintext metadata).
- `users.flags` gains `FlagBot = 64`, added to `publicFlags`. Bots cannot log in, have no
  password or recovery, and are excluded from friends, admin people counts and ownership
  transfer. Review every `NotPeople`/`FlagSystem` guard.

**Token.** The format is `base64url(appId) "." base64url(unix secs) "." base64url(32 random
bytes)`. That is Discord's three-part shape: some libraries parse the id out of the first part,
and the shape also makes leaked tokens recognisable. It is generated in the browser, and only the
hash is kept. **Reset Token** runs in the owner's browser:
1. open the escrow;
2. make a new token;
3. re-wrap;
4. `PUT /api/v1/applications/{id}/bot/credentials`.

The server then closes the bot's sessions with 4004. If the owner lost their identity (recovery),
the only option is "Reset Bot Keys": a new identity and deleted grants. Clients then show the
usual key-changed prompt.

**OAuth2 authorize.** URL:
`https://chat.evilion.xyz/oauth2/authorize?client_id=…&scope=bot+applications.commands&permissions=…[&guild_id=…&disable_guild_select=true]`.
It is an SPA route; the static handler already serves unknown paths. The page shows:
- the app card;
- a server picker (servers where the user has Manage Server);
- a permission list from the integer, with each box untickable (reuse `PermissionGrid`);
- the Read Messages checkbox, when the app has the Message Content toggle;
- the disclosure.

`POST /api/v1/oauth2/authorize` then:
1. creates the member and a **managed role** named after the app with the chosen permissions
   (`tags.bot_id`; it cannot be deleted or assigned by hand);
2. writes `application_installs`;
3. writes an audit entry `bot_add` (Discord action 28);
4. emits `member_add` and a GUILD_CREATE to the bot.

The page then grants keys (§4.2). `applications.commands` without `bot` is not offered: in Nexa an
install always adds the bot user, which keeps key and author handling uniform. Private apps
(`bot_public = false`) can only be installed by their owner.

**Where in the UI.** The owner asked for a "Developers" link in the home page's top bar and in
Settings, About.
- `/developers` is one SPA area. It holds the docs, readable signed out, and, when signed in,
  **My Applications**. It is a full page on desktop and a stacked page on phones.
  - The applications list: "New Application", with name and icon.
  - The app page:
    - General: name, description, icon.
    - Bot: username, avatar, **Reset Token** with a one-time Copy Token, the Public bot toggle,
      and privileged-intent toggles "Presence", "Server members", "Message content" (sentence
      case, since they are toggles).
    - Installation: the URL generator with scopes and the permission grid, and **Copy URL**.
    - Commands: read-only, as registered.
- The home page's top bar and Settings, About link to it. An optional "Developer Portal" item
  under App Settings can open the same page.
- Server Settings → Integrations gains an **Apps** section next to Webhooks.
- The member list and profile cards show the APP tag, the app's description, and Add to Server
  for public apps.
- Developer docs (in `/developers`, sourced from `docs/bots/`) cover the compat snippet,
  intents, limits, the encryption model and what is unsupported. They are **written in Nexa's own
  words**: nothing is copied from Discord's documentation, because of copyright.
  - The owner's request is explicitly about porting Discord bots, so the docs may name
    discord.py and the API they are compatible with. CLAUDE.md's "do not compare Nexa to
    Discord" still governs the rest of the app's copy ("bot libraries", "apps").

## 6. Phased implementation plan (task g)

Throughout:
- Go handlers go in `internal/api/bot_*.go` (compat REST) and `internal/api/oauth2_handlers.go`.
- Discord object serializers go in a new package `internal/discord`, so that `api` and `gateway`
  can share them without an import cycle.
- The dialect goes in `internal/gateway/dialect_discord*.go`, wired from api via hooks, like
  `ReadyExtras`.
- Bot crypto goes in `internal/e2ee` (built).
- Store code goes in `internal/store/applications.go`, `commands.go`, `interactions.go`.
- The web client gets `web/src/api/apps.ts`, `stores/apps.ts`, `pages/DevelopersPage.tsx` with
  `components/developers/*`, and `pages/AuthorizePage.tsx`.

Every phase adds Go tests, vitest tests, i18n in eleven locales, a What's New item for anything
people see, and phone and desktop screenshots via `tools/screenshot.py`. It is checked with
`test-bot.py` against a throwaway server (never :8090), with `NEXA_API=http://127.0.0.1:<port>/api/v10`.

Each phase lands in deployable slices, following `unfinishedbotwork.md`:
- **Planned but unbuilt** compat routes answer `501` with a Discord-shaped body
  (`{"message":"Not implemented yet on Nexa","code":0}`) and carry a `// Unfinished:` comment.
  discord.py raises `DiscordServerError` at once for 501 and does not retry it.
- **Things Nexa has no concept of** (automod, scheduled events, soundboard, SKUs) answer the
  truth: an empty list, or a Discord-shaped 404 (`{"message":"404: Not Found","code":0}`).

**P0 Groundwork (S).**
- `Via: 1.1 nexa` on every 429 that Discord-style clients see: webhook routes now, bot routes later.
- Move `dError`/`writeDiscordError` from webhook_errors.go to `discord_errors.go`.
- Extract `discordMessage` into `internal/discord`.
- A Discord-shaped `/api/v10` 404 catch-all.
- `docs/bots.md` skeleton.
- Add `test-bot.py` and `mock-nexa.py` to `tools/`.

**P1 Log in, read, reply (L).** Exit test: `test-bot.py` all PASS on a throwaway server, including
`NEXA_WAIT_HUMAN`.
- *Store:* the applications migration (applications, installs, `messages.application_id`),
  `FlagBot`, guards.
- *Auth:* `auth.BotMiddleware` (`Bot <token>` → app → bot user, no TTL); `limGeneric` keyed per
  bot. Bot sessions are counted separately in hub caps (16 per bot).
- *REST* (`bot_routes.go`, `bot_users.go`, `bot_guilds.go`, `bot_channels.go`,
  `bot_messages.go`):
  - `GET /users/@me`, `/users/{id}`;
  - `GET /oauth2/applications/@me`, `/applications/@me`;
  - `GET /gateway`, `/gateway/bot`;
  - `GET /guilds/{g}`, `/guilds/{g}/channels`, `/guilds/{g}/members/{u}`, `/guilds/{g}/roles`,
    `/users/@me/guilds`;
  - `GET /channels/{c}`;
  - `GET/POST /channels/{c}/messages`, `GET/PATCH/DELETE …/{m}`, `POST …/typing`;
  - `POST /users/@me/channels`;
  - `PUT /applications/{a}/commands` answering `[]`, so `tree.sync()` does not crash before P2.
- *Gateway* (`internal/gateway/dialect_discord.go`, `_translate.go`):
  - HELLO, heartbeat before IDENTIFY, IDENTIFY with intents, close codes;
  - READY and GUILD_CREATE from `serverViewUsers`;
  - MESSAGE_CREATE/UPDATE/DELETE/DELETE_BULK;
  - CHANNEL_CREATE/UPDATE/DELETE, GUILD_DELETE, TYPING_START;
  - RESUME answered with op 9 `d:false`;
  - bot sinks in `Hub` (hub.go: `bots map[ids.ID]map[*botSink]struct{}`, the emit functions and
    `Online`).
- *Crypto:* `internal/e2ee` (built), the runtime cache, decrypt on read, encrypt on send, ECF1 for
  uploads, signed decrypting attachment URLs, the store/keys.go entitlement filter, server-made DM
  epochs.
- *Portal and install:* `DevelopersPage` at `/developers` (docs plus My Applications: create an
  app, identity plus token plus escrow in `web/src/crypto/botIdentity.ts`, Reset Token, intent
  toggles, URL generator), linked from the home page's top bar (`pages/HomePage.tsx`) and
  Settings, About (`components/settings/AboutPage.tsx`); `AuthorizePage` at `/oauth2/authorize`;
  and `oauth2_handlers.go` (managed role, install row, grants from the page).
- *Chat UI:*
  - APP tag (MessageItem, member list, profile);
  - the app-message hint;
  - app payload extras rendered through the webhook components (`x` in `crypto/message.ts`);
  - Integrations → Apps;
  - the channel-header notice;
  - What's New "Apps and bots";
  - privacy policy and Terms updates (docs/legal/*.txt, legal_handlers.go).

**P2 Commands, interactions, components (L).**
- *Store:* `application_commands`, `interactions`.
- *REST:*
  - global and guild command CRUD and bulk overwrite, with Discord's validation errors (50035
    shaped, so `CommandSyncFailure` shows them);
  - `GET …/commands/permissions`;
  - `POST /interactions/{id}/{token}/callback` (`with_response`);
  - follow-ups and `@original` on the webhook-token paths (dispatch app id versus webhook id);
  - ephemeral delivery;
  - `POST /api/v1/interactions` for people;
  - `GET /api/v1/channels/{c}/application-commands` (the index).
- *Gateway:* INTERACTION_CREATE (with `resolved` for users, members, roles, channels,
  attachments), APPLICATION_COMMAND_PERMISSIONS_UPDATE, and the Nexa events
  `app_commands_update` and `interaction_modal` to clients.
- *Perms:* add `USE_APPLICATION_COMMANDS` (1<<31) to perms.go and the grid, i18n.
- *Web:*
  - the composer slash picker (components/composer: built-ins, plugin commands, then app commands
    grouped by app);
  - option entry per type: choices, autocomplete (debounced type-4 calls), user/role/channel
    pickers reusing the mention autocomplete, and attachment upload as a plaintext
    interaction file;
  - message and user context-menu "Apps" entries (messageMenu.ts, memberMenu.ts);
  - interactive buttons and selects (extend HookComponents), "{app} is thinking...", "Only you
    can see this" with a Dismiss Message button, a `ModalDialog` (label, text input, selects),
    and "The app did not respond.";
  - What's New "Slash commands".

**P3 Members, moderation, presence, robustness (M-L).**
- Members: GUILD_MEMBER_*, op 8 chunking with nonce and `presences`, privileged intents with
  4014, `members/search`, full member PATCH.
- Roles, channels and overwrites: routes and events.
- Moderation: bans (`delete_message_seconds`), `bulk-ban`, kicks, timeouts, GUILD_BAN_*.
- Audit log: the action map, reasons on every route, GUILD_AUDIT_LOG_ENTRY_CREATE.
- Reactions: every route and event. Pins: new and legacy routes. Bulk delete.
- Invites and webhooks by bot, WEBHOOKS_UPDATE.
- Presence: op 3 and PRESENCE_UPDATE.
- Voice: VOICE_STATE_UPDATE and voice moderation.
- Reliability:
  - RESUME with a per-session replay ring (1,000 events or 2 minutes);
  - real rate-limit headers (a `ratelimit.Limiter.Peek`);
  - optional zlib-stream (`compress/zlib` Flush);
  - `/cdn` redirects.

**P4 Threads and forums, for everyone (L).**
- *Store:* channel types `thread_public`/`thread_private`, `thread_members`, archive fields.
- *Keys:* private-thread epochs (§4.7).
- *REST and gateway:* all thread routes and events; forum type 15 with tags; `message.thread`.
- *Web:*
  - "Create Thread" from the message menu and the channel header;
  - thread panel and sidebar nesting;
  - forum channel view;
  - What's New "Threads".

**P5 Polls, stickers, invites polish (M).**
- Bot polls (encrypted text, server tallies, expire).
- A **Create Poll** composer for people. `unfinishedbotwork.md` already queues it (E2EE question
  and answers, server-side tallies), so it may land first; this phase then only maps it to the
  bot API.
- Stickers by id (read-only pack mapping).
- Guild emoji management by bots.
- Graceful stubs for automod, events and so on.

**P6 Encrypted Apps and scale (L).**
- The `nexa-bridge` sidecar (design 2) with `nexa_envelope` passthrough.
- Sharding (`(server_id >> 22) % n`).
- HTTP interactions endpoint (Ed25519 `verify_key` signatures).
- User-installed apps (maybe).

Not planned: bot voice audio; stage channels; SKUs and entitlements.

## 7. Risks and open decisions

1. **The E2EE claim.** The README says the server "can read none of" messages. Design 1 makes
   that false for channels an app with Read Messages can see, live. The owner must accept this,
   and the README, privacy policy, Terms and in-app copy must change the same day. It is a legal
   surface too (legal_handlers.go serves the texts).
2. **Key availability.** A bot has no key until someone who holds it is online, but the install
   grant covers the common case. Rotations are made by people's clients and include the bot. A
   channel made while no key-holding person is online stays unreadable to the bot until someone
   is. Surface this as `50001` and `nexa_undecryptable`.
3. **Trust in "is this a bot with consent".** Clients grant to whoever the server lists. A
   malicious server could list a fake app as consenting. This is the same class of risk as today's
   fail-open member check. Mitigations:
   - the client grants to a bot only if it shows as an APP with Read Messages in the member list
     it has loaded;
   - every such grant is logged on the Encryption page.
4. **Compatibility drift.** 2.5 switched interaction callbacks to `with_response`; 2.6 moved pins
   (`/messages/pins`) and role colours (`colors`) and added components v2 and modal labels.
   Mitigations:
   - pin `test-bot.py` plus a larger P2/P3 suite in CI against the last two discord.py releases;
   - golden-JSON tests for `internal/discord`;
   - keep a compatibility matrix in `docs/bots.md`.
5. **Silent crashes from shapes.** Missing `flags` on a member, a partial MESSAGE_UPDATE, a
   charset in the content type, or `X-RateLimit-Remaining` without Reset each break discord.py.
   Serializers must be typed structs with required fields, not ad-hoc maps.
6. **Load.** Every bot session gets a per-bot copy of each event: decrypt, JSON and no shared
   encoding. SQLite has a single writer, and bots post more than people. Bound it with:
   - per-bot send queues, and dropping sessions that lag (close 4000; they resume);
   - intents (no content decrypt without MESSAGE_CONTENT);
   - `limMsg`.
   Measure with a 1,000-member server fixture.
7. **Hub regression risk.** Human connections share encoded frames and tuned timeouts. Keep bot
   sinks on a separate path, and test that nothing changes for `conn`.
8. **Abuse.**
   - Bots never tire. `dm_privacy` applies to bots.
   - Instance staff can disable an app (FlagDisabled on the bot and the app).
   - Public bots are rate-limited on installs.
   - Tokens are hashed. Resets close sessions.
9. **Ids and epochs.** Bots must set `DISCORD_EPOCH` or times are 11 years off. Other libraries
   (discord.js, hikari, JDA) need their own equivalent, which some cannot patch easily. This
   limits the platform to libraries with a URL knob plus an epoch knob. Document a support
   matrix.
10. **Owner decisions needed:**
    - accept design 1 and its disclosure;
    - confirm that developer docs may name discord.py, in Nexa's own words;
    - whether apps can be public from day one;
    - the per-bot session and server caps;
    - whether interaction attachments (plaintext) are allowed.

## Appendix A. Nexa event → bot event

| Nexa (`internal/gateway/protocol.go`) | Discord dispatch | intent (bit) |
|---|---|---|
| `server_create` / `server_update` / `server_delete` | GUILD_CREATE / GUILD_UPDATE / GUILD_DELETE `{id, unavailable?}` | GUILDS (0) |
| `channel_create` / `_update` / `_delete`; `channel_positions` | CHANNEL_CREATE / UPDATE / DELETE; n × CHANNEL_UPDATE | GUILDS |
| `role_create` / `_update` / `_delete` | GUILD_ROLE_CREATE / UPDATE `{guild_id, role}`, GUILD_ROLE_DELETE `{guild_id, role_id}` | GUILDS |
| `member_add` / `_update` / `_remove` | GUILD_MEMBER_ADD (member plus `guild_id`) / UPDATE / REMOVE `{guild_id, user}` | GUILD_MEMBERS (1), privileged |
| `ban_add` / `ban_remove` | GUILD_BAN_ADD / REMOVE `{guild_id, user}` | GUILD_MODERATION (2) |
| audit insert (new hook) | GUILD_AUDIT_LOG_ENTRY_CREATE | GUILD_MODERATION |
| `emoji_update` / `sticker_update` | GUILD_EMOJIS_UPDATE `{guild_id, emojis}` / GUILD_STICKERS_UPDATE | GUILD_EXPRESSIONS (3) |
| `webhooks_update` | WEBHOOKS_UPDATE `{guild_id, channel_id}` | GUILD_WEBHOOKS (5) |
| `invite_create` / `_delete` | INVITE_CREATE / DELETE | GUILD_INVITES (6) |
| `voice_state` | VOICE_STATE_UPDATE | GUILD_VOICE_STATES (7) |
| `presence`, `user_update` | PRESENCE_UPDATE; USER_UPDATE (for the bot itself) | GUILD_PRESENCES (8), privileged |
| `message_create` / `_update` / `_delete` / `_delete_bulk` | MESSAGE_CREATE / UPDATE (full) / DELETE / DELETE_BULK | GUILD_MESSAGES (9), DIRECT_MESSAGES (12); content needs MESSAGE_CONTENT (15) |
| `reaction_add` / `reaction_remove` | MESSAGE_REACTION_ADD (with `member`, `type:0`, `message_author_id`) / REMOVE | GUILD_MESSAGE_REACTIONS (10), DIRECT_MESSAGE_REACTIONS (13) |
| `typing` | TYPING_START (`timestamp` in seconds) | GUILD_MESSAGE_TYPING (11), DIRECT_MESSAGE_TYPING (14) |
| `pin_update` | CHANNEL_PINS_UPDATE `{guild_id, channel_id, last_pin_timestamp}` | GUILDS / DIRECT_MESSAGES |
| `poll_vote_add` / `_remove` | MESSAGE_POLL_VOTE_ADD / REMOVE | GUILD_MESSAGE_POLLS (24), DIRECT_MESSAGE_POLLS (25) |
| (new) interactions | INTERACTION_CREATE | none (always) |
| `key_grant` | none: updates the bot keyring | |
| `keys_needed`, `key_rotation_needed`, `read_state`, `relationship_*`, `settings_update`, `call_*`, `nexa_*`, `mod_*`, `sticker_recent`, `voice_signal` | dropped | |

## Appendix B. Type maps

- **Channels:** `text` → 0, `voice` → 2 (`bitrate` 64000, `user_limit`, `rtc_region` null,
  `video_quality_mode` 1), `category` → 4, `dm` → 1 (`recipients`: the other person),
  `group_dm` → 3 (`recipients`, `name`, `icon`, `owner_id`), `subchat` → not exposed.
  From P4: `thread_public` → 11, `thread_private` → 12, `forum` → 15.
- **Overwrites:** `target_type` `role` → 0, `member` → 1. `allow` and `deny` are strings.
- **Messages:** `default` → 0; `reply` → 19; `system_join` → 7; `system_member_add` → 1;
  `system_member_remove` → 2; `system_pin` → 6; `system_call` → 3;
  `system_poll_result`/`poll_result` → 46.
  - New: interaction replies → 20 (chat input) or 23 (context menu); thread-created → 18;
    thread starter → 21.
  - Flags pass through (pinned is bit 0 in Nexa's `flags`; Discord uses the `pinned` boolean).
- **Timestamps:** Nexa epoch milliseconds → ISO 8601 `+00:00` with microseconds, as
  `discordMessage` already formats them. `communication_disabled_until` comes from
  `timeout_until`.
- **Permissions:** identical bits. Add `SEND_TTS_MESSAGES` (1<<12), `USE_EXTERNAL_EMOJIS` (1<<18),
  `USE_APPLICATION_COMMANDS` (1<<31), and in P4 the thread bits `MANAGE_THREADS` (1<<34),
  `CREATE_PUBLIC_THREADS` (1<<35), `CREATE_PRIVATE_THREADS` (1<<36) and
  `SEND_MESSAGES_IN_THREADS` (1<<38). Keep unknown bits when round-tripping, so `Permissions`
  edits by bots do not clear them.
