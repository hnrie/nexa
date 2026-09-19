# Triage — decisions per finding

Coordinator's decisions, one line per finding, written as each area finishes.
`accept` means it goes into a fix package in `PLAN.md`; `decline` needs a
reason. Notes carry the decision the fix agent must follow where the finding
offered options. The owner asked for everything real to be fixed, so the bar
for declining is "wrong, harmful, or not this product".

## server-api (SAPI) — 50 findings, 49 accepted

- SAPI-001 accept · build the bundle from what was written; never re-read after the writes.
- SAPI-002 **decline** · username enumeration is inherent to public handles here; keep the helpful `no_recovery_key` message.
- SAPI-003 accept · `strconv.Itoa`, share the helper with `RateLimit`.
- SAPI-004 accept · refuse `!ValidUsername` before the limiter in all three places.
- SAPI-005 accept · key the per-account login limiter on (username, address); keep the per-address limiter and the timing floor; comment says why.
- SAPI-006 accept · drop the `X-Forwarded-For` branch; adjust `auth_test.go`.
- SAPI-007 accept · `CleanText(reason, maxBanReason)`; accept the reason in the body too, keep the query form.
- SAPI-008 accept · refuse `cannot_timeout_admin`.
- SAPI-009 accept · snapshot + `syncVisibility` + `member_update` for both on transfer.
- SAPI-010 accept · return the read error; reject the bad colour on create.
- SAPI-011 accept · `403 account_disabled` only after a correct password; clients show a sentence (web + android strings).
- SAPI-012 accept · caps via `ErrTooMany`: 100 servers per account, 50 recipients per group (matches `maxGroupCreate`), `MAX_SERVER_MEMBERS` config default 10000.
- SAPI-013 accept · locked subchat cannot be deleted while locked.
- SAPI-014 accept · registration with an invite code spends a use and joins the server/group in the same transaction, unless the client flow already joins afterwards (check `RegisterPage`/`InvitePage`); whichever it is, make it one join, one use, and fix the env comment.
- SAPI-015 accept · P1. Free-space check per piece; count open reservations in the create check; cap open uploads per account (8); use or delete `uploadIdleLife`.
- SAPI-016 accept · `limAuthUsr` on every password-verifying route, reset on success.
- SAPI-017 accept · one shared emoji validator (unicode sequence or `name:id` that exists) for reactions, status emoji and the presence op.
- SAPI-018 accept · both moderator routes (`DELETE …/reactions/{emoji}/{user_id}`, `DELETE …/reactions`) behind Manage Messages; web context-menu items; Android when its actions sheet is touched.
- SAPI-019 accept · quantised expiry (12 h buckets, valid 24–36 h); clients keep refreshed links for the session.
- SAPI-020 accept · epoch creator's grant replaces a prior one; recipient may delete their own grant to re-raise the need; per-wrapper limiter.
- SAPI-021 accept · nonce lookup before the limiter.
- SAPI-022 accept · `friend_request_privacy` (everyone · mutual servers · friends of friends · nobody) + 20/h outgoing limiter; settings UI on web (Privacy page) and Android.
- SAPI-023 accept · cap `about_me` at 10 000 runes (the README promises "unlimited"; that stays true in spirit) and drop it from `Public()` in list contexts; only the profile route returns it.
- SAPI-024 accept · per-account limiter on GIF search (60/min), `q` capped at 100 runes.
- SAPI-025 accept · per-creator cap 10 with the channel cap as ceiling; better message.
- SAPI-026 accept · generous caps so "unlimited" stays honest in practice: 500 emoji per server, 200 stickers per pack, 100 packs per account; errors say the number.
- SAPI-027 accept · P2. `dropVoice` in `handleRecipientRemove` (or route through `removeFromGroup`); test.
- SAPI-028 accept · `Warn` log lines for the five admin actions with actor/target/change; plus SAPI-032's protection.
- SAPI-029 accept · both corrections to the legal report.
- SAPI-030 accept · tighten CSP as proposed; must run the full e2e suite and check unfurl cards/YouTube thumbnails load through the proxy; keep `challenges.cloudflare.com`.
- SAPI-031 accept · per-account limiter 10/min burst 20 + keep at most 20 rows per user.
- SAPI-032 accept · refuse demoting/disabling `ADMIN_USERNAME` (or the first account) by anyone else; re-apply the flag at startup.
- SAPI-033 accept · HSTS when `PublicURL` is https.
- SAPI-034 accept · delete a departing member's invites (kick, ban, leave, deletion), emit `invite_delete`.
- SAPI-035 accept · P2. Limiter names in the shared key; test with two limiters sharing one backend.
- SAPI-036 accept · make `TestReadJSON` real.
- SAPI-037 accept · voice package: refuse audio publish while server-muted/suppressed; close tracks at the SFU on mute/deafen; recompute `Suppress` on role/overwrite change; tests.
- SAPI-038 accept · cache TURN per guest id with the shortened reuse window; test.
- SAPI-039 accept · validate both TURN pairs at startup; `Warn` when a mint fails; `PUBLIC_URL` unset → startup warning naming the example line (not a failure — live sets it, but a stranger's copy must not silently point here: default it to `http://<LISTEN>` when unset).
- SAPI-040 accept · one `turnConfigured()` helper.
- SAPI-041 accept · tidy the test helper.
- SAPI-042 accept · the table-driven hierarchy test.
- SAPI-043 accept · P1. Server answers `403 invalid_credentials` on the five routes; Android keys sign-out on `code == "unauthorized"`; test.
- SAPI-044 accept · P1. Android decodes the wrappers, merges `users`, shows an error state; a shared JSON fixture test for the list routes.
- SAPI-045 accept · Android sends `max_age`; server logs unknown fields at debug (no rejection).
- SAPI-046 accept · Android `JoinResult` with optional `server`/`channel`; server keeps the shapes (documented).
- SAPI-047 accept · server refuses video/screen publish without `Stream`, clears flags on join/resume; both clients gate the buttons; test.
- SAPI-048 accept · hide the four dead toggles in both editors; enforce Embed Links by forcing the suppress-embeds flag at send for authors without it; help text for the two client-honoured ones.
- SAPI-049 accept · optional `Idempotency-Key`/`nonce` on the create routes (server, remembered per account for 5 min); Android `retryOnConnectionFailure(false)` and retry only idempotent calls.
- SAPI-050 accept · correct the three Android wrappers.

## web-core (WCORE) — 29 findings, 29 accepted

- WCORE-001 accept · guard the 2xx parse like `upload`; test.
- WCORE-002 accept · remove `maximum-scale`/`user-scalable`, delete `noZoom.ts`; the fix agent confirms every phone-layout input is ≥ 16 px and checks focus-zoom on the iOS Simulator (iPhone 14, iOS 16.2).
- WCORE-003 accept · decided with the chat list: if `MessageList` is virtualised in this round, keep the dependency; otherwise remove it and regenerate `licenses.json`.
- WCORE-004 accept · abort signal through `PieceSender`/worker, cancel affordance while sending; Android tray gets the same (`Uploads.kt`).
- WCORE-005 accept · with 004.
- WCORE-006 accept · session path above 8 MB; one retry on network/5xx for the single POST; both platforms.
- WCORE-007 accept · batched unwraps + `saveRoots` in one transaction.
- WCORE-008 accept · teardown inside `lockApp`; a lock does **not** end a call (people lock while listening); the passcode page shows "in a call" with a hang-up button.
- WCORE-009 accept · six-digit minimum for new numeric passcodes (existing ones keep working); honest copy on the Security page; Android: honour the policy with `BiometricPrompt` + device credential (android package), until then the web copy says web and desktop.
- WCORE-010 accept · per-user namespacing of panes/lastChannel/volumes; `reset` on the three stores; clear `unsent`; abort inflight media jobs.
- WCORE-011 accept · one shared fetch guard.
- WCORE-012 accept · warn + crash report on handler failure.
- WCORE-013 accept · keep `pending` across `clearAll`; spare and `syncGap` every pane's channel.
- WCORE-014 accept · drop bodies for channels that are neither loaded nor shown.
- WCORE-015 accept · reuse the paced fetcher; report failed channels; fail the export on non-403/404.
- WCORE-016 accept · `notifications.preview` full · name · none, web and Android.
- WCORE-017 accept · export strings through `t()`; README stays English with a translated first line.
- WCORE-018 accept · device-sized in-page cap with an honest message before fetching.
- WCORE-019 accept · captcha sheet: translated words, focus in/out, Escape, `aria-modal`.
- WCORE-020 accept · templates per verb; `Intl.ListFormat`; Android equivalents.
- WCORE-021 accept.
- WCORE-022 accept · timeout stripping in `base()` + test.
- WCORE-023 accept · P2. `isDMLike`-style check including subchats + per-type test; Android `KeyService.kt` checked for the same.
- WCORE-024 accept · P2. `lastMessage` map out of `byId`; render ctx once per list via React context with lazy lookups; test that another channel's message does not re-render a row.
- WCORE-025 accept · shared markdown fixture file read by both suites; Android fixes 1–3, 5–8, 13–14; web fix 9 (blocks inside quotes, as Discord).
- WCORE-026 accept · Android sends previews (android package).
- WCORE-027 accept · with VOICE-028: dynamic-import the voice engine at the three seams; report sizes before/after.
- WCORE-028 accept · candidate-name test; share the table with the picker index.
- WCORE-029 accept · every fix above lands with its test; plus a `dispatch.test.ts` ordering suite.

## voice (VOICE) — 28 findings, 28 accepted

- VOICE-001 accept · P1. `connection` state in the voice store; "Reconnecting…" in status, stage and tiles; grey dot while not connected; Android `CallScreen` gets the same state.
- VOICE-002 accept · interval loss, both transports.
- VOICE-003 accept · `keysArrived` from a keys-store hook + sender-side grace on the old epoch; Android the same.
- VOICE-004 accept · "Try again" → `refreshMic()`; mute button retries while blocked; `devicechange` and `permissions.query` retries; Android re-asks.
- VOICE-005 accept · all listed literals (incl. GuestCallPage, VoicePage, IncomingCallScreen, Notifications.kt) through the catalogue.
- VOICE-006 accept · transport takes an `iceServers()` provider used on every rebuild/restart; server reuse only while ≥ 3 h left; guests get the full TTL; Android the same.
- VOICE-007 accept · server tags the displacing leave `reason: "moved"`; client shows the toast on it.
- VOICE-008 accept · no ring on a resume that carries an `sfu_session`; keep the pinned test's case.
- VOICE-009 accept · backoff toward `RETRY_MAX_MS` after 8 refusals; reset on a new tag; both platforms.
- VOICE-010 accept · charge screen pulls from a server-side tier table keyed by a `quality` enum.
- VOICE-011 accept · P1. `startRebuild()` after ≥ `TRACKS_GONE_MS` down; 35 s outage step in `call_soak.py`.
- VOICE-012 accept · L. Focused layout + pinch zoom + full screen for shares/cameras; long-press sheet with volume, local mute, stream volume; persisted per user.
- VOICE-013 accept · `requireFrameEncryption`; must be verified in a real SFU call on the emulator (device test) before shipping.
- VOICE-014 accept · web behaviour on both: stay, show "X left · waiting", auto hang-up after 60 s alone.
- VOICE-015 accept · P1. Remove the window-level Enter; per-tile Enter selects and chooses.
- VOICE-016 accept · strings passed in the `getDisplayMedia` round trip; radiogroup semantics and arrow keys.
- VOICE-017 accept · host C++ test target with NIST vectors + fixtures written by `frameCrypto.test.ts`; wired into `tools/check.sh`.
- VOICE-018 accept · implement push to talk on Android: mic disabled in PTT mode, large hold-to-talk button on the call screen; pair with 019.
- VOICE-019 accept · phone layout: sentence instead of key capture; hold-to-talk button in the narrow control row.
- VOICE-020 accept · "Calls" card on the admin page.
- VOICE-021 accept · (a) rekey + second-device checks in `sfu_call.py`; (b) `--assert` thresholds in `call_quality.py`; (c) 35 s outage in `call_soak.py`; (e) the three `session.test.ts` cases. (d) phone-browser network change via emulator Chrome is a stretch goal, recorded if not done.
- VOICE-022 accept · rotate on guest removal/revoke while a call is live.
- VOICE-023 accept · red-tinted "off" pill on web and Android.
- VOICE-024 accept · P1. Ringtone channel `calls_v2` with ringtone attributes + vibration; in-app looping `Ringtone`; stopped on answer/decline/end/timeout.
- VOICE-025 accept · floating layers inherit `data-dark-scope`; guest page scoped.
- VOICE-026 accept · keep the band inside the call on coarse pointers.
- VOICE-027 accept · `insetInlineStart`.
- VOICE-028 accept · with WCORE-027.
