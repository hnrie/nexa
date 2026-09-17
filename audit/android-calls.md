# Android calls

## Summary

The call path is the least defended code in the app. Everything a call does
runs on one process-wide scope, `VoiceSession.scope` at
`voice/VoiceSession.kt:78`, built as `CoroutineScope(SupervisorJob() +
Dispatchers.Default)` **with no `CoroutineExceptionHandler`**. A `SupervisorJob`
stops a failing child from cancelling its siblings; it does not swallow the
exception. Anything that throws inside one of the ~12 `scope.launch { }` blocks
in `VoiceSession` goes straight to `Thread.getDefaultUncaughtExceptionHandler`,
which `CrashReport` chains to the platform handler, which kills the process. Six
of those launches call the network or WebRTC without a `try`. That single
omission turns every other bug below into a crash rather than a bad minute.

On top of that sits a WebRTC lifecycle problem. `SfuTransport.rebuild()`
(`voice/SfuTransport.kt:329`) calls `pc?.dispose()`, which disposes every
`RtpReceiver` and with it every remote `MediaStreamTrack`, but it never tells
`VoiceSession` to let go of them. `VoiceSession.remoteAudio` and
`CallState.peers[].video/.screen` keep the now-dead Java wrappers, and the next
`setDeafened`, the next 400 ms stats tick and the next composition of
`CallScreen` all call methods on them — `IllegalStateException:
MediaStreamTrack has been disposed`, thrown on the main thread, on WebRTC's
signalling thread, and inside Compose. `rebuild()` is what runs when the
connection goes `FAILED`, i.e. on the ordinary Wi-Fi-to-mobile handover that a
phone call exists to survive.

Three plain data races make it worse: `remoteAudio`, `watchingVideo`, `pulled`
and `byMid` are all bare `mutableMapOf`/`mutableSetOf`, written from WebRTC's
signalling thread and read from `Dispatchers.Default` and from the main thread
at the same time.

Compared with `web/src/voice/`, which is the same protocol and works, the phone
is missing the recovery machinery entirely — no ICE restart, no `sfuRestart`
call (the endpoint exists, unused, at `net/Endpoints.kt:352`), no retry of a
pull the SFU could not serve yet, no rollback of a failed offer, no handling of
`sfu_session_gone` — and it gets two protocol details backwards: it gates
**video** on "is anyone watching" (the web gates **screen**), and it compares
the tag the SFU returned against the tag the roster has, which the web
explicitly guards against because the server's is often newer.

Counts: 51 findings — 9 CRASH, 18 BROKEN, 16 BAD, 8 POLISH.

Single best guess at the reported crash: **an exception escaping
`VoiceSession.scope`, most likely `IllegalStateException: MediaStreamTrack has
been disposed` after `SfuTransport.rebuild()` re-made the peer connection**
(CRASH-1 plus CRASH-3 below). The runner-up, which would crash 100 % of calls
rather than some of them, is CRASH-2: the native frame-crypto library failing to
load is swallowed at startup and surfaces as an `UnsatisfiedLinkError`, an
`Error` that the only `catch` on the join path does not catch.

---

## Findings

### [CRASH] Nothing on the call scope has an exception handler; six launches can throw

- **Where**: `android/app/src/main/java/xyz/evilion/chat/voice/VoiceSession.kt:78`
- **What**: `private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)`.
  No `CoroutineExceptionHandler`. `SupervisorJob` isolates *cancellation*, not
  failure: a child that throws with no handler in its context reaches
  `handleCoroutineException` → `Thread.currentThread().uncaughtExceptionHandler`
  → process death. The launches that can throw and are not wrapped:
  - `toggleCamera()` (`:263`) → `VoiceEngine.startCapture` (camera open can
    throw) and `sfu.setLocalTrack` → `publishPending()` → `VoiceApi.sfuPublish`
    (`ApiException`) or `IllegalStateException("no answer to the offer")` at
    `SfuTransport.kt:252`.
  - `startScreenShare()` (`:293`) → `ScreenCapturerAndroid.startCapture`
    (`SecurityException`, see CRASH-5) and the same publish path.
  - `republishAfterRebuild()` (`:435`) → three `setLocalTrack` calls, each a
    full offer/answer against chatd.
  - `setWatching()` (`:102`) and `refreshTracks()` (`:430`) → `syncTracks()`
    (this one is `runCatching`-wrapped, so it is safe).
  - `joinNow()` (`:108`) → `VoiceEngine.createAudioTrack` at `:154` and
    `VoiceEngine.enterCallAudio` at `:167` are both outside the `try`.
  - `startStats()` (`:484`) → see CRASH-4.
- **How it fails**: put the phone on a flaky link, tap the camera button; the
  `sfuPublish` POST fails with `ApiException(0, "network", …)`; the coroutine has
  no handler; the app disappears with no dialog. The user reads this as "the
  call crashed the client".
- **Fix**: give the scope a `CoroutineExceptionHandler` that logs, sets
  `_state.error` and tears the call down, and wrap each public entry point's
  body in `runCatching`. The web equivalent (`web/src/voice/sfu.ts`) routes
  everything through an `enqueue()` that catches, classifies and retries.

### [CRASH] `catch (e: Exception)` on the join path does not catch `UnsatisfiedLinkError`, and the library load failure is silently ignored

- **Where**: `voice/VoiceSession.kt:159-165`, `voice/FrameCryptoNative.kt:15-23`, `App.kt:41`
- **What**: `FrameCryptoNative.load()` wraps `System.loadLibrary("evilion_frame_crypto")`
  in `runCatching { … }.onFailure { loaded = false }` and returns a `Boolean`
  that `App.onCreate` discards. Nothing anywhere checks `loaded` before calling
  the eight `external fun`s. The first one reached in a call is
  `FrameCryptoNative.nativeCreateKeys()` at `SfuTransport.kt:100`, inside
  `sfu.start()`, which `VoiceSession` guards with `catch (e: Exception)`.
- **How it fails**: if the `.so` is missing for the device's ABI — the build
  does per-ABI splits (`build.gradle.kts:94-101`), so a wrong-split install, a
  stripped APK or a failed `externalNativeBuild` all produce this —
  `nativeCreateKeys()` throws `java.lang.UnsatisfiedLinkError`. That is an
  `Error`, not an `Exception`, so `catch (e: Exception)` at `:161` does not
  catch it; it leaves `joinNow`, leaves `scope.launch`, and kills the process.
  Every single call attempt crashes immediately, with no error shown first.
- **Fix**: check `FrameCryptoNative.load()` at join time and `fail()` with "this
  build cannot encrypt calls" instead; and widen the catch to `Throwable`.

### [CRASH] `rebuild()` disposes the peer connection but leaves disposed remote tracks in the UI state

