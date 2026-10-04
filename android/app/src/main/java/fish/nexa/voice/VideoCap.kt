package fish.nexa.voice

import android.util.Log
import org.webrtc.MediaStreamTrack
import org.webrtc.RtpCapabilities
import org.webrtc.RtpParameters
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
     * 60), scaled down under the size cap, and what it gives up first when
     * the phone or the connection cannot keep up.
     */
    fun capSender(sender: RtpSender, maxBitrate: Int, width: Int = 0, height: Int = 0, fps: Int = FPS, degradation: RtpParameters.DegradationPreference? = null) {
        try {
            val params = sender.parameters ?: return
            if (params.encodings.isEmpty()) return
            if (degradation != null) params.degradationPreference = degradation
            val enc = params.encodings[0]
            if (maxBitrate > 0) enc.maxBitrateBps = maxBitrate
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

    /**
     * What a share gives up first when the connection or the encoder cannot
     * keep up, as the web's content hint decides it (media.ts getScreen):
     * whoever picked 60 fps wants motion kept, anything slower is usually text
     * and keeps its sharpness.
     */
    fun shareDegradation(fps: Int): RtpParameters.DegradationPreference =
        if (fps >= 60) RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE else RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
}
