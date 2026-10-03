package fish.nexa.voice

import android.util.Log
import org.webrtc.MediaStreamTrack
import org.webrtc.RtpCapabilities
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import kotlin.math.max
import kotlin.math.min
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

    /** A sender's single encoding: this bitrate, at most 60 fps, scaled down under the size cap. */
    fun capSender(sender: RtpSender, maxBitrate: Int, width: Int = 0, height: Int = 0) {
        try {
            val params = sender.parameters ?: return
            if (params.encodings.isEmpty()) return
            val enc = params.encodings[0]
            if (maxBitrate > 0) enc.maxBitrateBps = maxBitrate
            enc.maxFramerate = min(FPS, enc.maxFramerate?.takeIf { it > 0 } ?: FPS)
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
    const val MAX_SHARE_BPS = 12_000_000

    /** The capture box for a resolution; "source" is the screen as it is, limited only by the cap. */
    fun shareBox(res: String): Pair<Int, Int> = when (res) {
        "720p" -> 1280 to 720
        "1080p" -> 1920 to 1080
        "1440p" -> 2560 to 1440
        else -> SIDE to SIDE
    }

    private val BPS_AT_30 = mapOf("720p" to 2_500_000, "1080p" to 5_000_000, "1440p" to 8_000_000, "source" to 10_000_000)
    private val FPS_SCALE = mapOf(15 to 0.6, 30 to 1.0, 60 to 1.5)

    /** The bitrate cap for a share, which the SFU's meter also charges it at. */
    fun shareBitrate(res: String, fps: Int): Int {
        val r = if (res in RESOLUTIONS) res else "1080p"
        val f = if (fps in FRAME_RATES) fps else 30
        return (BPS_AT_30.getValue(r) * FPS_SCALE.getValue(f)).toInt().coerceIn(MIN_SHARE_BPS, MAX_SHARE_BPS)
    }

    fun clampShareBitrate(bps: Int): Int = if (bps <= 0) 5_000_000 else bps.coerceIn(MIN_SHARE_BPS, MAX_SHARE_BPS)
}