- **Where**: `voice/SfuTransport.kt:329-344` (`pc?.dispose()` at `:339`), consumers at `voice/VoiceSession.kt:245`, `:255`, `:461`, `:505`, and `ui/voice/CallScreen.kt:183`, `:334`
- **What**: `rebuild()` clears its own `pulled`/`byMid`/`senders` maps and
  disposes the `PeerConnection`. `PeerConnection.dispose()` iterates its
  `RtpReceiver`s and calls `receiver.dispose()`, which calls
  `cachedTrack.dispose()`, which zeroes `nativeTrack` on the Java
  `MediaStreamTrack`. But `rebuild()` never calls `onRemoteTrack(user, kind,
  null)`, so `VoiceSession.remoteAudio` still holds those `AudioTrack` objects
  and `CallState.peers[…].video / .screen` still hold those `VideoTrack`
  objects.
- **How it fails**: the connection goes `FAILED` (a Wi-Fi → mobile handover),
  `onConnectionChange` (`SfuTransport.kt:162`) launches `rebuild()`. Then any of:
  - the user taps deafen → `setDeafened` at `VoiceSession.kt:245` does
    `track.setEnabled(!on)` on a disposed track →
    `IllegalStateException: MediaStreamTrack has been disposed.` **on the main
    thread, inside a Compose click handler** → crash;
  - the 400 ms stats tick at `VoiceSession.kt:505` calls
    `remoteAudio[userId]?.id()` → same exception **on WebRTC's network thread**,
    where nothing catches it → crash;
  - `CallScreen` recomposes and `VideoView` at `CallScreen.kt:334` calls
    `track.addSink(this)` on a disposed `VideoTrack` → same exception **during
    composition** → crash.
- **Fix**: before `pc?.dispose()`, walk `pulled` and emit
  `onRemoteTrack(p.userId, p.kind, null)` for each, exactly as the drop branch
  of `sync()` already does at `SfuTransport.kt:282`. The same is needed in
  `close()` for symmetry (there `leaveNow` happens to clear the state after, so
  it is only a race).

### [CRASH] The stats loop calls `getStats` on a `PeerConnection` that `close()` may have just disposed

- **Where**: `voice/VoiceSession.kt:487-488`, against `voice/SfuTransport.kt:357` and `voice/VoiceSession.kt:186-194`
- **What**:
  ```kotlin
  val connection = transport?.connection() ?: continue
  connection.getStats { report -> … }
  ```
  There is no suspension point between reading `connection` and calling
  `getStats`, so job cancellation cannot interrupt it. `leaveNow()` cancels
  `statsJob` *before* `transport?.close()` — a race of one mutex acquisition —
  but `leaveQuietly()` at `:186-193` cancels it **after** `transport?.close()`
  and `releaseLocalMedia()`, which is a window of milliseconds.
- **How it fails**: sign out or get signed out during a call (`Session.kt:356`
  calls `leaveQuietly()`); `close()` runs `pc.dispose()`; the stats coroutine,
  already past `delay(400)`, calls `getStats` on the disposed connection.
  libwebrtc's `PeerConnection.getStats` runs `checkPeerConnectionExists()` →
  `IllegalStateException: PeerConnection has been disposed.`, uncaught on the
  call scope → crash. (In some libwebrtc revisions `dispose()` frees the native
  object without zeroing the handle, in which case this is a native
  use-after-free / `SIGSEGV` instead. I could not confirm which, since the AAR
  is not in the local Gradle cache.)
- **Fix**: cancel and `join()` the stats job before closing the transport, and
  guard the body with `runCatching`.

### [CRASH] Screen share uses `MediaProjection` before the media-projection foreground service is up

- **Where**: `ui/voice/CallScreen.kt:91-97`, `voice/VoiceSession.kt:292-308`, `service/Services.kt:109-118`
- **What**:
  ```kotlin
  if (result.resultCode == Activity.RESULT_OK && data != null) {
      CallService.start(context, channelId, sharing = true)   // startForegroundService — async
      VoiceSession.startScreenShare(data)                     // uses the projection immediately
  }
  ```
  `Context.startForegroundService` only *schedules* the service; `onStartCommand`
  and its `startForeground(…, FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)` run on
  the next main-looper turn at the earliest. `VoiceSession.startScreenShare`
  immediately launches on `Dispatchers.Default` and calls
  `VoiceEngine.startCapture` → `ScreenCapturerAndroid.startCapture`, which does
  `mediaProjectionManager.getMediaProjection(...)` and `createVirtualDisplay()`.
- **How it fails**: on Android 14+ (this app targets 37) starting a projection
  without a running FGS of type `mediaProjection` throws
  `java.lang.SecurityException: Media projections require a foreground service
  of type ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`. It is thrown on
  the coroutine's thread, on the call scope, with no handler → crash the moment
  you confirm the "Start recording or casting?" dialog.
- **Fix**: make the service start deterministic before the projection is
  touched — bind to `CallService`, or start the capture from inside
  `CallService.onStartCommand` after `startForeground` returned, or await a
  `CompletableDeferred` the service completes. Also wrap the capture start in a
  `try` and surface the failure as `_state.error`.

### [CRASH] "Stop sharing" runs the HTTP request on the main thread, uncaught

- **Where**: `ui/voice/CallScreen.kt:80` and `:272`, `voice/VoiceSession.kt:310-321`, `net/ApiClient.kt:125`
- **What**: `val scope = rememberCoroutineScope()` is `AndroidUiDispatcher.Main`.
  `scope.launch { VoiceSession.stopScreenShare() }` runs `removeLocalTrack` →
  `VoiceApi.sfuClose` → `Api.requestRaw`, and `requestRaw` is
  ```kotlin
  return http.await(request).use { res -> readOrThrow(res) }
  ```
  Only `await` is `withContext(Dispatchers.IO)`. `withContext` resumes the
  caller on the *caller's* dispatcher, so `readOrThrow` — and therefore
  `res.body.string()` — runs on the main thread.
- **How it fails**: on an HTTP/1.1 connection (a local chatd, a proxy, or an
  h2-less hop) the body read hits `BlockGuard` →
  `android.os.NetworkOnMainThreadException`, thrown inside a
  `rememberCoroutineScope` launch with no handler → crash. On HTTP/2 the frame
  is usually already buffered by OkHttp's reader thread, so it "works" but
  blocks the main thread until the body arrives — an ANR waiting for a slow
  network. This is an app-wide shape (`ProfileSheet.kt:83` and
  `IncomingCallScreen.kt:68` have it too, but they are inside `runCatching`, so
  they fail silently rather than crash).
- **Fix**: make `Api.requestRaw` read the body inside the IO context —
  `withContext(Dispatchers.IO) { http.await(request).use { readOrThrow(it) } }`
  — and run call controls on `VoiceSession.scope`, not the composition scope.

### [CRASH] `setDeafened` iterates a plain `HashMap` that WebRTC's signalling thread writes

- **Where**: `voice/VoiceSession.kt:93` (`private val remoteAudio = mutableMapOf<String, AudioTrack>()`), written at `:456-458` and `:203`, read at `:245`, `:255`, `:505`
- **What**: `onRemoteTrack` is called from `SfuTransport`'s
  `PeerConnection.Observer.onTrack` (`SfuTransport.kt:181`), i.e. on WebRTC's
  signalling thread, and from `sync()` at `:282` on `Dispatchers.Default`.
  `setDeafened` reads it on the main thread:
  ```kotlin
  for (track in remoteAudio.values) track.setEnabled(!on)
  ```
