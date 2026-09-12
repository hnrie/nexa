# Evilion Chat

A self-hosted, end-to-end-encrypted chat platform with a Discord-shaped UI, served at
`https://chat.evilion.xyz` through the Cloudflare tunnel that already fronts this box.
Every account gets the things Discord paywalls: animated avatars and banners, unlimited
"about me", display names with plain unique usernames, custom sticker packs, big uploads,
HD screen share.

```
chat/
├── cmd/chatd/        the Go server: REST API, WebSocket gateway, media, and the built web app
├── internal/         config, ids, db (SQLite + migrations), store, auth, api, gateway, media, unfurl
├── web/              the React/TypeScript app (Vite); web/dist is what chatd serves
├── deploy/           launchd template, installer, DNS helper
├── tools/            screenshot.py and e2e.py (Playwright)
├── docs/             design spec, implementation plans, Discord UI reference captures
├── data/             runtime (SQLite database, media blobs) — not in git
└── logs/             runtime — not in git
```

## Build and run

```
make build          # web app (needs the prebuilt Node under /usr/local/lib/nodejs) + Go binary
make test           # go vet + go test -race + tsc + vitest
./bin/chatd         # listens on 127.0.0.1:8090 (see chatd.env.example for every setting)
```

Install as a LaunchDaemon and wire it into the tunnel (idempotent, needs sudo):

```
sudo bash deploy/install.sh
```

See `deploy/README.md` for the one DNS step that only your Cloudflare account can do,
and for restart/stop/update/backup commands.

## How it works

- **One process.** `chatd` serves `/api/v1` (JSON), `/gateway` (WebSocket), `/media/*`
  and the SPA from `web/dist`. SQLite in WAL mode with a single writer; blobs on disk,
  content-addressed. No nginx, no external database.
- **End-to-end encryption.** The password is stretched with Argon2id in the browser; from
  it come an auth key (the only thing the server ever sees, hashed again server-side)
  and an encryption key that wraps the account's X25519 identity. Each conversation has
  root keys in numbered epochs, granted to members as sealed boxes; channel keys derive
  from the root; messages are AES-256-GCM envelopes bound to their channel and author;
  attachments carry their own random key inside the message. The server stores only
  ciphertext plus the metadata it needs (author, channel, mentions, reactions, sizes).
  A recovery key shown once at registration can restore the identity if the password
  is lost. Details: `docs/superpowers/specs/2026-09-11-chat-design.md` §6.
- **Realtime.** Clients hold one WebSocket; the hub fans events out to the members who
  may see them and tracks presence and typing. Heartbeats every 25 s keep Cloudflare
  from dropping idle sockets.
- **Calls** are peer-to-peer WebRTC (encrypted by construction); the tunnel only carries
  HTTP, so there is no media server on this box.

## Development

```
cd web && npm run dev            # Vite on :5173, proxying /api, /gateway and /media to :8090
go run ./cmd/chatd               # in another shell
```

`tools/e2e.py` starts a throwaway server and drives two browsers through registration,
friend requests, DMs, reactions, replies, edits and encrypted uploads;
`tools/screenshot.py` captures any page at any viewport. Both need the Playwright venv
described in `tools/README.md`.

## Configuration

`chatd.env` (created by the installer from `chatd.env.example`): listen address, public
URL, data directory, upload limits (Cloudflare's free plan caps request bodies at 100 MB),
registration mode (`open`, `invite` with a shared `REGISTRATION_KEY`, or `closed`), the
admin username, optional TURN credentials for calls, optional Tenor key for GIF search.
