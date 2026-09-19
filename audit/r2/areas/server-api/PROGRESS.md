# Progress — server-api
State: auditing
Last checkpoint: 2026-09-19T00:03Z (resumed by successor)
Next finding id: 015

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
- [ ] internal/api/captcha_test.go
- [x] internal/totp/totp.go
- [ ] internal/totp/totp_test.go

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
- [ ] internal/api/message_handlers.go
- [ ] internal/api/message_handlers_test.go
- [ ] internal/api/upload_handlers.go
- [ ] internal/api/upload_handlers_test.go
- [ ] internal/api/media_handlers.go
- [ ] internal/api/media_handlers_test.go
- [ ] internal/api/media_variants_test.go
- [ ] internal/api/gif_preview_test.go
- [ ] internal/api/proxy_handlers.go
- [ ] internal/api/proxy_handlers_test.go
- [ ] internal/api/unfurl_handlers.go
- [ ] internal/api/unfurl_handlers_test.go

### Keys, relationships, users, expressions
- [ ] internal/api/key_handlers.go
- [ ] internal/api/key_handlers_test.go
- [ ] internal/api/relationship_handlers.go
- [ ] internal/api/relationship_handlers_test.go
- [ ] internal/api/user_handlers.go
- [ ] internal/api/user_handlers_test.go
- [ ] internal/api/expression_handlers.go
- [ ] internal/api/expression_handlers_test.go

### Guests, voice/SFU (auth, validation, rate limits only), activity
- [ ] internal/api/guest_handlers.go
- [ ] internal/api/guest_handlers_test.go
- [ ] internal/api/sfu_handlers.go
- [ ] internal/api/sfu_handlers_test.go
- [ ] internal/api/voice_glue.go
- [ ] internal/api/voice_handlers_test.go
- [ ] internal/api/activity_glue.go
- [ ] internal/api/gateway_sessions_test.go

### Admin, legal, crash
- [ ] internal/api/admin_handlers.go
- [ ] internal/api/admin_handlers_test.go
- [ ] internal/api/legal_handlers.go
- [ ] internal/api/legal_handlers_test.go
- [ ] internal/api/crash_handlers.go
- [ ] internal/api/crash_handlers_test.go

### Release routes, static, disk
- [ ] internal/api/desktop_handlers.go
- [ ] internal/api/desktop_handlers_test.go
- [ ] internal/api/android_handlers.go
- [ ] internal/api/static.go
- [ ] internal/api/static_test.go
- [ ] internal/api/static_dot_test.go
- [ ] internal/api/disk.go

### Process, config, rate limiting, text
- [ ] cmd/chatd/main.go
- [ ] cmd/chatd/main_test.go
- [ ] internal/config/config.go
- [ ] internal/config/config_test.go
- [ ] internal/ratelimit/limiter.go
- [ ] internal/ratelimit/limiter_test.go
- [ ] internal/ratelimit/ratelimit_test.go
- [x] internal/textutil/textutil.go

### Remaining tests
- [ ] internal/api/audit_regressions_test.go
- [ ] internal/api/router_test.go
- [ ] internal/api/testutil_test.go

### Round-1 verification
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/server-security.md
- [ ] audit/server-correctness.md (api parts)

### Client contract comparison
- [ ] web/src/api/*.ts (spot-check against routes)
- [ ] android/.../net/Endpoints.kt, ApiClient.kt, Models.kt (spot-check against routes)

## Handoff note
Findings SAPI-001..014 written. Pending items to settle before writing them up:
- password-verifying routes (auth/password, auth/recovery, mfa/*, account delete) only have the generic 600/min limiter — list the account-delete route from user_handlers.go, then write it.
- `handleRecipientRemove` (channel_handlers.go:341) never calls `dropVoice`, unlike `removeFromGroup`; check in voice_glue.go whether a member kicked from a group by its owner stays in the group's call.
- limiter.go: confirm whether `Reset` clears the shared (Redis) counter (round-1 LOW).
- static.go: HSTS / CSP (round-1 hardening).
- server-correctness.md's api items are being verified handler by handler (not read as a whole yet).
Next: message_handlers.go, upload_handlers.go, media_handlers.go, proxy_handlers.go, unfurl_handlers.go, then keys/relationships/users/expressions.
