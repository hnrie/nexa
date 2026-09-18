# Brief — voice (finding prefix `VOICE`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

Calls, on every platform, end to end:

```
web/src/voice/                 all 26 (session, sfu, mesh, transport, media, playback, e2ee,
                               frameCrypto + worker, redundancy, copyPlanner, playoutDelay,
                               shareQuality, speaking, guestKeys, devices, the tests)
web/src/components/voice/      all 10 (VoiceView, VoiceParticipants, VoiceStatus, CallBanner,
                               IncomingCall, ShareScreenModal, GuestLinkModal, HangUp,
                               deviceMenus, Voice.module.css)
web/src/stores/                voice.ts voiceLocal.ts (+ tests)
web/src/lib/                   callLayout.ts callPanel.ts audioKeeper.ts (+ tests)
web/src/pages/                 GuestCallPage.tsx GuestCallPage.module.css
web/src/components/settings/   VoicePage.tsx (device logic; the page UX is web-shell-ui's)
web/src/components/desktop/    DisplayPicker.tsx (the web side of screen-share picking)
internal/api/                  sfu_handlers.go voice_glue.go voice_handlers_test.go
                               sfu_handlers_test.go guest_handlers.go (call parts)
internal/voice/                registry.go
internal/realtime/             client.go meter.go (the SFU client and the allowance meter)
internal/gateway/              the voice_state / voice_signal handling in conn.go and hub.go
android/.../voice/             FrameCryptoNative.kt SfuTransport.kt Speaking.kt VoiceEngine.kt
                               VoiceSession.kt
android/.../ui/voice/          CallScreen.kt IncomingCallScreen.kt
android/.../ui/common/HangUp.kt
android/app/src/main/cpp/      aes_gcm.cc/.h frame_crypto.cc sealed_frame.cc/.h webrtc_abi.h
android/.../service/Services.kt (the call foreground service parts)
desktop/src/main/              appAudio.ts displayPicker.ts permissions.ts (share audio + picker)
desktop/src/picker/            picker.html preload.ts ui.ts
tools/                         sfu_call.py sfu_guest.py call_quality.py netsim/
tools/device/                  call_peer.py call_soak.py handover.py
```

Other areas audit the same server and desktop files for authorization,
validation and Electron security; you audit them for **call semantics**.

## What this area is

Calls go through Cloudflare's Realtime SFU (live since 2026-09-13) with
Cloudflare TURN; the peer-to-peer mesh (`mesh.ts`) remains for instances
without SFU keys and is what the e2e suite exercises. One RTCPeerConnection
per device to Cloudflare; chatd proxies session/publish/subscribe/
renegotiate/close and only lets you pull tracks from people in your own
call. Frames are end-to-end encrypted: AES-GCM with the clear Opus TOC /
VP8 header as AAD, an 8-byte salt + 4-byte counter IV, a key index byte; VP8
is forced. On web this is an `RTCRtpScriptTransform` worker
(`frameCrypto.worker.ts`); on Android it is C++ implementing libwebrtc's
`FrameEncryptorInterface`/`FrameDecryptorInterface` (the NDK has no crypto
library, so AES-GCM is hand-written and tested against NIST vectors and the
web client's output). Voice states carry `media: {kind: tag}` so a
republished track is re-pulled; cameras stay pulled while off; screen shares
are pulled only while watched. A meter charges per pull and pauses video at
90 % of the free allowance and new calls at 99 %. Guests join by link
(`GuestCallPage`) with the frame key in the fragment; members relay rotated
keys to guests over `voice_signal`. Bad-network work (2026-09-14):
`redundancy.ts` wraps up to two earlier frames in Opus code-3 padding and a
receiver-side "mender"; `copyPlanner.ts` decides the depth from loss reports;
ICE restart via `PUT /voice/sfu/restart`; a 20 s gateway resume grace.
Android calls were silent after any network change until 2026-09-18 (four
causes, all in `SfuTransport.kt`/`VoiceSession.kt`); the web client "may
share cause 3 on phones (continual gathering) — untested; it only restarts
on `disconnected`".

## Checklist

Correctness of the call lifecycle, per platform (web desktop browser, web
on a phone browser / iOS home-screen app, Android native, Electron):
- Join: permission prompts (mic denied → what does the user see and can
  they retry?), device selection persisted, the SFU session creation and
  publish, the `sfu_required`/`sfu_off` handshakes, joining a channel you
  are already in from another device (what happens to the first device?),
  joining while another call rings.
- Leave: every resource released (tracks stopped, PC closed, worker
  terminated, AudioContext released — the iOS home-screen audio rules in
  `audioKeeper.ts`), the SFU session closed server-side, the voice state
  cleared for others promptly, the foreground service stopped on Android.
- Network change and reconnect: the web client on a phone changing from
  Wi-Fi to mobile (Android cause 3 — read `sfu.ts`'s ICE handling and say
  whether the web needs `GATHER_ONCE`-style handling or an explicit
  restart on network change; propose a test); gateway drop vs. media drop;
  the 20 s resume grace and `voice_resumed kept:false`; TRACKS_GONE_MS
  rebuild after ≥20 s down; retry caps; what the user sees during each
  (a "reconnecting" state? silence with no indication is a P0).
- Two-device and race cases: `voice_glue.go`'s reconnect logic deciding a
  reconnect is "another device" (the 2026-09-18 bug — is the fix general?),
  a user leaving and rejoining within the grace, a moderator moving someone
  mid-reconnect, a kick during a call (does the key rotate and the kicked
  device stop hearing?), the server restarting mid-call.
- Key rotation during a call (epoch bump): every platform re-keys senders
  and receivers; the key index byte; guests get relayed keys only from
  non-guests; old keys retained long enough for in-flight frames but not
  forever.
- Ringing: DM calls ring the callee on every device (web, Android
  notification with full-screen intent?), decline/timeout/cancel propagate,
  the incoming call UI on a locked phone, the ringtone respecting the
  device's silent switch (`incoming-call.m4a` via WebAudio on iOS
  home-screen — round of fixes in `4980f48`; verify).
