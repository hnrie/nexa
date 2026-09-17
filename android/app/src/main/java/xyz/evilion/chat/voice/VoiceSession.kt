package xyz.evilion.chat.voice

import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.readable
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.GatewayEvent
import xyz.evilion.chat.net.IceConfig
import xyz.evilion.chat.net.VoiceApi
import xyz.evilion.chat.net.VoiceState

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
    val error: String? = null,
    val peers: Map<String, CallPeer> = emptyMap(),
    /** Frames sealed, opened and dropped, for the call's readout. */
    val crypto: LongArray = longArrayOf(0, 0, 0),
)

/**
 * The call this device is in.
 *
 * Joining means three things at once: telling the server through the gateway,
 * opening a session with the SFU, and sealing every frame with the
 * conversation's key — without which nothing is sent at all, rather than
 * something the server could listen to.
 */
object VoiceSession {
    private const val TAG = "VoiceSession"

    /**
     * Nothing a call does may take the app down with it.
     *
     * Most of the work here is launched into this scope, and WebRTC throws
     * from places a caller cannot see coming — a track disposed by a peer
     * connection that was rebuilt after the network changed is still held by
     * the stats tick, by the deafen button and by the view drawing it. Without
     * a handler, one of those ends the process. With one, the call fails and
     * says so.
     */
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, e ->
            Log.e(TAG, "call failed", e)
            Session.toasts.tryEmit(e.readable("call"))
        },
    )
    private val lock = Mutex()

    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state.asStateFlow()

    private var transport: SfuTransport? = null
    private var micSource: AudioSource? = null
    private var micTrack: AudioTrack? = null
    private var cameraCapturer: VideoCapturer? = null
    private var cameraSource: VideoSource? = null
    private var cameraTrack: VideoTrack? = null
    private var screenCapturer: VideoCapturer? = null
    private var screenSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private val remoteAudio = mutableMapOf<String, AudioTrack>()
    private var statsJob: Job? = null
    private var watchingVideo = mutableSetOf<String>()

    /** Whether this device wants someone's camera; a camera nobody watches is not pulled. */
    fun watching(userId: String): Boolean = userId in watchingVideo

    fun setWatching(userId: String, on: Boolean) {
        if (on) watchingVideo += userId else watchingVideo -= userId
        scope.launch { syncTracks() }
    }

    // --- joining and leaving ----------------------------------------------

    fun join(channelId: String) {
        scope.launch { joinNow(channelId) }
    }

    private suspend fun joinNow(channelId: String) {
        if (_state.value.channelId == channelId) return
        if (_state.value.channelId != null) leaveNow(moving = true)
        _state.update { CallState(channelId = channelId, connecting = true, muted = it.muted, deafened = it.deafened) }

        val ice = runCatching { VoiceApi.ice() }.getOrNull()
        if (ice == null) {
            fail(t("voiceSession.couldNotReachTheServerTo"))
            return
        }
        if (ice.sfu) {
            // the call's frames are sealed with the conversation's key, which has to be here first
            val conv = AppState.convFor(channelId)
            val key = runCatching { KeyService.ensureConvKey(conv) }.getOrNull()
            if (key == null) {
                fail(t("guestLink.thisConversationSKeysHaveNot"))
                return
            }
        } else {
            fail(t("voiceSession.thisServerIsNotSetUp"))
            return
        }

        val myId = AppState.me.value?.id ?: return
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
        transport = sfu

        val (source, track) = VoiceEngine.createAudioTrack("mic")
        micSource = source
        micTrack = track
        track.setEnabled(!_state.value.muted)

        try {
            sfu.start()
        } catch (e: Throwable) {
            Log.w(TAG, "could not get the call ready", e)
            fail(e.message ?: t("voiceSession.theCallCouldNotBeStarted"))
            return
        }

        VoiceEngine.enterCallAudio(speaker = true)
        // The gateway goes first: the server hands out an SFU session only to
        // someone it has already seen join the call.
        sendState(channelId)
        startStats()
    }

    private fun fail(message: String) {
        _state.value = CallState(error = message)
        scope.launch { runCatching { transport?.close() } }
        transport = null
        releaseLocalMedia()
    }

    fun leave() {
        scope.launch { leaveNow(moving = false) }
    }

    /** Sign-out and teardown: no gateway traffic, just let go of everything. */
    fun leaveQuietly() {
        scope.launch {
            runCatching { transport?.close() }
            transport = null
            releaseLocalMedia()
            statsJob?.cancel()
            _state.value = CallState()
        }
    }

    private suspend fun leaveNow(moving: Boolean) = lock.withLock {
        val channelId = _state.value.channelId
        statsJob?.cancel()
        statsJob = null
        runCatching { transport?.close() }
        transport = null
        releaseLocalMedia()
        remoteAudio.clear()
        watchingVideo.clear()
        VoiceEngine.leaveCallAudio()
        if (channelId != null && !moving) sendState(null)
        _state.value = CallState(muted = _state.value.muted, deafened = _state.value.deafened)
    }

    private fun releaseLocalMedia() {
        runCatching { cameraCapturer?.stopCapture() }
        cameraCapturer?.dispose()
        cameraSource?.dispose()
        cameraCapturer = null
        cameraSource = null
        cameraTrack = null
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        screenSource?.dispose()
        screenCapturer = null
        screenSource = null
        screenTrack = null
        micTrack?.setEnabled(false)
        micTrack = null
        micSource?.dispose()
        micSource = null
    }

    /** Told when the microphone was refused, so the call says so rather than looking broken. */
    fun noteNoMicrophone() {
        _state.update { it.copy(error = t("session.microphoneAccessWasDeniedYouCan")) }
    }

    // --- controls ----------------------------------------------------------

    fun setMuted(on: Boolean) {
        _state.update { it.copy(muted = on) }
        micTrack?.setEnabled(!on)
        sendState(_state.value.channelId)
    }

    fun setDeafened(on: Boolean) {
        _state.update { it.copy(deafened = on, muted = if (on) true else it.muted) }
        micTrack?.setEnabled(!_state.value.muted)
        for (track in remoteAudio.values) track.setEnabled(!on)
        sendState(_state.value.channelId)
    }

    fun setSpeaker(on: Boolean) {
        _state.update { it.copy(speaker = on) }
        VoiceEngine.enterCallAudio(on)
    }

    fun setVolume(userId: String, volume: Float) {
        remoteAudio[userId]?.setVolume(volume.toDouble().coerceIn(0.0, 2.0))
        _state.update { current ->
            val peer = current.peers[userId] ?: CallPeer(userId)
            current.copy(peers = current.peers + (userId to peer.copy(volume = volume)))
        }
    }

    fun toggleCamera() {
        scope.launch {
            val sfu = transport ?: return@launch
            if (_state.value.video) {
                sfu.removeLocalTrack(PubKind.VIDEO)
                runCatching { cameraCapturer?.stopCapture() }
                cameraCapturer?.dispose()
                cameraSource?.dispose()
                cameraCapturer = null
                cameraSource = null
                cameraTrack = null
                _state.update { it.copy(video = false) }
            } else {
                val capturer = VoiceEngine.createCameraCapturer(front = true) ?: return@launch
                val (source, track) = VoiceEngine.startCapture(capturer, 1280, 720, 30)
                cameraCapturer = capturer
                cameraSource = source
                cameraTrack = track
                sfu.setLocalTrack(PubKind.VIDEO, track)
                _state.update { it.copy(video = true) }
            }
            sendState(_state.value.channelId)
        }
    }

    fun switchCamera() {
        (cameraCapturer as? org.webrtc.CameraVideoCapturer)?.switchCamera(null)
    }

    /** The screen, once the system has said yes. */
    fun startScreenShare(permission: Intent) {
        scope.launch {
            val sfu = transport ?: return@launch
            val capturer = ScreenCapturerAndroid(permission, object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() {
                    scope.launch { stopScreenShare() }
                }
            })
            val (source, track) = VoiceEngine.startCapture(capturer, 1280, 720, 30)
            screenCapturer = capturer
            screenSource = source
            screenTrack = track
            sfu.setLocalTrack(PubKind.SCREEN, track)
            _state.update { it.copy(screen = true) }
            sendState(_state.value.channelId)
        }
    }

    suspend fun stopScreenShare() {
        val sfu = transport ?: return
        sfu.removeLocalTrack(PubKind.SCREEN)
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        screenSource?.dispose()
        screenCapturer = null
        screenSource = null
        screenTrack = null
        _state.update { it.copy(screen = false) }
        sendState(_state.value.channelId)
    }

    fun localVideoTrack(): VideoTrack? = cameraTrack

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
        scope.launch { syncTracks() }
    }

    /** Opens the media session once, after the server acknowledged the join. */
    private suspend fun openSession() {
        val sfu = transport ?: return
        if (sfu.hasSession()) {
            syncTracks()
            return
        }
        try {
            Log.i(TAG, "opening the call session")
            sfu.openSession(micTrack)
            Log.i(TAG, "call session open")
            _state.update { it.copy(connecting = false, error = null) }
            syncTracks()
        } catch (e: Exception) {
            Log.w(TAG, "could not open the call session", e)
            _state.update { it.copy(error = e.message ?: t("voiceSession.theCallCouldNotBeStarted")) }
            // The server only knows this device is in the call once its own
            // voice state comes back; a race there is worth one more try.
            if (e is xyz.evilion.chat.net.ApiException && e.code == "not_in_voice") {
                delay(700)
                if (_state.value.channelId != null && transport?.hasSession() != true) {
                    runCatching {
                        transport?.openSession(micTrack)
                        _state.update { it.copy(error = null, connecting = false) }
                        syncTracks()
                    }
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

    fun onReady(states: List<VoiceState>, sessionId: String) {
        // A reconnect brings the call back: the server keeps this device's place
        // for a moment, and the session is opened again from here.
        val channelId = _state.value.channelId ?: return
        scope.launch {
            sendState(channelId)
            syncTracks()
        }
    }

    /** Someone else's media changed: pull what is new. */
    fun refreshTracks() {
        scope.launch { syncTracks() }
    }

    /** After the connection was made again, everything local is published once more. */
    fun republishAfterRebuild() {
        scope.launch {
            val sfu = transport ?: return@launch
            micTrack?.let { sfu.setLocalTrack(PubKind.AUDIO, it) }
            cameraTrack?.let { sfu.setLocalTrack(PubKind.VIDEO, it) }
            screenTrack?.let { sfu.setLocalTrack(PubKind.SCREEN, it) }
            syncTracks()
        }
    }

    private suspend fun syncTracks() {
        val sfu = transport ?: return
        val channelId = _state.value.channelId ?: return
        val states = AppState.voiceStates.value.values.filter { it.channelId == channelId }
        runCatching { sfu.sync(states) }
            .onFailure { Log.w(TAG, "could not sync call tracks", it) }
    }

    private fun onRemoteTrack(userId: String, kind: PubKind, track: MediaStreamTrack?) {
        when (kind) {
            PubKind.AUDIO, PubKind.SCREEN_AUDIO -> {
                val audio = track as? AudioTrack
                if (audio == null) {
                    remoteAudio.remove(userId)
                } else {
                    remoteAudio[userId] = audio
                    audio.setEnabled(!_state.value.deafened)
                    _state.value.peers[userId]?.volume?.let { audio.setVolume(it.toDouble()) }
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
        if (kind == PubKind.AUDIO && track != null) {
            _state.update { call ->
                val peer = call.peers[userId] ?: CallPeer(userId)
                call.copy(peers = call.peers + (userId to peer))
            }
        }
    }

    /** Who is speaking, from the levels the connection reports. */
    private fun startStats() {
        statsJob?.cancel()
        statsJob = scope.launch {
            while (true) {
                delay(400)
                val connection = transport?.connection() ?: continue
                connection.getStats { report ->
                    val levels = mutableMapOf<String, Double>()
                    var local = 0.0
                    for (stat in report.statsMap.values) {
                        when (stat.type) {
                            "inbound-rtp" -> {
                                val level = (stat.members["audioLevel"] as? Number)?.toDouble() ?: continue
                                val trackId = stat.members["trackIdentifier"] as? String
                                levels[trackId ?: continue] = level
                            }
                            "media-source" -> {
                                (stat.members["audioLevel"] as? Number)?.let { local = it.toDouble() }
                            }
                        }
                    }
                    _state.update { call ->
                        val peers = call.peers.mapValues { (userId, peer) ->
                            val id = remoteAudio[userId]?.id()
                            val level = id?.let { levels[it] } ?: 0.0
                            peer.copy(speaking = level > 0.02)
                        }
                        call.copy(
                            peers = peers,
                            speaking = !call.muted && local > 0.02,
                            crypto = transport?.cryptoStats() ?: call.crypto,
                        )
                    }
                }
            }
        }
    }
}

/** The ICE servers chatd hands out, as WebRTC wants them. */
private fun xyz.evilion.chat.net.IceServer.toWebRtc(): PeerConnection.IceServer? {
    val element = urls ?: return null
    val list = when {
        element is kotlinx.serialization.json.JsonArray -> element.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
        element is kotlinx.serialization.json.JsonPrimitive -> listOf(element.content)
        else -> emptyList()
    }
    if (list.isEmpty()) return null
    return PeerConnection.IceServer.builder(list)
        .setUsername(username.orEmpty())
        .setPassword(credential.orEmpty())
        .createIceServer()
}
