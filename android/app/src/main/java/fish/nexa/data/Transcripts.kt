package fish.nexa.data

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import fish.nexa.Nexa
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.roundToInt

/** Whisper Tiny multilingual. Download only weights; decrypted audio and transcript never leave this device. */
object Transcripts {
    private const val MODEL_SHA = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"
    private const val MODEL_SIZE = 77691713L
    private val modelLock = Mutex()
    private val executor = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.MINUTES).build()
    private val native by lazy { System.loadLibrary("nexa_whisper_jni"); true }

    private suspend fun model(progress: (Int) -> Unit): File = withContext(Dispatchers.IO) {
        modelLock.withLock {
            val target = File(Nexa.app.noBackupFilesDir, "whisper-tiny-$MODEL_SHA.bin")
            if (target.length() == MODEL_SIZE) return@withLock target
            val part = File(target.path + ".part")
            try {
                client.newCall(Request.Builder().url("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin").build()).execute().use { response ->
                    check(response.isSuccessful)
                    val hash = MessageDigest.getInstance("SHA-256")
                    var total = 0L
                    var percent = -1
                    progress(0)
                    response.body.byteStream().use { input -> part.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            total += n
                            check(total <= MODEL_SIZE)
                            hash.update(buffer, 0, n)
                            output.write(buffer, 0, n)
                            val next = ((total * 100 / MODEL_SIZE).toInt()).coerceIn(0, 99)
                            if (next != percent) { percent = next; progress(next) }
                        }
                    } }
                    check(total == MODEL_SIZE && hash.digest().joinToString("") { "%02x".format(it) } == MODEL_SHA)
                    check(part.renameTo(target))
                    progress(100)
                }
            } finally { part.delete() }
            target
        }
    }

    suspend fun transcribe(file: File, progress: (Int) -> Unit = {}, working: () -> Unit): String {
        val model = model(progress)
        val samples = withContext(Dispatchers.IO) { decode(file) }
        currentCoroutineContext().ensureActive()
        working()
        return suspendCancellableCoroutine { cont ->
            val cancelled = AtomicBoolean(false)
            cont.invokeOnCancellation { cancelled.set(true) }
            executor.execute {
                try {
                    if (!cancelled.get()) {
                        check(native)
                        val result = nativeTranscribe(model.path, samples, cancelled, Runtime.getRuntime().availableProcessors()) ?: error("Whisper failed")
                        if (cont.isActive) cont.resume(result.decodeToString().trim())
                    }
                } catch (e: Throwable) { if (cont.isActive) cont.resumeWithException(e) }
                finally { samples.fill(0f) }
            }
        }
    }

    /** Decode the formats either client records, mix down, and resample to Whisper's 16 kHz. */
    private suspend fun decode(file: File): FloatArray {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(file.path)
            val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            check(format.getLong(MediaFormat.KEY_DURATION) <= 601_000_000L)
            val decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            codec = decoder
            decoder.configure(format, null, null, 0); decoder.start()
            val info = MediaCodec.BufferInfo()
            val chunks = ArrayList<FloatArray>()
            var count = 0
            var inputDone = false
            var outputDone = false
            var floatPcm = false
            var idle = 0
            while (!outputDone) {
                currentCoroutineContext().ensureActive()
                check(idle++ < 1000)
                if (!inputDone) {
                    val i = decoder.dequeueInputBuffer(10000)
                    if (i >= 0) {
                        val size = extractor.readSampleData(decoder.getInputBuffer(i)!!, 0)
                        if (size < 0) { decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { decoder.queueInputBuffer(i, 0, size, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val o = decoder.dequeueOutputBuffer(info, 10000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val next = decoder.outputFormat
                    rate = next.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = next.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    floatPcm = next.containsKey(MediaFormat.KEY_PCM_ENCODING) && next.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                } else if (o >= 0) {
                    idle = 0
                    val buffer = decoder.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
                    buffer.position(info.offset); buffer.limit(info.offset + info.size)
                    val n = info.size / (if (floatPcm) 4 else 2) / channels
                    val pcm = FloatArray(n) {
                        var sum = 0f
                        repeat(channels) { sum += if (floatPcm) buffer.float else buffer.short / 32768f }
                        sum / channels
                    }
                    count += n
                    check(count.toLong() <= rate.toLong() * 601)
                    chunks += pcm
                    outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    decoder.releaseOutputBuffer(o, false)
                }
            }
            val mono = FloatArray(count)
            var offset = 0
            chunks.forEach { it.copyInto(mono, offset); offset += it.size; it.fill(0f) }
            check(count > 0)
            val result = FloatArray((count.toDouble() * 16000 / rate).roundToInt()) { i ->
                val pos = i.toDouble() * rate / 16000
                val a = pos.toInt().coerceAtMost(mono.lastIndex)
                val b = (a + 1).coerceAtMost(mono.lastIndex)
                (mono[a] + (mono[b] - mono[a]) * (pos - a)).toFloat()
            }
            mono.fill(0f)
            return result
        } finally { codec?.let { runCatching { it.stop() }; it.release() }; extractor.release() }
    }
    private external fun nativeTranscribe(model: String, pcm: FloatArray, cancelled: AtomicBoolean, threads: Int): ByteArray?
}
