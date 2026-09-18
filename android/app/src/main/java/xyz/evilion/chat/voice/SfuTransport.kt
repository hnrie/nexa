package xyz.evilion.chat.voice

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.RTCStatsReport
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.SfuCloseRequest
import xyz.evilion.chat.net.SfuDescription
import xyz.evilion.chat.net.SfuPublishRequest
import xyz.evilion.chat.net.SfuRenegotiateRequest
import xyz.evilion.chat.net.SfuRestartRequest
import xyz.evilion.chat.net.SfuSubscribeRequest
import xyz.evilion.chat.net.SfuSubscribeTrack
import xyz.evilion.chat.net.SfuTrackRequest
import xyz.evilion.chat.net.VoiceApi
import java.util.concurrent.ConcurrentHashMap
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
class Pulled(
    val userId: String,
    val kind: PubKind,
    /** The tag the SFU says this track has. */
    val tag: String,
    /**
     * And the tag that was asked for.
     *
     * The server fills the first from its own live voice state, which is often
     * newer than the roster this device holds. Comparing only against the
     * roster made every `sync` decide the track was stale, drop it, pull it
     * again, get the same newer tag back and drop it again — audio cutting out
     * on every cycle. Either tag matching means the track is the wanted one.
     */
    val asked: String,
    val mid: String,
    @Volatile var track: MediaStreamTrack? = null,
    @Volatile var decryptor: NativeFrameDecryptor? = null,
    /**
     * The receiving transceiver, as `onTrack` handed it over. Kept so the pull
     * can be stopped without asking the connection for its transceivers — see
     * [SfuTransport] on why that is never done.
     */
    @Volatile var transceiver: RtpTransceiver? = null,
)

/** Something this device wants to pull. */
private class Want(val userId: String, val kind: PubKind, val tag: String)

