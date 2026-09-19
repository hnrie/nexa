# Progress — server-api
State: audit-done
Last checkpoint: 2026-09-19T05:19Z
Next finding id: 051

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
- [x] internal/api/server_handlers_test.go
- [x] internal/api/server_perms_test.go
- [x] internal/api/server_glue.go
- [x] internal/perms/perms.go
- [x] internal/perms/perms_test.go
- [x] internal/api/membership_test.go
- [x] internal/api/admin_powers_test.go

### Channels, groups, subchats
- [x] internal/api/channel_handlers.go
- [x] internal/api/channel_handlers_test.go
- [x] internal/api/group_handlers.go
- [x] internal/api/groups.go
- [x] internal/api/subchat_handlers.go
- [x] internal/api/subchat_handlers_test.go
- [x] internal/api/subchat_lock_test.go

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
- [x] internal/api/testutil_test.go

### Round-1 verification
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/server-security.md
- [x] audit/server-correctness.md (api parts)

### Client contract comparison
- [x] web/src/api/*.ts (spot-check against routes)
- [x] android/.../net/Endpoints.kt, ApiClient.kt, Models.kt (spot-check against routes)

## Handoff note
Audit done 2026-09-19T05:19Z. Every file in scope inspected; Summary written at the top of FINDINGS.md (50 findings, SAPI-001..050). Nothing pending. If a fourth agent is ever started here: do not re-audit; the fix phase's PLAN.md is the next thing that touches this area.