- Moderation: server mute/deafen/move/disconnect from the member list and
  the voice participants; hierarchy; what the muted person sees.
- Speaking detection, PTT vs. VAD, thresholds, the mute/unmute sounds,
  self-mute vs. server-mute display, deafen implying mute.
- Screen share: source picking (browser picker, Electron's own window —
  `displayPicker.ts`; the consent window design from round 1), quality and
  bitrate caps (`shareQuality.ts`), share audio on each OS (the
  desktop-app gating facts below), stopping from the OS's own control,
  viewers pulling only while watching, share tiles on phones, "share your
  own screen" on Android (not supported? say so as a parity finding).
- Camera: on/off without republish, front/back on phones, mirror self
  view only, resolution/frame rate caps, the pause-at-90 % meter behaviour
  visible to users.
- Playback: per-user volume to 200 %, output device selection (Chromium
  only; Safari?), the held-gain-until-first-opened-frame rule (noise fix
  `9fcc57b`), playout delay (`playoutDelay.ts`), the mender (`redundancy.ts`)
  — read the Chromium write-order facts below and check nothing violates
  them.
- Meter (`meter.go`): correct per-pull accounting, users told why video
  paused or a call refused (a plain message, not a code), month rollover,
  the admin's view of usage (round 1 left "Calls this month: X of Y GB"
  undone — check `AdminPage.tsx`).
- Guest calls: the link's fragment format, epoch check, captcha, the
  guest's UI (name entry, mic test, leaving, being removed), guest limits
  (10 per link, 25 per channel), sweep after 2 min offline, the guest's
  visibility to members (flags 8), what a guest can and cannot do.

Security and privacy of calls:
- Does anything leak a participant's IP (relay-only enforced? ICE
  candidates filtered before display/logging?); what the server learns
  (tags, sizes, timing); a member of another channel pulling a track
  (`not_in_call` — verify server-side, not client-side); a guest pulling
  members' cameras; a stale session token operating a live SFU session;
  the `/voice/ice` TURN credential TTL (capped to a guest's stay, never
  cached — verify); frame-crypto nonce uniqueness across senders and after
  a rekey; AAD covering everything an SFU might rewrite.

UI of calls (both web and Android — compare, and judge which is better):
- The call view (`VoiceView.tsx` 875 lines; `CallScreen.kt` 512): layouts
  (focus/grid, PiP), controls reachable with one thumb on a phone, labels
  and states on every button (`aria-label`, pressed state), the participant
  list, speaking rings, connection quality readout, the call banner when
  navigating away, minimising the call on a phone, landscape, the
  incoming-call screen, the hang-up affordance, what an error looks like.
