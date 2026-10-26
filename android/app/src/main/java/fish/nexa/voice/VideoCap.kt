package fish.nexa.voice

import android.util.Log
import kotlinx.coroutines.CancellationException
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.Priority
import org.webrtc.RtpCapabilities
import org.webrtc.RtpParameters
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Video as every Nexa client sends it (web/src/voice/videoCap.ts,
 * shareQuality.ts): VP8 only, one encoding, never over the size and frame
 * rate cap, at a bitrate the server charges the same way.
 */
object VideoCap {
    private const val TAG = "VideoCap"

    /** The cap: the longest side, the most pixels, the highest frame rate. */
    const val SIDE = 8192
    const val PIXELS = 7680 * 4320
    const val FPS = 60

    /** The camera through the SFU, and peer to peer. */
    const val CAMERA_BPS = 1_500_000
    const val MESH_CAMERA_BPS = 2_500_000

    /** The camera as it is captured: 1280 x 720 at 30. */
    const val CAMERA_WIDTH = 1280
    const val CAMERA_HEIGHT = 720
    const val CAMERA_FPS = 30

    fun fits(width: Int, height: Int) = width > 0 && height > 0 && width <= SIDE && height <= SIDE && width.toLong() * height <= PIXELS

    fun scaleFor(width: Int, height: Int): Double {
        if (width <= 0 || height <= 0) return 1.0
        val need = max(max(width.toDouble() / SIDE, height.toDouble() / SIDE), sqrt(width.toDouble() * height / PIXELS))
        return if (need > 1) need * 1.002 else 1.0
    }

    private fun vp8Of(caps: RtpCapabilities?): List<RtpCapabilities.CodecCapability>? {
        val list = caps?.codecs?.filter { it.name.equals("VP8", true) || it.name.equals("rtx", true) } ?: return null
        return list.takeIf { l -> l.any { it.name.equals("VP8", true) } }
    }

    private val sendVp8 by lazy { runCatching { vp8Of(WebRtc.factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) }.getOrNull() }
    private val receiveVp8 by lazy { runCatching { vp8Of(WebRtc.factory.getRtpReceiverCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) }.getOrNull() }

    private fun h264Of(caps: RtpCapabilities?): List<RtpCapabilities.CodecCapability>? =
        caps?.codecs?.filter { it.name.equals("H264", true) }?.takeIf { it.isNotEmpty() }

