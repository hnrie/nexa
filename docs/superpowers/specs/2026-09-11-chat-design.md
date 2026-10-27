# Evilion Chat — design spec

Date: 2026-09-11. Status: approved by the owner's brief ("write out your entire plan
before you do it"); this document is the plan.

A self-hosted, end-to-end-encrypted chat platform with a Discord-shaped UI, served at
`https://chat.evilion.xyz` through the existing Cloudflare tunnel on this Mac. No
paywalled features: every account gets animated avatars, banners, unlimited "about
me", display names, custom sticker packs, HD screen share and big uploads.

---

## 1. Goals, constraints, non-goals

**Goals**

1. Discord-parity UX: server rail, channel sidebar, chat, member list, DMs, friends,
   voice channels, settings modals, pickers — laid out and styled like the 2025
   Discord client (measured from the running client, see §9), without using any
   Discord asset, font, logo, sound or name.
2. Everything that Discord charges for or refuses to add: user sticker packs,
   unlimited server emoji/stickers, animated profiles for all, unlimited about me,
   themes, big uploads, HD/60fps screen share, favourite GIFs, mark-as-unread, and so on
   (§3 has the full list).
3. End-to-end encryption of all message content and attachments, with history stored
   server-side so any device can log in and read it (§6).
4. Servers with categories, drag-and-drop channel reordering, role permissions,
   per-channel permission overwrites, invites, moderation and audit log (§7).
5. Voice, video and screen share that work well for the sizes this instance will see (§8).
6. High performance: Go backend, one static binary, SQLite in WAL mode; Vite/React
   frontend with virtualised lists; works on phones.
7. Starts at boot on this Mac and survives restarts (§10).

**Hard constraints discovered in the environment**

- The Mac is an Intel i7-4790 with 16 GB on macOS 13.7. Compiles are slow, so the
  toolchain is prebuilt binaries only: Go 1.27 (already installed), Node 22 LTS (official
  tarball, installed to `/usr/local/lib/nodejs`), Playwright's Chromium headless shell.
  Go is chosen over Rust for the backend because a full Rust build of a comparable
  server would take 10–30 minutes on this box; Go builds in seconds and is more than
  fast enough for a chat server (goroutine-per-connection, zero-copy fan-out).
- The only way in from the internet is the Cloudflare tunnel (`server/tunnel/`). Only
  HTTP and WebSocket traffic traverses it. WebRTC media therefore cannot reach a media
  server on this Mac, so calls are peer-to-peer mesh (§8). Uploads are capped at 100 MB
  by Cloudflare's free plan.
- There is no `~/.cloudflared/cert.pem` and no Cloudflare API token on the box, so the
  DNS record for `chat.evilion.xyz` is the one step that needs the owner (§10.4). The
  ingress rule itself is local config and is done by the deploy script.
- No Discord asset may be copied. Fonts: Noto Sans (OFL) — which is also Discord's own
  fallback face — and JetBrains Mono (OFL). Icons: lucide (ISC). Sounds: synthesised at
  runtime with Web Audio, no audio files.

**Non-goals for this build** (explicitly out, so nobody expects them)

- SFU-based large voice rooms (needs a public UDP port or Cloudflare Realtime; upgrade
  path in §8.6). Mesh is targeted at up to ~10 participants.
- Server-side content moderation / AutoMod (impossible under E2E), bots/webhooks API,
  server discovery, threads/forum channels, stage channels, scheduled events, Nitro-style
  shop. Threads and polls are designed for but scheduled after the core (§12).
- Native mobile apps. The web app is responsive and installable as a PWA.
- Push notifications while the tab is closed (no VAPID push in v1; in-app and desktop
  notifications while the app is open).

---

## 2. Architecture

```
chat/
├── cmd/chatd/            Go entry point: config, migrations, HTTP + gateway, static files
├── internal/
│   ├── config/           env parsing, defaults, validation
│   ├── ids/              snowflake ids (41-bit ms since 2026-01-01, 10-bit node, 12-bit seq)
│   ├── db/               sqlite open (WAL, foreign keys, busy timeout), embedded migrations
│   ├── store/            typed queries per domain (users, servers, channels, messages, keys…)
│   ├── auth/             sessions, argon2id, rate limits for auth
│   ├── perms/            permission bitflags + Discord-algorithm resolver (pure, tested)
│   ├── api/              REST handlers by domain, JSON envelope, error codes, middleware
│   ├── gateway/          WebSocket hub: connections, subscriptions, event fan-out, presence
│   ├── voice/            voice-state registry + signalling relay (no media)
│   ├── media/            blob storage (content-addressed), magic-byte validation, serving
│   ├── unfurl/           SSRF-safe link preview fetcher with cache
│   └── ratelimit/        token buckets keyed by ip / user / route
├── web/                  Vite + React 18 + TypeScript (strict)
│   └── src/
│       ├── api/          typed REST client
│       ├── gateway/      WebSocket client, reconnect, event → store dispatch
│       ├── crypto/       keys, conversations, message/file encryption, IndexedDB keystore
│       ├── markdown/     Discord-flavoured markdown parser + React renderer
│       ├── stores/       zustand stores (auth, users, servers, channels, messages, voice, ui…)
│       ├── components/   UI, grouped by area (rail, sidebar, chat, members, pickers, modals…)
│       ├── pages/        route-level screens (login, register, app, invite, sticker pack)
│       ├── styles/       tokens.css (themes), base.css, per-component CSS modules
│       └── assets/       fonts (self-hosted), PWA manifest, generated icons
├── deploy/               launchd template, install.sh, route-dns.sh, tunnel ingress snippet
├── tools/                screenshot.py (multi-viewport), e2e.py (two-browser end-to-end run)
├── docs/                 this spec, the implementation plan, design reference captures
├── data/                 runtime (gitignored): chat.db, blobs/
└── logs/                 runtime (gitignored)
```

