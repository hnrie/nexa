# Progress — voice
State: auditing
Last checkpoint: 2026-09-19T00:02Z
Next finding id: 001

## Inspected

### web/src/voice (reading order first)
- [ ] web/src/voice/transport.ts
- [ ] web/src/voice/session.ts
- [ ] web/src/voice/sfu.ts
- [ ] web/src/voice/mesh.ts
- [ ] web/src/voice/media.ts
- [ ] web/src/voice/playback.ts
- [ ] web/src/voice/e2ee.ts
- [ ] web/src/voice/frameCrypto.ts
- [ ] web/src/voice/frameCrypto.worker.ts
- [ ] web/src/voice/guestKeys.ts
- [ ] web/src/voice/redundancy.ts
- [ ] web/src/voice/copyPlanner.ts
- [ ] web/src/voice/playoutDelay.ts
- [ ] web/src/voice/speaking.ts
- [ ] web/src/voice/shareQuality.ts
- [ ] web/src/voice/devices.test.ts (devices logic lives in media.ts / deviceMenus.ts)
- [ ] web/src/voice/session.test.ts
- [ ] web/src/voice/media.test.ts
- [ ] web/src/voice/playback.test.ts
- [ ] web/src/voice/frameCrypto.test.ts
- [ ] web/src/voice/guestKeys.test.ts
- [ ] web/src/voice/redundancy.test.ts
- [ ] web/src/voice/copyPlanner.test.ts
- [ ] web/src/voice/playoutDelay.test.ts
- [ ] web/src/voice/speaking.test.ts
- [ ] web/src/voice/shareQuality.test.ts

### web stores / lib
- [ ] web/src/stores/voice.ts
- [ ] web/src/stores/voice.test.ts
- [ ] web/src/stores/voiceLocal.ts
- [ ] web/src/stores/voiceLocal.test.ts
- [ ] web/src/lib/audioKeeper.ts
- [ ] web/src/lib/audioKeeper.test.ts
- [ ] web/src/lib/callLayout.ts
- [ ] web/src/lib/callLayout.test.ts
- [ ] web/src/lib/callPanel.ts
- [ ] web/src/lib/callPanel.test.ts

### web components / pages
- [ ] web/src/components/voice/VoiceView.tsx
- [ ] web/src/components/voice/VoiceParticipants.tsx
- [ ] web/src/components/voice/VoiceStatus.tsx
- [ ] web/src/components/voice/CallBanner.tsx
- [ ] web/src/components/voice/IncomingCall.tsx
- [ ] web/src/components/voice/ShareScreenModal.tsx
- [ ] web/src/components/voice/GuestLinkModal.tsx
- [ ] web/src/components/voice/HangUp.tsx
- [ ] web/src/components/voice/deviceMenus.ts
- [ ] web/src/components/voice/Voice.module.css
- [ ] web/src/pages/GuestCallPage.tsx
- [ ] web/src/pages/GuestCallPage.module.css
- [ ] web/src/components/settings/VoicePage.tsx
- [ ] web/src/components/desktop/DisplayPicker.tsx

### server
- [ ] internal/api/sfu_handlers.go
- [ ] internal/api/sfu_handlers_test.go
- [ ] internal/api/voice_glue.go
- [ ] internal/api/voice_handlers_test.go
- [ ] internal/api/guest_handlers.go (call parts)
- [ ] internal/voice/registry.go
- [ ] internal/voice/registry_test.go
- [ ] internal/realtime/client.go
- [ ] internal/realtime/client_test.go
- [ ] internal/realtime/meter.go
- [ ] internal/realtime/meter_test.go
- [ ] internal/gateway/conn.go (voice_state / voice_signal parts)
- [ ] internal/gateway/hub.go (voice parts)

### android
- [ ] android/app/src/main/java/xyz/evilion/chat/voice/FrameCryptoNative.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/voice/SfuTransport.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/voice/Speaking.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/voice/VoiceEngine.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/voice/CallScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/voice/IncomingCallScreen.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/ui/common/HangUp.kt
- [ ] android/app/src/main/java/xyz/evilion/chat/service/Services.kt (call foreground service parts)
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
- [ ] tools/device/call_peer.py
- [ ] tools/device/call_soak.py
- [ ] tools/device/handover.py
- [ ] tools/device/sfu_server.py

### round 1 cross-check
- [ ] audit/REVIEW.md (Done / Not doing / Still open for voice)
- [ ] audit/android-calls.md
- [ ] audit/crypto.md (voice parts)
- [ ] audit/web-bugs.md, audit/web-ui.md, audit/performance.md (voice parts)

## Handoff note
Second run (predecessor ticked nothing). Started from the top of the reading
order: transport.ts first. FINDINGS.md created with a header only.
