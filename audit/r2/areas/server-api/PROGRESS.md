# Progress — server-api
State: auditing
Last checkpoint: 2026-09-19T01:40Z
Next finding id: 035

## Inspected

Reading order from BRIEF.md; tests at the end, read alongside the handler they cover.

### Router, middleware, auth
- [x] internal/api/router.go
- [x] internal/api/middleware.go
- [x] internal/auth/middleware.go
- [x] internal/auth/password.go
- [x] internal/auth/tokens.go
- [x] internal/auth/auth_test.go
- [x] internal/api/access.go
- [x] internal/api/respond.go
- [x] internal/api/errors.go
- [x] internal/api/validate.go

### Accounts, MFA, captcha
- [x] internal/api/auth_handlers.go
- [x] internal/api/auth_handlers_test.go
- [x] internal/api/mfa_handlers.go
- [x] internal/api/mfa_handlers_test.go
- [x] internal/api/captcha.go
- [x] internal/api/captcha_test.go
- [x] internal/totp/totp.go
- [x] internal/totp/totp_test.go

### Servers and permissions
- [x] internal/api/server_handlers.go
- [ ] internal/api/server_handlers_test.go
- [ ] internal/api/server_perms_test.go
- [x] internal/api/server_glue.go
- [x] internal/perms/perms.go
- [ ] internal/perms/perms_test.go
- [ ] internal/api/membership_test.go
- [ ] internal/api/admin_powers_test.go

### Channels, groups, subchats
- [x] internal/api/channel_handlers.go
- [ ] internal/api/channel_handlers_test.go
- [x] internal/api/group_handlers.go
- [x] internal/api/groups.go
- [x] internal/api/subchat_handlers.go
- [ ] internal/api/subchat_handlers_test.go
- [ ] internal/api/subchat_lock_test.go

### Messages, uploads, media, proxy, unfurl
- [x] internal/api/message_handlers.go
- [x] internal/api/message_handlers_test.go
- [x] internal/api/upload_handlers.go
- [x] internal/api/upload_handlers_test.go
- [x] internal/api/media_handlers.go
- [x] internal/api/media_handlers_test.go
- [x] internal/api/media_variants_test.go
- [x] internal/api/gif_preview_test.go
- [x] internal/api/proxy_handlers.go
- [x] internal/api/proxy_handlers_test.go
- [x] internal/api/unfurl_handlers.go
- [x] internal/api/unfurl_handlers_test.go

### Keys, relationships, users, expressions
- [x] internal/api/key_handlers.go
- [x] internal/api/key_handlers_test.go
- [x] internal/api/relationship_handlers.go
- [x] internal/api/relationship_handlers_test.go
- [x] internal/api/user_handlers.go
- [x] internal/api/user_handlers_test.go
- [x] internal/api/expression_handlers.go
- [x] internal/api/expression_handlers_test.go

### Guests, voice/SFU (auth, validation, rate limits only), activity
- [x] internal/api/guest_handlers.go
- [x] internal/api/guest_handlers_test.go
- [x] internal/api/sfu_handlers.go
- [x] internal/api/sfu_handlers_test.go
- [x] internal/api/voice_glue.go
- [x] internal/api/voice_handlers_test.go
- [x] internal/api/activity_glue.go
- [x] internal/api/gateway_sessions_test.go

### Admin, legal, crash
- [x] internal/api/admin_handlers.go
- [x] internal/api/admin_handlers_test.go
- [x] internal/api/legal_handlers.go
- [x] internal/api/legal_handlers_test.go
- [x] internal/api/crash_handlers.go
- [x] internal/api/crash_handlers_test.go

### Release routes, static, disk
- [x] internal/api/desktop_handlers.go
- [x] internal/api/desktop_handlers_test.go
- [x] internal/api/android_handlers.go
- [x] internal/api/static.go
- [x] internal/api/static_test.go
- [x] internal/api/static_dot_test.go
- [x] internal/api/disk.go

### Process, config, rate limiting, text
- [x] cmd/chatd/main.go
- [x] cmd/chatd/main_test.go
- [x] internal/config/config.go
- [x] internal/config/config_test.go
- [x] internal/ratelimit/limiter.go
- [x] internal/ratelimit/limiter_test.go
- [x] internal/ratelimit/ratelimit_test.go
- [x] internal/textutil/textutil.go

### Remaining tests
- [x] internal/api/audit_regressions_test.go
- [x] internal/api/router_test.go
- [ ] internal/api/testutil_test.go

### Round-1 verification
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/server-security.md
- [ ] audit/server-correctness.md (api parts)

### Client contract comparison
- [ ] web/src/api/*.ts (spot-check against routes)
- [ ] android/.../net/Endpoints.kt, ApiClient.kt, Models.kt (spot-check against routes)

## Handoff note
Findings SAPI-001..022 written. Still pending from the first agent's list:
- (settled → SAPI-027) group kick leaves the member in the call.
- (settled) limiter.go Reset clears the shared counter; tested.
- (settled → SAPI-030, SAPI-033) CSP and HSTS.
- server-correctness.md's api items verified handler by handler; the file itself not yet read as a whole.
Open threads of mine: SAPI-016 names `handlePasswordChange`/`handleRecoveryReplace`/`handleMFADisable` from the predecessor's note — confirm each calls VerifyAuthKey without limAuthUsr when reading mfa tests; `about_me` is 100 000 runes and `Public()` includes it — check whether message authors / member lists embed PublicUser before writing a perf finding.
Settled: expression caps → SAPI-026; rpcapps has FailTTL+pacing (no finding). Candidate P3 from sfu_handlers.go: server-mute/deafen/suppress are flags only — a muted member may still publish audio and a deafened one still subscribe (enforce in handleSFUPublish/Subscribe); guests get a fresh Cloudflare TURN credential on every /voice/ice call (no reuse, voice_glue.go:527-536).
Pending: config finding (TURN pair unvalidated; PUBLIC_URL default is the live domain; env-example covers every key, precedence documented); shared-limiter collision — every ipLimited limiter uses the bare IP as key and Redis namespaces only by 'rate:' (cache/redis.go:149), confirm the Lua script then write P2 (latent, REDIS_URL only); router_test.go TestReadJSON is an empty stub (P3 test).
Next: testutil/perms/server_perms/membership/admin_powers tests, then server_handlers/channel/subchat tests, round-1 server-correctness.md, client spot-check, admin/legal/crash, desktop/android/static, main/config/limiter/totp tests, remaining tests, client contract spot-check.
