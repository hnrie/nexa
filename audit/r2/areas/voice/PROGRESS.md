# Progress — voice
State: audit-done
Last checkpoint: 2026-09-19T05:20Z
Next finding id: 029

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
- [x] internal/api/sfu_handlers_test.go
- [x] internal/api/voice_glue.go
- [x] internal/api/voice_handlers_test.go
- [x] internal/api/guest_handlers.go (call parts)
- [x] internal/voice/registry.go
- [x] internal/voice/registry_test.go
- [x] internal/realtime/client.go
- [x] internal/realtime/client_test.go
- [x] internal/realtime/meter.go
- [x] internal/realtime/meter_test.go
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
- [x] android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt (the calls channel and ringing() — read for VOICE-024)
- [x] android/app/src/main/cpp/aes_gcm.cc
- [x] android/app/src/main/cpp/aes_gcm.h
- [x] android/app/src/main/cpp/frame_crypto.cc
- [x] android/app/src/main/cpp/sealed_frame.cc
- [x] android/app/src/main/cpp/sealed_frame.h
- [x] android/app/src/main/cpp/webrtc_abi.h
- [x] android/app/src/main/cpp/CMakeLists.txt
- [x] android/app/proguard-rules.pro (the org.jni_zero keep rule — present, lines 22-25)

### desktop
- [x] desktop/src/main/appAudio.ts
- [x] desktop/src/main/displayPicker.ts
- [x] desktop/src/main/permissions.ts
- [x] desktop/src/picker/picker.html
- [x] desktop/src/picker/preload.ts
- [x] desktop/src/picker/ui.ts

### tools and tests
- [x] tools/sfu_call.py
- [x] tools/sfu_guest.py
- [x] tools/call_quality.py
- [x] tools/netsim/main.go
- [x] tools/device/call_peer.py
- [x] tools/device/call_soak.py
- [x] tools/device/handover.py
- [x] tools/device/sfu_server.py

### round 1 cross-check
- [x] audit/REVIEW.md (Done / Not doing / Still open for voice)
- [x] audit/android-calls.md (the nine CRASH items verified against the code; see the Summary)
- [x] audit/crypto.md (voice parts: T-table note, guest revoke rotation → VOICE-022, key index collision, salt race, no sender auth)
- [x] audit/web-bugs.md, audit/web-ui.md, audit/performance.md (voice parts; still-open ones re-reported as VOICE-023/025/026/027/028)

## Handoff note
Audit complete: 28 findings (P1 4, P2 11, P3 13), Summary written at the top
of FINDINGS.md. Every pending thread from the earlier handoff notes is settled
(see "Settled without a finding" in the Summary). Nothing left to read.
Successor, if any: nothing to do in this area until triage.
