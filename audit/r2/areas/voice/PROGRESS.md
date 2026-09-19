# Progress — voice
State: auditing
Last checkpoint: 2026-09-19T00:18Z
Next finding id: 015

## Inspected

### web/src/voice (reading order first)
- [x] web/src/voice/transport.ts
- [x] web/src/voice/session.ts
- [x] web/src/voice/sfu.ts
- [x] web/src/voice/mesh.ts
- [x] web/src/voice/media.ts
- [x] web/src/voice/playback.ts
- [x] web/src/voice/e2ee.ts
- [x] web/src/voice/frameCrypto.ts
- [x] web/src/voice/frameCrypto.worker.ts
- [x] web/src/voice/guestKeys.ts
- [x] web/src/voice/redundancy.ts
- [x] web/src/voice/copyPlanner.ts
- [x] web/src/voice/playoutDelay.ts
- [x] web/src/voice/speaking.ts
- [x] web/src/voice/shareQuality.ts
- [x] web/src/voice/devices.test.ts (devices logic lives in media.ts / deviceMenus.ts)
- [x] web/src/voice/session.test.ts
- [x] web/src/voice/media.test.ts
- [x] web/src/voice/playback.test.ts
- [x] web/src/voice/frameCrypto.test.ts
- [x] web/src/voice/guestKeys.test.ts
- [x] web/src/voice/redundancy.test.ts
- [x] web/src/voice/copyPlanner.test.ts
- [x] web/src/voice/playoutDelay.test.ts
- [x] web/src/voice/speaking.test.ts
- [x] web/src/voice/shareQuality.test.ts

### web stores / lib
- [x] web/src/stores/voice.ts
- [x] web/src/stores/voice.test.ts
- [x] web/src/stores/voiceLocal.ts
- [x] web/src/stores/voiceLocal.test.ts
- [x] web/src/lib/audioKeeper.ts
- [x] web/src/lib/audioKeeper.test.ts
- [x] web/src/lib/callLayout.ts
- [x] web/src/lib/callLayout.test.ts
- [x] web/src/lib/callPanel.ts
- [x] web/src/lib/callPanel.test.ts

### web components / pages
- [x] web/src/components/voice/VoiceView.tsx
- [x] web/src/components/voice/VoiceParticipants.tsx
- [x] web/src/components/voice/VoiceStatus.tsx
- [x] web/src/components/voice/CallBanner.tsx
- [x] web/src/components/voice/IncomingCall.tsx
- [x] web/src/components/voice/ShareScreenModal.tsx
- [x] web/src/components/voice/GuestLinkModal.tsx
- [x] web/src/components/voice/HangUp.tsx
- [x] web/src/components/voice/deviceMenus.ts
- [x] web/src/components/voice/Voice.module.css
- [x] web/src/pages/GuestCallPage.tsx
- [x] web/src/pages/GuestCallPage.module.css
- [x] web/src/components/settings/VoicePage.tsx
- [x] web/src/components/desktop/DisplayPicker.tsx

### server
- [x] internal/api/sfu_handlers.go
- [ ] internal/api/sfu_handlers_test.go
- [x] internal/api/voice_glue.go
- [ ] internal/api/voice_handlers_test.go
- [x] internal/api/guest_handlers.go (call parts)
- [x] internal/voice/registry.go
- [ ] internal/voice/registry_test.go
- [x] internal/realtime/client.go
- [ ] internal/realtime/client_test.go
- [x] internal/realtime/meter.go
- [ ] internal/realtime/meter_test.go
- [x] internal/gateway/conn.go (voice_state / voice_signal parts)
- [x] internal/gateway/hub.go (voice parts)

### android
- [x] android/app/src/main/java/xyz/evilion/chat/voice/FrameCryptoNative.kt
- [x] android/app/src/main/java/xyz/evilion/chat/voice/SfuTransport.kt
- [x] android/app/src/main/java/xyz/evilion/chat/voice/Speaking.kt
- [x] android/app/src/main/java/xyz/evilion/chat/voice/VoiceEngine.kt
- [x] android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/voice/CallScreen.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/voice/IncomingCallScreen.kt
- [x] android/app/src/main/java/xyz/evilion/chat/ui/common/HangUp.kt
- [x] android/app/src/main/java/xyz/evilion/chat/service/Services.kt (call foreground service parts)
- [ ] android/app/src/main/cpp/aes_gcm.cc
- [ ] android/app/src/main/cpp/aes_gcm.h
- [ ] android/app/src/main/cpp/frame_crypto.cc
- [ ] android/app/src/main/cpp/sealed_frame.cc
- [ ] android/app/src/main/cpp/sealed_frame.h
- [ ] android/app/src/main/cpp/webrtc_abi.h
- [ ] android/app/src/main/cpp/CMakeLists.txt
- [ ] android/app/proguard-rules.pro (the org.jni_zero keep rule)

### desktop
- [ ] desktop/src/main/appAudio.ts
- [ ] desktop/src/main/displayPicker.ts
- [ ] desktop/src/main/permissions.ts
- [ ] desktop/src/picker/picker.html
- [ ] desktop/src/picker/preload.ts
- [ ] desktop/src/picker/ui.ts

