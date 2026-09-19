# Findings — voice (prefix `VOICE`)

Format per `audit/r2/README.md`. Appended as found; never rewritten.
Summary is written at the top when the audit is done.

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