- **How it fails**: someone joins or leaves the call (which fires `onTrack` /
  `sync`'s drop branch) while you tap the deafen button →
  `java.util.ConcurrentModificationException` on the main thread → crash. The
  milder outcome of the same race is a corrupted `LinkedHashMap` (an entry lost,
  or an infinite loop on lookup).
- **Fix**: `ConcurrentHashMap`, or confine every mutation to a single
  single-threaded dispatcher.

### [CRASH] `pulled` and `byMid` are read and written from two threads at once

- **Where**: `voice/SfuTransport.kt:91-92`, written under `lock` in `sync()` (`:276-317`), `rebuild()` (`:335-336`) and `close()` (`:353-354`), read and written **without the lock** in `onTrack` (`:174-180`)
- **What**: `onTrack` runs on WebRTC's signalling thread and does
  `byMid[mid]`, `entry.decryptor = …`, `entry.track = …`. `sync()` runs on a
  coroutine and does `pulled.remove(…)`, `byMid.remove(…)`, `byMid[mid] = entry`
  while holding a `kotlinx` `Mutex` that `onTrack` cannot take (it is not a
  suspend context).
- **How it fails**: a peer republishing while a renegotiation is in flight puts a
  `HashMap` resize and a `HashMap` read on two threads → a lost entry (the track
  arrives with no decryptor and plays as noise, or plays nothing), or an
  infinite loop in `HashMap.get` pinning a WebRTC thread, or
  `ConcurrentModificationException` escaping the signalling thread → crash.
  It also leaks decryptors: if `sync()` reads `p.decryptor` (d1) and releases it
  while `onTrack` overwrites it with d2, d2 is never released.
- **Fix**: keep both maps in a `ConcurrentHashMap`, or post the `onTrack` body
  onto the transport's own coroutine and take the mutex there.

### [CRASH] The key-rotation timer and `cryptoStats()` can use `keysHandle` after it is freed

- **Where**: `voice/SfuTransport.kt:102-107` (timer), `:126-139` (`refreshKeys`), `:360-363` (`close`), `:368-369` (`cryptoStats`), `voice/VoiceSession.kt:512`
- **What**: `close()` does `FrameCryptoNative.nativeReleaseKeys(keysHandle)` then
  `keysHandle = 0`, under the transport lock. `refreshKeys()` (from the 4-second
  `keyTimer`) and `cryptoStats()` read `keysHandle` **outside** that lock.
  `keyTimer?.cancel()` cannot interrupt a coroutine that is already past
  `delay(4000)` and inside the non-suspending JNI call.
- **How it fails**: hang up at the wrong 4-second boundary; the timer has
  already loaded the non-zero handle as an argument, `close()` runs
  `delete reinterpret_cast<KeysHandle*>(ptr)` (`cpp/frame_crypto.cc:225`), and
  the timer's `nativeSetKeys` dereferences `handle->keys` on freed memory →
  `SIGSEGV`, or silent heap corruption. `cryptoStats()` at `VoiceSession.kt:512`
  runs inside the `getStats` callback on a WebRTC thread and has the same
  window.
- **Fix**: take the lock in `refreshKeys`/`cryptoStats`, or make the handle an
  atomically-swapped `AtomicLong` that the native side reference-counts
  (a `shared_ptr` handed out per call rather than a raw `delete`).

---

### [BROKEN] Peer cameras never appear: the watching gate is on the wrong track kind

- **Where**: `voice/SfuTransport.kt:271`, against `web/src/voice/sfu.ts:757-767`
- **What**: Android skips pulling a peer's camera unless someone is watching:
  ```kotlin
  if (kind == PubKind.VIDEO && !VoiceSession.watching(state.userId)) continue
  ```
  The web does the opposite, and says why:
  > everyone's voice and camera (a camera that is off sends nothing and costs
  > nothing, and turning it on shows without another exchange), and the shares
  > being watched
  ```ts
  add("audio");
  if (!paused) add("video");
  if (st.streaming && this.watching.has(userId)) { if (!paused) add("screen"); add("screen_audio"); }
  ```
- **How it fails**: someone turns their camera on; you see their avatar, not
  their face, forever — until you happen to tap their tile, which is the only
  place `setWatching(id, true)` is called (`ui/voice/CallScreen.kt:192`) and is
  not signposted as "show video". Meanwhile every peer's **screen share** is
  pulled whether or not you are looking at it, which is the expensive one (the
  server meters it, `internal/api/sfu_handlers.go:283`).
- **Fix**: swap the gate — always pull `AUDIO` and `VIDEO`, gate `SCREEN` and
  `SCREEN_AUDIO` on `watching` **and** `state.streaming`.

### [BROKEN] A tag the server updated ahead of the roster puts `sync()` into a pull/drop loop

- **Where**: `voice/SfuTransport.kt:276` and `:314`, against `web/src/voice/sfu.ts:503-506` and `:788`
- **What**: Android stores the tag the SFU returned and compares it with the tag
  the roster carries:
  ```kotlin
  val drop = pulled.filter { (key, p) -> want[key]?.first != p.tag }.values.toList()
  …
  val entry = Pulled(track.userId, kind, track.tag.orEmpty(), mid)
  ```
  The server fills that tag from its own live voice state
  (`internal/api/sfu_handlers.go:283`, `p.Tag = voice.TrackTag(x.name)`), which
  can be newer than the `voice_state` this client has. The web keeps both and
  compares against either:
  ```ts
  asked: string;  // "the tag of the published track it is, and the tag that was asked for (the server may have had a newer one)"
  if (!w || (w.tag !== p.tag && w.tag !== p.asked)) drop.push(p);
  ```
- **How it fails**: a peer republishes (camera toggle, reconnect). Their new tag
  reaches the server before it reaches you. Your next `sync()` sees
  `want.tag != p.tag`, drops the track (one offer + one `sfuClose` + one
  `setRemoteDescription`), re-subscribes, gets the same newer tag back, and on
  the next trigger drops it again. Audio cuts out on every cycle. Also fires
  permanently if chatd ever omits `tag` (it is `json:"tag,omitempty"`, so an
  empty tag is omitted): `track.tag.orEmpty()` becomes `""`, never equal to the
  roster's tag, so every sync drops and re-pulls everything.
- **Fix**: carry `asked` as the web does and accept either.

### [BROKEN] A pull the SFU could not serve yet is never retried, so a call can start silent

- **Where**: `voice/SfuTransport.kt:307-317`, against `web/src/voice/sfu.ts:824-826` and the `PULL_RETRY_BASE_MS` constant at `:93`
- **What**: for every entry with `track.error != null`, Android does `continue`
  and forgets it. The server returns `not_in_call`, `not_published`,
  `not_returned` or Cloudflare's `not_found_track_error`
  (`internal/api/sfu_handlers.go:236-242`, `:278-282`) — all of which mean "not
  yet", not "never". The web schedules a retry:
  > A pull the SFU could not serve yet waits this long first. Cloudflare refuses
  > a track whose publisher is still connecting (not_found_track_error), which
  > is what someone who joined a moment ago looks like.
