package fish.nexa.data

import android.media.MediaRecorder
import android.media.AudioRecord
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import java.nio.ByteOrder
import kotlin.math.sqrt
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

    /** 48 kHz AAC at 128 kbps, through the call's neural filter with no microphone gain boost. */
    class Recorder {
        private val file = File(Nexa.app.cacheDir, "voice-${System.nanoTime()}.m4a")
        private val audio: AudioRecord
        private val encoder: MediaCodec
        private val muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        private val dsp = RecordingDsp.create().also { check(it != 0L) }
        private val enhanced = (Nexa.settings.doc.value["voice"] as? kotlinx.serialization.json.JsonObject)?.get("noiseMode")?.toString()?.trim('"')?.let { it == "enhanced" } ?: true
        private val effects = ArrayList<android.media.audiofx.AudioEffect>()
        private val started: Long
        private val worker: Thread
        @Volatile private var running = true
        @Volatile private var failure: Exception? = null
        @Volatile private var now = 0f
        private var ended = 0L
        private val levels = ArrayList<Float>()
        private var released = false

        init {
            val buffer = maxOf(480 * 8, AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT))
            audio = AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setAudioFormat(AudioFormat.Builder().setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(buffer).build()
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            try {
                check(audio.state == AudioRecord.STATE_INITIALIZED)
                // VOICE_RECOGNITION avoids vendor speech-volume boosts. Use only requested effects.
                AutomaticGainControl.create(audio.audioSessionId)?.let { it.enabled = false; effects += it }
                val voice = Nexa.settings.doc.value["voice"] as? kotlinx.serialization.json.JsonObject
                val echo = voice?.get("echoCancellation")?.toString() != "false"
                val mode = voice?.get("noiseMode")?.toString()?.trim('"') ?: "enhanced"
                AcousticEchoCanceler.create(audio.audioSessionId)?.let { it.enabled = echo; effects += it }
                NoiseSuppressor.create(audio.audioSessionId)?.let { it.enabled = mode == "standard"; effects += it }
                val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, 48000, 1).apply {
                    setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                    setInteger(MediaFormat.KEY_BIT_RATE, 128000)
                    setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 960)
                }
                encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                encoder.start(); audio.startRecording()
                check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING)
            } catch (e: Exception) {
                effects.forEach { it.release() }; audio.release(); encoder.release(); muxer.release(); RecordingDsp.destroy(dsp); file.delete(); throw e
            }
            started = SystemClock.elapsedRealtime()
            worker = Thread({ capture() }, "nexa-voice-recording").apply { start() }
        }

        private fun capture() {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
            val pcm = ShortArray(480)
            var track = -1
            var muxing = false
            var frames = 0L
            val info = MediaCodec.BufferInfo()
            try {
                var eos = false
                var finished = false
                while (!finished) {
                    if (!eos) {
                        val i = encoder.dequeueInputBuffer(10000)
                        if (i >= 0) {
                            if (!running || frames >= 48000L * MAX_SECONDS.toLong()) {
                                encoder.queueInputBuffer(i, 0, 0, frames * 1000000 / 48000, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                eos = true
                            } else {
                                var read = 0
                                while (read < pcm.size && running) {
                                    val n = audio.read(pcm, read, pcm.size - read, AudioRecord.READ_BLOCKING)
                                    check(n >= 0)
                                    if (n == 0) break
                                    read += n
                                }
                                if (read < pcm.size) java.util.Arrays.fill(pcm, read, pcm.size, 0.toShort())
                                RecordingDsp.process(dsp, pcm, enhanced)
                                var sum = 0.0
                                for (v in pcm) { val x = v / 32768.0; sum += x * x }
                                now = (sqrt(sum / pcm.size) * 4).toFloat().coerceIn(0f, 1f)
                                val input = encoder.getInputBuffer(i)!!.order(ByteOrder.nativeOrder())
                                input.clear(); input.asShortBuffer().put(pcm)
                                encoder.queueInputBuffer(i, 0, 960, frames * 1000000 / 48000, 0)
                                frames += 480
                            }
                        }
                    }
                    var o = encoder.dequeueOutputBuffer(info, 10000)
                    while (o >= 0 || o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                            track = muxer.addTrack(encoder.outputFormat); muxer.start(); muxing = true
                        } else {
                            val output = encoder.getOutputBuffer(o)!!
                            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
                                check(muxing); output.position(info.offset); output.limit(info.offset + info.size)
                                muxer.writeSampleData(track, output, info)
                            }
                            finished = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                            encoder.releaseOutputBuffer(o, false)
                        }
                        if (finished) break
                        o = encoder.dequeueOutputBuffer(info, 0)
                    }
                }
            } catch (e: Exception) { failure = e }
            finally {
                runCatching { audio.stop() }; audio.release()
                effects.forEach { it.release() }
                runCatching { encoder.stop() }; encoder.release()
                if (muxing) runCatching { muxer.stop() }; muxer.release()
                RecordingDsp.destroy(dsp); pcm.fill(0)
            }
        }
        fun elapsed(): Double = ((if (ended > 0) ended else SystemClock.elapsedRealtime()) - started) / 1000.0
        fun sample(): Float { if (!released) levels += now; return now }
        fun level(): Float = now
        private fun finish() {
            if (released) return
            released = true; ended = SystemClock.elapsedRealtime(); running = false
            worker.join(2500)
            check(!worker.isAlive) { "Recording did not finish" }
        }
        fun stop(): Recording? {
            if (released) return null
            finish()
            if (failure != null || elapsed() < MIN_SECONDS || file.length() == 0L) { file.delete(); return null }
            return Recording(file, Math.round(minOf(MAX_SECONDS, elapsed()) * 10) / 10.0, encodeWave(shapeOf(levels)))
        }
        fun cancel() { if (!released) finish(); file.delete() }
    }
}