- Voice settings page: device pickers (labels when permission is not yet
  granted), input sensitivity meter, PTT key capture (on a phone?), echo
  cancellation/noise suppression toggles, test buttons, and whether
  settings apply live during a call.

Tests: `sfu_call.py` (29 checks), `sfu_guest.py`, `call_quality.py`, the
device tests. What has no automated check — network change on the web
client on a phone, rekey during a call, two devices — propose the test.

## Compare with

Web ↔ Android in every item above. Where Android learned something (the
four network-change causes), check the web for the same class of bug.

## Round 1

`audit/REVIEW.md`, `audit/android-calls.md` (51, 9 CRASH), the voice parts
of `audit/crypto.md`, `audit/web-bugs.md` and `audit/web-ui.md`, and
`audit/performance.md` ("the voice engine in the entry bundle"). Verify the
CRASH fixes in the Android call path and the `org.jni_zero` keep rule in
`android/app/proguard-rules.pro`.

## Facts you would otherwise rediscover

- Chromium: frames must be written in the order read; frames constructed
  with `new RTCEncodedAudioFrame` are silently dropped; a code-3 multi-frame
  Opus packet written as the earlier frame plays both; `setMetadata` does
  not exist on audio frames; `priority: "high"` on the audio sender floods
  padding under uplink loss (removed — must not come back).
- Cloudflare: tracks are GC'd after 30 s without packets; session ops wait
  up to 5 s for the PC; `not_found_track_error` when pulling before the
  publisher's PC connects (client retries with 400 ms backoff); a close
  after the PC died returns 400.
- Android: never call `getTransceivers()/getReceivers()/getSenders()` on the
  connection (libwebrtc disposes the wrappers; `tools/check.sh` greps for
  it); `GATHER_ONCE`; resume + `sfu_session` on reconnect; rebuild on
  `voice_resumed kept:false`.
- Desktop share audio: ask for `loopbackWithoutChrome` by name; per-window
  `applicationLoopback:<pid|bundleId>` on Windows / macOS 14.2+; never drop
  audio based on track settings (a guard once silenced every Windows share
  — `never-disable-untestable-platforms`); fail open with sound, maybe
  echo, over silence.
- iOS 26 home-screen apps have a system audio bug; `audioKeeper.ts` limits
  exposure (release contexts when idle/hidden, resume interrupted ones).
- Real SFU tests need `REALTIME_APP_ID`/`REALTIME_APP_SECRET` from
  `chatd.env` — `tools/device/sfu_server.py` reads exactly those and hands
  them only to its child. You may run `tools/sfu_call.py` with
  `E2E_CHATD`/`E2E_WEB_DIST` at scratch builds under a memory watchdog if
  a finding needs it; it costs Cloudflare allowance, so once, not in a loop.
  Do not start the emulator (the `ux-walkthrough` agent owns it); read the
  Android code and the device test scripts instead.
- The e2e voice flow depends on the expressions flow running first; run
  the full `tools/e2e.py` rather than `--flows voice`.

## Reading order

`web/src/voice/transport.ts`, `session.ts`, `sfu.ts`, `mesh.ts` →
`media.ts`, `playback.ts`, `e2ee.ts`, `frameCrypto.ts` + worker,
`guestKeys.ts` → `redundancy.ts`, `copyPlanner.ts`, `playoutDelay.ts`,
`speaking.ts`, `shareQuality.ts`, `devices` → `stores/voice.ts`,
`voiceLocal.ts`, `lib/audioKeeper.ts`, `callLayout.ts`, `callPanel.ts` →
`components/voice/*`, `GuestCallPage.tsx`, `VoicePage.tsx`,
`DisplayPicker.tsx` → `internal/api/sfu_handlers.go`, `voice_glue.go`,
`internal/voice/registry.go`, `internal/realtime/*`, the gateway voice ops,
the guest handlers → `android/.../voice/*`, `ui/voice/*`, the C++ →
`desktop/src/main/appAudio.ts`, `displayPicker.ts`, `permissions.ts`, the
picker → the tools and tests.
