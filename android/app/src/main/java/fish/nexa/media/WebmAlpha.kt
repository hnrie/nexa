package fish.nexa.media

import android.graphics.Bitmap
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import fish.nexa.Nexa
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * WebM stickers with see-through backgrounds, as the web's <video> draws them.
 * A WebM keeps its alpha beside each picture, as a second VP8 or VP9 frame in
 * the block's additions (Matroska BlockAdditional, id 1), and Android's
 * decoders drop it, which leaves a sticker in a solid box. Here both streams
 * are decoded and put back together, a frame at a time, into a bitmap.
 */
object Webm {
    class Frame(val timeUs: Long, val data: ByteArray, val alpha: ByteArray?)

    class Clip(val mime: String, val width: Int, val height: Int, val frames: List<Frame>) {
        val alpha = frames.any { it.alpha != null }

        /** How long one pass lasts: the last frame's time plus one frame's length. */
        val durationUs: Long = run {
            if (frames.size < 2) return@run 1_000_000L / 30
            val last = frames.last().timeUs
            last + maxOf(1L, (last - frames.first().timeUs) / (frames.size - 1))
        }
    }

    private const val EBML = 0x1A45DFA3
    private const val SEGMENT = 0x18538067
    private const val INFO = 0x1549A966
    private const val TIMESTAMP_SCALE = 0x2AD7B1
    private const val TRACKS = 0x1654AE6B
    private const val TRACK_ENTRY = 0xAE
    private const val TRACK_NUMBER = 0xD7
    private const val TRACK_TYPE = 0x83
    private const val CODEC_ID = 0x86
    private const val VIDEO = 0xE0
    private const val PIXEL_WIDTH = 0xB0
    private const val PIXEL_HEIGHT = 0xBA
    private const val CLUSTER = 0x1F43B675
    private const val TIMESTAMP = 0xE7
    private const val SIMPLE_BLOCK = 0xA3
    private const val BLOCK_GROUP = 0xA0
    private const val BLOCK = 0xA1
    private const val BLOCK_ADDITIONS = 0x75A1
    private const val BLOCK_MORE = 0xA6
    private const val BLOCK_ADD_ID = 0xEE
    private const val BLOCK_ADDITIONAL = 0xA5

    /** The segment's own children: one of these ends a cluster whose size was left open. */
    private val TOP = setOf(CLUSTER, INFO, TRACKS, 0x1C53BB6B, 0x1254C367, 0x1043A770, 0x1941A469, 0x114D9B74)

    private class El(val id: Int, val from: Int, val to: Int, val open: Boolean)

    /** One element at [p]: its id, and where its data starts and ends (an open size runs to [limit]). */
    private fun element(b: ByteArray, p: Int, limit: Int): El? {
        if (p >= limit) return null
        val idLen = Integer.numberOfLeadingZeros(b[p].toInt() and 0xFF) - 23
        if (idLen !in 1..4 || p + idLen > limit) return null
        var id = 0
        for (i in 0 until idLen) id = (id shl 8) or (b[p + i].toInt() and 0xFF)
        val q = p + idLen
        if (q >= limit) return null
        val sizeLen = Integer.numberOfLeadingZeros(b[q].toInt() and 0xFF) - 23
        if (sizeLen !in 1..8 || q + sizeLen > limit) return null
        var size = (b[q].toInt() and (0xFF shr sizeLen)).toLong()
        var open = size == (0xFF shr sizeLen).toLong()
        for (i in 1 until sizeLen) {
            val v = b[q + i].toInt() and 0xFF
            size = (size shl 8) or v.toLong()
            if (v != 0xFF) open = false
        }
        val from = q + sizeLen
        val to = if (open) limit else minOf(limit.toLong(), from + size).toInt()
        return El(id, from, to, open)
    }

    private fun uint(b: ByteArray, from: Int, to: Int): Long {
        var v = 0L
        for (i in from until to) v = (v shl 8) or (b[i].toLong() and 0xFF)
        return v
    }

