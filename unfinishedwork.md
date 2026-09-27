# Unfinished work

Requests from the owner that are not built yet, written so a new session with
no memory can do them exactly. Follow `CLAUDE.md` (UI text rules, all eleven
translations, never `npm run build` / `make web` / `make server` /
`make build`, migrations in both SQLite and Postgres folders, check UI at
desktop and phone sizes). Keep every commit deployable. When one is done,
remove it from this file in the same commit, and delete the file once empty.

## Server-side cropping for avatar-like images (keep GIFs animated)

The owner, word for word:

> when we crop images on any part of the site, we should always crop them
> ourselves on the server too, we don't want people putting insane
> resolutions on images in those fields, stickers, uploaded media in chats are
> perfectly fine, i mean stuff like what i described.

> don't make cropping ruin animated gifs and stuff, that isn't cool.

What to build:

- Applies to every image the app crops before upload: user avatars and
  banners, server icons and banners, group chat icons, channel icons if they
  are images, webhook pictures, and any other field that goes through
  `web/src/components/common/ImageCropModal.tsx`. **Not** stickers, emoji
  packs or chat attachments.
- The server must not trust the browser's crop. On upload (these go through
  `media.PutPublic` in `internal/media/store.go`, with per-kind limits in
  `limitsFor` in `internal/api/media_handlers.go`, and `webhookAvatar` in
  `internal/api/webhook_handlers.go`), decode the image, centre-crop it to the
  field's aspect ratio (1:1 for avatars and icons; the banner ratio the crop
  modal uses for banners), and scale it down to that field's maximum output
  size (match what the crop modal produces, for example 512 or 1024 square
  for avatars). Images already within the size and ratio are stored as they
  are (no needless re-encode).
- Animated GIFs must stay animated: decode every frame (`image/gif`
  `DecodeAll`), crop and scale each frame with the same geometry (respecting
  frame offsets and disposal: composite onto a full canvas first, then crop
  and scale, then re-encode with the original delays, disposal and loop
  count, using `gif.EncodeAll`; quantise with the frame's palette or
  Floyd-Steinberg). Keep transparency.
- Animated WebP and APNG: Go has no encoder for them in the standard library.
  Keep them animated: store them unchanged when they are within the field's
  limits, and refuse them with a clear error when they are larger (the client
  crop already produces sizes within limits).
- Static PNG, JPEG and WebP: re-encode as PNG (with alpha) or JPEG (quality
  about 90) only when cropping or scaling was needed.
- Media metadata is already stripped on upload (`internal/media/scrub.go`);
  keep that running first.
- Tests: Go tests per format (oversized static image cropped and scaled to the
  field's size and ratio, animated GIF keeps every frame, delay and loop count
  after scaling, an in-limits image stored byte for byte, animated WebP within
  limits kept and oversized refused), and a check through the avatar upload
  route.

## Discord activity sync (listening and exact Discord activity)

The owner, in short: a system that syncs people's Discord activity (for
example what they are listening to, and the exact Discord activity details)
into Nexa, working alongside the existing Discord Rich Presence relay without
duplicates. A Discord bot sits in an otherwise empty Discord server made for
this. Connecting is an OAuth step that links the Discord account to the Nexa
account and joins them to that server; Nexa's bot then watches that person's
presence there and mirrors it. If the person leaves that server on Discord,
Nexa shows a banner warning about it with a "Rejoin" button. Everything goes in
a new Settings section called "Activity" (organise it however works best; the
existing activity privacy/display settings can move there too).

Credentials: the owner has the bot token, the application client id
(1553635967494127708) and the client secret. They must NEVER be committed. Read
them from the environment (`chatd.env`, which is gitignored):
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and
`DISCORD_ACTIVITY_GUILD_ID` (optional: if unset, use the bot's only guild from
READY and log an error if it is in more than one). With any of the first three
unset, the feature is off and Settings, Activity says it is not set up on this
server. Document the variables in README's Configuration section.

Redirect URI to use (the owner must add it in the Discord Developer Portal,
OAuth2, Redirects): `https://chat.evilion.xyz/api/v1/connections/discord/callback`
(built from PUBLIC_URL, so a test server uses its own).

Developer Portal settings the owner must have on: Bot, Privileged Gateway
Intents: Presence Intent and Server Members Intent. The bot needs the Create
Instant Invite permission in the activity server (required to add members with
`guilds.join`).

Build (plan):
- Migration (next free number) for `discord_links`: nexa user id, discord user
  id (unique), discord username/avatar for display, refresh token sealed with
  the server secret (like webhook tokens: derived key, AES-GCM), access token
  expiry, joined flag, left_at, created_at. Both SQLite and Postgres.
- OAuth: `GET /api/v1/connections/discord/authorize` (authed) redirects to
  Discord with scopes `identify guilds.join`, a signed short-lived `state`
  tied to the user, and PKCE; `GET .../callback` exchanges the code, fetches
  `/users/@me`, refuses a Discord account linked to another Nexa account,
  stores the link, then adds the user to the activity server with
  `PUT /guilds/{guild}/members/{discord_user}` (bot token, user access token),
  and redirects back to Settings, Activity. `DELETE /api/v1/connections/discord`
  unlinks (and optionally removes them from the server). `POST
  .../discord/rejoin` refreshes the access token and joins again.
- A Discord gateway client in Go (new package, for example
  `internal/discordsync`): identify with intents GUILDS, GUILD_MEMBERS,
  GUILD_PRESENCES; heartbeats, resume, reconnect with backoff; honour rate
  limits; request guild members/presences on start. On PRESENCE_UPDATE for a
  linked user, map Discord activities (listening with Spotify details:
  track, artists, album art, timestamps and link; playing with name, details,
  state, timestamps, assets; streaming; watching; competing; custom status)
  into Nexa's activity model (see `internal/api/activity_glue.go`,
  `internal/rpcapps`, `web/src/lib/activity.ts`, the ActivityCard) and publish
  them through the same path the desktop relay uses.
- No duplicates with the desktop Rich Presence relay
  (`web/src/lib/desktopBridge.ts`, keep it compatible with installed desktop
  apps): the same activity (same application id or same name and type) from
  both sources shows once, preferring the desktop relay's while it is live,
  falling back to the bot's; the bot's copy clears when Discord says it ended.
- GUILD_MEMBER_REMOVE for a linked user sets `left_at`; the client shows a
  dismissible banner ("Your Discord account left the activity server, so your
  Discord activity is no longer shown." with a Rejoin button calling the rejoin
  route); GUILD_MEMBER_ADD clears it.
- Settings, Activity: connect or disconnect Discord (showing the linked
  account), whether to show synced activity, what kinds to show (listening,
  playing, etc.), the Rejoin state, and an explanation of what is shared and
  that activity passes through Nexa's server.
- Privacy: only the linked person's own presence is used; unlinking deletes
  the tokens and stops syncing at once; mention the data in the privacy policy
  (docs/legal) and the legal data report.
- Tests: OAuth state and callback (with a fake Discord API server), token
  sealing, the gateway client against a fake gateway, activity mapping and
  deduplication, the banner state; UI checked at desktop and phone sizes;
  translations in all eleven languages; a What's New entry.