- **How it fails**: two people tap Join within a second of each other. Your
  subscribe lands while their publish is still in flight; you get
  `not_published`; nothing ever re-runs `sync()` unless their `voice_state`
  changes again. You sit in a call hearing nothing, with the header cheerfully
  saying "2 in the call · encrypted end to end".
- **Fix**: on any per-track error other than `video_paused`, schedule another
  `sync()` after ~400 ms with backoff, capped.

### [BROKEN] A failed publish leaves the peer connection wedged in `have-local-offer`

- **Where**: `voice/SfuTransport.kt:236-256`, against `web/src/voice/sfu.ts:552-570`
- **What**: `publishPending()` does `createOffer` → `setLocal(offer)` →
  `sfuPublish` → `setRemote(answer)`. If `sfuPublish` throws, or the reply has
  no answer (`throw IllegalStateException("no answer to the offer")` at `:252`),
  the local description has already been applied and nothing rolls it back. The
  transceiver stays in `senders`, and `published` is not updated. The web rolls
  back explicitly:
  ```ts
  if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
  for (const kind of added) { this.senders[kind]?.stop(); delete this.senders[kind]; }
  ```
- **How it fails**: one failed publish and the connection is in
  `have-local-offer` forever. Every later `createOffer`/`setLocalDescription`
  from `sync()` or `removeLocalTrack` fails with `Failed to set local offer sdp:
  Called in wrong state: have-local-offer`, so no track can ever be pulled or
  dropped again. The call is frozen: no new participants are heard, the camera
  button does nothing, and hanging up is the only exit. (And on the way there it
  throws out of `toggleCamera`'s launch — see CRASH-1.)
- **Fix**: copy the web's rollback-and-unwind on the error path.

### [BROKEN] `openSession` marks the session live before the microphone is published, and cannot recover

- **Where**: `voice/VoiceSession.kt:373-401`, `voice/SfuTransport.kt:116-122`
- **What**:
  ```kotlin
  lock.withLock { if (sessionId != null || closed) return@withLock; sessionId = VoiceApi.sfuSession().sessionId }
  audio?.let { setLocalTrack(PubKind.AUDIO, it) }
  ```
  `sessionId` is set first. If the `setLocalTrack` that follows throws (see the
  previous finding), `VoiceSession.openSession`'s `catch` sets `_state.error`
  and then checks `transport?.hasSession() != true` before retrying — which is
  now `false`, because the session *was* created. So the retry is skipped.
- **How it fails**: you are in the call, the server and everyone else can see
  you in it, you hear everyone — and nobody hears you, permanently, with an
  error string under the channel name. Leaving and rejoining is the only cure.
- **Fix**: publish first or retry the publish separately; do not let
  `hasSession()` stand in for "the microphone is up".

### [BROKEN] `sfu_session_gone` is swallowed, so a dead SFU session is never rebuilt

- **Where**: `voice/VoiceSession.kt:444-450`
- **What**:
  ```kotlin
  runCatching { sfu.sync(states) }.onFailure { Log.w(TAG, "could not sync call tracks", it) }
  ```
  `SfuTransport.sync` goes out of its way to rethrow the two codes that mean
  "start again" (`:302-305`: `sfu_session_gone`, `not_in_voice`) — and the only
  caller throws them into a log line.
- **How it fails**: chatd restarts, or your session ages out
  (`internal/api/sfu_handlers.go:215` returns 409 `sfu_session_gone`). Every
  subsequent sync fails the same way, is logged, and the call stays up on screen
  with no audio and no error. The web treats this as fatal and re-makes the
  session.
- **Fix**: catch `ApiException` and, for those two codes, drive `rebuild()` (or
  a full `leave()` + `join()`).

### [BROKEN] `rebuild()` gives up permanently if the new session cannot be created

- **Where**: `voice/SfuTransport.kt:341`
- **What**: `sessionId = runCatching { VoiceApi.sfuSession().sessionId }.getOrNull()`.
  On failure `sessionId` is `null`, and every method that needs it
  (`publishPending`, `sync`, `removeLocalTrack`) starts with
  `?: return@withLock`. Nothing ever tries again — `rebuild()` only runs from
  `onConnectionChange(FAILED)`, and the fresh connection has no tracks, so it
  will sit in `NEW`/`CONNECTING` and may never reach `FAILED` again.
- **How it fails**: the network blip that caused the rebuild also fails the
  `POST /voice/sfu/session`. The call is now a permanently silent shell.
- **Fix**: retry with backoff, and fail the call visibly after N attempts.

### [BROKEN] No ICE restart at all, and `DISCONNECTED` is not handled

- **Where**: `voice/SfuTransport.kt:160-165`; the unused endpoint at `net/Endpoints.kt:352-353` and its models at `net/Models.kt:640-643`; against `web/src/voice/sfu.ts:402-476`
- **What**: the only recovery is `if (state == FAILED) rebuild()`. The web waits
  `RECOVER_AFTER_MS = 3_000` on `disconnected`, then does
  `pc.restartIce()` + `createOffer({ iceRestart: true })` + `voiceApi.sfuRestart`,
  up to `MAX_ICE_RESTARTS = 4`, and only re-makes the whole connection if the
  SFU has had time to drop the tracks (`TRACKS_GONE_MS = 20_000`). Android has
  `SfuRestartRequest`/`SfuRestartReply` and `VoiceApi.sfuRestart` defined and
  **never calls them**.
- **How it fails**: walk out of Wi-Fi range onto mobile data. WebRTC sits in
  `DISCONNECTED` for 15-30 s (nothing on screen changes, the call is just
  silent), then goes `FAILED`, then Android tears the whole connection down and
  re-publishes from scratch — several seconds more, a new SFU session, and every
  peer has to re-pull you. The web is back in about three seconds and keeps its
  session.
- **Fix**: implement the web's recover/restart ladder; the server side already
  exists.

### [BROKEN] A video tile goes permanently black the first time the track behind it changes

- **Where**: `ui/voice/CallScreen.kt:325-351`
- **What**:
  ```kotlin
  val renderer = remember(track) { mutableStateOfRenderer() }
  AndroidView(factory = { … track.addSink(this); renderer.value = this }, …)
  DisposableEffect(track) { onDispose { renderer.value?.let { … }; renderer.value = null } }
  ```
  `AndroidView`'s `factory` runs **once per node**, not once per key. When
  `track` changes, `remember(track)` makes a *new* `MutableState` holding
  `null`, the factory does not re-run, and the old `DisposableEffect` (which
  captured the old state and the old track) releases the `SurfaceViewRenderer`.
  There is no `update` block, so `mirror` is ignored on change too.
- **How it fails**: a peer's track is replaced — they toggle their camera, they
  start a screen share (the tile switches from `peer.video` to `peer.screen` at
  `:183`), or `sync()` re-pulls after any blip. The renderer is released while
  still in the view hierarchy, the new track is never sinked, and that person's
  tile is a black rectangle for the rest of the call. Coming back does not fix
  it; only closing and reopening the call screen does.
- **Fix**: key the whole thing on the track —
  `key(track) { AndroidView(factory = …, onRelease = …) }` — or move
  `addSink`/`removeSink` into an `update` block plus a `DisposableEffect` that
  reads the view from the `AndroidView`'s own `onRelease`.

### [BROKEN] Screen audio overwrites voice audio in `remoteAudio`

- **Where**: `voice/VoiceSession.kt:452-463`
- **What**:
  ```kotlin
  PubKind.AUDIO, PubKind.SCREEN_AUDIO -> { … remoteAudio[userId] = audio … }
  ```
  One slot per user for two different track kinds.
- **How it fails**: someone shares a screen with audio. Their `SCREEN_AUDIO`
  track replaces their voice track in the map. Deafen (`:245`) and the
  per-person volume slider (`:255`) now act on the screen audio and leave the
  voice untouched — so deafen does not silence people. Speaking detection
  (`:505`, `remoteAudio[userId]?.id()`) matches the wrong track id, so their
  green ring never lights. When they stop sharing, `remoteAudio.remove(userId)`
  removes the entry entirely and their **voice** becomes unadjustable.
- **Fix**: key by `slot(userId, kind)` as `SfuTransport` already does.

### [BROKEN] The call service never asks for the camera foreground-service type

- **Where**: `service/Services.kt:96-98`; the manifest declares it at `AndroidManifest.xml:89` and `:17`
- **What**:
  ```kotlin
  val type = (if (mic) FOREGROUND_SERVICE_TYPE_MICROPHONE else FOREGROUND_SERVICE_TYPE_DATA_SYNC) or
      (if (sharing) FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
  ```
  `FOREGROUND_SERVICE_TYPE_CAMERA` is declared in the manifest and in the
  permissions list and is never passed.
- **How it fails**: turn your camera on, then press Home or switch apps. On
  Android 11+ background camera access is cut unless a `camera`-typed foreground
  service is running; Camera2 delivers `onDisconnected` and the capturer stops.
  Everyone else sees your video freeze on the last frame and it does not come
  back when you return (the capturer is dead; nothing restarts it).
  `VoiceEngine.createCameraCapturer`'s `onCameraDisconnected` handler is
  `= Unit` (`VoiceEngine.kt:84`), so nothing even notices.
- **Fix**: add the camera bit whenever `_state.video` is true, and re-`start`
  the service when the camera is toggled; handle `onCameraDisconnected` by
  clearing `_state.video`.

### [BROKEN] Reopening the call screen while sharing kills the screen share

- **Where**: `ui/voice/CallScreen.kt:109` and `:121`, `service/Services.kt:97-99`
- **What**: `CallService.start(context, channelId, sharing = false)` is called
  from `CallScreen`'s `LaunchedEffect(channelId)` and from the microphone
  permission callback, with `sharing` hardcoded `false`. `onStartCommand` then
  calls `startForeground(2, notification, MICROPHONE)` — dropping
  `MEDIA_PROJECTION` from the running service's type set.
- **How it fails**: start sharing your screen, tap the chevron to go back to the
  chat, tap the call again. `CallScreen` re-enters composition, the
  `LaunchedEffect` fires, the service type changes, and Android stops the
  projection ("the foreground service type changed"). The share dies; you see
  your own `screen` button turn off a second later via
  `MediaProjection.Callback.onStop`. The same happens if Android restarts the
  service (`START_STICKY` at `:105` with a null intent → `sharing = false`).
- **Fix**: derive the type from `VoiceSession.state` inside the service rather
  than from the intent, or keep a sticky "sharing" flag on the service.

### [BROKEN] The "In a call" notification never goes away unless you press the hang-up button

- **Where**: `ui/voice/CallScreen.kt:281-285` is the only `CallService.stop` call site
- **What**: every other way a call ends — a moderator moves or disconnects you
  (`VoiceSession.kt:351`), `call_end` (`:412`), `guest_ended` (`:414`),
  `fail()` (`:174`), sign-out (`leaveQuietly`, `:186`) — leaves `CallService`
  running.
- **How it fails**: the other person hangs up; your screen closes; a permanent,
  non-dismissible "In a call" notification stays in the shade with the
  microphone/camera privacy indicator lit, and the service keeps the process
  alive. It only clears when the app is force-stopped.
- **Fix**: stop the service from `VoiceSession` itself whenever `channelId`
  becomes `null`, not from one button in one screen.

### [BROKEN] Signing out during a call leaves the phone in call audio mode

- **Where**: `voice/VoiceSession.kt:186-194`, compare `:205`
- **What**: `leaveNow()` calls `VoiceEngine.leaveCallAudio()`; `leaveQuietly()`
  does not.
- **How it fails**: sign out (or get a `session_expired`, `Session.kt:356`)
  while in a call. `AudioManager.mode` stays `MODE_IN_COMMUNICATION` and
  `isSpeakerphoneOn` stays as it was for the rest of the process's life. Music,
  videos and notification sounds route to the earpiece at call volume, and the
  volume keys keep controlling the in-call stream. The user's only fix is to
  force-stop the app.
- **Fix**: call `VoiceEngine.leaveCallAudio()` in `leaveQuietly()` and in
  `fail()`.

### [BROKEN] There is no way back into a call once the screen is closed

- **Where**: `ui/sheets/Layers.kt:20` (`onClose = { Nav.popTo(layer) }`), no equivalent of `web/src/components/voice/CallBanner.tsx`
- **What**: the chevron and the system back gesture pop the `Layer.Call` without
  leaving the call — deliberately, since the service keeps it alive. But nothing
  in the shell shows that a call is in progress.
- **How it fails**: close the call screen to check a message. The only route
  back is the notification shade (`MainActivity.kt:140-142` handles the
  `call_channel_id` extra). If notifications were denied — `Notifications.post`
  at `notify/Notifications.kt:142-147` silently returns without
  `POST_NOTIFICATIONS` — there is no route back at all, and the call runs
  invisibly.
- **Fix**: port the web's `CallBanner`: a persistent strip above the composer
  with the channel, a mute toggle and a hang-up.

### [BROKEN] Declining a call from the in-app screen can silently do nothing

- **Where**: `ui/voice/IncomingCallScreen.kt:48` and `:68`
- **What**: `scope.launch { runCatching { VoiceApi.decline(channelId) } }` where
  `scope` is `rememberCoroutineScope()` — the main dispatcher. Per the
  `readOrThrow`-on-caller's-thread problem above, this throws
  `NetworkOnMainThreadException` on any HTTP/1.1 connection, and `runCatching`
  swallows it.
- **How it fails**: the local UI dismisses, but the caller never sees "declined"
  and keeps ringing until their own timeout. The broadcast-receiver version of
  the same action (`notify/Notifications.kt:161`) uses `Session.scope` and is
  correct — so the notification's Decline works and the in-app one may not,
  which is a confusing pair of behaviours to debug.
- **Fix**: same as CRASH-6 — read the body on IO — and use `Session.scope`.

### [BROKEN] `joinNow` can return with the UI stuck on "Connecting" and no error

- **Where**: `voice/VoiceSession.kt:114` then `:134`
- **What**: `_state` is set to `connecting = true` at `:114`, then
  `val myId = AppState.me.value?.id ?: return` at `:134` returns without calling
  `fail()`.
- **How it fails**: join a call in the window between a gateway reconnect and
  `ready` landing (`AppState.me` is cleared by `AppState.reset`). The header
  reads "Connecting…" forever; no transport was created so nothing will ever
  change it; the hang-up button is the only exit. The same shape applies if
  `ice.sfu` handling ever falls through.
- **Fix**: `fail(t(…))` instead of a bare `return`.

### [BROKEN] Two `join()` calls in flight leak a transport and a live SFU session

- **Where**: `voice/VoiceSession.kt:107-113`
- **What**: `join()` is `scope.launch { joinNow(channelId) }` and `joinNow`'s
  only guard is `if (_state.value.channelId == channelId) return` — read
  outside any lock (`leaveNow` takes `lock`, `joinNow` does not).
- **How it fails**: the `LaunchedEffect` at `CallScreen.kt:120` and the
  permission callback at `:108` can both fire (rotation, or a permission dialog
  answered while the effect re-runs). Two `joinNow`s run concurrently on
  `Dispatchers.Default`; both build an `SfuTransport`, both create a microphone
  track; `transport` and `micSource`/`micTrack` keep the second. The first
  transport is never closed: its `keyTimer` runs forever, its peer connection
  stays up, and its SFU session keeps publishing your microphone to the call
  that you think you left. `leave()` closes only the second.
- **Fix**: take `lock` for the whole of `joinNow`, and make `join` idempotent.

---

### [BAD] The call never requests audio focus

- **Where**: `voice/VoiceEngine.kt:101-114`
- **What**: `enterCallAudio` sets `AudioManager.mode = MODE_IN_COMMUNICATION`
  and `isSpeakerphoneOn`, and nothing more. There is no
  `AudioManager.requestAudioFocus` / `AudioFocusRequest` with
  `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE`, and no `OnAudioFocusChangeListener`.
- **How it fails**: Spotify keeps playing over the call. An incoming cellular
  call does not duck or pause anything. A navigation prompt talks over the
  person you are listening to. And when the call ends nothing tells the other
  app to resume. Every other calling app on Android takes focus.
- **Fix**: request and abandon focus around `enterCallAudio`/`leaveCallAudio`,
  and pause/unmute on `AUDIOFOCUS_LOSS_TRANSIENT`.

### [BAD] Speakerphone uses the deprecated API and Bluetooth routing is never set up

- **Where**: `voice/VoiceEngine.kt:105-113`, `AndroidManifest.xml:14`
- **What**: `@Suppress("DEPRECATION") manager.isSpeakerphoneOn = speaker`. On
  API 31+ the supported route control is
  `AudioManager.setCommunicationDevice(AudioDeviceInfo)` /
  `clearCommunicationDevice()`; the old setter is ignored or overridden in
  several situations, notably when a Bluetooth headset is connected. There is no
  `AudioDeviceCallback`, no SCO handling, and the declared
  `BLUETOOTH_CONNECT` permission is never requested at runtime.
- **How it fails**: pair AirPods or a car kit, join a call — audio comes out of
  the phone's speaker, or the route flips unpredictably when the headset
  connects mid-call, and the Speaker button does nothing about it.
- **Fix**: use `setCommunicationDevice` on API 31+, enumerate
  `availableCommunicationDevices`, and offer earpiece / speaker / Bluetooth
  rather than a single boolean.

### [BAD] No local track is ever disposed; `SurfaceTextureHelper` leaks a thread per camera toggle

- **Where**: `voice/VoiceSession.kt:210-227` and `:266-272`, `voice/VoiceEngine.kt:92-99`
- **What**: `releaseLocalMedia()` disposes the capturers and the *sources* and
  then nulls the track fields:
  ```kotlin
  cameraSource?.dispose(); cameraTrack = null
  micTrack?.setEnabled(false); micTrack = null; micSource?.dispose()
  ```
  `VideoTrack.dispose()` / `AudioTrack.dispose()` are never called, so each call
  leaks a native track reference, and the source is disposed *before* the track
  that references it. Worse, `VoiceEngine.startCapture` creates a
  `SurfaceTextureHelper` at `:94` and nobody ever holds it or calls
  `helper.dispose()`; each helper owns a `HandlerThread` and an EGL surface.
- **How it fails**: toggle the camera twenty times in a long call and you have
  twenty live threads and twenty EGL surfaces. Across calls, the undisposed
  audio track can keep the `AudioRecord` alive, which is what leaves the
  Android 12+ microphone indicator dot lit after hanging up.
- **Fix**: dispose track then source, in that order; keep the
  `SurfaceTextureHelper` beside the capturer and dispose it in
  `releaseLocalMedia`.

### [BAD] `fail()` leaves the call half up

- **Where**: `voice/VoiceSession.kt:174-179`
- **What**: it closes the transport and releases media, but does not cancel
  `statsJob`, does not call `VoiceEngine.leaveCallAudio()`, does not stop
  `CallService`, and resets the whole `CallState` — dropping the user's mute and
  deafen choices, which `leaveNow` is careful to preserve at `:207`.
- **How it fails**: a failed join leaves a 2.5 Hz stats loop spinning for the
  life of the process (harmless but pointless, since `transport` is null), an
  "In a call" notification with no call, and — if `enterCallAudio` had already
  run — the earpiece routing of the previous finding.
- **Fix**: route `fail()` through the same teardown as `leaveNow`.

### [BAD] The decrypt path sniffs VP8, so any other video codec never decodes

- **Where**: `cpp/sealed_frame.cc:14-16` and `:39`, `voice/SfuTransport.kt:415-421`, against `web/src/voice/frameCrypto.worker.ts:94`
- **What**: how many header bytes stay in the clear is decided by
  `IsVp8KeyFrame(data, …)` — a VP8 bitstream sniff — on **both** seal and open.
  The web uses `frame.type === "key"` from `RTCEncodedVideoFrame`, which is
  codec-agnostic. Android only forces VP8 on its own **senders**
  (`preferVp8`, and only if VP8 is in the capability list, and wrapped in
  `runCatching` so a failure is silent); the receive side takes whatever the SFU
  offers.
- **How it fails**: if any publisher in the call sends H.264 (an iOS client, a
  device whose VP8 encoder was unavailable, or an SFU that re-offers H.264),
  the Android receiver mis-computes the clear-header length, every GCM tag check
  fails, `dropped` climbs and their video is a permanent black tile — while the
  readout at `CallScreen.kt:228-235` cheerfully reports the drops.
- **Fix**: take the key-frame flag from libwebrtc's frame metadata rather than
  from the bitstream, or negotiate VP8 on receive transceivers too and refuse
  anything else.

### [BAD] Camera and microphone revoked mid-call are not handled

- **Where**: `voice/VoiceEngine.kt:82-89` (all six `CameraEventsHandler` callbacks are `= Unit`), `voice/VoiceSession.kt:230-232`
- **What**: `onCameraError`, `onCameraDisconnected` and `onCameraFreezed` do
  nothing. `noteNoMicrophone()` only sets an error string and is only called
  once, from the initial permission callback (`CallScreen.kt:107`). Android 14+
  can revoke a permission and kill the process, or (for one-time grants) revoke
  it while the app is alive.
- **How it fails**: the user revokes the camera in Settings while the call is
  running. Camera2 disconnects, `_state.video` stays `true`, the button stays
  lit, the transceiver keeps sending nothing, and there is no message. Same for
  the microphone: `AudioRecord` fails to start and the app still publishes an
  audio track, so peers see you unmuted and hear silence.
- **Fix**: implement the handlers — clear `_state.video`, `removeLocalTrack`,
  set an error — and re-check `RECORD_AUDIO` on resume.

### [BAD] `CallState.crypto` is a `LongArray`, so the state flow emits every 400 ms whether or not anything changed

- **Where**: `voice/VoiceSession.kt:64` and `:512`
- **What**: `CallState` is a `data class` with `val crypto: LongArray`. Kotlin's
  generated `equals` compares arrays by reference, and
  `transport?.cryptoStats()` returns a **new** `LongArray` from JNI on every
  tick (`cpp/frame_crypto.cc:256`, `env->NewLongArray(3)`).
  `MutableStateFlow.update` therefore always sees a changed value.
- **How it fails**: `CallScreen` recomposes 2.5 times a second for the whole
  duration of every call — the grid, every tile, every button — plus a JNI
  array allocation per tick. On a mid-range phone this is measurable battery and
  jank next to the video renderers.
- **Fix**: make it a `data class CryptoStats(val sealed: Long, val opened: Long,
  val dropped: Long)`, or override `equals`/`hashCode`.

### [BAD] `onReady` throws away both of its arguments and never re-opens the media session

- **Where**: `voice/VoiceSession.kt:418-426`
- **What**:
  ```kotlin
  fun onReady(states: List<VoiceState>, sessionId: String) {
      val channelId = _state.value.channelId ?: return
      scope.launch { sendState(channelId); syncTracks() }
  }
  ```
  Neither parameter is used. The comment claims "the session is opened again
  from here", but nothing calls `openSession()`; it only happens if the server
  happens to echo a `voice_state` back, and `openSession` then short-circuits on
  `sfu.hasSession()`.
- **How it fails**: the gateway drops and reconnects during a call. The client
  re-announces itself and keeps using the *old* SFU session id, which the server
  may have already discarded — see the swallowed `sfu_session_gone` above.
- **Fix**: use `states` to prime the roster, and verify or re-create the SFU
  session on reconnect.

### [BAD] `refreshTracks()` is dead code

- **Where**: `voice/VoiceSession.kt:429-431`
- **What**: `fun refreshTracks()` has no callers anywhere in the app (`grep -rn
  refreshTracks android/app/src/main` finds only the declaration).
- **How it fails**: it is documented as "Someone else's media changed: pull what
  is new", which is exactly the hook the missing pull-retry needs. Its absence
  is part of why a call can start silent.
- **Fix**: call it from the places that should re-sync, or delete it.

### [BAD] JNI: three unchecked returns and an unvalidated array length

- **Where**: `cpp/frame_crypto.cc:209`, `:211`, `:256`
- **What**:
  - `jint* indices = env->GetIntArrayElements(j_indices, nullptr);` — the result
    is not null-checked before `indices[i]` at `:216`.
  - `env->GetObjectArrayElement(j_keys, i)` is indexed by `j_indices`'s length
    without checking `GetArrayLength(j_keys)`. If they ever differ, JNI raises a
    pending `ArrayIndexOutOfBoundsException` and the function keeps making JNI
    calls with an exception pending, which is undefined behaviour.
  - `jlongArray arr = env->NewLongArray(3);` is not null-checked before
    `SetLongArrayRegion`.
- **How it fails**: OOM or a future caller mismatch turns into a native crash
  rather than a Java exception. Today the two arrays are always built from the
  same list at `SfuTransport.kt:135-136`, so the second one is latent.
- **Fix**: null-check each, and take `min(len(indices), len(keys))`.

### [BAD] A zero-length plaintext is reported as a decryption failure

- **Where**: `cpp/frame_crypto.cc:164`, `cpp/sealed_frame.cc:42`
- **What**: `OpenFrame` returns `body - kTagLen`, and `Decrypt` treats
  `written == 0` as failure. A frame whose plaintext was empty (29 bytes on the
  wire: 16 tag + 12 iv + 1 index) authenticates correctly and still counts as a
  drop.
- **How it fails**: the field trial `WebRTC-Audio-Allow-Opus-Dtx/Enabled/` is
  switched on at `voice/VoiceEngine.kt:38`, so DTX comfort-noise frames are in
  play. Any that reach zero payload length inflate the `dropped` counter shown
  in the call readout and are discarded rather than passed through. Cosmetic
  today; it becomes real if the redundancy work from `web/src/voice/redundancy.ts`
  is ever ported.
- **Fix**: return a sentinel (`-1`) for "could not open" and let 0 mean an empty
  frame.

### [BAD] `release()` on the native crypto wrappers does not zero the pointer

- **Where**: `voice/VoiceEngine.kt:123-125` and `:134-136`
- **What**:
  ```kotlin
  private val pointer = FrameCryptoNative.nativeCreateEncryptor(keys)
  fun release() { if (pointer != 0L) FrameCryptoNative.nativeReleaseEncryptor(pointer) }
  ```
  `pointer` is a `val`; calling `release()` twice calls `Release()` twice on the
  C++ object. The reference the object is created with is the caller's
  (`refs_{1}` at `cpp/frame_crypto.cc:94`, plus one taken by
  `scoped_refptr` inside libwebrtc's JNI), so a second release underflows the
  count and frees an object the sender still holds.
- **How it fails**: no current path releases twice, so this is latent — but the
  decryptor case is one refactor away, since `sync()`'s drop loop and `close()`
  both walk `pulled` and there is a window (see CRASH-8) where both can see the
  same entry.
- **Fix**: make `pointer` a `var`, zero it in `release()`, and mark `release()`
  `@Synchronized`.

### [BAD] `START_STICKY` with a null intent posts an "In a call" notification with no call

- **Where**: `service/Services.kt:71-77` and `:105`
- **What**: `onStartCommand` returns `START_STICKY`, so Android restarts the
  service after a process kill with `intent == null`. The code handles that
  (`intent?.getStringExtra(...)`) by falling back to the generic name, and puts
  the notification up.
- **How it fails**: the app is killed for memory during a call; Android restarts
  `CallService`; `VoiceSession` is a fresh object with no call in it; the user
  sees a permanent "In a call · Call" notification that leads to an empty app.
- **Fix**: return `START_NOT_STICKY`, and `stopSelf()` when the intent is null.

### [BAD] `enterCallAudio(speaker = true)` ignores the user's saved choice

- **Where**: `voice/VoiceSession.kt:167`, against `:59` and `:249-252`
- **What**: `CallState.speaker` defaults to `true` and `joinNow` hardcodes
  `enterCallAudio(speaker = true)`. Unlike `muted`/`deafened`, which
  `leaveNow`/`joinNow` carry across calls, `speaker` is reset on every join.
- **How it fails**: someone who always holds the phone to their ear has to press
  Speaker off at the start of every single call.
- **Fix**: persist it in `SettingsStore` beside `echoCancellation`, or at least
  carry it the way mute is carried.

### [BAD] `removeLocalTrack` and `sync`'s drop branch accept a missing answer

- **Where**: `voice/SfuTransport.kt:230` and `:290`
- **What**: `reply.answer?.let { connection.setRemote(...) }`. The web throws
  (`"no answer to closing tracks"`, `web/src/voice/sfu.ts:846`).
- **How it fails**: chatd returns 200 with no answer (the handler can, e.g. when
  the SFU had nothing to renegotiate); the local description stays applied and
  the connection sits in `have-local-offer` — the same wedge as the failed
  publish, reached from a different direction.
- **Fix**: throw, and roll the offer back.

### [BAD] The instant a call fails the error replaces everything, including the channel id

- **Where**: `voice/VoiceSession.kt:175`
- **What**: `_state.value = CallState(error = message)` — `channelId` becomes
  `null` while `CallScreen` is still open for that channel.
- **How it fails**: `CallScreen`'s `LaunchedEffect(channelId)` will not re-run
  (its key did not change), but `if (call.channelId != channelId)` is now true
  for any later trigger, so a stray recomposition can silently re-`join()` a
  call that just failed, producing a join loop against a server that is down.
- **Fix**: keep `channelId` and add `error`, and require an explicit dismissal.

---

### [POLISH] `setWatching` is only ever set to `true`

- **Where**: `ui/voice/CallScreen.kt:192`, `voice/VoiceSession.kt:100-103`
- **What**: tapping a tile calls `setWatching(userId, true)`; nothing ever
  passes `false`, and `watchingVideo` is only cleared on `leaveNow`.
- **How it fails**: once you have looked at someone's screen share you keep
  paying for it for the rest of the call. And since the gate is on the wrong
  kind (see the BROKEN finding), the tap is also the only way to see anyone's
  camera — an undiscoverable gesture with no affordance.
- **Fix**: toggle, and show a "watching" state on the tile.

### [POLISH] An incoming call shows both a full-screen dialog and a heads-up notification

- **Where**: `App.kt:56` (`Session.ringHooks += { … Notifications.ringing(this, …) }`), `MainActivity.kt:233-241`
- **What**: the ring hook posts the notification unconditionally, while
  `IncomingCall()` puts up a full-screen `Dialog` whenever `Session.ringing` is
  set and you are not already in that call. Nothing consults
  `Session.Focus.foreground`, which the message hook at `App.kt:52` does use.
- **How it fails**: with the app open you get a heads-up card sliding over a
  full-screen answer/decline screen, with two Decline buttons that take
  different code paths (one of which may silently fail, above).
- **Fix**: post the ring notification only when `!Session.Focus.foreground`.

### [POLISH] The sidebar's voice roster does not update

- **Where**: `ui/main/Sidebar.kt:220` — `val voice = AppState.voiceIn(channel.id)`
- **What**: `voiceIn` reads `voiceStates.value` directly rather than through
  `collectAsState`, so Compose never subscribes.
- **How it fails**: people joining or leaving a voice channel do not appear or
  disappear under it until something else forces that row to recompose.
- **Fix**: `val states by AppState.voiceStates.collectAsState()` and derive.

### [POLISH] Toggling the camera closes the track at the SFU instead of replacing it

- **Where**: `voice/VoiceSession.kt:266-273`, against `web/src/voice/sfu.ts:590-596`
- **What**: Android calls `removeLocalTrack(VIDEO)`, which stops the transceiver
  and sends `sfuClose`. The web keeps the sender published and replaces the
  track with `null`:
  > turned off, the sender stays published and sends nothing; the server stops
  > charging for it
- **How it fails**: a stopped transceiver's m-line cannot be reused, so every
  toggle grows the SDP by one section and costs two renegotiations, and every
  peer must re-pull when you turn it back on (with a new tag — which, per the
  tag bug above, they may then loop on).
- **Fix**: match the web: `sender.setTrack(null, false)` and leave it published.

### [POLISH] Speaking detection is a bare threshold with no smoothing

- **Where**: `voice/VoiceSession.kt:508` and `:511` (`level > 0.02`), against `web/src/voice/speaking.ts`
- **What**: the web has a dedicated module with hysteresis; Android compares a
  raw 400 ms sample to `0.02`.
- **How it fails**: the green speaking ring flickers on and off between samples
  during normal speech, and a quiet room with a noisy mic keeps it lit.
- **Fix**: port `speaking.ts`'s attack/release.

### [POLISH] `call.error!!` where a smart cast would do

- **Where**: `ui/voice/CallScreen.kt:162`
- **What**: `call.error != null -> call.error!!`. `call` is a local `val` and
  `error` is a `val` on a data class, so `call.error` smart-casts.
- **How it fails**: it does not, today. It is the kind of `!!` that becomes a
  `NullPointerException` the moment `call` is changed to a `by` delegate or
  `error` becomes a `var`.
- **Fix**: `val error = call.error; if (error != null) …`.

### [POLISH] Hardcoded English in a fully translated screen

- **Where**: `ui/voice/CallScreen.kt:164` ("`${participants.size} in the call · encrypted end to end`"), `ui/voice/IncomingCallScreen.kt:61` ("is calling"), `notify/Notifications.kt:124` ("`$name is calling`"), `voice/SfuTransport.kt:311` ("Video is paused on this server for now.")
- **What**: four user-visible strings bypass `t(...)` in files where every other
  string uses it.
- **How it fails**: the call screen reads half in the user's language and half in
  English, and the SFU's video-paused message is untranslatable. The web's
  equivalent is `tr_("sfu.videoIsPausedUntilNextMonth")`.
- **Fix**: move them into the shared catalogue.

### [POLISH] No telecom integration

- **Where**: `AndroidManifest.xml` — no `MANAGE_OWN_CALLS`, no `ConnectionService`
- **What**: the app rings with a notification and a Compose dialog rather than
  registering with `TelecomManager`.
- **How it fails**: a cellular call and a Nexa call can ring at once and both
  play audio; the phone's call screen, car head units and watches know nothing
  about a Nexa call; and `USE_FULL_SCREEN_INTENT` (declared at
  `AndroidManifest.xml:13`) is increasingly restricted on Android 14+ for apps
  that are not registered calling apps.
- **Fix**: a `ConnectionService` self-managed connection, which is what Android
  expects of a calling app.