    /** The first video track (VP8 or VP9) and the frames it holds, alpha beside each; null when the file is anything else. */
    fun parse(b: ByteArray): Clip? {
        return try {
            read(b)
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun read(b: ByteArray): Clip? {
        val head = element(b, 0, b.size) ?: return null
        if (head.id != EBML) return null
        val seg = element(b, head.to, b.size) ?: return null
        if (seg.id != SEGMENT) return null
        var scaleNs = 1_000_000L
        var track = -1L
        var mime: String? = null
        var width = 0
        var height = 0
        val frames = ArrayList<Frame>()

        fun readTrack(from: Int, to: Int) {
            var number = -1L
            var type = 0L
            var codec = ""
            var w = 0
            var h = 0
            var p = from
            while (true) {
                val e = element(b, p, to) ?: break
                when (e.id) {
                    TRACK_NUMBER -> number = uint(b, e.from, e.to)
                    TRACK_TYPE -> type = uint(b, e.from, e.to)
                    CODEC_ID -> codec = String(b, e.from, e.to - e.from, Charsets.US_ASCII).trimEnd('\u0000')
                    VIDEO -> {
                        var v = e.from
                        while (true) {
                            val x = element(b, v, e.to) ?: break
                            if (x.id == PIXEL_WIDTH) w = uint(b, x.from, x.to).toInt()
                            if (x.id == PIXEL_HEIGHT) h = uint(b, x.from, x.to).toInt()
                            v = x.to
                        }
                    }
                }
                p = e.to
            }
            val m = when (codec) { "V_VP9" -> MediaFormat.MIMETYPE_VIDEO_VP9; "V_VP8" -> MediaFormat.MIMETYPE_VIDEO_VP8; else -> null }
            if (type == 1L && m != null && track < 0) {
                track = number; mime = m; width = w; height = h
            }
        }

        /** A block's frame, when it is the video track's and holds one unlaced frame. */
        fun readBlock(from: Int, to: Int, clusterTime: Long, alpha: ByteArray?) {
            val lenTrack = Integer.numberOfLeadingZeros(b[from].toInt() and 0xFF) - 23
            if (lenTrack !in 1..8) return
            val number = uint(b, from, from + lenTrack) and ((1L shl (7 * lenTrack)) - 1)
            val q = from + lenTrack
            if (number != track || q + 3 > to) return
            val rel = ((b[q].toInt() shl 8) or (b[q + 1].toInt() and 0xFF)).toShort().toLong()
            val flags = b[q + 2].toInt()
            if (flags and 0x06 != 0) return
            frames += Frame((clusterTime + rel) * scaleNs / 1000, b.copyOfRange(q + 3, to), alpha)
        }

        fun readCluster(from: Int, to: Int, open: Boolean): Int {
            var time = 0L
            var p = from
            while (true) {
                val e = element(b, p, to) ?: return to
                if (open && e.id in TOP) return p
                when (e.id) {
                    TIMESTAMP -> time = uint(b, e.from, e.to)
                    SIMPLE_BLOCK -> readBlock(e.from, e.to, time, null)
                    BLOCK_GROUP -> {
                        var block: El? = null
                        var alpha: ByteArray? = null
                        var g = e.from
                        while (true) {
                            val x = element(b, g, e.to) ?: break
                            if (x.id == BLOCK) block = x
                            if (x.id == BLOCK_ADDITIONS) {
                                var m = x.from
                                while (true) {
                                    val more = element(b, m, x.to) ?: break
                                    if (more.id == BLOCK_MORE) {
                                        var addId = 1L
                                        var data: ByteArray? = null
                                        var k = more.from
                                        while (true) {
                                            val y = element(b, k, more.to) ?: break
                                            if (y.id == BLOCK_ADD_ID) addId = uint(b, y.from, y.to)
                                            if (y.id == BLOCK_ADDITIONAL) data = b.copyOfRange(y.from, y.to)
                                            k = y.to
                                        }
                                        if (addId == 1L && data != null) alpha = data
                                    }
                                    m = more.to
                                }
                            }
                            g = x.to
                        }
                        block?.let { readBlock(it.from, it.to, time, alpha) }
                    }
                }
                p = e.to
            }
        }

        var p = seg.from
        while (true) {
            val e = element(b, p, seg.to) ?: break
            when (e.id) {
                INFO -> {
                    var i = e.from
                    while (true) {
                        val x = element(b, i, e.to) ?: break
                        if (x.id == TIMESTAMP_SCALE) scaleNs = uint(b, x.from, x.to).takeIf { it > 0 } ?: scaleNs
                        i = x.to
                    }
                }
                TRACKS -> {
                    var t = e.from
                    while (true) {
                        val x = element(b, t, e.to) ?: break
                        if (x.id == TRACK_ENTRY) readTrack(x.from, x.to)
                        t = x.to
                    }
                }
                CLUSTER -> {
                    if (track < 0) return null
                    p = readCluster(e.from, e.to, e.open)
                    continue
                }
            }
            p = e.to
        }
        val m = mime ?: return null
        if (frames.isEmpty() || width <= 0 || height <= 0) return null
        return Clip(m, width, height, frames)
    }

    private val clips = object : LinkedHashMap<String, Clip>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Clip>?) = size > 32
    }

