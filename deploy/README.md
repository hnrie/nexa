# Deploying Evilion Chat on this Mac

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

Settings live in `chatd.env` (documented in `chatd.env.example`); restart after
editing. The database is `data/chat.db` (SQLite, WAL mode) and uploads live in
`data/media/`; back them up with `backup.sh`, never by copying the live files.