/**
 * A call through Cloudflare's SFU: one peer connection for everything.
 *
 * This device publishes its microphone (and camera or screen) there and pulls
 * what it needs of everyone else's, through chatd, which decides who may pull
 * what. Every frame is sealed with the conversation's key on the way out and
 * opened on the way in, so Cloudflare forwards media it cannot read and nobody
 * in the call learns anyone else's address.
 *
 * Two rules keep this class alive on a real phone. One: every native object
 * this owns — the connection, the keys, the frame encryptors — is touched only
 * while the thing that could free it is held off, because WebRTC calls back on
 * its own threads and a disposed native object used from Kotlin takes the
 * process down with no stack to read. Two: a connection that goes down is
 * recovered rather than rebuilt where it can be, since a Wi-Fi-to-mobile
 * handover is the ordinary case a phone call has to survive.
 *
 * Three: nothing here ever asks the connection for its `transceivers` (nor
 * its senders or receivers). libwebrtc's Java wrapper disposes every
 * transceiver it handed out before it lists them again — including the ones
 * `addTransceiver` returned, which is what [senders] holds. One such call, made
 * to set codec preferences after the first pull, killed the microphone's
 * sender: every restart after that threw "RtpTransceiver has been disposed"
 * reading its mid, and a call that lost the network never came back.
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

        /**
         * How long a dropped connection gets before ICE is restarted, and how
         * often restarts are tried while it stays down. A blip comes back by
         * itself well within the first; a changed network needs the restart.
         */
        const val RECOVER_AFTER_MS = 3_000L
        const val RESTART_EVERY_MS = 8_000L

        /** Restarts that were answered and still never reconnected, before the connection is made again. */
        const val MAX_ICE_RESTARTS = 4

        /**
         * Cloudflare lets go of tracks after 30 s without their media. A
         * connection down this long comes back to tracks that are gone, so
         * everything is pulled again rather than sat in silence.
         */
        const val TRACKS_GONE_MS = 20_000L

        /**
         * A pull the SFU could not serve yet waits this long first. Cloudflare
         * refuses a track whose publisher is still connecting, which is what
         * someone who joined a moment ago looks like — and without the retry
         * two people who tap Join together sit in a silent call for ever.
         */
        const val PULL_RETRY_BASE_MS = 400L
        const val PULL_RETRY_MAX_MS = 1_600L

        /** A new session after a rebuild: the blip that broke the connection often breaks this too. */
        const val SESSION_RETRY_BASE_MS = 700L
        const val SESSION_RETRY_MAX_MS = 5_000L
        const val MAX_SESSION_TRIES = 5

        /** How long the connection may take to hand over a stats report before the tick gives up. */
        const val STATS_TIMEOUT_MS = 2_000L

        /** Server answers that mean this call has to start again rather than carry on. */
        fun fatal(e: Throwable): Boolean =
            e is ApiException && (e.code == "sfu_session_gone" || e.code == "not_in_voice")
    }

    private val lock = Mutex()

    /**
     * Guards the keys handle on its own.
     *
     * The rotation timer, the stats readout and the teardown all reach for it,
     * from three different threads, and the teardown `delete`s what the other
     * two are about to dereference. It cannot be the call's [lock]: two of
     * those three are not in a coroutine.
     */
    private val keyGuard = Any()

    private var pc: PeerConnection? = null
    @Volatile private var sessionId: String? = null
    private var keysHandle: Long = 0
    private var keyVersion: String? = null
    private val senders = mutableMapOf<PubKind, RtpTransceiver>()
    private val encryptors = mutableMapOf<PubKind, NativeFrameEncryptor>()
    private val published = mutableSetOf<PubKind>()

    /**
     * What is pulled, and what arrived on which m-line.
     *
     * `onTrack` reads and writes these from WebRTC's signalling thread while
     * `sync` is writing them from a coroutine. As plain maps that was a lost
     * entry (a track playing as noise for want of its decryptor), an infinite
     * loop pinning a WebRTC thread, or a ConcurrentModificationException
     * thrown where nothing catches it.
     */
    private val pulled = ConcurrentHashMap<String, Pulled>()
    private val byMid = ConcurrentHashMap<String, Pulled>()

    @Volatile private var closed = false
    private var keyTimer: Job? = null

    /**
     * Which connection is current.
     *
     * A disposed connection's observer can still be called once on the way
     * out; its callbacks carry the generation they were made with, so a dead
     * one cannot report a state or start a recovery for the live call.
     */
    @Volatile private var generation = 0

    private var recoverJob: Job? = null
    private var rebuildJob: Job? = null

    /**
     * The ICE username of a restart that has not produced a path yet.
     *
     * An answered restart is not a working one. Moving back onto Wi-Fi while
     * mobile data was still up, the old session's path stayed "connected" on
     * the phone's side, so WebRTC never moved to the new session — and
     * Cloudflare, which had let the old one go, sent nothing down it. The state
     * never changed and the call stayed silent. A path chosen on the new
     * username is the proof a restart took; without one it is tried again, and
     * then the connection is made from nothing.
     */
    @Volatile private var pendingUfrag: String? = null
    private var iceRestarts = 0
    private var downSince: Long? = null
    private var wasUp = false
    private var pullRetryJob: Job? = null
    private var pullRetries = 0

    private fun slot(userId: String, kind: PubKind) = "$userId:${kind.wire}"

    /** The ICE username a local candidate was gathered under, which a restart changes. */
    private fun ufragOf(candidate: IceCandidate?): String? =
        candidate?.sdp?.let { Regex(" ufrag (\\S+)").find(it)?.groupValues?.get(1) }

    /** "relay/cellular" and the like, from a candidate: its type and network, not its address. */
    private fun pathOf(candidate: IceCandidate?): String {
        val sdp = candidate?.sdp ?: return "?"
        val type = Regex(" typ (\\w+)").find(sdp)?.groupValues?.get(1) ?: "?"
        val network = candidate.adapterType?.name?.lowercase()?.removePrefix("adapter_type_") ?: "?"
        return "$type/$network"
    }

    /** Gets the keys and the connection ready; the session waits for the server. */
    suspend fun start() {
        synchronized(keyGuard) { keysHandle = FrameCryptoNative.nativeCreateKeys() }
        refreshKeys()
        keyTimer = scope.launch {
            while (isActive) {
                delay(4000)
                runCatching { refreshKeys() }
                    .onFailure { Log.w(TAG, "could not refresh the call keys", it) }
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
            // a rebuild opens its own session and publishes again: two at once
            // left the server holding one session and this device the other
            if (closed || rebuildJob?.isActive == true) return
            if (sessionId == null) sessionId = VoiceApi.sfuSession().sessionId
        }
        // published even when the session was already there: a session whose
        // first publish failed is exactly the one nobody can hear
        audio?.let { setLocalTrack(PubKind.AUDIO, it) }
    }

    fun hasSession(): Boolean = sessionId != null

    /** The SFU session this device holds, for resuming the call on a new gateway connection. */
    fun currentSession(): String? = sessionId

    /** The network looks back (the gateway reconnected): a connection still down tries again now. */
    fun nudge() {
        scope.launch {
            val down = lock.withLock {
                val state = if (closed) null else pc?.connectionState()
                state == PeerConnection.PeerConnectionState.DISCONNECTED ||
                    state == PeerConnection.PeerConnectionState.FAILED
            }
            if (!down || rebuildJob?.isActive == true) return@launch
            recoverJob?.cancel()
            recoverJob = null
            scheduleRecover(0)
        }
    }

    /**
     * Whether a kind is actually published.
     *
     * A session is not a microphone: the session used to be created first and
     * the publish that follows could fail on its own, after which `hasSession`
     * said yes for ever and nobody could hear this device again for the rest
     * of the call.
     */
    fun isPublishing(kind: PubKind): Boolean = kind in published

    // --- keys ---------------------------------------------------------------

    /** The call keys this device holds, refreshed as epochs rotate. */
    private fun refreshKeys() = synchronized(keyGuard) {
        val handle = keysHandle
        if (handle == 0L) return@synchronized
        val keys = KeyService.voiceKeys(channelId)
        val version = keys?.third ?: "none:$channelId"
        if (version == keyVersion) return@synchronized
        keyVersion = version
        val list = keys?.first.orEmpty()
        FrameCryptoNative.nativeSetKeys(
            handle,
            list.map { it.first }.toIntArray(),
            list.map { it.second }.toTypedArray(),
            keys?.second ?: -1,
        )
    }

    /** [sealed, opened, dropped] since this call started. */
    fun cryptoStats(): LongArray = synchronized(keyGuard) {
        if (keysHandle != 0L) FrameCryptoNative.nativeStats(keysHandle) else longArrayOf(0, 0, 0)
    }

    private fun newEncryptor(): NativeFrameEncryptor? = synchronized(keyGuard) {
        if (keysHandle == 0L) null else NativeFrameEncryptor(keysHandle)
    }

    private fun newDecryptor(): NativeFrameDecryptor? = synchronized(keyGuard) {
        if (keysHandle == 0L) null else NativeFrameDecryptor(keysHandle)
    }

    private fun releaseKeys() = synchronized(keyGuard) {
        if (keysHandle != 0L) {
            FrameCryptoNative.nativeReleaseKeys(keysHandle)
            keysHandle = 0
        }
    }

    // --- the connection -----------------------------------------------------

    private fun newConnection(): PeerConnection {
        val mine = ++generation
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // Once, not continually. Gathering on every network that comes up
            // let WebRTC move a live call onto Wi-Fi by itself the moment it
            // appeared, while mobile data was still up: the connection went on
            // saying "connected", Cloudflare never followed, and the call was
            // silent both ways — an ICE restart on top did not bring it back.
            // Gathered once, the call stays on the network it has until that
            // one goes (Android lets mobile data go 30 s after Wi-Fi returns),
            // the connection drops, and the restart below finds the new one:
            // the one sequence that was measured to come back every time.
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
        }
        return requireNotNull(
            VoiceEngine.factory.createPeerConnection(config, object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                    if (mine == generation && !closed) Log.i(TAG, "ice $state")
                }

                // Which network the call is on and why it moved: the question
                // behind every "the call went silent when I walked in the
                // door". Types only, never addresses.
                override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) {
                    if (mine != generation || closed || event == null) return
                    Log.i(TAG, "path now ${pathOf(event.local)} to ${pathOf(event.remote)} (${event.reason})")
                    val ufrag = ufragOf(event.local)
                    if (pendingUfrag != null && (ufrag == null || ufrag == pendingUfrag)) {
                        Log.i(TAG, "the restarted session has a path")
                        pendingUfrag = null
                    }
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
                override fun onIceCandidate(candidate: IceCandidate?) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
                override fun onAddStream(stream: MediaStream?) = Unit
                override fun onRemoveStream(stream: MediaStream?) = Unit
                override fun onDataChannel(channel: DataChannel?) = Unit
                override fun onRenegotiationNeeded() = Unit

                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    if (mine != generation || closed) return
                    Log.i(TAG, "connection $state")
                    onState(state)
                    onConnectionState(state)
                }

                override fun onTrack(transceiver: RtpTransceiver?) {
                    // WebRTC's signalling thread: anything thrown here has
                    // nowhere to go but the process's uncaught handler.
                    runCatching { attachTrack(mine, transceiver) }
                        .onFailure { Log.w(TAG, "could not take a pulled track", it) }
                }

                override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
            }),
        ) { "the call connection could not be made" }
    }

    /**
     * A pulled track arriving, on WebRTC's signalling thread.
     *
     * Every receiver is given its decryptor at once: what arrives without one
     * is sealed, and would be played as noise.
     */
    private fun attachTrack(generationSeen: Int, transceiver: RtpTransceiver?) {
        if (generationSeen != generation || closed) return
        val mid = transceiver?.mid ?: return
        val receiver = transceiver.receiver
        val decryptor = newDecryptor() ?: return
        receiver.setFrameDecryptor(decryptor)
        val entry = byMid[mid]
        if (entry == null) {
            decryptor.release()
            return
        }
        // One track per entry: a second arrival on the same m-line replaces
        // the first, and the decryptor it had is let go rather than leaked.
        val previous = synchronized(entry) {
            val old = entry.decryptor
            entry.decryptor = decryptor
            entry.track = receiver.track()
            entry.transceiver = transceiver
            old
        }
        previous?.release()
        // Here rather than after the offer is applied: onTrack runs inside
        // setRemoteDescription, before the answer is made, and this is the one
        // place the receiving transceiver can be had without listing them.
        if (entry.kind.video) preferVp8OnReceive(transceiver)
        onRemoteTrack(entry.userId, entry.kind, entry.track)
    }

    /**
     * What a change of connection state means for the call.
     *
     * Runs on WebRTC's signalling thread, so it only ever schedules work.
     */
    private fun onConnectionState(state: PeerConnection.PeerConnectionState) {
        val now = System.currentTimeMillis()
        when (state) {
            PeerConnection.PeerConnectionState.CONNECTED -> {
                recoverJob?.cancel()
                recoverJob = null
                iceRestarts = 0
                val downFor = downSince?.let { now - it } ?: 0
                downSince = null
                wasUp = true
                // Long enough down that the SFU will have let go of the
                // tracks: they are asked for again rather than waited on.
                if (downFor >= TRACKS_GONE_MS) VoiceSession.refreshTracks()
            }

            PeerConnection.PeerConnectionState.DISCONNECTED,
            PeerConnection.PeerConnectionState.FAILED,
            -> {
                if (wasUp && downSince == null) downSince = now
                scheduleRecover(if (state == PeerConnection.PeerConnectionState.FAILED) 0 else RECOVER_AFTER_MS)
            }

            else -> Unit
        }
    }

    /** What one pass of [recover] found. */
    private enum class Recovery { UP, AGAIN, REMAKE }

    /**
     * Brings a dropped connection back, trying until it is up or the call ends.
     *
     * One job for the whole outage. It used to schedule its next try from
     * inside itself, which the "already running" check here refused, so a
     * restart that failed because the network was still down was the last one
     * ever tried, and the call sat connected on screen and silent for good.
     */
    private fun scheduleRecover(wait: Long) {
        if (closed || recoverJob?.isActive == true) return
        recoverJob = scope.launch {
            delay(wait)
            while (isActive && !closed) {
                val step = try {
                    recover()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Log.w(TAG, "could not restart the connection; making it again", e)
                    Recovery.REMAKE
                }
                when (step) {
                    Recovery.UP -> return@launch
                    Recovery.AGAIN -> delay(RESTART_EVERY_MS)
                    Recovery.REMAKE -> {
                        startRebuild()
                        return@launch
                    }
                }
            }
        }
    }

    /**
     * One try at bringing the connection back: restart ICE, keeping the
     * session, its tracks and everyone's pulls, while the connection stays open
     * to come back by itself. Only restarts that were answered and still did
     * not reconnect, or a session the SFU no longer has, make it again from
     * nothing — which costs a new session and every peer re-pulling.
     */
    private suspend fun recover(): Recovery = lock.withLock {
        if (closed) return@withLock Recovery.UP
        val connection = pc ?: return@withLock Recovery.UP
        val state = connection.connectionState()
        val down = state == PeerConnection.PeerConnectionState.DISCONNECTED ||
            state == PeerConnection.PeerConnectionState.FAILED
        // answered, and still no path on it after a whole wait
        val stuck = pendingUfrag != null
        if (!down && !stuck) {
            iceRestarts = 0
            return@withLock Recovery.UP
        }
        if (stuck && iceRestarts >= 2) {
            Log.i(TAG, "restarts were answered but none took; making the connection again")
            return@withLock Recovery.REMAKE
        }
        val session = sessionId
        // a sender libwebrtc has disposed reads as no anchor, which remakes the
        // connection, rather than as an exception that ends the recovery
        val anchor = PubKind.entries.firstNotNullOfOrNull { kind ->
            if (kind !in published) null
            else runCatching { senders[kind]?.mid }.getOrNull()?.let { kind to it }
        }
        if (iceRestarts >= MAX_ICE_RESTARTS || session == null || anchor == null) {
            Log.i(TAG, "remaking the connection (restarts $iceRestarts, session ${session != null}, anchor ${anchor != null})")
            return@withLock Recovery.REMAKE
        }
        try {
            Log.i(TAG, "restarting ICE ($state, ${iceRestarts} answered so far)")
            connection.restartIce()
            val offer = createOffer(connection, iceRestart = true)
            connection.setLocal(offer)
            // before the answer: a path on the new username can be chosen the
            // moment it is applied, before this coroutine runs again
            pendingUfrag = Regex("a=ice-ufrag:(\\S+)").find(offer.description)?.groupValues?.get(1)
            val reply = VoiceApi.sfuRestart(
                SfuRestartRequest(
                    sessionId = session,
                    offer = SfuDescription("offer", offer.description),
                    mid = anchor.second,
                    kind = anchor.first.wire,
                ),
            )
            val answer = reply.answer ?: throw IllegalStateException("no answer to the ICE restart")
            connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
            iceRestarts++
            Log.i(TAG, "ICE restart answered")
            Recovery.AGAIN
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            pendingUfrag = null
            rollback(connection)
            // A session the SFU let go of cannot come back; anything else is
            // the network still being down, and waits for the next try.
            if (fatal(e)) {
                Recovery.REMAKE
            } else {
                Log.w(TAG, "the ICE restart did not go through", e)
                Recovery.AGAIN
            }
        }
    }

    // --- publishing --------------------------------------------------------

    /** Publishes a kind, or swaps the track of one already published. */
    suspend fun setLocalTrack(kind: PubKind, track: MediaStreamTrack?) {
        lock.withLock {
            if (closed) return@withLock
            val existing = senders[kind]
            if (existing != null) {
                // Turned off, the sender stays published and sends nothing:
                // the m-line is reused, the peers keep their subscription, and
                // turning it back on costs no exchange at all.
                runCatching { existing.sender.setTrack(track, false) }
                    .onFailure { Log.w(TAG, "could not swap the ${kind.wire} track", it) }
                return@withLock
            }
            if (track == null) return@withLock
            val connection = pc ?: return@withLock
            val transceiver = connection.addTransceiver(
                track,
                RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY),
            )
            if (kind.video) preferVp8(transceiver)
            val encryptor = newEncryptor()
            if (encryptor == null) {
                runCatching { transceiver.stop() }
                throw IllegalStateException(t("voiceSession.thisBuildCannotEncryptCalls"))
            }
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
            if (closed) return@withLock
            val transceiver = senders.remove(kind) ?: return@withLock
            val mid = transceiver.mid
            runCatching { transceiver.sender.setTrack(null, false) }
            runCatching { transceiver.stop() }
            encryptors.remove(kind)?.release()
            published.remove(kind)
            val session = sessionId ?: return@withLock
            val connection = pc ?: return@withLock
            if (mid == null) return@withLock
            try {
                val offer = createOffer(connection)
                connection.setLocal(offer)
                val reply = VoiceApi.sfuClose(
                    SfuCloseRequest(session, listOf(mid), SfuDescription("offer", offer.description)),
                )
                val answer = reply.answer ?: throw IllegalStateException("no answer to closing tracks")
                connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
            } catch (e: Throwable) {
                // The offer is taken back rather than left applied: a
                // connection stuck in have-local-offer can never publish or
                // pull anything again, which is a call frozen until it is hung
                // up on.
                rollback(connection)
                throw e
            }
        }
    }

    /** Offers everything added but not yet published, in one exchange. */
    private suspend fun publishPending() {
        val connection = pc ?: return
        val session = sessionId ?: return
        val fresh = senders.keys.filterNot { it in published }.toList()
        if (fresh.isEmpty()) return
        try {
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
        } catch (e: Throwable) {
            rollback(connection)
            // And the transceivers the attempt added, so the next exchange
            // starts from what is really published rather than from a half
            // offer nobody answered.
            for (kind in fresh) {
                senders.remove(kind)?.let { runCatching { it.stop() } }
                encryptors.remove(kind)?.release()
            }
            throw e
        }
    }

    // --- pulling -----------------------------------------------------------

    /**
     * What should be pulled now: everyone's voice and camera — a camera that
     * is off sends nothing and costs nothing, and turning it on shows without
     * another exchange — and the shares being watched, which are the expensive
     * ones the server meters.
     */
    private fun wanted(states: List<xyz.evilion.chat.net.VoiceState>): Map<String, Want> {
        val out = mutableMapOf<String, Want>()
        for (state in states) {
            if (state.userId == myId || state.channelId != channelId) continue
            val media = state.media.orEmpty()
            fun add(kind: PubKind) {
                val tag = media[kind.wire]
                if (!tag.isNullOrEmpty()) out[slot(state.userId, kind)] = Want(state.userId, kind, tag)
            }
            add(PubKind.AUDIO)
            add(PubKind.VIDEO)
            if (state.streaming && VoiceSession.watching(state.userId)) {
                add(PubKind.SCREEN)
                add(PubKind.SCREEN_AUDIO)
            }
        }
        return out
    }

    /** Brings what is pulled in line with who is publishing what. */
    suspend fun sync(states: List<xyz.evilion.chat.net.VoiceState>) {
        lock.withLock {
            if (closed) return@withLock
            val connection = pc ?: return@withLock
            val session = sessionId ?: return@withLock
            val want = wanted(states)

            val drop = pulled.values.filter { p ->
                val w = want[slot(p.userId, p.kind)]
                w == null || (w.tag != p.tag && w.tag != p.asked)
            }
            if (drop.isNotEmpty()) unsubscribe(connection, session, drop)

            val add = want.filterKeys { !pulled.containsKey(it) }.values.toList()
            if (add.isEmpty()) return@withLock
            subscribe(connection, session, add)
        }
    }

    private suspend fun unsubscribe(connection: PeerConnection, session: String, drop: List<Pulled>) {
        for (p in drop) {
            if (pulled[slot(p.userId, p.kind)] === p) pulled.remove(slot(p.userId, p.kind))
            if (byMid[p.mid] === p) byMid.remove(p.mid)
            val (held, receiving) = synchronized(p) {
                val old = p.decryptor to p.transceiver
                p.decryptor = null
                p.track = null
                p.transceiver = null
                old
            }
            held?.release()
            onRemoteTrack(p.userId, p.kind, null)
            receiving?.let { runCatching { it.stop() } }
        }
        try {
            val offer = createOffer(connection)
            connection.setLocal(offer)
            val reply = VoiceApi.sfuClose(
                SfuCloseRequest(session, drop.map { it.mid }, SfuDescription("offer", offer.description)),
            )
            val answer = reply.answer ?: throw IllegalStateException("no answer to closing tracks")
            connection.setRemote(SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
        } catch (e: Throwable) {
            rollback(connection)
            throw e
        }
    }

    private suspend fun subscribe(connection: PeerConnection, session: String, add: List<Want>) {
        val reply = try {
            VoiceApi.sfuSubscribe(
                SfuSubscribeRequest(
                    sessionId = session,
                    tracks = add.map { SfuSubscribeTrack(it.userId, it.kind.wire) },
                ),
            )
        } catch (e: ApiException) {
            if (fatal(e)) throw e
            Log.w(TAG, "could not pull tracks: ${e.message}")
            retryPullLater()
            return
        }
        val asked = add.associate { slot(it.userId, it.kind) to it.tag }
        var refused = false
        for (track in reply.tracks) {
            val kind = PubKind.of(track.kind) ?: continue
            if (track.error != null) {
                if (track.error == "video_paused") onError(t("sfu.videoIsPausedUntilNextMonth"))
                // not_in_call, not_published and Cloudflare's own
                // not_found_track_error all mean "not yet", never "never":
                // someone who joined a moment ago looks exactly like this.
                else refused = true
                continue
            }
            val mid = track.mid ?: continue
            val entry = Pulled(
                userId = track.userId,
                kind = kind,
                tag = track.tag.orEmpty(),
                asked = asked[slot(track.userId, kind)].orEmpty(),
                mid = mid,
            )
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
        if (refused) retryPullLater() else pullRetries = 0
    }

    private fun retryPullLater() {
        if (closed || pullRetryJob?.isActive == true) return
        val wait = (PULL_RETRY_BASE_MS shl pullRetries.coerceAtMost(3)).coerceAtMost(PULL_RETRY_MAX_MS)
        pullRetries = (pullRetries + 1).coerceAtMost(6)
        pullRetryJob = scope.launch {
            delay(wait)
            if (!closed) VoiceSession.refreshTracks()
        }
    }

    // --- rebuilding and closing ---------------------------------------------

    /**
     * Makes the whole connection again: a new session, the same media, the
     * same pulls. Everything the old connection owned is let go of first,
     * including everyone else's tracks, which the call is still holding.
     */
    suspend fun rebuild() {
        startRebuild().join()
    }

    /**
     * The rebuild, in a job of its own and only one at a time.
     *
     * Run inside the recovery job, it cancelled that job — itself — as its
     * first step, and died at the first suspension after tearing the old
     * connection down: a new connection with no session and nothing on it.
     */
    private fun startRebuild(): Job = synchronized(this) {
        rebuildJob?.takeIf { it.isActive } ?: scope.launch {
            try {
                remake()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "could not make the call connection again", e)
                onError(t("voiceSession.theCallLostItsConnectionAnd"))
            }
        }.also { rebuildJob = it }
    }

    private suspend fun remake() {
        lock.withLock {
            if (closed) return
            Log.i(TAG, "making the call connection again")
            recoverJob?.cancel()
            recoverJob = null
            pullRetryJob?.cancel()
            pullRetryJob = null
            iceRestarts = 0
            pullRetries = 0
            downSince = null
            wasUp = false
            releaseConnection()
            pendingUfrag = null
            pc = newConnection()
            sessionId = null
        }
        if (closed) return
        if (openSessionAgain()) VoiceSession.republishAfterRebuild()
    }

    /**
     * A session for the connection that has just been made.
     *
     * The blip that took the connection down usually takes this request with
     * it, and giving up on the first failure left a call that was up on screen
     * and silent for ever.
     */
    private suspend fun openSessionAgain(): Boolean {
        var wait = SESSION_RETRY_BASE_MS
        repeat(MAX_SESSION_TRIES) { attempt ->
            if (closed) return false
            val made = lock.withLock {
                if (closed) return@withLock null
                runCatching { VoiceApi.sfuSession().sessionId }
                    .onFailure { Log.w(TAG, "could not open a call session", it) }
                    .getOrNull()
                    ?.also { sessionId = it }
            }
            if (made != null) return true
            if (attempt < MAX_SESSION_TRIES - 1) {
                delay(wait)
                wait = (wait * 2).coerceAtMost(SESSION_RETRY_MAX_MS)
            }
        }
        onError(t("voiceSession.theCallLostItsConnectionAnd"))
        return false
    }

    /**
     * Lets go of the connection and everything it owns. Must be called with
     * [lock] held.
     *
     * `PeerConnection.dispose()` walks its receivers and disposes the tracks
     * behind them, which are the very objects the call screen is drawing and
     * the deafen button is about to call `setEnabled` on. Telling the call to
     * let go of them first is the difference between a reconnect and a crash
     * in native code with no Kotlin stack to read.
     */
    private fun releaseConnection() {
        for (p in pulled.values) {
            runCatching { onRemoteTrack(p.userId, p.kind, null) }
            val held = synchronized(p) {
                val old = p.decryptor
                p.decryptor = null
                p.track = null
                p.transceiver = null
                old
            }
            held?.release()
        }
        pulled.clear()
        byMid.clear()
        for (encryptor in encryptors.values) encryptor.release()
        encryptors.clear()
        senders.clear()
        published.clear()
        val connection = pc
        pc = null
        generation++
        if (connection != null) runCatching { connection.dispose() }
    }

    suspend fun close() {
        lock.withLock {
            closed = true
            keyTimer?.cancel()
            keyTimer = null
            recoverJob?.cancel()
            recoverJob = null
            rebuildJob?.cancel()
            rebuildJob = null
            pullRetryJob?.cancel()
            pullRetryJob = null
            releaseConnection()
            sessionId = null
            releaseKeys()
        }
    }

    /**
     * A stats report from the live connection, or null if there is none.
     *
     * Taken with the lock held, so the connection cannot be disposed between
     * this deciding it exists and libwebrtc reading from it — which is what
     * turned signing out during a call into a native crash.
     */
    suspend fun stats(): RTCStatsReport? = lock.withLock {
        val connection = pc
        if (connection == null || closed) return@withLock null
        runCatching {
            withTimeoutOrNull(STATS_TIMEOUT_MS) {
                suspendCancellableCoroutine<RTCStatsReport> { cont ->
                    connection.getStats { report -> if (cont.isActive) cont.resume(report) }
                }
            }
        }.getOrNull()
    }

    // --- sdp helpers -------------------------------------------------------

    private suspend fun createOffer(connection: PeerConnection, iceRestart: Boolean = false): SessionDescription =
        suspendCoroutine { cont ->
            val constraints = MediaConstraints().apply {
                if (iceRestart) mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
            }
            connection.createOffer(object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
                override fun onCreateFailure(error: String?) = cont.resumeWith(Result.failure(IllegalStateException(error)))
                override fun onSetSuccess() = Unit
                override fun onSetFailure(error: String?) = Unit
            }, constraints)
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

    /** Takes back an offer nobody answered, so the next exchange starts clean. */
    private suspend fun rollback(connection: PeerConnection) {
        if (connection.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) return
        runCatching { connection.setLocal(SessionDescription(SessionDescription.Type.ROLLBACK, "")) }
            .onFailure { Log.w(TAG, "could not take the offer back", it) }
    }

    /**
     * And VP8 only on the way in, for the same reason.
     *
     * How many header bytes stay in the clear is worked out on both sides from
     * whether the frame is a VP8 key frame, which is read out of the bitstream
     * because a frame decryptor is handed no metadata. A publisher sending
     * H.264 would therefore have every tag check fail and show as a black tile
     * for ever; refusing it in the answer is better than decoding it wrong.
     */
    private fun preferVp8OnReceive(transceiver: RtpTransceiver) {
        val codecs = receiveVp8 ?: return
        runCatching { transceiver.setCodecPreferences(codecs) }
            .onFailure { Log.w(TAG, "could not ask for VP8 on the pulled video", it) }
    }

    /** VP8 and its retransmissions from what this phone can decode, or null if it cannot. */
    private val receiveVp8: List<org.webrtc.RtpCapabilities.CodecCapability>? by lazy {
        val capabilities = runCatching {
            VoiceEngine.factory.getRtpReceiverCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)
        }.getOrNull() ?: return@lazy null
        capabilities.codecs.filter { it.name.equals("VP8", true) || it.name.equals("rtx", true) }
            .takeIf { list -> list.any { it.name.equals("VP8", true) } }
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