**Process model.** One `chatd` process listens on `127.0.0.1:8090`. It serves the SPA
(`web/dist`, with immutable cache headers for hashed assets), the REST API under
`/api/v1`, the gateway WebSocket at `/gateway`, and media at `/media/…`. The Cloudflare
tunnel forwards `chat.evilion.xyz` to it. No nginx in the path (the Go server handles
gzip/brotli, caching headers and ranges itself), which keeps the chat service
independent of the site's service, matching the parent repo's "deliberately
independent services" rule.

**Data.** SQLite (`modernc.org/sqlite`, pure Go, no cgo) in WAL mode with
`synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. One writer connection
(serialised through a mutex) and a pool of readers, which is the pattern that makes
SQLite fast under concurrency. Blobs on disk under `data/blobs/ab/cd/<sha256>`.

**Trust model.** The server is trusted for *authorisation* (who is a member, who may
view a channel) and *availability*, but never sees message or attachment plaintext.
Clients trust the server's membership claims when deciding whom to grant keys to; that
is the same trust model as Matrix and is the honest limit of server-mediated groups.

---

## 3. Feature list

Legend: **P1** ships in the first complete build, **P2** immediately after, **P3** when
the rest is solid. Everything is designed for now (schema, API shape) so later phases
are additive.

### Accounts and profiles
- P1 Register / log in with username + password; no email required. Optional
  registration modes: open (default), invite-only, closed; instance-level admin.
- P1 Unique lowercase usernames (`a-z 0-9 _ .`, 2–32) with no discriminator; display
  names (any Unicode, 1–32) changeable any time.
- P1 Animated avatars (GIF/APNG/WebP) and banners for everyone, up to 10 MB.
- P1 About me with no length limit, rendered with full markdown; pronouns; profile
  accent colour; custom status with emoji and expiry; online / idle / DND / invisible;
  auto-idle.
- P1 Per-server profiles: nickname and per-server avatar.
- P1 Sessions/devices list with remote log-out; password change; recovery key
  (shown once at registration) that restores encryption keys if the password is lost.
- P1 Friends: requests (send by username), accept/decline/cancel, remove, block/unblock;
  DM privacy (everyone / friends / nobody).
- P2 Friend nicknames and per-user notes (encrypted in your settings).
- P2 Instance admin page: registration mode, upload limits, user list, instance bans.

### Messaging
- P1 DMs, group DMs (up to 25, with name and icon), server text channels.
- P1 End-to-end encryption of message text, attachments and stickers references;
  history saved in the account and readable from any logged-in device.
- P1 Discord-flavoured markdown: bold, italic, underline, strikethrough, spoilers,
  inline code, fenced code with syntax highlighting, block quotes, headers, subtext,
  bulleted and numbered lists, masked links, autolinks, mentions of users / channels /
  roles / @everyone / @here, custom emoji, timestamps (`<t:…:R>` etc.), escapes.
- P1 4000-character messages for everyone; edit (with "edited" tag and time), delete,
  reply with quote and ping toggle, jump-to-message permalinks, pinning with a pins
  panel, reactions with Unicode and custom emoji and "who reacted" tooltips, quick
  reaction bar, message hover toolbar and context menu, mark as unread, copy text/link.
- P1 Attachments up to 100 MB (Cloudflare's cap): drag-and-drop, paste, multiple files,
  image/video/audio previews, spoiler attachments, lightbox with zoom and download,
  inline video and audio players; all encrypted.
- P1 Link previews: Open Graph / Twitter cards, direct image / GIF / video URLs embed
  inline, YouTube embeds (privacy-enhanced iframe), previews generated by the sender so
  recipients never reveal the URL; per-user "fetch link previews" toggle; sender can
  remove an embed from their message.
- P1 Animated GIFs embed inline from any direct URL; favourite any GIF with one click;
  favourites tab in the picker, stored encrypted in your settings.
- P1 Typing indicators, unread markers, "new messages" divider, per-channel mention
  badges, date dividers, message grouping, jump-to-present, load-older with scroll
  anchoring, virtualised list that stays smooth with thousands of messages.
- P1 Slow mode, NSFW channel gate, `/shrug` `/tableflip` `/unflip` `/me` `/spoiler` text
  commands, up-arrow to edit your last message, drafts per channel.
- P2 Message search over your local decrypted index with `from:` `in:` `has:`
  `before:` `after:` filters (private: the server never indexes content).
- P2 Forward message to another chat; polls (question/options encrypted, votes as
  option indexes); voice messages with waveform.
- P3 Threads; message scheduling; per-message translation hooks (none of these are
  in this build).

### Expressions
- P1 Emoji picker with categories, search, skin tones, frequently used, shortcode
  autocomplete; jumbo emoji for emoji-only messages.
- P1 Custom server emoji, static and animated, **no cap**, usable by anyone in any
  channel or DM (the "Nitro" restriction does not exist here); emoji management page.
- P1 **Sticker packs**: any user can create packs (name, description, cover), add
  stickers (PNG/APNG/GIF/WebP, 5 MB, name + tags), reorder, make a pack public with a
  shareable link, and install other people's public packs; servers own packs too,
  managed with the emoji permission; **no cap** on packs or stickers. Unified
  GIF / Stickers / Emoji picker with frequently-used, my packs, this server's packs,
  and installed packs, searchable by name and tags.
- P2 GIF search through Tenor when a `TENOR_API_KEY` is configured (proxied so the
  key never leaves the server); without a key the GIF tab shows favourites only.
- P3 Soundboard for voice channels (server-owned sounds, mixed into your outgoing
  audio).

### Servers
- P1 Create, edit (name, icon incl. animated, banner, description, system channel),
  transfer ownership, delete; leave server.
- P1 Channels: text, voice, categories; topic, slow mode, NSFW, voice user limit;
  create/edit/delete; **drag-and-drop reordering** of channels within and between
  categories and of categories themselves; collapsible categories; private channels
  with lock icon.
- P1 Roles: create, edit (name, colour, hoist, mentionable, full permission grid),
  drag-to-reorder hierarchy, assign to members; @everyone role; role colours on names.
- P1 Permissions: Discord's bitflag set and resolution algorithm (base roles →
  @everyone overwrite → role overwrites → member overwrite; Administrator; owner;
  timeouts), per-channel overwrite editor with allow / neutral / deny tri-state for
  roles and members, and server-side enforcement on every endpoint and gateway event.
- P1 Invites with expiry and max uses; invite page with server preview; system channel
  join messages.
- P1 Member list grouped by hoisted roles with presence, virtualised; member search;
  profile popouts with roles, member-since, mutual servers/friends and actions.
- P1 Moderation: kick, ban (with reason and message-purge window), unban, timeout
  (mute for a duration), change nicknames, delete others' messages, bulk delete; audit
  log with actor, target, changes and reason.
- P1 Encryption panel: key epoch status and "rotate keys now" (§6.5).
- P2 Server folders and drag-to-reorder of the server rail; server notification
  defaults; per-channel notification overrides; mute with duration.
- P2 Rules/verification gate for new members; announcement-style read-only channels
  via permissions template.

### Voice, video, screen share
- P1 Voice channels with join/leave, participant list under the channel with speaking
  rings, mute/deafen icons, camera and stream badges; DM and group-DM calls with ringing.
- P1 Push-to-talk (configurable key) or voice activity with adjustable sensitivity;
  noise suppression, echo cancellation and auto gain (browser DSP); input/output device
  selection; per-user volume (up to 200 %); local mute; server mute/deafen and move
  by moderators.
- P1 Camera video; screen share with system audio where the browser allows it,
  selectable 720p / 1080p / source at 30 or 60 fps for everyone; multiple simultaneous
  streams; focus / grid layouts; picture-in-picture for a stream; stream preview tiles.
- P1 Calls are encrypted end-to-end by construction (DTLS-SRTP directly between
  participants; no media server).
- P2 Priority speaker; voice channel text chat pane; connection quality indicator.
- P3 Soundboard; krisp-style ML noise suppression (RNNoise WASM).

### Client and appearance
- P1 Themes: Dark (default), Light, Ash (darker), Onyx (pure black / AMOLED), follow
  system; accent colour picker; font size and message spacing; cozy / compact display;
  reduced motion; underline links; high contrast.
- P1 Responsive layout: three-pane desktop, collapsible member list, tablet, and a
  phone layout with swipeable rail+sidebar and members drawers, sticky composer that
  respects the on-screen keyboard and safe areas; installable PWA.
- P1 Keyboard: quick switcher (Ctrl/Cmd+K), Alt+↑/↓ channel, Ctrl+Alt+↑/↓ server,
  Esc mark read / close, Ctrl+Shift+M mute, Ctrl+Shift+D deafen, Ctrl+E emoji, ↑ edit
  last, Shift+PageUp/Down scroll, Ctrl+/ shortcut help.
- P1 Notifications: unread and mention badges on rail, tab title count, desktop
  notifications (after decryption, so the preview is real), synthesised sounds for
  message / mention / call / join / leave, per-server and per-channel notification level
  (all / mentions / nothing) and mutes; DND suppresses.
- P1 Developer mode (copy ids), shortcut cheat-sheet, connection status banner with
  automatic reconnect, offline indicator.
- P2 Data export (profile + decrypted history you hold keys for) as a zip.

---

## 4. Data model

All ids are snowflakes (int64) stored as INTEGER and serialised as strings in JSON.
`created_at` are Unix milliseconds. Every table below is created by an embedded,
numbered migration; `PRAGMA user_version` tracks the schema.

```
users              id, username (unique, lowercase), display_name, auth_hash (argon2id of the
                   client's auth key), kdf_salt, kdf_params, public_key (X25519, 32 B),
                   enc_private_key (wrapped by password-derived key), enc_private_key_recovery
                   (wrapped by recovery-derived key), recovery_auth_hash, avatar_id, banner_id,
                   about_me, pronouns, accent_color, status_text, status_emoji,
                   status_expires_at, presence_pref, flags (admin, disabled), created_at, updated_at
sessions           id, user_id, token_hash (sha256), user_agent, ip, created_at, last_seen_at
user_settings      user_id, blob (ciphertext, client-encrypted), version, updated_at
relationships      user_id, target_id, type (friend | outgoing | incoming | blocked), created_at
servers            id, name, icon_id, banner_id, owner_id, description, system_channel_id,
                   flags, created_at
server_members     server_id, user_id, nickname, avatar_id, joined_at, timeout_until, flags
roles              id, server_id, name, color, hoist, mentionable, position, permissions, created_at
member_roles       server_id, user_id, role_id
channels           id, server_id (null for DM/group), type (text | voice | category | dm |
                   group_dm), name, topic, position, parent_id, nsfw, slowmode_seconds,
                   user_limit, owner_id (group DM), icon_id, last_message_id, created_at
channel_overwrites channel_id, target_id, target_type (role | member), allow, deny
dm_participants    channel_id, user_id, added_by, added_at
messages           id, channel_id, author_id, type (default | reply | system_join |
                   system_pin | system_call | system_member_add …), ciphertext (envelope),
                   key_conv_id, key_epoch, reply_to_id, mentions (json user ids),
                   mention_roles (json), mention_everyone, has_attachments, flags (pinned,
                   suppress_embeds), edited_at, created_at
attachments        id, message_id, channel_id, uploader_id, blob_id, size, created_at
                   (name/type/dimensions/decryption key are inside the encrypted message)
reactions          message_id, user_id, emoji (unicode string or custom id), created_at
pins               channel_id, message_id, pinned_by, pinned_at
read_states        user_id, channel_id, last_read_message_id, last_ack_at
invites            code, server_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at
bans               server_id, user_id, reason, banned_by, created_at
audit_log          id, server_id, actor_id, action, target_type, target_id, changes (json),
                   reason, created_at
emojis             id, server_id, name, blob_id, animated, creator_id, created_at
sticker_packs      id, owner_user_id (nullable), server_id (nullable), name, description,
                   cover_sticker_id, public, created_at, updated_at
stickers           id, pack_id, name, tags, blob_id, format, position, creator_id, created_at
sticker_installs   user_id, pack_id, installed_at
blobs              id, sha256, size, mime, kind (avatar | banner | icon | emoji | sticker |
                   attachment), encrypted, ref_count, created_at
key_epochs         conv_id, epoch, created_by, created_at, reason
key_grants         conv_id, epoch, user_id, wrapped_key, wrapped_by, created_at
key_flags          conv_id, needs_rotation, needs_own_key, updated_at
polls (P2)         message_id, options_count, multiselect, expires_at
poll_votes (P2)    message_id, user_id, option_index
```

Indexes: `messages(channel_id, id DESC)`, `messages(author_id)`, `reactions(message_id)`,
`read_states(user_id)`, `server_members(user_id)`, `key_grants(user_id, conv_id, epoch)`,
`relationships(target_id)`, `invites(server_id)`, `audit_log(server_id, id DESC)`,
`stickers(pack_id, position)`, `blobs(sha256)`.

**Conversation (`conv_id`) rule** — the unit that owns encryption keys:
- a DM or group DM channel → its own channel id;
- a server → the server id ("server root key");
- a server channel → its own channel id **if it has any key epochs** (created the
  moment it stops being viewable by @everyone), otherwise the server's.

---

## 5. Server internals

### 5.1 HTTP API (`/api/v1`)

JSON in and out; errors are `{ "error": { "code": "…", "message": "…" } }` with
appropriate HTTP status; `Authorization: Bearer <session token>` on everything except
`/auth/*`, `/invites/{code}` preview, `/health`, and public media.

```
auth       POST register, POST login (returns kdf params on GET /auth/kdf?username=), POST logout,
           POST recover, POST password (change), GET sessions, DELETE sessions/{id}
users      GET @me, PATCH @me (profile), PUT @me/avatar, PUT @me/banner, GET {id}, GET {id}/profile
           (with mutuals), GET @me/settings, PUT @me/settings, GET @me/keys, PUT @me/keys (rewrap)
relationships  GET, POST (by username), PUT {id} (accept), DELETE {id}, POST block/{id}, DELETE block/{id}
channels   GET {id}, PATCH {id}, DELETE {id}, GET {id}/messages?before|after|around&limit,
           POST {id}/messages, PATCH {id}/messages/{mid}, DELETE …, POST …/ack,
           PUT/DELETE …/reactions/{emoji}/@me, GET …/reactions/{emoji}, PUT/DELETE {id}/pins/{mid},
           GET {id}/pins, POST {id}/typing, POST {id}/attachments (multipart, returns blob id),
           PUT {id}/permissions/{target}, DELETE …, POST {id}/invites, GET {id}/invites,
           group DM: POST {id}/recipients/{uid}, DELETE …, PUT {id}/icon
dms        POST users/@me/channels {recipient_ids[]}  (creates or returns DM / group DM)
servers    POST, GET {id}, PATCH {id}, DELETE {id}, PUT {id}/icon, PUT {id}/banner,
           GET {id}/channels, POST {id}/channels, PATCH {id}/channels (bulk positions + parents),
           GET {id}/members?after&limit&q, GET/PATCH {id}/members/{uid}, DELETE …/members/{uid} (kick),
           PUT/DELETE {id}/members/{uid}/roles/{rid}, PATCH {id}/members/@me (nick, avatar),
           GET/POST {id}/roles, PATCH {id}/roles (positions), PATCH/DELETE {id}/roles/{rid},
           GET/PUT/DELETE {id}/bans/{uid}, GET {id}/invites, GET {id}/audit-log,
           GET/POST {id}/emojis, PATCH/DELETE {id}/emojis/{eid}, POST {id}/leave,
           POST {id}/transfer, PUT {id}/members/{uid}/timeout, PUT {id}/members/{uid}/voice (mute/deafen/move)
invites    GET {code} (preview), POST {code} (join), DELETE {code}
stickers   GET packs (mine + installed), POST packs, GET packs/{id}, PATCH/DELETE packs/{id},
           POST packs/{id}/stickers (multipart), PATCH/DELETE packs/{id}/stickers/{sid},
           PATCH packs/{id}/stickers (positions), PUT/DELETE packs/{id}/install, GET packs/public?q
keys       GET needs (conversations I hold keys for that have members lacking grants),
           POST grants (batch), POST epochs (rotate / create own key), GET grants (mine),
           GET users/{id}/public-key
unfurl     GET ?url=  (sender-side link preview; SSRF-guarded; cached)
media      GET /media/{kind}/{id}[.ext]  (public blobs), GET /media/attachments/{id} (ciphertext,
           requires channel access), Range supported, immutable cache for content-addressed ids
gif        GET search?q (only when TENOR_API_KEY set)
admin      GET stats, GET users, PATCH users/{id} (disable/admin), PATCH settings (registration)
health     GET /api/health → {"ok":true,"version":…}
```

Pagination is id-based (`before`/`after`), limit ≤ 100. Bulk-position updates are
transactional. Every mutating endpoint re-checks permissions server-side via `perms`.

### 5.2 Gateway (`/gateway`, WebSocket)

Frames are JSON `{ "op": "…", "d": … }`; server → client frames carry `"t"` event
names and a sequence number. Client ops: `identify {token}`, `heartbeat`,
`presence {status, custom}`, `typing {channel_id}`, `voice_state {channel_id|null,
self_mute, self_deaf, video, streaming}`, `voice_signal {to, payload}`,
`subscribe_members {server_id}` (member list is fetched by REST and then kept fresh).

Server events: `ready` (user, settings blob, servers with channels/roles/emoji/my member,
DMs, relationships, read states, presences, key grants, voice states), `message_create
/ update / delete / delete_bulk`, `reaction_add / remove`, `typing`, `channel_create /
update / delete / positions`, `server_create / update / delete`, `member_add / update /
remove`, `role_create / update / delete`, `presence`, `user_update`, `relationship_add /
remove`, `read_state`, `voice_state`, `voice_signal`, `call_ring / call_end`, `key_grant`,
`keys_needed`, `emoji_update`, `sticker_update`, `pin_update`, `ban_add / remove`,
`invite_create / delete`, `settings_update`, `session_expired`.

Heartbeat every 25 s from the client (Cloudflare closes idle sockets at ~100 s); the
server drops a connection that misses two. Reconnect uses exponential backoff with
jitter and a fresh `identify`; `ready` is idempotent so the client rebuilds state
rather than resuming a sequence.

Fan-out: the hub keeps `userID → []conn`, `serverID → set[userID]` (membership cache
loaded from the store and updated on member events) and `channelID → viewers` computed
through `perms` when a channel has overwrites. Per-connection outbound buffered
channel (256 frames); a slow consumer is disconnected rather than blocking others.
Presence is broadcast to friends and to co-members of shared servers, coalesced.

### 5.3 Permissions (`internal/perms`)

Bitflags (same names and values as Discord's so mental models transfer):
`CREATE_INSTANT_INVITE, KICK_MEMBERS, BAN_MEMBERS, ADMINISTRATOR, MANAGE_CHANNELS,
MANAGE_SERVER, ADD_REACTIONS, VIEW_AUDIT_LOG, PRIORITY_SPEAKER, STREAM, VIEW_CHANNEL,
SEND_MESSAGES, MANAGE_MESSAGES, EMBED_LINKS, ATTACH_FILES, READ_MESSAGE_HISTORY,
MENTION_EVERYONE, CONNECT, SPEAK, MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS, USE_VAD,
CHANGE_NICKNAME, MANAGE_NICKNAMES, MANAGE_ROLES, MANAGE_EMOJIS, MODERATE_MEMBERS,
USE_SOUNDBOARD, CREATE_POLLS`.

Resolution for (member, channel):
1. Owner → all. Else base = @everyone.permissions | OR of member roles.
2. If base has ADMINISTRATOR → all.
3. Apply @everyone overwrite: `base &^ deny | allow`.
4. Aggregate role overwrites for the member's roles: `base &^ (OR denies) | (OR allows)`.
5. Apply member overwrite.
6. Timed-out member → keep only VIEW_CHANNEL and READ_MESSAGE_HISTORY.
7. Without VIEW_CHANNEL, nothing else applies (return 0).

Hierarchy rules: a member may only manage (assign, edit, delete) roles positioned below
their highest role; may only kick/ban/timeout/manage members whose highest role is
below theirs; owner outranks all. The same module ships a table-driven test suite,
and the TypeScript client mirrors the pure function (with the same test vectors) so UI
affordances match server enforcement.

### 5.4 Auth

- Client derives `master = argon2id(password, salt, m=64MiB, t=3, p=1)` (hash-wasm),
  then `authKey = HKDF(master, "auth")`, `encKey = HKDF(master, "enc")`.
- Server stores `argon2id(authKey)` (`golang.org/x/crypto/argon2`, m=19MiB t=2 p=1, per-
  user salt) so a database leak reveals neither password nor encKey.
- `GET /auth/kdf?username=` returns the salt/params (also returns a deterministic fake
  for unknown usernames to avoid enumeration). Login rate limit: 5/min per IP and per
  username, with a fixed 300 ms minimum response time.
- Session token: 32 random bytes, base64url; stored hashed; 90-day rolling expiry;
  `sessions` lists devices. Tokens travel in `Authorization` for REST and inside the
  `identify` frame for the gateway (never in the URL).
- Recovery: a random 32-byte recovery key shown once (`XXXX-XXXX-…`), from which the
  client derives `recoveryAuthKey` and `recoveryEncKey` the same way; the server stores
  a hash of the first and a second wrapped copy of the private key under the second.

### 5.5 Media

- Public kinds (avatar, banner, icon, emoji, sticker) are validated by magic bytes
  (PNG, APNG, JPEG, GIF, WebP), dimension-checked (`image.DecodeConfig`, `x/image/webp`),
  size-limited by kind, content-addressed and served with `Cache-Control: public,
  max-age=31536000, immutable`; changing an avatar produces a new id, so caches never
  go stale.
- Attachments are opaque ciphertext; the server enforces channel access on download,
  supports `Range`, and caps size at `MAX_UPLOAD_BYTES` (default 100 MB).
- Garbage collection: a blob's `ref_count` drops when its owner row is deleted; an
  hourly sweep removes unreferenced blobs older than a day.

### 5.6 Unfurl

`GET /api/v1/unfurl?url=`: resolve the host, refuse loopback / private / link-local /
multicast ranges (re-checked on every redirect, max 3), only `http`/`https`, 6 s total
timeout, 2 MB read cap, parse `<meta>` og:/twitter: tags with `x/net/html`, detect
direct media by `Content-Type`, recognise YouTube ids; results cached in memory (LRU,
1 h). Rate limit 30/min per user.

### 5.7 Rate limits and hardening

Per-IP and per-user token buckets (`x/time/rate`) with route classes: auth (strict),
messages (5 per 5 s per channel per user, plus server slow mode), uploads (10/min),
unfurl, typing (1 per 8 s), generic (60/min). `429` with `Retry-After`. Body size
limits per route. Security headers: strict CSP (`default-src 'self'`; images/media
from `https:` and `blob:`/`data:` for embeds; `frame-src` only the privacy-enhanced
YouTube host; `connect-src 'self' wss:`), `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` for camera/microphone/display-capture same-origin. WebSocket
origin check against `PUBLIC_URL`. All user-supplied strings are length-capped and
control-character-stripped. Snowflake ids are not guessable in a useful way.

---

## 6. End-to-end encryption

### 6.1 Primitives
X25519 (`@noble/curves`) for key agreement, HKDF-SHA-256 (`@noble/hashes`) for key
derivation, AES-256-GCM (WebCrypto) for all symmetric encryption, Argon2id (`hash-wasm`)
for password stretching, `crypto.getRandomValues` for randomness. Tests run under Node's
WebCrypto in vitest with fixed vectors.

### 6.2 Identity keys
At registration the client generates an X25519 keypair. The private key is wrapped
with AES-GCM under `encKey` (and under `recoveryEncKey`) and stored on the server with
the public key. On login from any device the client fetches the wrapped key, unwraps it
locally and keeps it in memory and in an IndexedDB keystore (cleared on logout). This
is what makes "saved in the account" work without the server ever holding a usable key.

### 6.3 Conversation keys and epochs
Each conversation (§4 rule) has epochs `0..n`; each epoch has a random 32-byte **root
key**. Per-channel message keys are `HKDF(root, info = "chan:" + channel_id)`, so a
server's channels all derive from one root while a private channel with its own
conversation uses its own root. A key is handed to a user as a **grant**: a sealed box
(ephemeral X25519 → HKDF → AES-GCM) addressed to the user's public key, stored by the
server. Users always self-grant keys they create or receive so any of their devices
can fetch them.

### 6.4 Distribution
- **DM**: the first sender creates epoch 0 and grants it to both parties.
- **Group DM**: the creator creates epoch 0 and grants all recipients; whoever adds a
  member grants them the current epoch.
- **Server**: the creator creates the server root; **invite links carry the current
  root key in the URL fragment** (`/invite/CODE#k=…`), which never reaches the server,
  so a new member can read immediately and self-grants on join. Members joining
  without a fragment (or after a rotation) fall back to the request path below.
- **Reconciliation**: the server knows who *should* hold which keys (membership +
  `perms`) and who *does* (grants). `keys_needed` events and `GET /keys/needs` tell key
  holders about members lacking grants; every online holder's client fulfils them
  automatically (batched, deduplicated by the server accepting the first grant). This
  single mechanism covers joins, DM creation, role changes, permission changes and new
  epochs. If nobody with the key is online, the recipient sees "waiting for a member to
  share the key" and the messages decrypt the moment a grant arrives.
- **Private channels**: when a channel stops being viewable by @everyone the server
  sets `needs_own_key`; the acting client creates epoch 0 for that channel and grants
  the current viewer set. The rule "a channel with epochs uses its own key" then holds
  permanently. Messages sent before the switch stay under the server root (they were
  public when written).

### 6.5 Rotation
Leaving, kick, ban, group-DM removal, or a viewer-set shrink sets `needs_rotation`;
the acting client (or the next online key holder) creates a new epoch and grants it to
the entitled set. Server settings has "Rotate keys now". Old epochs are kept so history
stays readable; removed members cannot decrypt later messages even if they obtained the
ciphertext. Rotation invalidates the key in old invite links, which then use the request
path.

### 6.6 Message envelope
```
ciphertext = AES-256-GCM(key = HKDF(root, "chan:"+channel), iv = 12 random bytes,
             aad = conv_id | epoch | channel_id | author_id,
             plaintext = JSON { t: text, att: [{blob_id, name, type, size, w, h, key, spoiler}],
                                sticker: {id}, embeds: [unfurl results], poll, flags })
stored     = { v:1, conv, epoch, iv, ct }   (base64 fields)
```
The AAD binds a ciphertext to its channel and author, so the server cannot replay a
message into a different channel or under a different author. Mentions (user ids, role
ids, @everyone) are sent as plaintext metadata so the server can compute mention badges;
reactions and emoji/sticker ids are plaintext too. Attachments use a random per-file
key, encrypted in 4 MiB chunks (IV = 8 random bytes ‖ 32-bit chunk counter) so memory
stays bounded; the file key rides inside the message plaintext.

### 6.7 What the server can see
Who talks to whom and when, message sizes, mentions, reactions, sticker/emoji ids,
profiles, server structure, and the URL when a *sender* asks for a link preview. It
cannot see text, attachments, file names, poll text or sticker choices' context. Client
keys live in the browser profile's IndexedDB while logged in, the standard trade-off for
web E2E clients.

---

## 7. Frontend

### 7.1 Stack
React 18 + TypeScript strict, Vite 6, `zustand` stores with selectors, `react-router`
6, `@tanstack/react-virtual` for the message list and member list, `highlight.js`
(lazy per language), `emojibase-data` (compact set, loaded once and cached), `lucide-
react`, `@fontsource/noto-sans` and `@fontsource/jetbrains-mono` (self-hosted, no
external CDN so the CSP stays strict), `idb-keyval`-style tiny IndexedDB wrapper written
in-house, `vitest` + `@testing-library/react` for tests. No CSS framework: hand-written
CSS modules over a token sheet, because fidelity to the measured Discord layout matters
more than a utility system.

### 7.2 Routes
`/login`, `/register`, `/recover`, `/invite/:code`, `/stickers/pack/:id`,
`/channels/@me` (friends), `/channels/@me/:channelId` (DM), `/channels/:serverId/:channelId`,
`/channels/:serverId/:channelId/:messageId` (jump), settings as overlay routes
(`?settings=account` etc.) so the back button closes them on phones.

### 7.3 State
- `auth` (session, me, keys unlocked), `users` (id → user, presence), `relationships`,
  `servers` (id → server, members map, roles, emoji, my permissions cache), `channels`,
  `messages` (per channel: ordered id array + map, oldest/newest cursors, decrypted
  cache), `readStates`, `typing`, `voice` (channel states, my peers, local devices),
  `ui` (theme, panes, modals, drafts, quick switcher), `expressions` (emoji index,
  sticker packs, favourites), `settings` (decrypted blob, debounced encrypted save).
- Decryption is memoised per message id; `messages` store holds ciphertext and the
  decrypted payload, so re-renders never re-decrypt. Decryption for a page of 50 runs
  in a microtask batch to keep scrolling smooth; a Web Worker is used for attachment
  crypto so 100 MB files do not block the UI.
- The gateway client applies events to stores through a single reducer-like dispatcher
  with exhaustive `switch` on event type (TypeScript `never` check), so an unhandled
  event fails typecheck instead of silently dropping.

### 7.4 Key screens (all measured against the reference captures)
- **App shell**: 72 px server rail (`#2c2d32` in Dark), 240 px sidebar (resizable
  200–420 px, remembered), chat area on a raised surface (`#323339`) with a 12 px
  top-left radius, 49 px header, 240 px member list (toggle). User panel pinned at the
  sidebar bottom (avatar, name, status, mute/deafen/settings buttons) with the voice
  panel above it when connected.
- **Message row**: 40 px avatar at x=16, content padded left 72 px, 16 px/22 px text,
  username 16 px/500 with role colour, 12 px timestamp, 2 px vertical padding, hover
  background `#97979f` at 6 %; compact mode uses 12 px inline timestamps.
- **Composer**: 8 px radius surface (`#393a41`), 44 px minimum height, auto-grow to 50 %
  of the viewport, `+` attach at left, emoji/GIF/sticker at right, autocomplete popover
  above.
- **Pickers**: 498×498 popover with tabs GIFs | Stickers | Emoji, search field,
  category rail on the left, section headers, hover inspector at the bottom.
- **Settings**: full-screen layer, 218 px left nav with 32 px items and section headers,
  740 px content column, close button top-right with `ESC` label.
- **Voice view**: participant tiles (16:9, avatar centred, speaking ring
  `#3d9e60`), focused stream layout with a strip of tiles, bottom control bar (mute,
  deafen, camera, share, disconnect).
- **Phone (< 768 px)**: one pane at a time; the rail and sidebar slide in from the
  left, members from the right; a bottom bar in DMs for Home / Notifications / You;
  composer sticks above the keyboard using `visualViewport`.

### 7.5 Markdown
A single-pass tokenizer over the message string producing an AST (paragraph, text,
strong, em, underline, strike, code, codeblock{lang}, spoiler, quote, heading{1-3},
subtext, list{ordered}, listItem, link{url, masked}, autolink, mention{user|channel|role|
everyone|here}, emoji{unicode|custom}, timestamp{unix, style}, br). The renderer maps AST
→ React elements; nothing is ever injected as HTML. Rules follow Discord's: no
formatting across lines except code blocks and quotes; `\` escapes; headers only at line
start; lists at line start; masked links only with `http(s)`; jumbo emoji when the
message is only emoji (≤ 30). The parser has a property-based test that any input
renders without throwing and a fixture suite of ~80 Discord-behaviour cases.

### 7.6 Voice client
`RTCPeerConnection` per remote participant, perfect-negotiation pattern (polite peer =
lower user id), Unified Plan, Opus with DTX and 48 kHz stereo for screen-share audio,
`RTCRtpSender.setParameters` to cap bitrate per track, `getUserMedia` with
`echoCancellation / noiseSuppression / autoGainControl`, AudioWorklet RMS meter for
speaking detection and PTT gating (track enabled/disabled), per-peer `GainNode` for
volume, `getDisplayMedia` with `{ video: { frameRate, width, height }, audio: true,
systemAudio: "include" }`. ICE: STUN `stun.cloudflare.com:3478` and
`stun.l.google.com:19302`; optional TURN from server config exposed at
`GET /api/v1/voice/ice` (supports Cloudflare TURN credentials). Reconnect a peer on
`failed`; renegotiate on track add/remove. The UI warns above 10 participants.

---

## 8. Voice and video

8.1 **Topology**: full mesh through the gateway for signalling; media peer-to-peer.
8.2 **Join**: client sends `voice_state {channel_id}`; server validates CONNECT, user
limit, timeouts; broadcasts the state; the joiner opens offers to every existing
participant (impolite peer initiates). 8.3 **Leave/move**: server clears state,
peers tear down. 8.4 **Moderation**: MUTE_MEMBERS / DEAFEN_MEMBERS / MOVE_MEMBERS set
server flags that the target's client enforces (server mute disables its own outgoing
track; peers also drop the track locally). 8.5 **DM calls**: `call_ring` to the other
recipients; accept joins the DM's voice "channel" (the DM channel id); the chat shows
a call banner with join/decline; ringing times out at 60 s. 8.6 **Upgrade path**: if the
instance ever needs 20+ person rooms, add a Cloudflare Realtime SFU adapter — the client
already isolates media transport behind a `VoiceTransport` interface, and the server
would mint Realtime session tokens; nothing else changes.

---

## 9. Visual reference

Captured from the running client on 2026-09-11 (Discord 0.0.411, 2025 redesign) over
the Chrome DevTools protocol; kept under `docs/design/reference/` (colour tokens in
`palette-final.json`, layout metrics in `metrics*.json`). Personal screenshots were
removed before publication. Token values are
numbers and colours (not copyrightable); no asset or text was copied.

Dark tokens used: base `#2c2d32`, raised `#323339`, surface `#393a41`, floating/modal
`#393a41`, hover `#97979f/12%`, selected `#97979f/12%`, text `#f3f3f4`, strong `#fff`,
subtle `#c5c6ca`, muted `#abacb2`, channel `#999aa1`, placeholder `#6c6d76`, brand
`#5865f2` (hover `#4654c0`, active `#3a48a3`), link `#76aff6`, text-brand `#94a8ff`,
mention bg `#5865f2/24%` fg `#cdd7ff`, positive `#3d9e60`, warning `#fdb833`, danger
`#da3e44`, border subtle `#97979f/12%` strong `/44%`, scrollbar thumb `#767780`,
spoiler hidden `#7d7e87`, radii 4/8/12/16/24, shadows low `0 1px 4px #000/14%`, medium
`0 4px 8px #000/16%`, high `0 12px 24px #000/24%`. Light: base `#f3f3f4`, chat `#fff`,
text `#2e2e34`, muted `#6c6d76`, channel `#666770`, link `#006dd4`, positive `#269153`,
danger `#d6363f`. Ash: raised `#27272c`, chat `#323339` on base `#1e1f22`. Onyx: chat
`#000`, raised `#131416`, text `#d4d5d8`.

---

## 10. Deployment and operations

10.1 **Build**: `make build` → `cd web && npm ci && npm run build` then
`go build -trimpath -ldflags "-s -w" -o bin/chatd ./cmd/chatd`. `make test` runs
`go vet`, `go test -race ./...`, `npm run typecheck`, `npm test`.
10.2 **Config**: `chat/chatd.env` (mode 600), keys: `LISTEN=127.0.0.1:8090`,
`PUBLIC_URL=https://chat.evilion.xyz`, `DATA_DIR=./data`, `WEB_DIST=./web/dist`,
`MAX_UPLOAD_BYTES=104857600`, `MAX_AVATAR_BYTES`, `MAX_EMOJI_BYTES`, `MAX_STICKER_BYTES`,
`REGISTRATION=open|invite|closed`, `ADMIN_USERNAME`, `TURN_URLS`, `TURN_USERNAME`,
`TURN_CREDENTIAL`, `TENOR_API_KEY`, `LOG_LEVEL`. Missing file → sane defaults; a bad
value fails fast with a clear message.
10.3 **Service**: `deploy/xyz.evilion.chat.plist.in` rendered by `deploy/install.sh`
into `/Library/LaunchDaemons/xyz.evilion.chat.plist` (same shape as the parent's
daemons: runs as the folder owner, `KeepAlive`, `RunAtLoad`, `ThrottleInterval 5`,
`ExitTimeOut 30`, 4096 files, logs to `chat/logs/chatd.log`). `chatd` handles SIGTERM by
closing the gateway, checkpointing WAL, and exiting within 10 s.
10.4 **Tunnel**: `deploy/install.sh` inserts
`- hostname: chat.evilion.xyz / service: http://127.0.0.1:8090` into
`server/tunnel/config.yml` before the catch-all (idempotent) and restarts the site
daemon (`launchctl kickstart -k system/xyz.evilion.evilionxyz`). DNS needs one of:
`cloudflared tunnel login` then `deploy/route-dns.sh` (runs `cloudflared tunnel route
dns <YOUR_TUNNEL_ID> chat.evilion.xyz`), or a dashboard CNAME `chat →
<YOUR_TUNNEL_ID>.cfargotunnel.com` (proxied). `install.sh` checks
with `dig` and prints exactly which is missing.
10.5 **Backups**: `chat/backup.sh` uses `sqlite3 .backup` (safe under WAL) plus
`data/blobs`; documented for inclusion in the parent's `backup.sh`.
10.6 **Health/observability**: `/api/health`, structured logs (JSON lines with request
id, latency, status), `/api/v1/admin/stats` (users, messages, connections, blob bytes).
10.7 **Updates**: `make build && sudo launchctl kickstart -k system/xyz.evilion.chat`.
Migrations run at start, forward-only, inside a transaction each.

---

## 11. Testing and verification

- **Go**: table tests for `perms` (≥ 40 cases incl. hierarchy), `ids`, `ratelimit`,
  `unfurl` guard (private ranges, redirects), `media` validation; handler tests with
  `httptest` and a temp SQLite for auth, servers, channels (positions), messages
  (pagination, permissions), keys (reconciliation), stickers; gateway tests using a real
  WebSocket client for identify → ready → message fan-out and presence. `go test -race`.
- **Web**: vitest for crypto (round trips, wrong key fails, AAD mismatch fails, chunked
  file round trip), markdown fixtures, permission mirror vectors, stores (gateway event
  application), composer autocomplete logic. `tsc --noEmit` strict.
- **End-to-end** (`tools/e2e.py`, Playwright): starts `chatd` on a temp data dir, two
  browser contexts register, friend, DM, create server, invite, join via link, send
  messages, attachments, reactions, edit, pin, reorder channels, set permissions and
  assert the other user loses visibility, rotate keys, join a voice channel (fake media
  devices) and confirm peers connect; then screenshots at 1920×1080, 1366×768,
  820×1180 and 390×844 which are reviewed visually before each phase is called done.
- **Startup check**: `deploy/install.sh --check` verifies the binary runs, the port
  answers, the tunnel ingress exists, DNS resolves and the public URL returns the app.

---

## 12. Delivery phases

0. **Scaffold + live "hello"**: repo layout, build, config, migrations, health route,
   SPA shell served, launchd + tunnel ingress installed → `chat.evilion.xyz` answers as
   soon as DNS exists.
1. **Accounts, keys, DMs**: auth, identity keys, recovery, gateway, users/profiles,
   friends, DMs/group DMs with E2E messages, markdown, attachments, app shell (desktop
   and phone), settings (account, profile, appearance).
2. **Servers**: channels/categories/reordering, roles and permissions, overwrites,
   invites (with key fragment), member list, moderation, audit log, unread/mentions,
   notifications, server/channel settings, key reconciliation and rotation.
3. **Expressions & embeds**: emoji picker, custom emoji, sticker packs (user + server),
   GIF favourites, reactions, link/GIF/video/YouTube embeds, pins, replies, lightbox.
4. **Voice/video/screen share**: voice channels, DM calls, devices, PTT/VAD, streams.
5. **Polish**: search, quick switcher, shortcuts, PWA, themes, mobile QA, admin page,
   backups, docs; then P2 items in order.

Each phase ends with the test suites green, the e2e script passing, screenshots
reviewed, a build installed under launchd, and a commit.
