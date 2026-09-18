package xyz.evilion.chat.voice

import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.VideoTrack
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.readable
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.GatewayEvent
import xyz.evilion.chat.net.VoiceApi
import xyz.evilion.chat.net.VoiceState
import xyz.evilion.chat.service.CallService
import java.util.concurrent.ConcurrentHashMap

/** Someone in the call, and what of them this device is receiving. */
data class CallPeer(
    val userId: String,
    val speaking: Boolean = false,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val video: VideoTrack? = null,
    val screen: VideoTrack? = null,
    val volume: Float = 1f,
)

/**
 * Frames sealed, opened and dropped, for the call's readout.
 *
 * This was a `LongArray`, which a data class compares by reference, and the
 * JNI call behind it hands back a new one every 400 ms — so the state flow
 * reported a change on every tick and the whole call screen, every tile and
 * every video renderer, recomposed two and a half times a second for the
 * length of every call.
 */
data class CryptoStats(val sealed: Long = 0, val opened: Long = 0, val dropped: Long = 0) {
    val any: Boolean get() = sealed > 0 || opened > 0
}

data class CallState(
    val channelId: String? = null,
    val connecting: Boolean = false,
    val connected: Boolean = false,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val video: Boolean = false,
    val screen: Boolean = false,
    val speaker: Boolean = true,
    val speaking: Boolean = false,
    /** Something else took the audio — a cellular call, an alarm — and this one is waiting. */
    val interrupted: Boolean = false,
    val error: String? = null,
    val peers: Map<String, CallPeer> = emptyMap(),
    /** Whose screen shares this device asked for; a share nobody watches is never pulled. */
    val watching: Set<String> = emptySet(),
    val crypto: CryptoStats = CryptoStats(),
)

/**
 * The call this device is in.
 *
 * Joining means three things at once: telling the server through the gateway,
 * opening a session with the SFU, and sealing every frame with the
 * conversation's key — without which nothing is sent at all, rather than
 * something the server could listen to.
 *
 * Everything that touches a native object happens here or in [SfuTransport],
 * never in the UI, and never on one of WebRTC's own threads. A track the peer
 * connection disposed is still held by whatever drew it; the rule that keeps
 * this alive is that the transport tells the call to let go *before* it
 * disposes anything, and that every call into libwebrtc from a button or a
 * timer is guarded, because a disposed native object used from Kotlin ends the
 * process with nothing to read.
 */
object VoiceSession {
    private const val TAG = "VoiceSession"

    /** Up to this many times one call will make its SFU session again before giving up. */
    private const val MAX_RECOVERIES = 3

