# Brief — server-api (finding prefix `SAPI`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

Everything under `internal/api/` (69 files; the `_test.go` files are for
understanding and for checking what is covered — gaps in tests are findings
too), plus:

```
internal/auth/       middleware.go password.go tokens.go
internal/perms/      perms.go
internal/ratelimit/  limiter.go
internal/config/     config.go
internal/totp/       totp.go
internal/textutil/   textutil.go
cmd/chatd/           main.go
```

Out of scope (other areas): `internal/store`, `internal/db`, `internal/gateway`,
`internal/realtime`, `internal/media`, `internal/unfurl`, `internal/cache`,
`internal/rpcapps`, `internal/voice` (all `server-core`, except the voice
parts below), `cmd/chatmigrate` (`server-core`). The voice/SFU handlers
(`sfu_handlers.go`, `voice_glue.go`, `voice_handlers_test.go`, the voice parts
of `guest_handlers.go`) are audited by the `voice` area for call semantics, but
**you** still audit them for authorization, validation and rate limiting like
every other route. `desktop_handlers.go`, `android_handlers.go` and
`static.go` are shared with `desktop-release`: you cover the security of the
routes and headers; they cover the release path.

## What this area is

`chatd` is one Go process: `/api/v1` JSON routes, `/gateway` WebSocket,
`/media/*`, and the SPA. Auth is a session token from an Argon2id-derived
auth key (the server never sees a password or plaintext); sessions, MFA
(TOTP + backup codes), captchas (Turnstile, only when keys are set), rate
limits per route, instance admin, servers with Discord-shaped permissions
(`internal/perms`), DMs and groups, key grants (sealed boxes the server stores
but cannot open), uploads in pieces, a signed media proxy, unfurls, guest call
links (guests are not users; `authed` routes must reject them), a
law-enforcement export (`legal_handlers.go`), crash reports, and the desktop
and Android release endpoints. The router is `router.go`; middleware in
`middleware.go`; responses in `respond.go`/`errors.go`; validation helpers in
`validate.go`.

## Checklist

