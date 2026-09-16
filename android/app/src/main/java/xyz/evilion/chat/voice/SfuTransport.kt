package xyz.evilion.chat.voice

import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.IceServer
import xyz.evilion.chat.net.SfuCloseRequest
import xyz.evilion.chat.net.SfuDescription
import xyz.evilion.chat.net.SfuPublishRequest
import xyz.evilion.chat.net.SfuRenegotiateRequest
import xyz.evilion.chat.net.SfuSubscribeRequest
import xyz.evilion.chat.net.SfuSubscribeTrack
import xyz.evilion.chat.net.SfuTrackRequest
import xyz.evilion.chat.net.VoiceApi
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** What this device publishes, and what it pulls of everyone else. */
enum class PubKind(val wire: String, val video: Boolean) {
    AUDIO("audio", false),
    VIDEO("video", true),
    SCREEN("screen", true),
    SCREEN_AUDIO("screen_audio", false);

    companion object {
        fun of(wire: String): PubKind? = entries.firstOrNull { it.wire == wire }
    }
}

/** A track pulled from someone else. */
data class Pulled(
    val userId: String,
    val kind: PubKind,
    val tag: String,
    val mid: String,
    var track: MediaStreamTrack? = null,
    var decryptor: NativeFrameDecryptor? = null,
)

/**
 * A call through Cloudflare's SFU: one peer connection for everything.
 *
 * This device publishes its microphone (and camera or screen) there and pulls
 * what it needs of everyone else's, through chatd, which decides who may pull
 * what. Every frame is sealed with the conversation's key on the way out and
 * opened on the way in, so Cloudflare forwards media it cannot read and nobody
 * in the call learns anyone else's address.
 */