    private val sendH264 by lazy { runCatching { h264Of(WebRtc.factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) }.getOrNull() }
    private val receiveH264 by lazy { runCatching { h264Of(WebRtc.factory.getRtpReceiverCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)) }.getOrNull() }

    /**
     * Whether this phone can share its screen in H.264: libwebrtc offers
     * H.264 only from a hardware encoder, which keeps up with a phone's
     * screen where VP8 in software cannot.
     */
    val sendsH264: Boolean get() = sendH264 != null

    /** Whether this phone can watch a share in H.264, which the call is told (Calls.sendState). */
    val receivesH264: Boolean get() = receiveH264 != null

    /**
     * VP8 and its retransmissions only, on a video transceiver. True when the
     * preference took: the frame crypto keeps VP8's header readable, and a
     * receiver checks VP8 pictures against the cap before they are decoded.
     */
    fun preferVp8(tr: RtpTransceiver, sending: Boolean): Boolean {
        for (list in if (sending) listOf(sendVp8, receiveVp8) else listOf(receiveVp8, sendVp8)) {
            if (list == null) continue
            // this list is not the one the engine checks against: the other one is tried
            if (runCatching { tr.setCodecPreferences(list).isSuccess }.getOrDefault(false)) return true
        }
        return false
    }

    /**
     * H.264 and its retransmissions only, for a screen share everyone in the
     * call can watch in it (SfuTransport): the phone's hardware encoder keeps
     * a sharp 60 fps where VP8 in software cannot. The frame crypto seals
     * H.264 so its NAL units stay where the packetiser looks for them.
     */
    fun preferH264(tr: RtpTransceiver): Boolean {
        val h264 = sendH264 ?: return false
        val rtx = sendVp8?.filter { it.name.equals("rtx", true) }.orEmpty()
        // packetisation mode 1 first: its frames are split across packets rather than kept small
        val list = h264.sortedBy { if (it.parameters["packetization-mode"] == "1") 0 else 1 } + rtx
        return runCatching { tr.setCodecPreferences(list).isSuccess }.getOrDefault(false)
    }

    /**
     * What a receiving transceiver takes: VP8, and H.264 from a phone sharing
     * its screen, both read by the frame crypto and the size cap before
     * anything is decoded, and nothing else. VP8 first, so it is the one used
     * where a sender offers both.
     */
    fun acceptCallVideo(tr: RtpTransceiver): Boolean {
        val vp8 = receiveVp8 ?: sendVp8 ?: return false
        val list = vp8.filter { it.name.equals("VP8", true) } + receiveH264.orEmpty() + vp8.filter { it.name.equals("rtx", true) }
        if (runCatching { tr.setCodecPreferences(list).isSuccess }.getOrDefault(false)) return true
        return preferVp8(tr, sending = false)
    }

    /**
     * A sender's single encoding: this bitrate, at most `fps` (never above
     * 60), scaled down under the size cap, what it gives up first when the
     * phone or the connection cannot keep up, and with `high` served first
     * when the link is shared with a camera and a voice.
     */
    fun capSender(sender: RtpSender, maxBitrate: Int, width: Int = 0, height: Int = 0, fps: Int = FPS, degradation: RtpParameters.DegradationPreference? = null, high: Boolean = false) {
        try {
            val params = sender.parameters ?: return
            if (params.encodings.isEmpty()) return
            if (degradation != null) params.degradationPreference = degradation
            val enc = params.encodings[0]
            if (maxBitrate > 0) enc.maxBitrateBps = maxBitrate
            if (high) {
                // what "high" is on the web (RTCPriorityType), for the bitrate and for the packets' marking
                enc.bitratePriority = 4.0
                enc.networkPriority = Priority.HIGH
            }
            enc.maxFramerate = min(FPS, fps)
            enc.scaleResolutionDownBy = if (width > 0 && height > 0) scaleFor(width, height) else max(1.0, enc.scaleResolutionDownBy ?: 1.0)
            if (!sender.setParameters(params)) {
                // a sender that refuses the frame rate or the scale still takes the bitrate
                val again = sender.parameters ?: return
                if (again.encodings.isEmpty()) return
                if (maxBitrate > 0) again.encodings[0].maxBitrateBps = maxBitrate
                sender.setParameters(again)
            }
        } catch (e: Throwable) {
            Log.w(TAG, "could not cap a video sender", e)
        }
    }

    // --- screen share quality (shareQuality.ts) ------------------------------

    val RESOLUTIONS = listOf("720p", "1080p", "1440p", "source")
    val FRAME_RATES = listOf(15, 30, 60)
    const val MIN_SHARE_BPS = 1_000_000
    /** The most any share may send (Pro's); a Custom limit goes up to it. */
    const val MAX_SHARE_BPS = 20_000_000
    /** The most a share's own automatic bitrate and Quality use without a plan's say. */
    const val AUTO_MAX_BPS = 12_000_000

    /** The capture box for a resolution; "source" is the screen as it is, limited only by the cap. */
    fun shareBox(res: String): Pair<Int, Int> = when (res) {
        "720p" -> 1280 to 720
        "1080p" -> 1920 to 1080
        "1440p" -> 2560 to 1440
        else -> SIDE to SIDE
    }

    /** What a share may use at 30 fps, and at the other rates; 1080p at 60 fps gets just under 10 Mbit/s (shareQuality.ts). */
    private val BPS_AT_30 = mapOf("720p" to 3_000_000, "1080p" to 6_000_000, "1440p" to 9_000_000, "source" to 10_000_000)
    private val FPS_SCALE = mapOf(15 to 0.6, 30 to 1.0, 60 to 1.65)

    /** The bitrate cap for a share, which the SFU's meter also charges it at. */
    fun shareBitrate(res: String, fps: Int): Int {
        val r = if (res in RESOLUTIONS) res else "1080p"
        val f = if (fps in FRAME_RATES) fps else 30
        return (BPS_AT_30.getValue(r) * FPS_SCALE.getValue(f)).toInt().coerceIn(MIN_SHARE_BPS, AUTO_MAX_BPS)
    }

    fun clampShareBitrate(bps: Int): Int = if (bps <= 0) 6_000_000 else bps.coerceIn(MIN_SHARE_BPS, MAX_SHARE_BPS)

    /**
     * What a share is sent as (shareQuality.ts SharePlan): its size and frame
     * rate, its bitrate limit, and whether it keeps its frames by being made
     * smaller when the link is short (`smooth`, ShareAdapt) or keeps its size.
     */
    data class SharePlan(val res: String, val fps: Int, val bitrate: Int, val smooth: Boolean)

    /** Performance: smooth motion, 1080p at 60 fps within 6 Mbit/s (shareQuality.ts PERFORMANCE_PLAN). */
    val PERFORMANCE = SharePlan("1080p", 60, 6_000_000, true)
    /** Quality: the screen as it is, up to 60 fps, at the most a share may use (QUALITY_PLAN). */
    val QUALITY = SharePlan("source", 60, AUTO_MAX_BPS, false)

    /** What the account's plan lets a share do (data/Plans): Quality or not, and the most it sends (shareQuality.ts ShareAllowance). */
    data class Allowance(val quality: Boolean, val maxBps: Int)
    val OPEN = Allowance(true, AUTO_MAX_BPS)
    val MODES = listOf("performance", "quality", "custom")

    /** A Custom bitrate limit from settings, held to what a share may use; null when there is none (customShareBitrate). */
    fun customBitrate(bps: Double?): Int? =
        bps?.takeIf { it.isFinite() && it > 0 }?.let { it.roundToInt().coerceIn(MIN_SHARE_BPS, MAX_SHARE_BPS) }

    /**
     * The mode the settings ask for (shareModeOf): settings from before modes
     * had only a size and frame rate, and one other than the usual 1080p at
     * 30 fps was a choice, kept as Custom; the usual one is Performance.
     */
    fun shareMode(mode: String?, res: String?, fps: Int?): String = when {
        mode in MODES -> mode!!
        (res ?: "1080p") != "1080p" || (fps ?: 30) != 30 -> "custom"
        else -> "performance"
    }

    /** What a Custom share keeps when the link is short; before modes, 60 fps stayed smooth and slower shares sharp. */
    fun shareKeep(keep: String?, fps: Int?): String = if (keep == "sharp" || keep == "smooth") keep else if ((fps ?: 30) >= 60) "smooth" else "sharp"

    /**
     * What a share is sent as, from the account's voice settings (sharePlan),
     * within what its plan allows: Quality without a plan shares as
     * Performance, and no mode sends more than the plan's most (Quality sends
     * exactly that).
     */
    fun sharePlan(mode: String?, res: String?, fps: Int?, bitrate: Double?, keep: String?, allow: Allowance = OPEN): SharePlan {
        val m = shareMode(mode, res, fps)
        if (m == "quality" && allow.quality) return QUALITY.copy(bitrate = allow.maxBps)
        if (m != "custom") return PERFORMANCE.copy(bitrate = minOf(PERFORMANCE.bitrate, allow.maxBps))
        val r = if (res in RESOLUTIONS) res!! else "1080p"
        val f = if (fps in FRAME_RATES) fps!! else 30
        return SharePlan(r, f, minOf(customBitrate(bitrate) ?: shareBitrate(r, f), allow.maxBps), shareKeep(keep, fps) == "smooth")
    }

    /**
     * A screen share's sender: its bitrate and frame rate, served before a
     * camera, and keeping its resolution whatever its rate. Keeping the frame
     * rate instead lets libwebrtc shrink the picture while the bandwidth
     * estimate is still low at the start, and a screen is never grown back
     * (measured on the web, where 1080p at 60 fps stayed 480x270 for a whole
     * share); a share in motion is sized by ShareAdapt instead.
     */
    fun capShare(sender: RtpSender, maxBitrate: Int, fps: Int) =
        capSender(sender, maxBitrate, fps = fps, degradation = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION, high = true)

    /**
     * Looks at a screen share's sender and changes its scale when ShareAdapt
     * calls for it: smaller while the link cannot carry 60 frames a second of
     * it, larger again once it can, and always within the size cap. Called
     * every few seconds while a share runs.
     */
    suspend fun retuneShare(pc: PeerConnection, sender: RtpSender, adapter: ShareAdapter) {
        try {
            val track = sender.track() ?: return
            if (track.kind() != MediaStreamTrack.VIDEO_TRACK_KIND || track.state() != MediaStreamTrack.State.LIVE) return
            val have = max(1.0, sender.parameters?.encodings?.firstOrNull()?.scaleResolutionDownBy ?: 1.0)
            val report = WebRtc.stats(pc, sender) ?: return
            val sample = ShareAdapt.readStats(report.statsMap.values.map { it.type to it.members }, have) ?: return
            val want = adapter.scaleFor(sample)
            if (abs(want - have) / have < 0.01) return
            val params = sender.parameters ?: return
            val enc = params.encodings.firstOrNull() ?: return
            enc.scaleResolutionDownBy = want
            sender.setParameters(params)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // the sender went away, or cannot say
        }
    }
}
