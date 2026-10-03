package fish.nexa.voice

import android.os.SystemClock
import android.util.Log
import org.webrtc.ExternalAudioProcessingFactory
import java.nio.ByteBuffer
import kotlin.math.sqrt

/**
 * The microphone's last stage before the encoder (voice.md 8.2), in the
 * audio processing module's capture post-processing hook: RNNoise when
 * Enhanced noise suppression is on (the platform's own noise suppression is
 * off then), the input volume, and the level that voice activity and the
 * speaking ring go by. It runs on the audio thread, 10 ms at a time, whether or
 * not the sent track is let through, so voice activity can hear speech while
 * the call's copy of the microphone is silenced.
 */
object Denoise : ExternalAudioProcessingFactory.AudioProcessing {
    private const val TAG = "Denoise"

    /** RNNoise on (Enhanced). */
    @Volatile var enhanced = false

    /** The input volume, 0..2. */
    @Volatile var gain = 1f

    /** A test signal in place of the microphone (debug builds): 1 steady, 2 in phrases. */
    @Volatile var tone = 0

    /** The level of the last 20 ms of processed microphone, 0..1 (RMS x 4, as the web's LevelMeter). */
    @Volatile var level = 0f
        private set

    /** When the last block went through, to tell a stopped microphone from a quiet one. */
    @Volatile var lastAt = 0L
        private set

    private var rate = 48_000
    private var ptr = 0L
    private var previous = 0f
    private var logged = false

    /** Whether RNNoise can run on this device; Enhanced falls back to Standard when not. */
    val available: Boolean
        get() = FrameCryptoNative.loaded && ensure() != 0L

    @Synchronized
    private fun ensure(): Long {
        if (ptr == 0L && FrameCryptoNative.loaded) ptr = runCatching { nativeCreate() }.getOrDefault(0L)
        return ptr
    }

    override fun initialize(sampleRateHz: Int, numChannels: Int) {
        rate = sampleRateHz
        ensure()
        Log.i(TAG, "capture processing at $sampleRateHz Hz, $numChannels channel(s)")
    }

    override fun reset(newRate: Int) {
        rate = newRate
    }

    override fun process(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
        val p = ptr
        if (p == 0L) return
        if (!logged) {
            logged = true
            Log.i(TAG, "first block: $numFrames frames, $numBands band(s), direct=${buffer.isDirect}, ${buffer.capacity()} bytes")
        }
        val l = nativeProcess(p, buffer, numFrames, numFrames * 100, enhanced, gain, tone)
        if (l < 0) return
        level = sqrt((l * l + previous * previous) / 2f)
        previous = l
        lastAt = SystemClock.elapsedRealtime()
    }

    private external fun nativeCreate(): Long
    private external fun nativeDestroy(ptr: Long)
    private external fun nativeProcess(ptr: Long, buffer: ByteBuffer, frames: Int, rate: Int, denoise: Boolean, gain: Float, tone: Int): Float
}
