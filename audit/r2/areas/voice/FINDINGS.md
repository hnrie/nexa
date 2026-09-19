# Findings — voice (prefix `VOICE`)

Format per `audit/r2/README.md`. Appended as found; never rewritten.
Summary is written at the top when the audit is done.

## Summary

28 findings. By priority: P0 0 · P1 4 · P2 11 · P3 13. By kind: bug 9 · ux 6 ·
i18n 3 · security 3 · perf 2 · parity 2 · test 2 · design 1.

Read first:
1. **VOICE-024 · P1** — An incoming call on Android never rings or vibrates (`setSound(null, null)` and no ringtone anywhere). S.
2. **VOICE-011 · P1** — Android: 20–45 s of no network leaves the call "connected" and silent both ways (re-sync by tag instead of a rebuild). S.
3. **VOICE-015 · P1** — Desktop share picker: Enter on Cancel, or on another tile, shares the previously selected window. S.
4. **VOICE-001 · P1** — A dropped connection reads "Voice Connected" with a green dot while every tile says "Connecting…"; no reconnecting state on web or Android. M.
5. **VOICE-003 · P2** — Every key rotation cuts 0–4 s out of whoever is talking, for each listener (the 4 s key poll; no hook when a grant lands). M.
6. **VOICE-006 · P2** — TURN credentials are never refreshed, so after about an hour on a relay-only network no reconnect can succeed. M.
7. **VOICE-004 · P2** — A blocked microphone has no way back into the call short of hanging up (web and Android). S.
8. **VOICE-018 · P2** (with 019) — Android's "Push to talk" switch does nothing; the web on a phone silently falls back to voice activity. M.
9. **VOICE-017 · P2** — The hand-written AES-GCM and the frame format have no test in the repository; `check.sh` never compiles the C++. M.
10. **VOICE-020 · P2** — The admin page discards the call allowance the server already reports; the first sign of 90 % is video going off. S.

Then: VOICE-021 (the untested band: rekey between members, phone-browser network change, two devices, moderator actions mid-call; `call_quality.py` asserts nothing), VOICE-028 (voice engine in the entry bundle), VOICE-002 (lifetime-average quality dot), VOICE-012 (Android cannot enlarge a share or set a per-person volume), VOICE-005 (hard-coded English in the call UI).

Cross-area: VOICE-005 and VOICE-016 → i18n-copy; VOICE-027 → web-shell-ui (the voice settings page); VOICE-028's fix touches `gateway/dispatch.ts` and `AppShell.tsx` (web-core) but the split is voice's to make.

Round 1 cross-check: all nine `android-calls.md` CRASH fixes are present in the code (exception handler on the call scope, `load()` checked at join, `onRemoteTrack(null)` before dispose, `runCatching` + timeout around `getStats`, `awaitForeground` before the projection, body read on IO, `ConcurrentHashMap`s, `keyGuard`), and the `org.jni_zero` keep rule is in `proguard-rules.pro:22-25`. Verified fixed on the web: mic `onended`, `reset()` clearing repull/loss/playout state, `keysArrived` after a move, the guest page's joining timeout, `switchCamera` opening the new camera first, the blocked-mic state (retry still missing: VOICE-004), `voice_error` no longer hanging up silently, invite-guests reachable from the channel menu on phones. Still open from round 1 and re-reported: VOICE-022, 023, 025, 026, 027, 028. Not re-reported: the key-index collision (epoch 5/261 — both platforms mask identically, the newest epoch wins, and a live call only ever seals with the newest; harmless in practice), the T-table AES cache-timing note (theoretical; a hardware-AES path via ARMv8 intrinsics would be the fix if ever wanted), and the salt-refresh race (needs 2³² frames from one sender).

