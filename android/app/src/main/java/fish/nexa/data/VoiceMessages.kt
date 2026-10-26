package fish.nexa.data

import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import fish.nexa.Nexa
import java.io.File
import java.util.Calendar

/**
 * lib/voiceMessage.ts: voice messages recorded in the message box, sent as an
 * encrypted audio file with `voice` set, how long it runs and the shape of its
 * sound (`wave`, a byte of loudness per bar). Recorded as AAC in MP4, which
 * every app plays (the web's browsers, Android, the desktop app).
 */
object VoiceMessages {
    const val BARS = 48
    /** How many bars it is drawn with: fewer than it carries, so each is wide enough to see and aim at. */
    const val SHOWN_BARS = 32
    /** Ten minutes, a few megabytes at most. */
    const val MAX_SECONDS = 600.0
    /** Shorter than this is a slip of the finger, not a message. */
    const val MIN_SECONDS = 0.5

    /** Loudness samples to `bars` bars from 0 to 1, the loudest reaching the top (shapeOf). */
    fun shapeOf(levels: List<Float>, bars: Int = BARS): List<Float> {
        if (levels.isEmpty()) return List(bars) { 0f }
        val out = (0 until bars).map { b ->
            val from = b * levels.size / bars
            val to = maxOf(from + 1, (b + 1) * levels.size / bars)
            (from until minOf(to, levels.size)).maxOfOrNull { levels[it] } ?: 0f
        }
        val top = maxOf(out.maxOrNull() ?: 0f, 1e-6f)
        return out.map { minOf(1f, it / top) }
    }

    /** A shape as it travels: a byte a bar, in base64. */
    fun encodeWave(shape: List<Float>): String {
        val bytes = ByteArray(minOf(96, shape.size)) { (Math.round(shape[it].coerceIn(0f, 1f) * 255f)).toByte() }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    /** The bars of a received shape, from 0 to 1; null when it cannot be read. */
    fun decodeWave(wave: String?): List<Float>? {
        if (wave.isNullOrEmpty()) return null
        val bytes = runCatching { Base64.decode(wave, Base64.DEFAULT) }.getOrNull() ?: return null
        if (bytes.isEmpty()) return null
        return bytes.map { (it.toInt() and 0xff) / 255f }
    }

    /** voiceFileName: what whoever downloads it sees. */
    fun fileName(at: Calendar = Calendar.getInstance()): String {
        fun pad(n: Int) = n.toString().padStart(2, '0')
        return "voice-message-${at.get(Calendar.YEAR)}${pad(at.get(Calendar.MONTH) + 1)}${pad(at.get(Calendar.DAY_OF_MONTH))}-${pad(at.get(Calendar.HOUR_OF_DAY))}${pad(at.get(Calendar.MINUTE))}.m4a"
    }

    class Recording(val file: File, val duration: Double, val wave: String) {
        val type get() = "audio/mp4"
    }

    /** One recording from the microphone, sampled for its loudness as it goes. */
    class Recorder {
        private val file = File(Nexa.app.cacheDir, "voice-${System.nanoTime()}.m4a")
        private val rec: MediaRecorder = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(Nexa.app) else @Suppress("DEPRECATION") MediaRecorder())
        private val started: Long
        private var ended = 0L
        private val levels = ArrayList<Float>()
        @Volatile private var now = 0f
        private var released = false

        init {
            rec.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioChannels(1)
            rec.setAudioSamplingRate(48_000)
            rec.setAudioEncodingBitRate(64_000)
            rec.setMaxDuration((MAX_SECONDS * 1000).toInt())
            rec.setOutputFile(file.path)
            try {
                rec.prepare()
                rec.start()
            } catch (e: Exception) {
                rec.release()
                file.delete()
                throw e
            }
            started = SystemClock.elapsedRealtime()
        }

        /** Seconds recorded so far. */
        fun elapsed(): Double = ((if (ended > 0) ended else SystemClock.elapsedRealtime()) - started) / 1000.0

        /** Reads the loudness now (called every 50 ms), from 0 to 1. */
        fun sample(): Float {
            if (released) return now
            val amp = runCatching { rec.maxAmplitude }.getOrDefault(0)
            // speech sits far below full scale: lifted so a normal voice fills most of the height
            now = minOf(1f, amp / 12_000f)
            levels += now
            return now
        }

        fun level(): Float = now

        /** Ends the recording; null when it was too short to keep. */
        fun stop(): Recording? {
            if (released) return null
            ended = SystemClock.elapsedRealtime()
            released = true
            val ok = runCatching { rec.stop() }.isSuccess
            rec.release()
            val duration = minOf(MAX_SECONDS, elapsed())
            if (!ok || duration < MIN_SECONDS || file.length() == 0L) {
                file.delete()
                return null
            }
            return Recording(file, Math.round(duration * 10) / 10.0, encodeWave(shapeOf(levels)))
        }

        /** Ends it and throws it away. */
        fun cancel() {
            if (released) return
            released = true
            runCatching { rec.stop() }
            rec.release()
            file.delete()
        }
    }
}