class SfuTransport(
    private val scope: CoroutineScope,
    private val myId: String,
    var channelId: String,
    private val iceServers: List<PeerConnection.IceServer>,
    private val onRemoteTrack: (String, PubKind, MediaStreamTrack?) -> Unit,
    private val onState: (PeerConnection.PeerConnectionState) -> Unit,
    private val onError: (String) -> Unit,
) {
    private companion object {
        const val TAG = "SfuTransport"
        const val CAMERA_BPS = 1_500_000
    }

    private val lock = Mutex()
    private var pc: PeerConnection? = null
    private var sessionId: String? = null
    private var keysHandle: Long = 0
    private var keyVersion: String? = null
    private val senders = mutableMapOf<PubKind, RtpTransceiver>()
    private val encryptors = mutableMapOf<PubKind, NativeFrameEncryptor>()
    private val published = mutableSetOf<PubKind>()
    private val pulled = mutableMapOf<String, Pulled>()
    private val byMid = mutableMapOf<String, Pulled>()
    private var closed = false
    private var keyTimer: Job? = null

    private fun slot(userId: String, kind: PubKind) = "$userId:${kind.wire}"

    /** Gets the keys and the connection ready; the session waits for the server. */
    suspend fun start() {
        keysHandle = FrameCryptoNative.nativeCreateKeys()
        refreshKeys()
        keyTimer = scope.launch {
            while (true) {
                delay(4000)
                refreshKeys()
            }
        }
        lock.withLock { pc = newConnection() }
    }

    /**
     * Opens the SFU session and publishes. The server only hands out a session
     * to someone it has already seen join the call over the gateway, so this
     * waits for that acknowledgement.
     */
    suspend fun openSession(audio: MediaStreamTrack?) {
        lock.withLock {
            if (sessionId != null || closed) return@withLock
            sessionId = VoiceApi.sfuSession().sessionId
        }
        audio?.let { setLocalTrack(PubKind.AUDIO, it) }
    }

    fun hasSession(): Boolean = sessionId != null

    /** The call keys this device holds, refreshed as epochs rotate. */
    private fun refreshKeys() {
        val keys = KeyService.voiceKeys(channelId)
        val version = keys?.third ?: "none:$channelId"
        if (version == keyVersion) return
        keyVersion = version
        val list = keys?.first.orEmpty()
        FrameCryptoNative.nativeSetKeys(
            keysHandle,
            list.map { it.first }.toIntArray(),
            list.map { it.second }.toTypedArray(),
            keys?.second ?: -1,
        )
    }

    private fun newConnection(): PeerConnection {
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        return requireNotNull(
            VoiceEngine.factory.createPeerConnection(config, object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
                override fun onIceCandidate(candidate: IceCandidate?) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
                override fun onAddStream(stream: MediaStream?) = Unit
                override fun onRemoveStream(stream: MediaStream?) = Unit
                override fun onDataChannel(channel: DataChannel?) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    onState(state)
                    if (state == PeerConnection.PeerConnectionState.FAILED) {
                        scope.launch { runCatching { rebuild() } }
                    }
                }

                override fun onTrack(transceiver: RtpTransceiver?) {
                    val mid = transceiver?.mid ?: return
                    val receiver = transceiver.receiver
                    // Every receiver is given its decryptor at once: what arrives
                    // without one is sealed, and would be played as noise.
                    val decryptor = NativeFrameDecryptor(keysHandle)
                    receiver.setFrameDecryptor(decryptor)
                    val entry = byMid[mid]
                    if (entry == null) {
                        decryptor.release()
                        return
                    }
                    entry.decryptor = decryptor
                    entry.track = receiver.track()
                    onRemoteTrack(entry.userId, entry.kind, entry.track)
                }

                override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
            }),
        ) { "the call connection could not be made" }
    }

    // --- publishing --------------------------------------------------------

    /** Publishes a kind, or swaps the track of one already published. */
    suspend fun setLocalTrack(kind: PubKind, track: MediaStreamTrack?) {
        lock.withLock {
            val existing = senders[kind]
            if (existing != null) {
                existing.sender.setTrack(track, false)
                return@withLock
            }
            if (track == null) return@withLock
            val connection = pc ?: return@withLock
            val transceiver = connection.addTransceiver(
                track,
                RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY),
            )
            if (kind.video) preferVp8(transceiver)
            val encryptor = NativeFrameEncryptor(keysHandle)
            transceiver.sender.setFrameEncryptor(encryptor)
            encryptors[kind] = encryptor
            senders[kind] = transceiver
            if (kind == PubKind.VIDEO) capBitrate(transceiver, CAMERA_BPS)
            publishPending()
        }
    }

    /** Stops publishing a kind. */
    suspend fun removeLocalTrack(kind: PubKind) {
        lock.withLock {
            val transceiver = senders.remove(kind) ?: return@withLock
            val mid = transceiver.mid
            transceiver.sender.setTrack(null, false)
            runCatching { transceiver.stop() }
            encryptors.remove(kind)?.release()
            published.remove(kind)
            val session = sessionId ?: return@withLock
            val connection = pc ?: return@withLock
            if (mid != null) {
                val offer = createOffer(connection)
                connection.setLocal(offer)
                val reply = VoiceApi.sfuClose(SfuCloseRequest(session, listOf(mid), SfuDescription("offer", offer.description)))
                reply.answer?.let { connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, it.sdp)) }
            }
        }
    }

    /** Offers everything added but not yet published, in one exchange. */
    private suspend fun publishPending() {
        val connection = pc ?: return
        val session = sessionId ?: return
        val fresh = senders.keys.filterNot { it in published }
        if (fresh.isEmpty()) return
        val offer = createOffer(connection)
        connection.setLocal(offer)
        val reply = VoiceApi.sfuPublish(
            SfuPublishRequest(
                sessionId = session,
                offer = SfuDescription("offer", offer.description),
                tracks = fresh.mapNotNull { kind ->
                    senders[kind]?.mid?.let { SfuTrackRequest(it, kind.wire) }
                },
            ),
        )
        val answer = reply.answer ?: throw IllegalStateException("no answer to the offer")
        connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
        published += fresh
        if (reply.failed > 0) Log.w(TAG, "the call service refused ${reply.failed} track(s)")
    }

    // --- pulling -----------------------------------------------------------

    /** Brings what is pulled in line with who is publishing what. */
    suspend fun sync(states: List<xyz.evilion.chat.net.VoiceState>) {
        lock.withLock {
            val connection = pc ?: return@withLock
            val session = sessionId ?: return@withLock
            val want = mutableMapOf<String, Pair<String, PubKind>>()
            for (state in states) {
                if (state.userId == myId || state.channelId != channelId) continue
                for ((wire, tag) in state.media.orEmpty()) {
                    val kind = PubKind.of(wire) ?: continue
                    // a camera nobody is watching is not pulled: it costs the sender nothing to publish
                    if (kind == PubKind.VIDEO && !VoiceSession.watching(state.userId)) continue
                    want[slot(state.userId, kind)] = tag to kind
                }
            }

            val drop = pulled.filter { (key, p) -> want[key]?.first != p.tag }.values.toList()
            if (drop.isNotEmpty()) {
                for (p in drop) {
                    pulled.remove(slot(p.userId, p.kind))
                    byMid.remove(p.mid)
                    p.decryptor?.release()
                    onRemoteTrack(p.userId, p.kind, null)
                    connection.transceivers.firstOrNull { it.mid == p.mid }?.let { runCatching { it.stop() } }
                }
                val offer = createOffer(connection)
                connection.setLocal(offer)
                val reply = VoiceApi.sfuClose(
                    SfuCloseRequest(session, drop.map { it.mid }, SfuDescription("offer", offer.description)),
                )
                reply.answer?.let { connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, it.sdp)) }
            }

            val add = want.filterKeys { it !in pulled }
            if (add.isEmpty()) return@withLock
            val reply = try {
                VoiceApi.sfuSubscribe(
                    SfuSubscribeRequest(
                        sessionId = session,
                        tracks = add.map { (key, value) -> SfuSubscribeTrack(key.substringBefore(':'), value.second.wire) },
                    ),
                )
            } catch (e: ApiException) {
                if (e.code == "sfu_session_gone" || e.code == "not_in_voice") throw e
                Log.w(TAG, "could not pull tracks: ${e.message}")
                return@withLock
            }
            for (track in reply.tracks) {
                val kind = PubKind.of(track.kind) ?: continue
                val mid = track.mid ?: continue
                if (track.error != null) {
                    if (track.error == "video_paused") onError("Video is paused on this server for now.")
                    continue
                }
                val entry = Pulled(track.userId, kind, track.tag.orEmpty(), mid)
                pulled[slot(track.userId, kind)] = entry
                byMid[mid] = entry
            }
            val offer = reply.offer
            if (offer != null) {
                connection.setRemote(SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
                val answer = createAnswer(connection)
                connection.setLocal(answer)
                VoiceApi.sfuRenegotiate(SfuRenegotiateRequest(session, SfuDescription("answer", answer.description)))
            }
        }
    }

    /** Makes the whole connection again after it failed. */
    private suspend fun rebuild() {
        lock.withLock {
            if (closed) return@withLock
            for (encryptor in encryptors.values) encryptor.release()
            encryptors.clear()
            for (p in pulled.values) p.decryptor?.release()
            pulled.clear()
            byMid.clear()
            senders.clear()
            published.clear()
            pc?.dispose()
            pc = newConnection()
            sessionId = runCatching { VoiceApi.sfuSession().sessionId }.getOrNull()
        }
        VoiceSession.republishAfterRebuild()
    }

    suspend fun close() {
        lock.withLock {
            closed = true
            keyTimer?.cancel()
            for (encryptor in encryptors.values) encryptor.release()
            encryptors.clear()
            for (p in pulled.values) p.decryptor?.release()
            pulled.clear()
            byMid.clear()
            senders.clear()
            published.clear()
            pc?.dispose()
            pc = null
            sessionId = null
            if (keysHandle != 0L) {
                FrameCryptoNative.nativeReleaseKeys(keysHandle)
                keysHandle = 0
            }
        }
    }

    /** [sealed, opened, dropped] since this call started. */
    fun cryptoStats(): LongArray =
        if (keysHandle != 0L) FrameCryptoNative.nativeStats(keysHandle) else longArrayOf(0, 0, 0)

    fun connection(): PeerConnection? = pc

    // --- sdp helpers -------------------------------------------------------

    private suspend fun createOffer(connection: PeerConnection): SessionDescription = suspendCoroutine { cont ->
        connection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
            override fun onCreateFailure(error: String?) = cont.resumeWith(Result.failure(IllegalStateException(error)))
            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private suspend fun createAnswer(connection: PeerConnection): SessionDescription = suspendCoroutine { cont ->
        connection.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
            override fun onCreateFailure(error: String?) = cont.resumeWith(Result.failure(IllegalStateException(error)))
            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private suspend fun PeerConnection.setLocal(sdp: SessionDescription) = suspendCoroutine { cont ->
        setLocalDescription(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) = Unit
            override fun onCreateFailure(error: String?) = Unit
            override fun onSetSuccess() = cont.resume(Unit)
            override fun onSetFailure(error: String?) = cont.resumeWith(Result.failure(IllegalStateException(error)))
        }, sdp)
    }

    private suspend fun PeerConnection.setRemote(sdp: SessionDescription) = suspendCoroutine { cont ->
        setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) = Unit
            override fun onCreateFailure(error: String?) = Unit
            override fun onSetSuccess() = cont.resume(Unit)
            override fun onSetFailure(error: String?) = cont.resumeWith(Result.failure(IllegalStateException(error)))
        }, sdp)
    }

    /**
     * VP8 only for video: the frame encryption keeps that payload header
     * readable, which H.264's differs from, and the web client sends the same.
     */
    private fun preferVp8(transceiver: RtpTransceiver) {
        val capabilities = VoiceEngine.factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)
        val codecs = capabilities.codecs.filter {
            it.name.equals("VP8", true) || it.name.equals("rtx", true)
        }
        if (codecs.any { it.name.equals("VP8", true) }) runCatching { transceiver.setCodecPreferences(codecs) }
    }

    private fun capBitrate(transceiver: RtpTransceiver, bps: Int) {
        val sender = transceiver.sender
        val parameters = sender.parameters ?: return
        for (encoding in parameters.encodings) encoding.maxBitrateBps = bps
        sender.parameters = parameters
    }
}