### tools and tests
- [ ] tools/sfu_call.py
- [ ] tools/sfu_guest.py
- [ ] tools/call_quality.py
- [ ] tools/netsim/main.go
- [x] tools/device/call_peer.py
- [ ] tools/device/call_soak.py
- [x] tools/device/handover.py
- [x] tools/device/sfu_server.py

### round 1 cross-check
- [ ] audit/REVIEW.md (Done / Not doing / Still open for voice)
- [ ] audit/android-calls.md
- [ ] audit/crypto.md (voice parts)
- [ ] audit/web-bugs.md, audit/web-ui.md, audit/performance.md (voice parts)

## Handoff note
VOICE-011..014 + addenda written. Remaining: C++ (6 files + CMake + proguard), desktop (6), tools (sfu_call, sfu_guest, call_quality, netsim, rest of call_soak), Go tests (names skimmed; tick after a look), round-1 cross-check, then Summary.
VoiceSession.kt/VoiceEngine.kt read. (L) CONFIRMED in code: after >=20 s down Android calls refreshTracks() -> sync() which compares tags and finds nothing to drop/add -> no re-pull, no republish; the web rebuilds. Likely P0 (silent both ways after a long outage) — verify against tools/device/handover.py + call_soak.py (do they test >=30 s outages?) before writing. (M) resolved: release() drops Kotlin's ref; receiver keeps its own — verify refcount in frame_crypto.cc. (N) requireFrameEncryption not set on Android — P3 hardening. Parity note: Android leaves a DM call on call_end when alone; web stays.
SfuTransport.kt read: iceServers fixed at construction (VOICE-006 applies), 4 s key poll (VOICE-003 applies), pull retry same as web (VOICE-009). Open Android threads: (L) after >=20 s down Android only re-pulls (refreshTracks) and does not republish — if the SFU dropped this device's published tracks after 30 s, others cannot hear it; check VoiceSession.refreshTracks/republishAfterRebuild. (M) attachTrack releases a decryptor just handed to an unknown-mid receiver — check what NativeFrameDecryptor.release does in the C++ (delete vs refcount). (N) VoiceEngine: is requireFrameEncryption set (else clear frames could play as noise)?
VOICE-006..010 written (TURN expiry, moved-device toast unreachable, restart re-ring, pull retry cap, declared share bitrate). Threads A,B,C,E(part),F resolved. Still to verify in registry.go: Join(next, keep) preserves SFUSession/Tracks on a mute toggle; LeaveDetached compares the SFU session; Resume semantics. In guest_handlers: canGuestJoinVoice, guest limits, sweep, moderator move of a guest drops the Guest flag (voice_glue.go:741 builds a State without Guest/GuestEpoch — write as P3 if guests can be moved). Meter: user-facing messages, month rollover, admin view.
Web side fully read. Pending small items to write at the end: VOICE-005 addendum (GuestCallPage.tsx:277 'Join Again', :293 fine print; VoicePage.tsx:209 'Change'); P3 PTT offered on touch devices with a key capture that cannot complete (VoicePage.tsx:201-211 vs session.ts noKeyToHold). Long-press shim exists (lib/longPress.ts) so right-click tile menus are fine on touch. Now the server: sfu_handlers.go, voice_glue.go first.
VOICE-001 (reconnecting not shown), 002, 003, 004, 005 written. Next: Voice.module.css, ShareScreenModal, GuestLinkModal, GuestCallPage, VoicePage, DisplayPicker; check for a long-press→contextmenu shim (tile menus are right-click only; iOS Safari has no contextmenu on long-press).
transport/session/sfu read. Threads to verify against the server (write up
once the server side is read):
(A) SfuTransport keeps `ice` from construction for every rebuild/ICE restart;
    session.ts caches /voice/ice 30 min. What is the TURN TTL? A restart after
    TTL on a relay-only network would fail.
(B) A refused pull (not_found_track_error) retries forever every <=1.6 s
    (pullRetries uncapped) — does meter.go charge a refused pull? server load?
(C) The client sends its own screen `bitrate` in /voice/sfu/publish — does the
    server cap it / use it for charging?
(D) WRITTEN as VOICE-002. SfuTransport.stats() loss is cumulative over the call, not recent — check
    VoiceStatus thresholds (indicator stuck bad / dilutes late trouble).
(E) video_paused: client leaves video 10 min then asks again → toast every
    10 min "paused until next month" + camera forced off; check publish refusal.
(F) voice_resumed kept:false → transport.reconnected() (sessionId=null) but no
    new voice_state is sent; who triggers joined()/connect()? check voice_glue.
(G) WRITTEN as VOICE-004. mic denied: micBlocked in store; retry affordance in VoiceView?
(H) resolved: supported() covers legacy createEncodedStreams; only Firefox<117/Safari<15.4 refused, with a message. No finding.
(K) Tests: session.test.ts covers only 4 event flows (another device's state, refused signals, ringing); nothing on join/leave/reconnect/rekey/network change — write as a test finding at the end.
(J) WRITTEN as VOICE-003. (J-confirmed) keys.ts ring.set on grant arrival has no hook to the transport; only the 4 s poll. Write as P2.
(J) Key rotation: receivers only learn a new epoch by the 4 s KEY_CHECK_MS poll (keysArrived only on move) — a sender that rotated first is dropped up to 4 s; check stores/keys.ts for a ring-change hook to subscribe to.
(I) mesh.ts stats() loss is cumulative too (same as D). Mesh exposes host ICE candidates (P2P by design; dev only).