Authorization, route by route — this is the heart of it:
- For every handler: who may call it, is that checked, and is the check on
  the right object? (IDOR: an id in the path that is never tied to the
  caller's membership.) Server routes: is the permission computed through
  `internal/perms` with overwrites, and does hierarchy apply to role edits,
  kicks, bans, timeouts and moves? Channel routes: private channels, DM
  membership, group membership, subchat locks. Message routes: author vs.
  MANAGE_MESSAGES vs. pin. Key routes: who may read whose grants, who may
  write a grant for whom (round 1's CRITICAL was here — check the fix holds).
- Guests: every `authed` route rejects a guest token; the guest-only routes
  accept nothing else; `CallMiddleware` and `GuestMiddleware` boundaries.
- Admin routes: `ADMIN_USERNAME` and the first account; disabled accounts
  cannot act; promote/demote edge cases; the legal export's access control
  and what it discloses.
- Sessions: creation, listing, revocation, TTL refresh, the token format,
  constant-time comparison, logout everywhere, what a revoked session can
  still do through an open gateway socket.
- MFA: enrol/verify/disable ordering, backup code consumption, replay of a
  TOTP code within its window, lockout, recovery-key flows.
- Captcha: is every abusable action behind it when keys are set (register,
  login, recover, friend request, create/join server, guest join)? Is the
  token bound to the action and the hostname? Bypass when keys are unset is
  intended.

Input and limits:
- Body size limits per route; JSON decoding strictness (unknown fields,
  numbers, nulls); string length and Unicode validation (usernames, display
  names, channel names, topics, about-me, custom status, emoji names,
  sticker names, invite codes); path parameters; pagination bounds; the
  `validate.go` helpers and where they are *not* used.
- Rate limits: which routes have none; whether limits key on the account or
  the address; whether a failed login and a successful one cost the same;
  upload piece limits; unfurl and proxy limits (they cost outbound traffic).
- Uploads: piece ordering, total size vs. `MAX_UPLOAD_BYTES`, content type
  sniffing vs. declared type, orphan cleanup, who may finish someone else's
  upload, blob dedup and what it leaks.
- Media proxy (`proxy_handlers.go`): signature scheme, expiry, refresh route
  (signed-in only), SSRF (private ranges, redirects, DNS rebinding), response
  size and type caps, caching headers, what an attacker learns from timing.
- Unfurl handlers: same SSRF questions (the guard lives in `internal/unfurl`,
  but check the handler passes everything through it), who may trigger
  fetches, cost per call.

Responses and headers:
- `static.go`: CSP (does it allow only what is needed — note the known
  Cloudflare beacon warning), `frame-ancestors`, HSTS, referrer policy,
  cache headers for `index.html` vs. hashed assets vs. the service worker,
  the `no-store` on missing assets, `Permissions-Policy`, and the desktop/
  Android download routes' headers (range requests, content-disposition).
- Error responses: consistent shape; do any leak internal paths, SQL, or
  other users' existence (username enumeration on register/login/recover —
  decide whether that is acceptable here and say so)?
- CORS/origin checks on the gateway upgrade and on any state-changing route.

Correctness:
- Transactions across store calls (a check-then-act that is not atomic);
  partial failure leaving orphans; idempotency of retries (the clients retry
  on network failure — which routes are safe to retry?).
- Event emission: after every mutation, is the right gateway event sent to
  exactly the right audience (and only after the commit)?
- Time handling, ids (`internal/ids`), pagination cursors, deletion cascades
  (deleting a server, a channel, an account: what is left behind — keys,
  grants, blobs, sessions, invites, read states, guest links?).
- Account deletion and data export: completeness and what survives.
- `cmd/chatd/main.go`: startup ordering, graceful shutdown (in-flight
  uploads, gateway drain), signal handling, log content (secrets? tokens?
  IPs?), `LOG_LEVEL`, config validation, defaults that are unsafe.
- `config.go`: every setting documented in `chatd.env.example`? Defaults
  sane? `LoadEnvFile` precedence ("later lines win") — is that documented?

API design (for the clients' sake):
- Inconsistent naming, shapes, or status codes between similar routes;
  routes that force N+1 calls from the client; missing fields the clients
  work around; versioning of paths (the proxy refresh route is under
  `/proxy` because clients send unversioned `/media/…` paths — is that the
  only such wart?).

Tests: what has no test — especially authorization on each route, the
negative cases, guests, disabled accounts, hierarchy. A missing test for a
security property is a `P2 · test` finding.

## Compare with

The clients that call these routes: `web/src/api/*.ts` (the contract as the
web client understands it) and `android/app/src/main/java/xyz/evilion/chat/net/Endpoints.kt`,
`ApiClient.kt`, `Models.kt`. When the server and a client disagree about a
field or a status code, that is a finding (name both sides).

## Round 1

Read `audit/REVIEW.md` (all of it, it is short), then `audit/server-security.md`
(23 findings) and the api parts of `audit/server-correctness.md` (86). Verify
in the code: the key-grant recipient cross-check, the gateway connection cap
(that is `server-core`, skip), the argon2 floor in `validKDF`, the media proxy
expiry and refresh, the TOTP backup-code fix, the group-participants
data-loss fix, captcha coverage. Do not re-list what is fixed; list what is
not, or what regressed.

## Facts you would otherwise rediscover

- Live is SQLite; Postgres works and is tested (`CHAT_TEST_POSTGRES=<url>`),
  `DATABASE_URL`/`REDIS_URL` are the switches. Both dialects must stay
  correct, but the store is `server-core`'s.
- Turnstile keys are set on the live instance, so captchas are on there and
  off in every local test unless `TURNSTILE_*` is passed.
- `go test -race ./internal/api/` takes about three minutes; `go test
  ./internal/api/` without `-race` is the quick check. Both are fine to run.
- The voice/SFU registry is in-memory (or Redis); `voice_glue.go` is where
  a gateway reconnect decides whether to close a phone's SFU session (a
  real bug was here on 2026-09-18).

## Reading order

`router.go` → `middleware.go` → `auth/*` → `access.go`, `respond.go`,
`errors.go`, `validate.go` → `auth_handlers.go`, `mfa_handlers.go`,
`captcha.go` → `server_handlers.go` (the big one), `server_glue.go`,
`perms/perms.go` → `channel_handlers.go`, `group_handlers.go`, `groups.go`,
`subchat_handlers.go` → `message_handlers.go`, `upload_handlers.go`,
`media_handlers.go`, `proxy_handlers.go`, `unfurl_handlers.go` →
`key_handlers.go` → `relationship_handlers.go`, `user_handlers.go` →
`expression_handlers.go` → `guest_handlers.go`, `sfu_handlers.go`,
`voice_glue.go`, `activity_glue.go` → `admin_handlers.go`,
`legal_handlers.go`, `crash_handlers.go` → `desktop_handlers.go`,
`android_handlers.go`, `static.go`, `disk.go` → `cmd/chatd/main.go`,
`config/config.go`, `ratelimit/limiter.go`, `totp/totp.go` → the tests.
