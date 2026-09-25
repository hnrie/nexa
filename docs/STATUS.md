# Status

What is built, phase by phase, against
`docs/superpowers/specs/2026-09-11-chat-design.md`. Every phase ends with `make test`
green, `tools/e2e.py` passing, screenshots reviewed, and the build installed under
launchd as `xyz.evilion.chat`.

## Phase 0–1 — foundation ✅

Go server (`chatd`) with SQLite in WAL mode, content-addressed blobs, Argon2id auth,
sessions, rate limits, the WebSocket gateway, media, link unfurling. React client with
the Discord-shaped shell, auth pages with a recovery key, friends, DMs and group DMs,
end-to-end encryption (X25519 identities, per-conversation root keys in epochs, AES-GCM
message envelopes, chunked encrypted attachments), markdown, reactions, replies, edits,
pins, embeds, settings, notifications, a service worker and the PWA manifest.

## Phase 2 — servers ✅

`internal/perms` (Discord's algorithm and bit values), server/role/member/overwrite/
invite/ban/audit storage, the `/servers/*` and `/invites/*` API with hierarchy checks,
visibility diffing that emits per-member channel events, private channels with their own
key conversation, and key rotation flagged on kick, ban and leave. Client: permission
mirror, servers store, rail with drag ordering and badges, channel sidebar with
categories and drag-and-drop, member list, channel and server settings (including the
tri-state overwrite editor, roles grid, members, bans, invites, audit log, encryption),
invites carrying the root key in the URL fragment, and the `/invite/:code` page.

## Phase 3 — expressions ✅

Unlimited custom server emoji (static and animated, usable in every channel and DM
because the token carries the image id), sticker packs owned by users or servers with
public share links, install/uninstall, reordering, covers and tags, the unified
GIF/Stickers/Emoji picker with search and shortcode autocomplete, sticker rendering in
messages, custom-emoji reactions, and GIF search through Klipy that stays off unless
`KLIPY_API_KEY` is set.

## Phase 4 — voice, video, screen share ✅

An in-memory voice registry, gateway signalling relay, DM call ringing with decline and
timeout, moderation (server mute, deafen, move), and `/voice/ice`. Client: full-mesh
WebRTC with perfect negotiation, WebAudio playback with per-user volume to 200 % and
output device selection, voice activity or push-to-talk, camera, screen share with
quality and bitrate caps, focus and grid layouts, picture-in-picture, sidebar
participants, the voice status block, and the Voice & Video settings page.

## Phase 5 — polish ✅

Client-side message search with Discord-style filters over the decrypted history,
the instance admin page (stats, runtime registration policy, enable/disable and promote
accounts), a zip data export, friend nicknames that flow through DM names, private
per-user notes, quick switcher over servers and channels, and the mobile pass.

## Not built (deliberately)

From the spec's P2/P3 lists: server folders, rules gates and announcement channels,
message forwarding, polls, threads, scheduled messages, soundboard, RNNoise, priority
speaker, and a voice-channel text pane. The SFU adapter the spec named as the upgrade
path for larger rooms (§8.6) has since been built on Cloudflare Realtime, and takes every
call when `REALTIME_APP_ID` is set.