    /** The sticker at [url], fetched and read (a few are kept); null when it cannot be played here. */
    suspend fun load(url: String): Clip? {
        synchronized(clips) { clips[url] }?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                Nexa.api.http.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (r.isSuccessful) parse(r.body.bytes()) else null
                }
            }.getOrNull()?.also { synchronized(clips) { clips[url] = it } }
        }
    }

    /** One decoded picture's planes, copied out of the decoder so both streams can be held at once. */
    private class Picture {
        var pts = 0L
        var left = 0
        var top = 0
        var width = 0
        var height = 0
        var y = ByteArray(0)
        var yStride = 0
        var u = ByteArray(0)
        var uStride = 0
        var uStep = 1
        var v = ByteArray(0)
        var vStride = 0
        var vStep = 1

        fun take(img: Image, pts: Long, lumaOnly: Boolean) {
            this.pts = pts
            left = img.cropRect.left
            top = img.cropRect.top
            width = img.cropRect.width()
            height = img.cropRect.height()
            val planes = img.planes
            y = copy(planes[0].buffer, y)
            yStride = planes[0].rowStride
            if (lumaOnly) return
            u = copy(planes[1].buffer, u)
            uStride = planes[1].rowStride
            uStep = planes[1].pixelStride
            v = copy(planes[2].buffer, v)
            vStride = planes[2].rowStride
            vStep = planes[2].pixelStride
        }

        private fun copy(buf: java.nio.ByteBuffer, into: ByteArray): ByteArray {
            val out = if (into.size >= buf.remaining()) into else ByteArray(buf.remaining())
            buf.get(out, 0, buf.remaining())
            return out
        }
    }

    /**
     * One stream's decoder. A software one is preferred: stickers are small,
     * and a screen of them would run out of hardware decoders.
     */
    private class Stream(private val codec: MediaCodec, private val lumaOnly: Boolean) {
        private val info = MediaCodec.BufferInfo()
        private var inputEnded = false
        private var outputEnded = false
        val picture = Picture()

        fun restart() {
            codec.flush()
            inputEnded = false
            outputEnded = false
        }

        /** The next picture, feeding the decoder from [feed] as it asks; false at the end of the stream. */
        fun next(feed: () -> Frame?, data: (Frame) -> ByteArray): Boolean {
            if (outputEnded) return false
            repeat(500) {
                if (!inputEnded) {
                    val ix = codec.dequeueInputBuffer(2_000)
                    if (ix >= 0) {
                        val f = feed()
                        if (f == null) {
                            codec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputEnded = true
                        } else {
                            val bytes = data(f)
                            val buf = codec.getInputBuffer(ix) ?: return false
                            buf.clear()
                            if (bytes.size > buf.capacity()) return false
                            buf.put(bytes)
                            codec.queueInputBuffer(ix, 0, bytes.size, f.timeUs, 0)
                        }
                    }
                }
                val out = codec.dequeueOutputBuffer(info, 2_000)
                if (out >= 0) {
                    val end = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    val img = if (info.size > 0 || !end) codec.getOutputImage(out) else null
                    if (img != null) {
                        try {
                            picture.take(img, info.presentationTimeUs, lumaOnly)
                        } finally {
                            img.close()
                        }
                    }
                    codec.releaseOutputBuffer(out, false)
                    if (end) outputEnded = true
                    if (img != null) return true
                    if (end) return false
                }
            }
            return false
        }

        fun release() = runCatching { codec.stop(); codec.release() }

        companion object {
            fun open(clip: Clip, lumaOnly: Boolean): Stream? = runCatching {
                val format = MediaFormat.createVideoFormat(clip.mime, clip.width, clip.height)
                format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                val names = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                    .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(clip.mime, ignoreCase = true) } }
                    .map { it.name }
                    .sortedBy { if (it.startsWith("c2.android.") || it.startsWith("OMX.google.")) 0 else 1 }
                val codec = names.firstNotNullOfOrNull { name ->
                    runCatching { MediaCodec.createByCodecName(name).apply { configure(format, null, null, 0); start() } }.getOrNull()
                } ?: return null
                Stream(codec, lumaOnly)
            }.getOrNull()
        }
    }

    /** A box of [box] pixels a side, filled as `object-fit: contain` would; never larger than the video itself. */
    fun fit(clip: Clip, box: Int): Pair<Int, Int> {
        val scale = minOf(1f, box.toFloat() / maxOf(clip.width, clip.height))
        return maxOf(1, (clip.width * scale).toInt()) to maxOf(1, (clip.height * scale).toInt())
    }

    /**
     * Plays [clip] into bitmaps [width] by [height], handing each to [show] on
     * the main thread when it is due, looping until cancelled (or showing the
     * first frame only when [loop] is false). False when it cannot be played.
     */
    suspend fun play(clip: Clip, width: Int, height: Int, loop: Boolean, show: (Bitmap) -> Unit): Boolean = withContext(Dispatchers.IO) {
        val colour = Stream.open(clip, lumaOnly = false) ?: return@withContext false
        val alpha = if (clip.alpha) Stream.open(clip, lumaOnly = true) else null
        if (clip.alpha && alpha == null) {
            colour.release()
            return@withContext false
        }
        try {
            val pixels = IntArray(width * height)
            // three in turn: the one on screen, the one just handed over, the one being drawn into
            val bitmaps = Array(3) { Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888) }
            val withAlpha = clip.frames.filter { it.alpha != null }.mapTo(HashSet()) { it.timeUs }
            var turn = 0
            var shown = 0
            var start = System.nanoTime()
            while (isActive) {
                var i = 0
                var ai = 0
                var gotAlpha = false
                while (isActive) {
                    if (!colour.next({ clip.frames.getOrNull(i++) }, { it.data })) break
                    val pic = colour.picture
                    var a: Picture? = null
                    if (alpha != null && pic.pts in withAlpha) {
                        // the alpha stream gives its pictures in the same order; take the one for this time
                        while (!gotAlpha || alpha.picture.pts < pic.pts) {
                            val more = alpha.next({
                                while (ai < clip.frames.size && clip.frames[ai].alpha == null) ai++
                                clip.frames.getOrNull(ai++)
                            }, { it.alpha!! })
                            if (!more) break
                            gotAlpha = true
                        }
                        if (gotAlpha && alpha.picture.pts == pic.pts) a = alpha.picture
                    }
                    compose(pic, a, pixels, width, height)
                    val bmp = bitmaps[turn]
                    turn = (turn + 1) % bitmaps.size
                    bmp.setPixels(pixels, 0, width, 0, 0, width, height)
                    val wait = (start + pic.pts * 1000 - System.nanoTime()) / 1_000_000
                    if (wait > 0) delay(wait)
                    withContext(Dispatchers.Main) { show(bmp) }
                    shown++
                    if (!loop || clip.frames.size == 1) return@withContext true
                }
                if (shown == 0) return@withContext false
                colour.restart()
                alpha?.restart()
                start += clip.durationUs * 1000
                // after a long stall, start the next pass now rather than racing through it
                if (System.nanoTime() - start > clip.durationUs * 1000) start = System.nanoTime()
            }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (_: RuntimeException) {
            // a decoder that gave up, or pictures not the size the file said
            false
        } finally {
            colour.release()
            alpha?.release()
        }
    }

    /** Puts a colour picture and its alpha together into [out], scaled to [ow] by [oh] (BT.601, as WebM video is). */
    private fun compose(c: Picture, alpha: Picture?, out: IntArray, ow: Int, oh: Int) {
        val w = c.width
        val h = c.height
        val a = alpha?.takeIf { it.width == w && it.height == h }
        val xs = IntArray(ow) { it * w / ow }
        for (oy in 0 until oh) {
            val sy = oy * h / oh
            val cy = c.top + sy
            val yRow = cy * c.yStride + c.left
            val uRow = (cy shr 1) * c.uStride
            val vRow = (cy shr 1) * c.vStride
            val aRow = if (a != null) (a.top + sy) * a.yStride + a.left else 0
            var o = oy * ow
            for (ox in 0 until ow) {
                val sx = xs[ox]
                val l = 298 * ((c.y[yRow + sx].toInt() and 0xFF) - 16)
                val cx = (c.left + sx) shr 1
                val u = (c.u[uRow + cx * c.uStep].toInt() and 0xFF) - 128
                val v = (c.v[vRow + cx * c.vStep].toInt() and 0xFF) - 128
                val r = ((l + 409 * v + 128) shr 8).coerceIn(0, 255)
                val g = ((l - 100 * u - 208 * v + 128) shr 8).coerceIn(0, 255)
                val b = ((l + 516 * u + 128) shr 8).coerceIn(0, 255)
                val al = if (a != null) a.y[aRow + sx].toInt() and 0xFF else 255
                out[o++] = (al shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
    }
}
