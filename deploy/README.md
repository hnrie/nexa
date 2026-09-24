# Deploying Nexa on this Mac

```
make build                     # web app + Go binary (prebuilt Node at /usr/local/lib/nodejs)
sudo bash deploy/install.sh    # LaunchDaemon xyz.evilion.chat + tunnel ingress
```

`install.sh` is idempotent. It creates `chatd.env` (from the example), `data/`
and `logs/`, renders `deploy/xyz.evilion.chat.plist.in` into
`/Library/LaunchDaemons/`, starts the daemon, waits for `/api/health`, adds
`chat.evilion.xyz -> http://127.0.0.1:8090` to `../server/tunnel/config.yml`
(before the catch-all) and restarts the site daemon so cloudflared reloads it.

## DNS (once, needs your Cloudflare account)

The tunnel credentials on this box can run the tunnel but cannot create DNS
records. One of:

- `cloudflared tunnel login` (opens a browser, pick evilion.xyz), then
  `bash deploy/route-dns.sh`; or
- Cloudflare dashboard → DNS → add **CNAME** `chat` →
  `<YOUR_TUNNEL_ID>.cfargotunnel.com`, proxied.

## Day to day

```
tail -f logs/chatd.log
sudo launchctl kickstart -k system/xyz.evilion.chat    # restart
sudo launchctl bootout system/xyz.evilion.chat         # stop until next boot / bootstrap
sudo launchctl bootstrap system /Library/LaunchDaemons/xyz.evilion.chat.plist
make build && sudo launchctl kickstart -k system/xyz.evilion.chat   # update
bash backup.sh                                          # consistent DB + media backup
```

`bin/chatd` is the file the daemon starts, so anything that writes it decides
what runs after the next restart — including a reboot nobody planned. `make
server` builds to a scratch name and moves it into place in one step, keeping
what it replaced as `bin/chatd.prev`; a bare `go build -o bin/chatd` does not,
and will deploy on the next restart without saying so. To check that the server
compiles, `go build ./...` writes nothing.

Settings live in `chatd.env` (documented in `chatd.env.example`); restart after
editing. The database is `data/chat.db` (SQLite, WAL mode) and uploads live in
`data/media/`; back them up with `backup.sh`, never by copying the live files.

## Desktop app

The desktop app (`desktop/`, Electron) is a window on the live site plus a
Discord-compatible Rich Presence server and an updater. Its installers are built
on this Mac and served by chatd from `DESKTOP_DIR` (default `data/desktop`) at
`/desktop/`; the download page (`/download`) and the banner read
`/api/v1/desktop/latest`.

```
# bump "version" in desktop/package.json first, then:
make desktop            # desktop/dist: Windows .exe, macOS .dmg/.zip (Intel and Apple Silicon), Linux .AppImage/.deb
make publish-desktop    # copies them and the update manifests into data/desktop; no restart needed
```

Running apps find the new version within a minute and show "A new version is here" across the top (or at once from Settings →
Desktop App → Check for updates). Windows and the AppImage install it on restart;
the Mac build swaps itself in on restart (it is not signed, so macOS's own
updater cannot); a .deb only says a new version is out. Builds are unsigned:
Windows shows "Windows protected your PC" (More info → Run anyway) and macOS
wants a right-click → Open the first time; the download page says so.

## Moving to Postgres

SQLite is the default and stays the right answer for one machine. Move when one
stops being enough — several chatd processes, a replica, a database somebody
else keeps alive.

```
launchctl unload ~/Library/LaunchAgents/xyz.evilion.chat.plist   # stop chatd
go run ./cmd/chatmigrate --from data/chat.db --to 'postgres://chat@host/chat?sslmode=require'
```

It copies every table in one transaction and counts the rows on both sides
before it says it is done; nothing lands if anything fails. Then set
`DATABASE_URL` to the same URL in `chatd.env` and start chatd again. The SQLite
file is left alone, so unsetting `DATABASE_URL` puts things back exactly as
they were.

Run one chatd per instance. Gateway events, presence and calls live in the
memory of the process holding the sockets, so two processes behind one address
would each see only their own half: a message sent through one would never
reach the people connected to the other. `REDIS_URL` only moves the rate limits
into Redis, where they survive a restart.