Settled without a finding: the C++ refcount model (libwebrtc's `scoped_refptr` adds its own reference; Kotlin releases only the one it was handed); key indices are `& 0xff` on both platforms; a guest cannot be moved (`ChannelPerms` yields no `Connect` for a non-member → `cannot_connect`); the registry keeps the SFU session across a mute toggle and `LeaveDetached`/`Resume` compare both ids (pinned by `registry_test.go`); `video_paused`/`calls_paused` reach the user as plain sentences on web and Android; `not_in_call` is enforced server-side (`sfu_call.py` hits the API directly).

### VOICE-001 · P1 · ux · During a network drop the call says "Voice Connected" with a green dot while every tile says "Connecting…"
- Where: `web/src/voice/sfu.ts:432-449` (peer states are the one PC's `connectionState`), `web/src/voice/sfu.ts:1048-1064` (`stats()` reads `currentRoundTripTime` off the nominated pair whatever its state), `web/src/components/voice/VoiceView.tsx:661` (only `failed` reads "Reconnecting"; `disconnected` reads "Connecting…"), `web/src/components/voice/VoiceView.tsx:721,752-755`, `web/src/components/voice/VoiceStatus.tsx:37,47`
- What: when the SFU connection goes `disconnected` (Wi-Fi to mobile, a lift, a tunnel) the transport waits 3 s, restarts ICE every 8 s, and rebuilds after 20 s — all silently. The only visible change is that every *other* person's tile shows the small "Connecting…" caption (the caption for a brand-new peer), because `onPeerState` fans the single PC state out to all peers. The status block still says "Voice Connected", the quality dot keeps its last colour (the nominated pair's last RTT is still reported while the pair is dead), and the lobby/controls give no hint that this device is the one that dropped. Nothing at all shows in an audio-only DM panel on a phone where tiles are avatars.
- Impact: the person whose phone changed network hears silence, sees "Voice Connected" and green, and has no way to tell "wait, it is coming back in 3–20 s" from "hang up and rejoin". The brief calls silence with no indication a P0; here there is a misleading indication, so P1. Every phone user hits this.
- Fix: surface the transport's own state: add `connection: "connected" | "reconnecting" | "connecting"` to the voice store (set from `onConnectionState`/`reset`), show "Reconnecting…" in `VoiceStatus` (replacing "Voice Connected", `data-level="bad"`) and as a stage note in `VoiceView`; make `stats()` return `rtt: 0`/`null` when the PC is not `connected` so the dot goes grey; use "Reconnecting" for `disconnected` as well as `failed` on tiles. Android: `CallScreen.kt` — check the same (see the Android findings).
- Effort: M
- Status: open

### VOICE-002 · P2 · bug · The connection-quality readout is a lifetime average, so it is stuck "bad" after an early blip and misses trouble late in a long call
- Where: `web/src/voice/sfu.ts:1057-1063`, `web/src/voice/mesh.ts:489-496`, `web/src/components/voice/VoiceView.tsx:721`, `web/src/components/voice/VoiceStatus.tsx:37`
- What: `stats()` sums `packetsLost` and `packetsReceived` over every inbound stream since the connection was made and returns `lost / (received + lost)`. The views colour the dot red at `loss > 0.05`. Both counters are cumulative for the PC's life (a rebuild resets them, an ICE restart does not).
- Impact: a 10 % loss patch in the first minute keeps the dot red for the next hour of a clean call; a call that has been clean for an hour shows green while the last 30 s lose a quarter of the packets (the same numbers the loss reporter in `checkLoss` correctly treats as deltas). The tooltip ("x ms · y % loss") is wrong in the same way.
- Fix: keep the previous sample per SSRC in `stats()` (as `checkLoss` already does in `lossSeen`) and report loss over the last interval (or reuse `lossSeen`'s last two checks). Same in `mesh.ts`.
- Effort: S
- Status: open

### VOICE-003 · P2 · bug · After every key rotation a listener drops up to 4 s of the first speaker who switched keys
- Where: `web/src/voice/sfu.ts:88,257,335-342` (`KEY_CHECK_MS` poll), `web/src/voice/session.ts:838-849` (`keysArrived` is only called after a moderator move), `web/src/stores/keys.ts:169-178` (`ingestGrants` does `ring.set` with no hook), `web/src/voice/frameCrypto.worker.ts:96-99,114-123` (a frame under an unknown index is dropped, never played)
- What: a rotation lands on every membership change (`web/src/lib/keyring.ts:9-11`). Each device learns the new epoch through its own `key_grant` and its own 4-second `refreshKeys` tick. The device that created the epoch (or whose tick fires first) starts sealing with the new index immediately; each listener's worker only gets that key at its own next tick. Until then `openFrame` returns null and the frames are dropped (`stats.dropped`), silently. The gap is uniform in 0–4 s per listener per rotation.
- Impact: in a group call someone joining or leaving the DM/server cuts 1–4 s out of whoever is talking, for everyone else. No indication; it reads as a bad connection. Guests are worse: their new keys come through `GUEST_RELAY_MS` (1 s) *plus* the relaying member's own 4 s tick.
- Fix: (a) call `transport.keysArrived()` from a keys-store subscription whenever `ring` gains an epoch for the call's conversation (`useKeys`/`ingestGrants` returns the changed conv ids — hook there); (b) sender-side grace: keep `send` on the previous epoch for ~KEY_CHECK_MS after a new one lands, so listeners that still poll have the key (the old key is retained by everyone). Android `VoiceSession.kt` — check for the same poll.
- Effort: M
- Status: open

### VOICE-004 · P2 · ux · A blocked microphone has no way back into the call short of hanging up
- Where: `web/src/voice/session.ts:377-388` (join carries on with `mic = null`), `web/src/voice/session.ts:1059-1062` (the `devicechange` retry requires `s.micRaw`, which is null when blocked), `web/src/voice/session.ts:1000-1010` (`refreshMic` only on a device/processing setting change), `web/src/components/voice/VoiceView.tsx:732-737,758`
- What: when `getUserMedia` is refused or the device is busy, the call joins listen-only, the stage shows the "microphone is blocked" note with only a "Hide this" button, and the mute button is labelled "Microphone blocked" but still just toggles `muted`. Nothing calls `getMic` again: granting the permission in the browser's site info, plugging in a headset, or closing the app that held the mic all leave the call listen-only until the person leaves and rejoins. The `devicechange` listener skips the case because `micRaw` is null.
- Impact: a normal person (first-time Safari/Chrome prompt dismissed by accident, or a mic held by another app) is stuck talking to nobody with no button to try again; they will hang up, rejoin and get the prompt again — or not.
- Fix: make the note's action "Try again" → `refreshMic()` (which already handles a live session) and clear `micBlocked` on success; make the mute button, when `micBlocked`, call `refreshMic()` instead of toggling; let the `devicechange` handler retry when `micRaw` is null and `micBlocked` is set. Also on `permissions.query({name:"microphone"})` `change` where supported.
- Effort: S
- Status: open

### VOICE-005 · P2 · i18n · [i18n-copy] Hard-coded English in the call UI
- Where: `web/src/components/voice/VoiceView.tsx:386` ("You"), `:495` ("Unfocus"/"Focus"), `:512` ("Unmute"/"Mute"), `:653` ("LIVE"), `:752` ("Measuring…"); `web/src/components/voice/VoiceStatus.tsx:47` ("Connecting…"), `:68` ("Camera"), `:71` ("Sharing"/"Share"); `web/src/components/voice/VoiceParticipants.tsx:33` ("You"), `:58` ("Unmute"/"Mute"); `web/src/components/voice/deviceMenus.ts:32,40,62` ("Microphone n"/"Speakers n"/"Camera n" fallbacks); `web/src/pages/GuestCallPage.tsx` and `VoicePage.tsx` to be checked by the i18n area
- What: these strings bypass `t()`; `tools/i18n_keys_used.py` cannot see them because it checks keys, not literals. The same words exist as keys elsewhere (`voice.voice.unmute`, `voice.voice.focus`, `voice.voice.connecting`).
- Impact: a non-English UI shows "Mute"/"Unmute"/"Focus"/"Connecting…" in English in the most-used call controls.
- Fix: replace with the existing keys; add `voice.voice.you`, `voice.voice.live`, `voice.voice.measuring`, `voice.voiceStatus.camera/share/sharing`, and device fallbacks.
- Effort: S
- Status: open

### VOICE-006 · P2 · bug · A relay credential can expire during a long call and every reconnect after that fails, because the transport never refreshes its ICE servers
- Where: `web/src/voice/sfu.ts:247-271` (`ice` is `readonly`, reused by every `newConnection()` in `reset()`/`rebuild()` and by `restartIce`), `web/src/voice/session.ts:112-113,231-243` (`ICE_CACHE_MS` 30 min, only consulted at join), `internal/api/voice_glue.go:471-474,503-510,526-538` (`turnTTL` 4 h, `turnReuse` 3 h: a credential is handed out again until it has only one hour left; a guest's TTL is the time left on their stay, down to one minute)
- What: TURN credentials are minted once per join. An ICE restart or a rebuild hours later (network change, the 20 s `TRACKS_GONE_MS` rebuild, a `sfu_session_gone`) builds the new RTCPeerConnection with the same `iceServers`. For anyone whose network needs the relay (UDP to the SFU blocked: many offices, some campus and hotel Wi-Fi, some mobile carriers) an expired credential means candidate gathering yields no relay candidate, the connection never reaches `connected`, and `recover()`/`retryLater(true)` loop forever with the same dead credential. The floor is 1 h from the fetch (a credential can be 2 h 59 m old when reused), and for a guest it is whatever their link had left.
- Impact: a call that has run for more than about an hour on a relay-only network cannot survive any network hiccup; the person sees "Connecting…" on every tile until they hang up and rejoin (which fetches a new credential only if the 30 min client cache has lapsed, and the server may still hand back the old one for up to 3 h). Guests on short links are cut off from reconnecting sooner still.
- Fix: give `SfuTransport` an `iceServers: () => Promise<RTCIceServer[]>` (session's `iceConfig()` with the cache bypassed when older than ~30 min) and call it in `reset()`/`recover()` before building the connection or restarting ICE (`pc.setConfiguration({iceServers})` works for restarts); on the server hand out a reused credential only while it has at least, say, 3 h left (`turnReuse` = 1 h of a 4 h TTL), and give guests the full TTL (the session, not the credential, bounds their stay). Android `SfuTransport.kt` — check the same.
- Effort: M
- Status: open

### VOICE-007 · P3 · bug · "Your call moved to another device" is never shown; the first device just drops out with the leave sound
- Where: `internal/api/voice_glue.go:315-320,329` (the leave for the displaced connection is sent first, with that connection's own `session_id`), `web/src/voice/session.ts:816-828,859-862`
- What: when a second device (or a second tab of the same session) joins the account's call, the server emits `voice_state{channel_id:null}` to the old connection and only then broadcasts the new state. On the old device the leave carries its own session id, so `elsewhere` is false and the generic "disconnected server-side" branch runs `leaveVoice(false)`; by the time the broadcast with the other device's session id arrives, `session` is null and the toast branch (line 825) is skipped. The toast, its i18n key and the test "does not take another device's call for this one's" cover the branch that cannot happen in practice.
- Impact: the person on the first device hears the leave sound and lands in the lobby with no explanation.
- Fix: either have the server tag the displacing leave (`reason: "moved"`), or in the client show the toast when a leave for `myId` arrives while `session` is set and `vs.old_channel_id === session.channelId` and no local hang-up is pending (a `leaving` flag set by `leaveVoice`).
- Effort: S
- Status: open

### VOICE-008 · P3 · bug · After a server restart the first person back into a DM call rings everyone else's other devices
- Where: `internal/api/voice_glue.go:262-263,312,338-362`
- What: `started` comes from `Voice.Join` (the channel was empty in the in-memory registry, which a restart empties). The `resumed` flag only suppresses the `system_call` message, not the `call_ring`. So on every deploy while a DM call is up, the first client to reconnect (`onReadyVoice` → `sendState(resume)`) rings the other recipients; their in-call device ignores it (`session.channelId` matches) but their phone/desktop rings until their own rejoin a moment later emits `call_end answered`.
- Impact: phones buzz for a second or two on every server restart during a call (deploys are frequent here). Android may show and then dismiss an incoming-call notification.
- Fix: do not ring when `req.Resume` (or when `resumed`); ringing belongs to a call that is genuinely new.
- Effort: S
- Status: open

### VOICE-009 · P3 · perf · A pull the SFU keeps refusing is retried every 1.6 s for the rest of the call
- Where: `web/src/voice/sfu.ts:98-102,312-333,862-864`
- What: `pullRetries` grows without bound and the delay is capped at `PULL_RETRY_MAX_MS` (1.6 s). A publisher whose PC never connects (or whose track was refused for good) makes every listener POST `/voice/sfu/subscribe` (one Cloudflare `AddTracks` call each) every 1.6 s until the per-user rate limit (`sfuCaller` → `limVoice`) answers 429, which then falls into the ordinary backoff (8 s max). Refused pulls are not metered (`Meter.Start` only on success), so the cost is API calls and log noise, not allowance.
- Impact: in a 10-person call with one stuck publisher, ~75 SFU API calls a minute from the listeners for as long as the call lasts.
- Fix: after N (say 8) refusals in a row for the same slot, grow the wait toward `RETRY_MAX_MS` and stop counting the slot as "expected"; reset on a fresh voice_state tag for that publisher.
- Effort: S
- Status: open

### VOICE-010 · P3 · security · The meter charges screen shares at the rate the sharing client declares
- Where: `internal/api/sfu_handlers.go:106-113,170-176,288`, `web/src/voice/sfu.ts:582`, `web/src/voice/shareQuality.ts:34-44`
- What: `bitrate` in `/voice/sfu/publish` is clamped to 1–12 Mbps (`ClampScreenBps`) and then used as the charge rate for every pull of that share. The client also sets the encoder cap itself. A modified client can declare 1 Mbps and send 12 (or, with the cap removed, whatever the link takes) and be charged a twelfth of what it uses. Cloudflare bills real bytes, so the free-allowance guard under-counts by up to 12x for that share.
- Impact: only the instance owner's allowance (and the "video paused at 90 %" guard) is affected, and only by a member who alters their client; not a privacy or data issue.
- Fix: charge screen pulls at a fixed conservative rate (the 12 Mbps ceiling, or the chosen tier's rate looked up server-side from a `quality` enum rather than a number), or reconcile against Cloudflare's usage API when it is available.
- Effort: S
- Status: open

### VOICE-011 · P1 · bug · Android: a call that was down for 20–45 s comes back "connected" and silent both ways, because the reconnect only re-syncs pulls by tag
- Where: `android/app/src/main/java/xyz/evilion/chat/voice/SfuTransport.kt:133-138,449-459` (`TRACKS_GONE_MS` → `VoiceSession.refreshTracks()`), `android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt:742-744,761-770`, `android/app/src/main/java/xyz/evilion/chat/voice/SfuTransport.kt:709-726` (`sync` drops/adds only where the wanted tag differs from what is already pulled); compare `web/src/voice/sfu.ts:436-444` (the web rebuilds the whole connection after `downFor >= TRACKS_GONE_MS`)
- What: both clients document that Cloudflare lets go of tracks after 30 s without media. When the Android connection comes back after being down that long, the code says "everything is pulled again" but what runs is `sync()`, which compares wanted tags with the `pulled` map — unchanged by the outage — and finds nothing to drop or add. Nothing is re-pulled and nothing is republished (this device's own tracks, which the SFU also dropped, keep their old names and tags, so nobody else re-pulls them either). The web client remakes the session (new tracks, new tags, everyone re-pulls). The only Android paths that remake the session are `voice_resumed kept:false` (the gateway was gone longer than the server's 45 s grace) and a fatal API error — neither happens when the outage was 20–45 s, or when only media was down while the socket stayed up (a captive portal, UDP blocked after a NAT rebinding, a lift).
- Impact: a phone that loses signal for half a minute comes back to a call screen saying "3 in the call · encrypted end to end" with no audio either way, and nothing ever fixes it short of hanging up. This is the class of bug fixed on 2026-09-18 for shorter changes. `tools/device/call_soak.py` cuts the network for 12 s and `handover.py` never removes it fully, so the band is untested.
- Fix: in `onConnectionState(CONNECTED)` when `downFor >= TRACKS_GONE_MS`, call `startRebuild()` (new session, `republishAfterRebuild`, fresh pulls) instead of `refreshTracks()`, as the web does. Test: add a 35 s full outage step to `call_soak.py` (wifi+data off, sleep 35, on, then `moving()` both ways).
- Effort: S
- Status: open

### VOICE-012 · P2 · parity · Android's call screen cannot enlarge a screen share or a camera, and has no per-person volume or local mute
- Where: `android/app/src/main/java/xyz/evilion/chat/ui/voice/CallScreen.kt:168-231,344-426` (a fixed 2- or 3-column grid of 1.2:1 tiles; a tile's only tap is watch/unwatch a share), `VoiceSession.kt:394-401` (`setVolume` exists, nothing calls it), `web/src/components/voice/VoiceView.tsx:136-237,486-522,580-698` (focus, pinch-zoom, full screen, PiP, per-user volume 0–200 %, local mute, stream volume/mute)
- What: on Android a watched screen share is drawn in a tile about a third of the screen wide and cannot be focused, zoomed or made full screen; a desktop share of text is unreadable (the web's own comment on `StreamSurface` says why it added pinch-zoom). There is no way to turn one loud person down or mute them locally, though the session already supports volume to 200 %.
- Impact: anyone who joins from the phone to look at what someone is sharing cannot read it; a loud participant cannot be tamed without deafening everyone.
- Fix: tap a tile with a picture → a focused layout (the tile fills the width at its own aspect, the rest as a strip), pinch to zoom on the focused one, a full-screen button that hides the chrome; long-press a person's tile → sheet with a volume slider (0–200 %, `VoiceSession.setVolume`), local mute (`AudioTrack.setEnabled(false)` per slot), and for a share a stream volume. Keep the web's semantics (volumes persisted per user).
- Effort: L
- Status: open

### VOICE-013 · P3 · security · Android does not tell libwebrtc to require frame encryption, so a receiver that ever lacks a decryptor would play sealed frames as noise
- Where: `android/app/src/main/java/xyz/evilion/chat/voice/SfuTransport.kt:343-359` (`RTCConfiguration` without `cryptoOptions`), `:413-439` (the decryptor is attached in `onTrack`)
- What: with `CryptoOptions.sframe.requireFrameEncryption` unset, libwebrtc passes a payload straight to the decoder when a receiver has no `FrameDecryptor`, and lets a sender without a `FrameEncryptor` send in the clear. Today the decryptor is installed inside `onTrack` (during `setRemoteDescription`, before the answer reaches the SFU) and the encryptor before the offer, so there is no known window — but the web client needed the whole `held`/bypass machinery for exactly this class of race in Chromium, and the Android code has none.
- Impact: none observed; a future refactor that moves `setFrameDecryptor` after the answer, or a mid recycled onto an entry that was dropped, would play loud noise, and a sender path without an encryptor would leak audio in the clear to the SFU.
- Fix: `cryptoOptions = CryptoOptions.builder().setRequireFrameEncryption(true).createCryptoOptions()` on the configuration; a frame without an encryptor/decryptor is then dropped rather than passed.
- Effort: S
- Status: open

### VOICE-014 · P3 · parity · Android leaves a DM call by itself when the other person hangs up; the web stays in it
- Where: `android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt:703-706` (`call_end` with no peers → `leave()`), `web/src/voice/session.ts:936-940` (only stops the tone and the ring)
- What: on `call_end` (the last other participant left a DM) Android hangs up; the web stays in the call so the other person can come straight back (a dropped connection, a phone that died). The web posts no "call ended" either, so the web user sits in an empty call until they notice.
- Impact: inconsistent; on Android a friend whose app crashed cannot rejoin without ringing you again, on the web you may sit alone.
- Fix: pick one. Suggest the web behaviour plus a visible "X left · waiting" state and an automatic hang-up after ~60 s alone on both platforms.
- Effort: S
- Status: open

#### Addenda to earlier findings (found while reading Android)
- VOICE-001: Android shows `callScreen.waitingForTheCall` while the connection is `DISCONNECTED` (`CallScreen.kt:180-187`, `VoiceSession.kt:248-255` sets neither `connected` nor `connecting`), the same wording as before the first connection; needs a "Reconnecting…" state too.
- VOICE-003: Android polls its keys every 4 s as well (`SfuTransport.kt:245-251`); `KeyService` has no hook to `refreshKeys` either.
- VOICE-004: Android shows the same "denied" sentence as the status line (`VoiceSession.kt:368-370`, `CallScreen.kt:127-133`) and never re-asks; the mute button keeps toggling a track that does not exist.
- VOICE-005: also `GuestCallPage.tsx:277` ("Join Again"), `:293` (the guest fine print), `VoicePage.tsx:209` ("Change"), `IncomingCallScreen.kt:62` ("is calling").
- VOICE-006: Android too — `SfuTransport.kt:113,345` keeps the ICE servers from `VoiceSession.joinNow` for every remake.
- VOICE-009: Android too — `SfuTransport.kt:804-812` retries at most every 1.6 s for ever (`pullRetries` capped at 6 only caps the wait).

### VOICE-015 · P1 · bug · Desktop share picker: Enter on "Cancel" (or on a different tile) shares the previously selected window
- Where: `desktop/src/picker/ui.ts:108-111` (a window-level `keydown` handler sends `picker.choose(chosen)` on Enter), `:83,104-107` (a tile's `click` is what moves `chosen`; the Share button's click is what should share), `desktop/src/main/displayPicker.ts:80-91,101-112` (the first answer wins; a cancel after a choose is ignored and the window is destroyed at once)
- What: `keydown` fires on the focused button and bubbles to `window` *before* the button's own activation click (Chromium dispatches a button's Enter click on keypress). With a tile already selected by mouse: Tab to **Cancel**, press Enter → the window handler sends `choose(chosen)`, main resolves the share with that source and destroys the picker; the Cancel click never counts. Tab to a *different* tile and press Enter → the old tile is shared (its click, which would have moved `chosen`, runs after the choose went out, if at all). Space is unaffected because the handler only looks at Enter.
- Impact: a keyboard user who selected a window, changed their mind and pressed Enter on Cancel starts sharing that window to everyone in the call; one who moved focus to another window shares the wrong one. Sharing a window the person did not choose is a privacy failure, so P1 although it needs the keyboard.
- Fix: remove the window-level Enter branch (buttons already activate on Enter); put a `keydown` handler on each tile that, on Enter, selects *that* source and chooses it; leave Cancel and Share as ordinary buttons. Escape stays as it is.
- Effort: S
- Status: open

### VOICE-016 · P3 · i18n · [i18n-copy] The desktop share picker is English-only and its selection is invisible to assistive technology
- Where: `desktop/src/picker/picker.html:2,12,114-115,119-121`, `desktop/src/picker/ui.ts:95-96,100`, `desktop/src/main/displayPicker.ts:62` (window title)
- What: "Choose what to share", "Everyone in the call will see the screen or window you pick…", "Share this computer's sound", "Screens", "Windows", "Cancel", "Share", "This computer is not letting Nexa see the screen." are literals with `lang="en"` fixed, while the page the picker serves is translated. A tile's selection is `data-selected` only: no `role="radio"`/`aria-checked` (or `aria-pressed`), no `role="radiogroup"`, no arrow-key movement, so a screen reader announces "button, <window name>" for every tile and never says which one is chosen.
- Impact: a person using the app in Arabic or German gets an English dialog in the middle of a translated call flow; a VoiceOver/NVDA user cannot tell what they are about to share (compounded by VOICE-015).
- Fix: have the page include its `t()` strings for the picker in the `getDisplayMedia` round trip (the main process has `app.getLocale()` but not the catalogue; a small `strings` object in the `ready` offer is enough), set `lang`/`dir` from it; `role="radiogroup"` per grid with a label, `role="radio"` + `aria-checked` on tiles, Left/Right/Up/Down to move.
- Effort: M
- Status: open

### VOICE-017 · P2 · test · The hand-written AES-GCM and the cross-platform frame format have no test in the repository, and `check.sh` never compiles the C++
- Where: `android/app/src/main/cpp/aes_gcm.cc` (289 lines of table-driven AES-256 and a 4-bit GHASH, no test beside it), `android/app/src/main/cpp/sealed_frame.cc`, `tools/check.sh:44-52` (the Android section greps for transceiver listing and, with `--android`, runs the Kotlin unit tests; nothing touches `cpp/`), `android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt:96` (only the `voiceFrameKey` derivation is pinned), `web/src/voice/frameCrypto.test.ts` (web-only)
- What: the memory note and `audit/crypto.md:11-13` say the C++ was checked against the NIST GCM vectors, 40 random cases against Go's `crypto/cipher`, and byte-for-byte against the web's `sealFrame`/`openFrame` — but none of that harness was kept. `grep -rl aes_gcm` finds only the sources. `CMakeLists.txt` builds one shared library for the app; there is no host target, no vector file, no fixture from the web client.
- Impact: any later edit to `aes_gcm.cc`, `sealed_frame.cc` (the clear-byte rule, the trailer layout) or to the web's `clearBytes`/`sealFrame` can silently break Android↔web calls in one direction — every frame dropped, the call "connected" and silent, which is exactly the class of failure this area's P0 rule is about — and nothing in `tools/check.sh` would notice; only a device test with a real phone would.
- Fix: a host test target (`cmake -S android/app/src/main/cpp -B $TMPDIR/cpp-test -DEVILION_TESTS=ON` building `aes_gcm.cc sealed_frame.cc` plus a small `frame_test.cc`) that (a) runs the six NIST GCM vectors including the 8- and 60-byte IV cases, (b) opens fixtures emitted by `frameCrypto.test.ts` (write `tools/out/frame-fixtures.json` from the web test: key, iv, index, kind, plaintext, sealed) and seals the same inputs to compare byte-for-byte; wire it into `tools/check.sh` behind the host `c++` (clang on this Mac). Effort includes the fixture writer.
- Effort: M
- Status: open

### VOICE-018 · P2 · bug · Android's "Push to talk" switch does nothing: nothing reads the setting and the call screen has no button to hold
- Where: `android/app/src/main/java/xyz/evilion/chat/ui/settings/SettingsScreen.kt:417-418` (the only reader and writer of `voiceMode`; its subtitle is `settings.settingsScreen.holdTheButtonInACall`), `android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt:263,407` (the mic track is simply `setEnabled(!muted)`), `android/app/src/main/java/xyz/evilion/chat/ui/voice/CallScreen.kt` (no press-and-hold control)
- What: `grep -rn voiceMode android/` finds the settings toggle and nothing else. Turning it on changes a stored string and no behaviour: the microphone keeps transmitting whenever it is not muted, and the promised button never appears.
- Impact: a person who enables it in a noisy place believes they are silent until they hold something, and is live the whole time. The web honours the same account-level `mode: "ptt"` on desktop; on a phone browser it quietly falls back to voice activity (VOICE-019), so no platform actually gives a phone user push to talk.
- Fix: either remove the switch until it works, or implement it: when `voiceMode == "ptt"`, keep `micTrack.setEnabled(false)` and add a large hold-to-talk button to `CallScreen` (pointer down → enable + `speaking`, up/cancel → disable), with the same in the call notification's action row if feasible. Pair with VOICE-019 so the web's phone layout offers the same button.
- Effort: M
- Status: open

### VOICE-019 · P3 · ux · On a phone the web offers push to talk with a key capture that cannot complete, then silently uses voice activity instead
- Where: `web/src/components/settings/VoicePage.tsx:201-211` (the PTT radio and the "click the box, then press the key" capture are shown on every device), `web/src/voice/session.ts:246-260,269` (`noKeyToHold()` — `(hover: none) and (pointer: coarse)` — makes `mode === "ptt"` behave as voice activity)
- What: on an iPhone or Android browser the settings page shows "Push to talk" with a key capture; tapping it shows "Press a key" and waits for a keyboard that will not appear. If the person chose PTT on their desktop (it is an account setting), the phone shows PTT selected, shows the key, and transmits on voice activity with no note saying so.
- Impact: confusion on the settings page and a false belief about when the mic is open (the same failure as VOICE-018 from the other side).
- Fix: when `noKeyToHold()`, replace the key capture with a sentence ("On this device push to talk uses a button in the call") and add a hold-to-talk button to the phone control row (`VoiceView` narrow layout) that drives `session.pttHeld`; the gate already handles `pttHeld`.
- Effort: S
- Status: open

### VOICE-020 · P2 · ux · The admin page never shows the call allowance the server already reports, so the owner learns about the 90 % pause when video stops
- Where: `internal/api/admin_handlers.go:77` (`calls: {month, used_bytes, limit_bytes, video_paused, calls_paused}` in the admin stats), `web/src/components/settings/AdminPage.tsx` (no `used_bytes`/`limit_bytes`/`calls` anywhere in `web/src`), `internal/realtime/meter.go:229-258`
- What: round 1 left "Calls this month: X of Y GB" undone and it is still undone: the server computes and sends it, the page discards it. The only user-visible signals of the allowance are the "Video is paused until next month" toast at 90 % and "Calls are paused until next month" at 99 %.
- Impact: the instance owner cannot see usage climbing, cannot tell members in advance, and cannot judge whether `REALTIME_MONTHLY_GB` is set right; the first sign is everyone's camera going off.
- Fix: a "Calls" card on the admin page: "This month: 412 GB of 1,000 GB" with a bar, the 90 %/99 % marks, and the two paused flags as plain sentences; `used_bytes` already includes running pulls so it moves live.
- Effort: S
- Status: open

### VOICE-021 · P2 · test · The failure modes that have bitten calls twice have no automated check: rekey mid-call between members, a network change on a phone browser, two devices, a moderator acting mid-call, and any assertion at all in `call_quality.py`
- Where: `web/src/voice/session.test.ts` (four event flows: another device's state, refused signals, ringing), `tools/sfu_call.py` (29 checks: join, hear, not_in_call, relay-only, camera on/off/on, share pulled while watched, leave), `tools/sfu_guest.py` (guest join, key rotation relayed to a guest, removal), `tools/call_quality.py:409-435` (25 impairment scenarios including 4/15/25/40 s UDP blackouts and a 20 s gateway stall — measured and printed, never asserted), `tools/device/call_soak.py:242-247` (a 12 s outage only), `internal/api/sfu_handlers_test.go`, `internal/api/voice_handlers_test.go`, `internal/voice/registry_test.go` (the server side is well covered)
- What: nothing checks that after a rotation two *members* still hear each other (VOICE-003 is exactly the gap), that a phone browser switching Wi-Fi→mobile comes back (Android cause 3; the web "only restarts on `disconnected`"), that a second device joining displaces the first cleanly (VOICE-007), that a kick, a server-mute or a move mid-call does what it should on the client, or that Android survives ≥20 s down (VOICE-011). `call_quality.py`'s blackout-25/40 scenarios do exercise the web's `TRACKS_GONE_MS` rebuild, but a regression would only change a number in a JSON file nobody diffs.
- Impact: the two regressions of the last week (Android silent after any network change; the moved-device toast that cannot fire) were both in this untested band.
- Fix: (a) in `sfu_call.py`, after the three are talking: rotate the server key (as `sfu_guest.py` does) and assert `hears()` both ways within 6 s, then have a fourth session of alice's account join and assert the first is in the lobby; (b) a `--assert` mode for `call_quality.py` with thresholds per scenario (`back_after_ms` under 5 s for blackout-15, under 30 s for blackout-40, `rebuilds ≥ 1` for blackout-40, `dropout_ms` bounds for the loss scenarios) so it can run in `tools/check.sh --calls`; (c) a 35 s full outage step in `call_soak.py`; (d) for the phone-browser network change, drive Chromium on the Android emulator (`chrome` package) through the same `svc wifi/data` toggles and `call_peer.py`, since Playwright cannot change interfaces; (e) `session.test.ts` cases for `voice_resumed kept:false`, `moveTo` + `keysArrived`, and the displaced-device leave.
- Effort: L
- Status: open

### VOICE-022 · P3 · security · Removing a guest, or revoking their link, does not rotate the call key they were handed (round-1 MEDIUM, still open)
- Where: `internal/api/guest_handlers.go` (no `SetKeyFlags`/`KeysMaybeNeeded` anywhere in the file; `endGuest`/`dropGuest` only end the stay), `internal/api/voice_glue.go:733-735` (a moderator disconnecting a guest → `endGuest(…, "removed")`), `web/src/lib/keyring.ts:9-11` (rotation happens on member changes; a guest is not a member)
- What: the link's fragment carries `voiceFrameKey(root, channelId)` for the current epoch, and rotated keys are relayed to guests while they are in the call. After removal the guest keeps the epoch key they last had; nothing bumps the epoch, so members keep sealing with it until the next member join/leave.
- Impact: bounded — the SFU refuses the ex-guest's pulls (`not_in_call`, verified server-side by `sfu_call.py`) and the token is ended, so they need Cloudflare's cooperation or another valid link to get frames. Hygiene rather than a hole, but the product says "removed from the call" and the key says otherwise.
- Fix: on `endGuest`/link revoke while the channel has a live call, mark the conversation `key_rotation_needed` exactly as `server_handlers.go:200,445` do for member removals; members' clients already rotate on that flag.
- Effort: S
- Status: open

### VOICE-023 · P3 · design · Muted and deafened look the same as camera-on and sharing: one white pill for "off" and "on" (round-1 BAD, still open)
- Where: `web/src/components/voice/Voice.module.css:84-85` (`.ctl[data-off="true"], .ctl[data-on="true"] { background: #fff; color: #000 }`), `web/src/components/voice/VoiceView.tsx` control row
- What: mute (bad, off), deafen (bad, off), camera on (good, on) and screen share on (good, on) render as an identical white circle; only the glyph differs. Android's `CallScreen` uses the same neutral treatment.
- Impact: "am I muted" is the read people make fastest and under most stress; here it is carried by a small icon shape alone.
- Fix: `data-off` → a red-tinted pill (`--danger` at 18 % with a `--danger` glyph, plus the slash), `data-on` → white as now; the same two tokens on Android. Keep the `aria-pressed` states as they are.
- Effort: S
- Status: open

### VOICE-024 · P1 · bug · An incoming call on Android makes no sound and no vibration: the calls channel is created silent and nothing rings
- Where: `android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt:41-44` (`CHANNEL_CALLS` … `setSound(null, null)`, no `enableVibration`), `:104-135` (`ringing()` posts a `CATEGORY_CALL` notification with a full-screen intent and Answer/Decline — and nothing else), `android/app/src/main/java/xyz/evilion/chat/ui/voice/IncomingCallScreen.kt` (draws the screen, plays nothing); `grep -rn "Ringtone\|MediaPlayer\|SoundPool\|Vibrator" android/app/src/main/java` finds no hit. Compare `web/src/voice/session.ts` (loops `incoming-call.m4a` until answered, declined or timed out).
- What: on Android a DM call puts up the full-screen incoming-call UI on an unlocked phone and a silent heads-up notification on a locked one. Nothing rings, nothing vibrates; the phone in a pocket or face down on a desk never alerts. The channel's "no sound" was presumably meant to let the app play its own ringtone, which was never built.
- Impact: every call to an Android user who is not looking at the phone is missed. The Android app cannot be used to receive calls. (The 2026-09-18 device tests only ever had the phone *answer* from the screen.)
- Fix: give `CHANNEL_CALLS` the system ringtone with ringtone attributes — `setSound(RingtoneManager.getDefaultUri(TYPE_RINGTONE), AudioAttributes.Builder().setUsage(USAGE_NOTIFICATION_RINGTONE).setContentType(CONTENT_TYPE_SONIFICATION).build())`, `enableVibration(true)`, `setVibrationPattern` — so silent mode, DND and the ring volume are honoured by the system (a channel's settings are fixed after creation: use a new channel id, e.g. `calls_v2`, and delete the old one). For the in-app screen, loop a `Ringtone` with `USAGE_NOTIFICATION_RINGTONE` (`ringtone.isLooping = true` on API 28+) and stop it on answer/decline/`call_end`/timeout; on the web side nothing changes. Add "$name is calling" (`Notifications.kt:124`) to the VOICE-005 list.
- Effort: S
- Status: open

### VOICE-025 · P3 · ux · Light-theme surfaces leak into the black call stage: portalled menus and tooltips, and the guest page's top bar (round-1 BAD, still open)
- Where: `web/src/styles/tokens.css:171` (`[data-theme="light"] [data-dark-scope]` redefines the palette inside the scope), `web/src/components/voice/VoiceView.tsx:702,723` (the scope), `web/src/hooks/usePortalRoot.ts:5-8` (floating layers mount on `document.body` or the fullscreen element, never inside the scope), `web/src/pages/GuestCallPage.module.css:16-17` (`.call { background: #000 }` while `.bar` uses `--bg-raised`/`--text`), `web/src/pages/GuestCallPage.tsx` (no `data-dark-scope`, no theme override)
- What: in the light theme the device menu, a tile's context menu, the Share Screen and Guest Link dialogs and every control tooltip render light on the black stage; in fullscreen the same menu is dark because `portalRoot()` then returns the (scoped) fullscreen element. A guest on a light-mode OS gets a bright grey bar above a black call.
- Impact: inconsistent and glaring; not blocking.
- Fix: floating layers copy the scope: when opened from inside `[data-dark-scope]` (`trigger.closest(...)`), set `data-dark-scope=""` on the layer's root (Menu, Tooltip, Modal, Toast); put `data-dark-scope=""` on the guest page's `.call` wrapper.
- Effort: S
- Status: open

### VOICE-026 · P3 · ux · On a phone the call's resize handle still hangs 14 px over the first message under the call and eats taps there (round-1 BROKEN, half-fixed)
- Where: `web/src/components/voice/Voice.module.css:9` (`.resizer { bottom: -7px; height: 14px; z-index: 6; touch-action: none }`), `:111` (`@media (pointer: coarse) { .resizer { height: 28px; bottom: -14px } }`), `web/src/components/voice/VoiceView.tsx:782` (rendered whenever the call is embedded and not full screen)
- What: round 1 measured a 28 px invisible strip; it is still 28 px on touch, half inside the call and half over the message list. A tap or a scroll starting in the top 14 px of the first message row does nothing.
- Impact: a small but recurring dead zone right where the first unread message sits under an embedded call on a phone.
- Fix: on `(pointer: coarse)` keep the band inside the call (`bottom: 0; height: 28px`) or drop the drag resize on phones altogether (the panel has fixed heights there anyway).
- Effort: S
- Status: open

### VOICE-027 · P3 · i18n · [web-shell-ui] RTL: the sensitivity marker on the voice settings meter is positioned with a physical `left` (round-1 BROKEN, still open)
- Where: `web/src/components/settings/VoicePage.tsx:177` (`style={{ left: \`${Math.round(threshold * 100)}%\` }}`), `web/src/components/voice/Voice.module.css:203-204` (`.meterFill` grows from inline-start; `.meterMark` is absolutely positioned)
- What: in Arabic the fill grows from the right while the marker is measured from the left, so the threshold line sits at the mirrored position and crosses the fill at the wrong point.
- Impact: the input-sensitivity control is unreadable in RTL.
- Fix: `insetInlineStart` instead of `left`.
- Effort: S
- Status: open

### VOICE-028 · P2 · perf · The whole voice engine ships in the entry bundle, to the sign-in page and to every visitor (round-1 "still open" item, unchanged)
- Where: `web/src/gateway/dispatch.ts:11`, `web/src/gateway/session.ts:15`, `web/src/components/shell/AppShell.tsx:18`, `web/src/components/chat/ChatView.tsx:30`, `web/src/components/sidebar/ServerSidebar.tsx:10`, `web/src/pages/FriendsPage.tsx:12`, `web/src/components/sidebar/dmMenu.ts:14` (all static `import … from "@/voice/session"`), `web/vite.config.ts:128-132` (manual chunks only for react and crypto); scratch build `$TMPDIR/dist-check/assets/main-*.js` is one 825 KB chunk with no voice chunk beside it
- What: `session.ts` statically pulls `sfu.ts`, `mesh.ts`, `media.ts`, `playback.ts`, `e2ee.ts`, `redundancy.ts`, `copyPlanner.ts`, `playoutDelay.ts`, `speaking.ts`, `shareQuality.ts`, `guestKeys.ts` — about 189 KB of source under `web/src/voice/` plus 75 KB of call components and helpers — and `session.ts` is imported by the gateway dispatcher and the shell, so all of it is in `main` for everyone, including the sign-in page and a visitor who never joins a call.
- Impact: every first load on a phone parses the call engine before the message list can draw; `audit/REVIEW.md:244-250` lists this among the three structural performance items and it has not moved.
- Fix: make `session.ts` a thin facade (`joinVoice`, `leaveVoice`, `handleVoiceEvent`, `onReadyVoice`, `installVoice`, `inVoice`, the ring handling) that keeps only store logic and `await import("./engine")`s the transport, media and crypto modules on the first `joinVoice` or incoming ring; `handleVoiceEvent` for a `voice_state` while not in a call touches only `useVoice`. `GuestCallPage` may import the engine directly. Verify with `npx vite build --outDir "$TMPDIR/dist-voice" --emptyOutDir` that `main` shrinks by well over 100 KB and a `voice-*.js` chunk appears.
- Effort: M
- Status: open

#### Addendum to VOICE-005
- `android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt:124` (`"$name is calling"` in the incoming-call notification).

#### Addendum to VOICE-008
- `internal/api/voice_handlers_test.go:376-380` pins "a resumed call still rings" for the case where alice *left* (the call ended) and rejoins with `resume: true`; the fix must not break that. Distinguish by `sfu_session`: a resume that carries an SFU session (the client believes it is mid-call; the registry is empty only because chatd restarted) must not ring, a resume without one is a fresh call and may. Alternatively suppress the ring when a `call_end` for the channel was *not* sent since the last `started`.