    /**
     * Nothing a call does may take the app down with it.
     *
     * Most of the work here is launched into this scope, and WebRTC throws
     * from places a caller cannot see coming — a track disposed by a peer
     * connection that was rebuilt after the network changed is still held by
     * the stats tick, by the deafen button and by the view drawing it. Without
     * a handler, one of those ends the process. With one, the call says so.
     */
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, e ->
            Log.e(TAG, "call failed", e)
            val said = e.readable("call")
            Session.toasts.tryEmit(said)
            if (_state.value.channelId != null) _state.update { it.copy(error = said, connecting = false) }
        },
    )
    private val lock = Mutex()

    private val _state = MutableStateFlow(CallState(speaker = SettingsStore.deviceBool("callSpeaker", true)))
    val state: StateFlow<CallState> = _state.asStateFlow()

    private var transport: SfuTransport? = null
    private var micSource: AudioSource? = null
    private var micTrack: AudioTrack? = null
    private var camera: Capture? = null
    private var screen: Capture? = null

    /**
     * Everyone's incoming audio, keyed by person *and* kind.
     *
     * One slot per person meant a screen share's sound replaced the voice
     * behind it: deafen then silenced the share and left the voice audible,
     * the volume slider moved the wrong track, and when the share stopped the
     * voice became unadjustable for the rest of the call. A `ConcurrentHashMap`
     * because WebRTC's signalling thread writes it while the deafen button
     * reads it.
     */
    private val remoteAudio = ConcurrentHashMap<String, AudioTrack>()
    private var statsJob: Job? = null
    private val watchingVideo: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val speakingGates = ConcurrentHashMap<String, SpeakingGate>()
    private val myGate = SpeakingGate()
    private var recoveries = 0

    /** Set the moment the system says yes to a share, before the projection is touched. */
    @Volatile
    var wantsScreen: Boolean = false
        private set

    private fun slot(userId: String, kind: PubKind) = "$userId:${kind.wire}"

    /** Whether this device wants someone's screen share; a share nobody watches is not pulled. */
    fun watching(userId: String): Boolean = userId in watchingVideo

    /**
     * Asks for, or gives up, someone's screen share.
     *
     * The set is mirrored into the state so the tile that offers it knows
     * which way round it is: tapping a tile only ever subscribed before, and
     * once you had looked at a share you kept paying for it for the rest of
     * the call.
     */
    fun setWatching(userId: String, on: Boolean) {
        if (on) watchingVideo += userId else watchingVideo -= userId
        _state.update { it.copy(watching = watchingVideo.toSet()) }
        scope.launch { syncTracks() }
    }

    // --- joining and leaving ----------------------------------------------

    fun join(channelId: String) {
        scope.launch { joinNow(channelId) }
    }

    /**
     * Joins, once.
     *
     * The whole of this holds [lock]. Two joins could run at the same time —
     * the call screen's effect and the microphone prompt's callback both fire
     * on a rotation — and each built its own transport and its own microphone
     * while only the second was remembered. The first was never closed: its
     * key timer ran for ever and its SFU session kept publishing this device's
     * microphone into a call the user thought they had left.
     */
    private suspend fun joinNow(channelId: String) = lock.withLock {
        val current = _state.value
        if (current.channelId == channelId && current.error == null && transport != null) return@withLock
        if (current.channelId != null) tearDownLocked(moving = true)
        _state.update {
            CallState(
                channelId = channelId,
                connecting = true,
                muted = it.muted,
                deafened = it.deafened,
                speaker = it.speaker,
            )
        }
        recoveries = 0
        updateService(channelId)

        // A build whose native library did not load cannot seal a frame, and
        // every `external fun` it reaches throws an Error rather than an
        // Exception — which the join path used not to catch, so every call
        // attempt killed the process before anything was on screen.
        if (!FrameCryptoNative.load()) {
            failLocked(t("voiceSession.thisBuildCannotEncryptCalls"))
            return@withLock
        }

        val ice = runCatching { VoiceApi.ice() }.getOrNull()
        if (ice == null) {
            failLocked(t("voiceSession.couldNotReachTheServerTo"))
            return@withLock
        }
        if (!ice.sfu) {
            failLocked(t("voiceSession.thisServerIsNotSetUp"))
            return@withLock
        }
        // the call's frames are sealed with the conversation's key, which has to be here first
        val conv = AppState.convFor(channelId)
        if (runCatching { KeyService.ensureConvKey(conv) }.getOrNull() == null) {
            failLocked(t("guestLink.thisConversationSKeysHaveNot"))
            return@withLock
        }

        val myId = AppState.me.value?.id
        if (myId == null) {
            failLocked(t("voiceSession.theCallCouldNotBeStarted"))
            return@withLock
        }

        val servers = ice.iceServers.mapNotNull { it.toWebRtc() }
        val sfu = SfuTransport(
            scope = scope,
            myId = myId,
            channelId = channelId,
            iceServers = servers,
            onRemoteTrack = ::onRemoteTrack,
            onState = { state ->
                _state.update {
                    it.copy(
                        connected = state == PeerConnection.PeerConnectionState.CONNECTED,
                        connecting = state == PeerConnection.PeerConnectionState.CONNECTING,
                    )
                }
            },
            onError = { message -> _state.update { it.copy(error = message) } },
        )

        try {
            val (source, track) = VoiceEngine.createAudioTrack("mic")
            micSource = source
            micTrack = track
            track.setEnabled(!_state.value.muted)
            sfu.start()
        } catch (e: Throwable) {
            Log.w(TAG, "could not get the call ready", e)
            runCatching { sfu.close() }
            failLocked(e.message ?: t("voiceSession.theCallCouldNotBeStarted"))
            return@withLock
        }
        transport = sfu

        VoiceEngine.onFocusChange = ::onAudioFocus
        VoiceEngine.enterCallAudio(_state.value.speaker)
        // The gateway goes first: the server hands out an SFU session only to
        // someone it has already seen join the call.
        sendState(channelId)
        startStats()
    }

    fun leave() {
        scope.launch { lock.withLock { leaveLocked(moving = false) } }
    }

    /** Sign-out and teardown: no gateway traffic, just let go of everything. */
    fun leaveQuietly() {
        scope.launch { lock.withLock { leaveLocked(moving = true) } }
    }

    private suspend fun leaveLocked(moving: Boolean) {
        if (_state.value.channelId == null && transport == null) return
        tearDownLocked(moving)
        _state.value = CallState(
            muted = _state.value.muted,
            deafened = _state.value.deafened,
            speaker = _state.value.speaker,
        )
        updateService(null)
    }

    /**
     * A call that cannot go on, with the reason left on screen.
     *
     * The channel is kept. Wiping it made `CallScreen`'s "am I in this call?"
     * test true again, so a stray recomposition could quietly rejoin a call
     * that had just failed — a join loop against a server that was down — and
     * the error under the channel name belonged to nothing.
     */
    private suspend fun failLocked(message: String) {
        val channelId = _state.value.channelId
        tearDownLocked(moving = false)
        _state.value = CallState(
            channelId = channelId,
            error = message,
            muted = _state.value.muted,
            deafened = _state.value.deafened,
            speaker = _state.value.speaker,
        )
        updateService(null)
    }

    /**
     * Lets go of everything the call holds. Must be called with [lock] held.
     *
     * The stats loop is stopped *and waited for* before the transport closes:
     * cancelling a coroutine cannot interrupt one already inside a call into
     * libwebrtc, and the connection it was about to read from is the one
     * `close()` is about to dispose.
     */
    private suspend fun tearDownLocked(moving: Boolean) {
        val channelId = _state.value.channelId
        runCatching { statsJob?.cancelAndJoin() }
        statsJob = null
        runCatching { transport?.close() }
        transport = null
        releaseLocalMedia()
        remoteAudio.clear()
        watchingVideo.clear()
        speakingGates.clear()
        myGate.reset()
        wantsScreen = false
        VoiceEngine.onFocusChange = null
        // Left out of the quiet path, this was what kept the earpiece routing
        // and MODE_IN_COMMUNICATION for the rest of the process's life after a
        // sign-out: music and notifications at call volume until a force-stop.
        VoiceEngine.leaveCallAudio()
        if (channelId != null && !moving) sendState(null)
    }

    private fun releaseLocalMedia() {
        camera?.release()
        camera = null
        screen?.release()
        screen = null
        // The track goes before the source it reads from, and both go: leaving
        // the track alive is what kept `AudioRecord` open and the microphone
        // indicator lit after hanging up.
        micTrack?.let {
            runCatching { it.setEnabled(false) }
            runCatching { it.dispose() }
        }
        micTrack = null
        micSource?.let { runCatching { it.dispose() } }
        micSource = null
    }

    /** Told when the microphone was refused, so the call says so rather than looking broken. */
    fun noteNoMicrophone() {
        _state.update { it.copy(error = t("session.microphoneAccessWasDeniedYouCan")) }
    }

    // --- controls ----------------------------------------------------------

    fun setMuted(on: Boolean) {
        _state.update { it.copy(muted = on) }
        applyMicrophone()
        if (on) myGate.reset()
        sendState(_state.value.channelId)
    }

    fun setDeafened(on: Boolean) {
        _state.update { it.copy(deafened = on, muted = if (on) true else it.muted) }
        applyMicrophone()
        applyPlayback()
        sendState(_state.value.channelId)
    }

    fun setSpeaker(on: Boolean) {
        _state.update { it.copy(speaker = on) }
        SettingsStore.setDeviceBool("callSpeaker", on)
        runCatching { VoiceEngine.enterCallAudio(on) }
    }

    fun setVolume(userId: String, volume: Float) {
        val level = volume.toDouble().coerceIn(0.0, 2.0)
        remoteAudio[slot(userId, PubKind.AUDIO)]?.let { runCatching { it.setVolume(level) } }
        _state.update { current ->
            val peer = current.peers[userId] ?: CallPeer(userId)
            current.copy(peers = current.peers + (userId to peer.copy(volume = volume)))
        }
    }

    /** The microphone follows mute, deafen and whatever else is using the audio. */
    private fun applyMicrophone() {
        val call = _state.value
        val live = !call.muted && !call.interrupted
        micTrack?.let { runCatching { it.setEnabled(live) } }
    }

    /** And everyone else's voices follow deafen and the same interruption. */
    private fun applyPlayback() {
        val call = _state.value
        val play = !call.deafened && !call.interrupted
        for (track in remoteAudio.values) runCatching { track.setEnabled(play) }
    }

    /**
     * Something else took the audio: a cellular call, an alarm, a navigation
     * prompt. The call goes quiet both ways until it comes back, rather than
     * talking over it.
     */
    private fun onAudioFocus(has: Boolean) {
        if (_state.value.channelId == null) return
        _state.update { it.copy(interrupted = !has) }
        applyMicrophone()
        applyPlayback()
    }

    fun toggleCamera() {
        scope.launch {
            lock.withLock {
                val sfu = transport ?: return@withLock
                if (_state.value.video) {
                    // The sender stays published and sends nothing. A stopped
                    // transceiver's m-line cannot be reused, so closing it
                    // instead grew the SDP by a section on every toggle, cost
                    // two renegotiations, and made every peer pull again.
                    runCatching { sfu.setLocalTrack(PubKind.VIDEO, null) }
                    camera?.release()
                    camera = null
                    _state.update { it.copy(video = false) }
                } else {
                    val capturer = VoiceEngine.createCameraCapturer(front = true, events = cameraEvents)
                    if (capturer == null) {
                        _state.update { it.copy(error = t("settings.voice.noCameraFound")) }
                        return@withLock
                    }
                    val started = try {
                        VoiceEngine.startCapture(capturer, 1280, 720, 30)
                    } catch (e: Throwable) {
                        Log.w(TAG, "the camera would not start", e)
                        _state.update { it.copy(error = e.readable("camera")) }
                        return@withLock
                    }
                    camera = started
                    try {
                        sfu.setLocalTrack(PubKind.VIDEO, started.track)
                    } catch (e: Throwable) {
                        started.release()
                        camera = null
                        _state.update { it.copy(error = e.readable("camera")) }
                        return@withLock
                    }
                    _state.update { it.copy(video = true) }
                }
            }
            // Android 11+ cuts a background app off from the camera unless a
            // camera-typed foreground service is running, so the service is
            // told before anyone presses Home.
            updateService(_state.value.channelId)
            sendState(_state.value.channelId)
        }
    }

    fun switchCamera() {
        (camera?.capturer as? org.webrtc.CameraVideoCapturer)?.let { runCatching { it.switchCamera(null) } }
    }

    /** A camera that stopped and will not come back: the button goes out and says why. */
    private val cameraEvents = object : VoiceEngine.CameraEvents {
        override fun onLost(reason: String) {
            if (!_state.value.video) return
            Log.w(TAG, "the camera was lost: $reason")
            scope.launch {
                lock.withLock {
                    transport?.let { runCatching { it.setLocalTrack(PubKind.VIDEO, null) } }
                    camera?.release()
                    camera = null
                    _state.update { it.copy(video = false, error = t("voiceSession.theCameraStopped")) }
                }
                updateService(_state.value.channelId)
                sendState(_state.value.channelId)
            }
        }
    }

    /**
     * The screen, once the system has said yes.
     *
     * Android 14 and up refuse a media projection to an app without a running
     * foreground service of type `mediaProjection`, and the refusal is a
     * `SecurityException` on whatever thread asked. `startForegroundService`
     * only *schedules* the service, so starting the capture in the next breath
     * was a race the phone usually lost — a crash the moment the user
     * confirmed the system's own dialog.
     */
    fun startScreenShare(permission: Intent) {
        wantsScreen = true
        scope.launch {
            val channelId = _state.value.channelId
            if (channelId == null) {
                wantsScreen = false
                return@launch
            }
            val ready = CallService.awaitForeground(VoiceEngine.context(), channelId)
            if (!ready) {
                wantsScreen = false
                _state.update { it.copy(error = t("voiceSession.theScreenCouldNotBeShared")) }
                return@launch
            }
            lock.withLock {
                val sfu = transport ?: return@withLock
                val capturer = ScreenCapturerAndroid(
                    permission,
                    object : android.media.projection.MediaProjection.Callback() {
                        override fun onStop() {
                            scope.launch { stopScreenShare() }
                        }
                    },
                )
                val started = try {
                    VoiceEngine.startCapture(capturer, 1280, 720, 30)
                } catch (e: Throwable) {
                    Log.w(TAG, "the screen would not be captured", e)
                    _state.update { it.copy(error = e.readable("screen share")) }
                    return@withLock
                }
                screen = started
                try {
                    sfu.setLocalTrack(PubKind.SCREEN, started.track)
                } catch (e: Throwable) {
                    started.release()
                    screen = null
                    _state.update { it.copy(error = e.readable("screen share")) }
                    return@withLock
                }
                _state.update { it.copy(screen = true) }
            }
            wantsScreen = _state.value.screen
            updateService(_state.value.channelId)
            sendState(_state.value.channelId)
        }
    }

    suspend fun stopScreenShare() {
        lock.withLock {
            wantsScreen = false
            if (screen == null && !_state.value.screen) return@withLock
            transport?.let { runCatching { it.removeLocalTrack(PubKind.SCREEN) } }
            screen?.release()
            screen = null
            _state.update { it.copy(screen = false) }
        }
        updateService(_state.value.channelId)
        sendState(_state.value.channelId)
    }

    fun localVideoTrack(): VideoTrack? = camera?.track

    fun localScreenTrack(): VideoTrack? = screen?.track

    /**
     * Keeps the foreground service in step with what the call is doing.
     *
     * The types are what Android checks: microphone for a live call, camera
     * while the camera is on, mediaProjection while the screen is shared. The
     * service works them out from this state rather than from whatever flag
     * the caller happened to pass, because the call screen used to re-announce
     * `sharing = false` every time it was reopened, which dropped the
     * projection type from the running service and killed the share.
     */
    private fun updateService(channelId: String?) {
        runCatching {
            val context = VoiceEngine.context()
            if (channelId == null) CallService.stop(context) else CallService.start(context, channelId)
        }.onFailure { Log.w(TAG, "could not update the call notification", it) }
    }

    // --- the server's side -------------------------------------------------

    private fun sendState(channelId: String?) {
        val current = _state.value
        Session.gateway.send("voice_state", buildJsonObject {
            if (channelId == null) put("channel_id", null as String?) else put("channel_id", channelId)
            put("self_mute", current.muted)
            put("self_deaf", current.deafened)
            put("video", current.video)
            put("streaming", current.screen)
            if (channelId != null) put("sfu", true)
        })
    }

    fun onVoiceState(state: VoiceState) {
        val me = AppState.me.value?.id
        if (state.userId == me) {
            Log.i(TAG, "our voice state: channel=${state.channelId} session=${state.sessionId}")
            val current = _state.value.channelId
            if (current != null && state.channelId == current) {
                // the server has us in the call: now the media session can open
                scope.launch { openSession() }
                return
            }
            // moved by a moderator, or dropped from the call
            if (current != null && state.channelId != current) {
                if (state.channelId == null) leave() else join(state.channelId)
            }
            return
        }
        _state.update { call ->
            if (call.channelId == null) return@update call
            if (state.channelId != call.channelId) {
                call.copy(peers = call.peers - state.userId)
            } else {
                val peer = call.peers[state.userId] ?: CallPeer(state.userId)
                call.copy(
                    peers = call.peers + (state.userId to peer.copy(
                        muted = state.selfMute || state.serverMute,
                        deafened = state.selfDeaf || state.serverDeaf,
                    )),
                )
            }
        }
        if (state.channelId != _state.value.channelId) speakingGates.remove(state.userId)
        scope.launch { syncTracks() }
    }

    /**
     * Opens the media session once the server acknowledged the join.
     *
     * A session is not a microphone. The session used to stand in for "this
     * device is publishing", so a publish that failed on its own left someone
     * in the call, hearing everyone, whom nobody could hear — permanently,
     * because the retry checked for a session that had been created after all.
     */
    private suspend fun openSession() {
        val sfu = transport ?: return
        val mic = micTrack
        if (sfu.hasSession() && sfu.isPublishing(PubKind.AUDIO)) {
            syncTracks()
            return
        }
        try {
            Log.i(TAG, "opening the call session")
            sfu.openSession(mic)
            Log.i(TAG, "call session open")
            _state.update { it.copy(connecting = false, error = null) }
            syncTracks()
        } catch (e: Throwable) {
            Log.w(TAG, "could not open the call session", e)
            _state.update { it.copy(error = e.readable("call")) }
            // The server only knows this device is in the call once its own
            // voice state comes back; a race there is worth one more try.
            if (e is ApiException && e.code == "not_in_voice") {
                delay(700)
                if (_state.value.channelId != null && transport === sfu && !sfu.isPublishing(PubKind.AUDIO)) {
                    runCatching {
                        sfu.openSession(micTrack)
                        _state.update { it.copy(error = null, connecting = false) }
                        syncTracks()
                    }.onFailure { Log.w(TAG, "the call session would not open", it) }
                }
            }
        }
    }

    fun onGatewayEvent(event: GatewayEvent) {
        when (event.type) {
            "voice_resumed" -> Unit
            "voice_error" -> {
                val message = (event.data as? JsonObject)?.get("message")?.jsonPrimitive?.content
                if (message != null) _state.update { it.copy(error = message) }
            }
            "call_end" -> {
                val channel = (event.data as? JsonObject)?.get("channel_id")?.jsonPrimitive?.content
                if (channel != null && channel == _state.value.channelId && _state.value.peers.isEmpty()) leave()
            }
            "guest_ended" -> leave()
        }
    }

    /**
     * The gateway came back.
     *
     * The roster in the ready payload says who is in the call now, which is
     * what to pull; and the SFU session this device is holding may be one the
     * server has already let go of, which the first sync finds out and makes
     * again rather than logging.
     */
    fun onReady(states: List<VoiceState>, sessionId: String) {
        val channelId = _state.value.channelId ?: return
        scope.launch {
            sendState(channelId)
            val here = states.filter { it.channelId == channelId }.map { it.userId }.toSet()
            _state.update { call ->
                if (here.isEmpty()) call else call.copy(peers = call.peers.filterKeys { it in here || it == AppState.me.value?.id })
            }
            openSession()
        }
    }

    /** Someone else's media changed, or a pull has to be asked for again: pull what is new. */
    fun refreshTracks() {
        scope.launch { syncTracks() }
    }

    /** After the connection was made again, everything local is published once more. */
    fun republishAfterRebuild() {
        scope.launch {
            lock.withLock {
                val sfu = transport ?: return@withLock
                runCatching {
                    micTrack?.let { sfu.setLocalTrack(PubKind.AUDIO, it) }
                    camera?.track?.let { sfu.setLocalTrack(PubKind.VIDEO, it) }
                    screen?.track?.let { sfu.setLocalTrack(PubKind.SCREEN, it) }
                }.onFailure { Log.w(TAG, "could not publish again after reconnecting", it) }
            }
            syncTracks()
        }
    }

    private suspend fun syncTracks() {
        val sfu = transport ?: return
        val channelId = _state.value.channelId ?: return
        val states = AppState.voiceStates.value.values.filter { it.channelId == channelId }
        try {
            sfu.sync(states)
        } catch (e: Throwable) {
            if (!recoverFromFatal(e, sfu)) Log.w(TAG, "could not sync call tracks", e)
        }
    }

    /**
     * A session the server has let go of is made again rather than logged.
     *
     * chatd restarts, or the session ages out, and every sync after that fails
     * the same way. The call used to stay up on screen, cheerfully saying "2 in
     * the call · encrypted end to end", with no audio and no error at all.
     */
    private suspend fun recoverFromFatal(e: Throwable, sfu: SfuTransport): Boolean {
        val api = e as? ApiException ?: return false
        if (api.code != "sfu_session_gone" && api.code != "not_in_voice") return false
        if (transport !== sfu) return true
        val channelId = _state.value.channelId ?: return true
        if (recoveries >= MAX_RECOVERIES) {
            _state.update { it.copy(error = t("voiceSession.theCallLostItsConnectionAnd")) }
            return true
        }
        recoveries++
        Log.i(TAG, "the call session is gone; starting it again ($recoveries)")
        // The server hands out a session only to someone it has already seen
        // join, so it is told again before anything is asked of the SFU.
        sendState(channelId)
        delay(300)
        runCatching { sfu.rebuild() }.onFailure { Log.w(TAG, "could not start the call session again", it) }
        return true
    }

    private fun onRemoteTrack(userId: String, kind: PubKind, track: MediaStreamTrack?) {
        when (kind) {
            PubKind.AUDIO, PubKind.SCREEN_AUDIO -> {
                val key = slot(userId, kind)
                val audio = track as? AudioTrack
                if (audio == null) {
                    remoteAudio.remove(key)
                } else {
                    remoteAudio[key] = audio
                    val call = _state.value
                    runCatching { audio.setEnabled(!call.deafened && !call.interrupted) }
                    if (kind == PubKind.AUDIO) {
                        call.peers[userId]?.volume?.let { runCatching { audio.setVolume(it.toDouble()) } }
                    }
                }
                if (kind == PubKind.AUDIO) {
                    _state.update { call ->
                        if (call.channelId == null) return@update call
                        val peer = call.peers[userId] ?: CallPeer(userId)
                        call.copy(peers = call.peers + (userId to peer))
                    }
                }
            }

            PubKind.VIDEO -> _state.update { call ->
                val peer = call.peers[userId] ?: CallPeer(userId)
                call.copy(peers = call.peers + (userId to peer.copy(video = track as? VideoTrack)))
            }

            PubKind.SCREEN -> _state.update { call ->
                val peer = call.peers[userId] ?: CallPeer(userId)
                call.copy(peers = call.peers + (userId to peer.copy(screen = track as? VideoTrack)))
            }
        }
    }

    /**
     * Who is speaking, from the levels the connection reports.
     *
     * The report is awaited rather than handled in libwebrtc's callback, so
     * everything below runs on this coroutine. A throw from a disposed track
     * inside that callback had no coroutine around it and nothing above it but
     * the process's uncaught handler.
     */
    private fun startStats() {
        statsJob?.cancel()
        statsJob = scope.launch {
            while (isActive) {
                delay(400)
                val sfu = transport ?: continue
                val report = runCatching { sfu.stats() }.getOrNull() ?: continue
                if (transport !== sfu) continue
                runCatching { applyStats(sfu, report) }
                    .onFailure { Log.w(TAG, "could not read the call levels", it) }
            }
        }
    }

    private fun applyStats(sfu: SfuTransport, report: org.webrtc.RTCStatsReport) {
        val levels = mutableMapOf<String, Double>()
        var local = 0.0
        for (stat in report.statsMap.values) {
            when (stat.type) {
                "inbound-rtp" -> {
                    val level = (stat.members["audioLevel"] as? Number)?.toDouble() ?: continue
                    val trackId = stat.members["trackIdentifier"] as? String ?: continue
                    levels[trackId] = level
                }

                "media-source" -> (stat.members["audioLevel"] as? Number)?.let { local = it.toDouble() }
            }
        }
        val now = System.currentTimeMillis()
        val stats = sfu.cryptoStats()
        _state.update { call ->
            val peers = call.peers.mapValues { (userId, peer) ->
                val id = remoteAudio[slot(userId, PubKind.AUDIO)]?.let { track ->
                    runCatching { if (track.isDisposed) null else track.id() }.getOrNull()
                }
                val level = id?.let { levels[it] } ?: 0.0
                val gate = speakingGates.getOrPut(userId) { SpeakingGate() }
                peer.copy(speaking = gate.update(level > SpeakingGate.SPEAKING_LEVEL, now))
            }
            call.copy(
                peers = peers,
                speaking = myGate.update(!call.muted && !call.interrupted && local > SpeakingGate.SPEAKING_LEVEL, now),
                crypto = CryptoStats(stats.getOrElse(0) { 0 }, stats.getOrElse(1) { 0 }, stats.getOrElse(2) { 0 }),
            )
        }
    }
}

/** The ICE servers chatd hands out, as WebRTC wants them. */
private fun xyz.evilion.chat.net.IceServer.toWebRtc(): PeerConnection.IceServer? {
    val element = urls ?: return null
    val list = when (element) {
        is kotlinx.serialization.json.JsonArray -> element.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
        is kotlinx.serialization.json.JsonPrimitive -> listOf(element.content)
        else -> emptyList()
    }
    if (list.isEmpty()) return null
    return PeerConnection.IceServer.builder(list)
        .setUsername(username.orEmpty())
        .setPassword(credential.orEmpty())
        .createIceServer()
}
