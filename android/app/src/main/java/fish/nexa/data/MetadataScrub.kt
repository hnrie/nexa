package fish.nexa.data

import java.io.File
import java.io.RandomAccessFile

/**
 * lib/scrubMetadata.ts: photos and videos carry details nobody sees until they
 * go looking (where a picture was taken, the phone and its serial number,
 * when, what edited it, comments, XMP and IPTC). Attachments are encrypted on
 * this device, so this is the only place they can be taken out: every file
 * goes through [scrub] before it is staged.
 *
 * Nothing is re-encoded. Whole segments, chunks and boxes are left out or
 * blanked, and what a picture needs to be shown as it was stays: a JPEG's
 * orientation, colour profile and Adobe marker, and a PNG's colour chunks. A
 * file this does not recognise (HEIC among them), or cannot follow as far as
 * it has to, is sent exactly as it is. The rules are the server's
 * (internal/media/scrub.go) and the tests hold this to its test files.
 */
object MetadataScrub {
    /** How much of a file is read at a time while its structure is followed. */
    private const val WINDOW = 256 * 1024

    /** How many pieces a cleaned file may be made of; a file built to cost memory past it is left as it is. */
    private const val MAX_PARTS = 1 shl 16

    /** How far into a JPEG its picture data is looked for. */
    private const val JPEG_HEAD_MAX = 16 shl 20

    /** Reads a file a window at a time. */
    private class Source(private val raf: RandomAccessFile) {
        val size: Long = raf.length()
        var buf = ByteArray(0)
            private set
        var base = 0L
            private set

        fun peek(off: Long, n: Int): ByteArray? {
            val i = off - base
            return if (i >= 0 && n >= 0 && i + n <= buf.size) buf.copyOfRange(i.toInt(), i.toInt() + n) else null
        }

        /** The n bytes at off, or null when the file ends before them. */
        fun at(off: Long, n: Int): ByteArray? {
            if (off < 0 || n < 0 || off + n > size) return null
            peek(off, n)?.let { return it }
            val want = minOf(size - off, maxOf(n, WINDOW).toLong()).toInt()
            val b = ByteArray(want)
            raf.seek(off)
            raf.readFully(b)
            if (b.size < n) return null
            buf = b
            base = off
            return b.copyOfRange(0, n)
        }

        /** The byte at off without copying, reading a window when needed. */
        fun byteAt(off: Long): Int? {
            val i = off - base
            if (i >= 0 && i < buf.size) return buf[i.toInt()].toInt() and 0xff
            return at(off, 1)?.let { it[0].toInt() and 0xff }
        }
    }

    /** A stretch of a cleaned file: bytes of the original, new bytes, or zeros. */
    private sealed interface Part {
        data class Keep(val off: Long, var n: Long) : Part
        class Lit(val bytes: ByteArray) : Part
        data class Zeros(val n: Long) : Part
    }

    private class Plan {
        val parts = ArrayList<Part>()

        fun keep(off: Long, n: Long) {
            if (n <= 0) return
            val last = parts.lastOrNull()
            if (last is Part.Keep && last.off + last.n == off) last.n += n else parts += Part.Keep(off, n)
        }

        fun add(lit: ByteArray) {
            if (lit.isNotEmpty()) parts += Part.Lit(lit)
        }

        fun zeros(n: Long) {
            if (n > 0) parts += Part.Zeros(n)
        }
    }

    /**
     * Cleans [file] in place: the same file without what a photo or video
     * says about itself, or untouched when there is nothing to take out or it
     * is not a kind this knows. It never fails; a file it cannot read stays as
     * it came. Returns whether anything changed.
     */
    fun scrub(file: File): Boolean {
        return try {
            val plan = RandomAccessFile(file, "r").use { raf -> planScrub(Source(raf)) } ?: return false
            val tmp = File(file.parentFile, file.name + ".scrub")
            RandomAccessFile(file, "r").use { raf -> tmp.outputStream().buffered(1 shl 16).use { out -> write(plan, raf, out) } }
            if (!tmp.renameTo(file)) {
                tmp.delete()
                return false
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /** The cleaned bytes of [data], or null when nothing would change (for tests and small files). */
    fun scrubBytes(data: ByteArray): ByteArray? {
        val f = File.createTempFile("scrub", ".bin")
        try {
            f.writeBytes(data)
            val plan = RandomAccessFile(f, "r").use { planScrub(Source(it)) } ?: return null
            val out = java.io.ByteArrayOutputStream()
            RandomAccessFile(f, "r").use { write(plan, it, out) }
            return out.toByteArray()
        } catch (_: Exception) {
            return null
        } finally {
            f.delete()
        }
    }

    private fun write(plan: Plan, raf: RandomAccessFile, out: java.io.OutputStream) {
        val buf = ByteArray(1 shl 16)
        for (p in plan.parts) when (p) {
            is Part.Lit -> out.write(p.bytes)
            is Part.Zeros -> {
                var left = p.n
                java.util.Arrays.fill(buf, 0)
                while (left > 0) {
                    val n = minOf(left, buf.size.toLong()).toInt()
                    out.write(buf, 0, n)
                    left -= n
                }
            }
            is Part.Keep -> {
                raf.seek(p.off)
                var left = p.n
                while (left > 0) {
                    val n = raf.read(buf, 0, minOf(left, buf.size.toLong()).toInt())
                    if (n < 0) throw java.io.EOFException()
                    out.write(buf, 0, n)
                    left -= n
                }
            }
        }
    }

    private fun has(b: ByteArray, i: Int, s: String): Boolean {
        if (b.size < i + s.length) return false
        for (k in s.indices) if ((b[i + k].toInt() and 0xff) != s[k].code) return false
        return true
    }

    private fun text(b: ByteArray, i: Int, n: Int): String = String(CharArray(n) { (b[i + it].toInt() and 0xff).toChar() })
    private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xff
    private fun u16be(b: ByteArray, i: Int) = (u8(b, i) shl 8) or u8(b, i + 1)
    private fun u16(b: ByteArray, i: Int, le: Boolean) = if (le) u8(b, i) or (u8(b, i + 1) shl 8) else u16be(b, i)
    private fun u32be(b: ByteArray, i: Int): Long = (u8(b, i).toLong() shl 24) or (u8(b, i + 1).toLong() shl 16) or (u8(b, i + 2).toLong() shl 8) or u8(b, i + 3).toLong()
    private fun u32le(b: ByteArray, i: Int): Long = u8(b, i).toLong() or (u8(b, i + 1).toLong() shl 8) or (u8(b, i + 2).toLong() shl 16) or (u8(b, i + 3).toLong() shl 24)
    private fun u32(b: ByteArray, i: Int, le: Boolean) = if (le) u32le(b, i) else u32be(b, i)

    private fun planScrub(src: Source): Plan? {
        val h = src.at(0, minOf(src.size, 12).toInt()) ?: return null
        if (h.size >= 3 && u8(h, 0) == 0xff && u8(h, 1) == 0xd8 && u8(h, 2) == 0xff) return planJPEG(src)
        if (has(h, 0, "\u0089PNG\r\n\u001a\n")) return planPNG(src)
        if (has(h, 0, "RIFF") && has(h, 8, "WEBP")) return planWebP(src)
        if (has(h, 0, "GIF87a") || has(h, 0, "GIF89a")) return planGIF(src)
        if (has(h, 4, "ftyp")) return planMP4(src)
        return null
    }

    // ---- JPEG ----

    private class Kept(val b: ByteArray, val app0: Boolean)

    /**
     * Leaves out the segments before a JPEG's picture data that describe it
     * rather than draw it: Exif and XMP (APP1), IPTC (APP13), comments and
     * every application segment but JFIF, an ICC profile and Adobe's. An
     * orientation other than upright comes back as an Exif segment holding
     * nothing else, so the photo still shows the right way up.
     */
    private fun planJPEG(src: Source): Plan? {
        val kept = ArrayList<Kept>()
        var orient = 0
        var order = ""
        var exifSeen = false
        var pos = 2L
        while (true) {
            var m = src.at(pos, 2) ?: return null
            if (u8(m, 0) != 0xff) return null
            while (u8(m, 1) == 0xff) {
                if (++pos > JPEG_HEAD_MAX) return null
                m = src.peek(pos, 2) ?: src.at(pos, 2) ?: return null
            }
            val marker = u8(m, 1)
            if (marker == 0xda) break
            if (marker == 0x00 || marker == 0xd8 || marker == 0xd9) return null
            if (marker == 0x01 || marker in 0xd0..0xd7) {
                kept += Kept(m, false)
                if (kept.size > MAX_PARTS) return null
                pos += 2
                continue
            }
            val l = src.at(pos + 2, 2) ?: return null
            val n = u16be(l, 0) + 2
            val seg = (if (n < 4) null else src.at(pos, n)) ?: return null
            val body = seg.copyOfRange(4, seg.size)
            var keep = true
            when {
                marker == 0xe0 -> keep = has(body, 0, "JFIF\u0000")
                marker == 0xe1 -> {
                    keep = false
                    if (!exifSeen && has(body, 0, "Exif\u0000\u0000")) {
                        exifSeen = true
                        val (o, ord) = exifOrientation(body.copyOfRange(6, body.size))
                        orient = o
                        order = ord
                    }
                }
                marker == 0xe2 -> keep = has(body, 0, "ICC_PROFILE\u0000")
                marker == 0xee -> keep = has(body, 0, "Adobe")
                marker in 0xe3..0xef || marker == 0xfe -> keep = false
            }
            if (keep) kept += Kept(seg, marker == 0xe0)
            pos += n
            if (pos > JPEG_HEAD_MAX || kept.size > MAX_PARTS) return null
        }
        val head = java.io.ByteArrayOutputStream()
        head.write(byteArrayOf(0xff.toByte(), 0xd8.toByte()))
        var i = 0
        while (i < kept.size && kept[i].app0) {
            head.write(kept[i].b); i++
        }
        if (orient > 1) head.write(exifOrientationOnly(orient, order))
        while (i < kept.size) {
            head.write(kept[i].b); i++
        }
        val out = head.toByteArray()
        if (out.size.toLong() == pos) {
            val was = src.at(0, pos.toInt())
            if (was != null && was.contentEquals(out)) return null
        }
        val plan = Plan()
        plan.add(out)
        plan.keep(pos, src.size - pos)
        return plan
    }

    /** The orientation in Exif's TIFF data, read as browsers read it, with its byte order ("II" or "MM"); 0 when none. */
    private fun exifOrientation(t: ByteArray): Pair<Int, String> {
        if (t.size < 8) return 0 to ""
        val order = text(t, 0, 2)
        if (order != "II" && order != "MM") return 0 to ""
        val le = order == "II"
        if (u16(t, 2, le) != 42) return 0 to ""
        val ifd = u32(t, 4, le)
        if (ifd < 8 || ifd > t.size - 2) return 0 to ""
        val count = u16(t, ifd.toInt(), le)
        for (k in 0 until count) {
            val e = ifd.toInt() + 2 + 12 * k
            if (e + 12 > t.size) break
            if (u16(t, e, le) != 0x0112) continue
            if (u16(t, e + 2, le) != 3 || u32(t, e + 4, le) != 1L) break
            val o = u16(t, e + 8, le)
            if (o in 1..8) return o to order
            break
        }
        return 0 to ""
    }

    /** An Exif segment saying nothing but which way up a photo goes, in the byte order the original used. */
    private fun exifOrientationOnly(o: Int, order: String): ByteArray {
        val seg = ByteArray(36)
        byteArrayOf(0xff.toByte(), 0xe1.toByte(), 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0).copyInto(seg)
        val le = order == "II"
        val mark = if (le) 0x49 else 0x4d
        seg[10] = mark.toByte()
        seg[11] = mark.toByte()
        fun put16(at: Int, v: Int) {
            if (le) { seg[10 + at] = v.toByte(); seg[11 + at] = (v shr 8).toByte() } else { seg[10 + at] = (v shr 8).toByte(); seg[11 + at] = v.toByte() }
        }
        fun put32(at: Int, v: Long) {
            if (le) for (k in 0 until 4) seg[10 + at + k] = (v shr (8 * k)).toByte() else for (k in 0 until 4) seg[10 + at + k] = (v shr (8 * (3 - k))).toByte()
        }
        put16(2, 42)
        put32(4, 8)
        put16(8, 1)
        put16(10, 0x0112)
        put16(12, 3)
        put32(14, 1)
        put16(18, o)
        return seg
    }

    // ---- PNG ----

    private val PNG_KEPT = setOf("tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCv", "cLLi", "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT")
    private val PNG_TYPE = Regex("^[A-Za-z]{4}$")

    /** Keeps a PNG's critical chunks and the ones a picture is drawn with, and nothing after the end. */
    private fun planPNG(src: Source): Plan? {
        val plan = Plan()
        plan.keep(0, 8)
        var changed = false
        var pos = 8L
        while (true) {
            val c = src.peek(pos, 8) ?: src.at(pos, 8) ?: return null
            val n = u32be(c, 0)
            val type = text(c, 4, 4)
            if (n > 0x7fffffff || n > src.size - pos - 12 || !PNG_TYPE.matches(type)) return null
            if ((u8(c, 4) and 0x20) == 0 || type in PNG_KEPT) {
                plan.keep(pos, n + 12)
                if (plan.parts.size > MAX_PARTS) return null
            } else changed = true
            pos += n + 12
            if (type == "IEND") {
                changed = changed || pos < src.size
                break
            }
        }
        return if (changed) plan else null
    }

    // ---- WebP ----

    /** Leaves out a WebP's EXIF and XMP chunks and clears the flags that said they were there. */
    private fun planWebP(src: Source): Plan? {
        val h = src.at(0, 12) ?: return null
        val end = 8 + u32le(h, 4)
        if (end < 12 || end > src.size) return null
        val kept = ArrayList<Pair<Long, Long>>()
        var size = 4L
        var vp8x = -1L
        var changed = end < src.size
        var pos = 12L
        while (pos < end) {
            val c = src.peek(pos, 8) ?: src.at(pos, 8)
            if (c == null || end - pos < 8) return null
            val n = u32le(c, 4)
            val next = pos + 8 + n + (n and 1)
            if (next > end) return null
            val id = text(c, 0, 4)
            if (id == "EXIF" || id == "XMP ") changed = true
            else {
                if (id == "VP8X" && vp8x < 0) {
                    if (n < 10) return null
                    vp8x = pos
                }
                kept += pos to (next - pos)
                if (kept.size > MAX_PARTS) return null
                size += next - pos
            }
            pos = next
        }
        var x: ByteArray? = null
        if (vp8x >= 0) {
            x = src.at(vp8x, 9)!!.copyOf()
            if ((u8(x, 8) and 0x0c) != 0) {
                x[8] = (u8(x, 8) and 0x0c.inv()).toByte()
                changed = true
            }
        }
        if (!changed) return null
        val riff = byteArrayOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)
        for (k in 0 until 4) riff[4 + k] = (size shr (8 * k)).toByte()
        val plan = Plan()
        plan.add(riff)
        for ((off, n) in kept) {
            if (off == vp8x && x != null) {
                plan.add(x)
                plan.keep(off + 9, n - 9)
            } else plan.keep(off, n)
        }
        return plan
    }

    // ---- GIF ----

    /** Leaves out a GIF's comments and its XMP; frames, the loop count and other extensions stay. */
    private fun planGIF(src: Source): Plan? {
        val h = src.at(0, 13) ?: return null
        var pos = 13L
        if ((u8(h, 10) and 0x80) != 0) pos += 3L shl ((u8(h, 10) and 7) + 1)
        val plan = Plan()
        plan.keep(0, pos)
        var changed = false
        while (true) {
            val b = src.byteAt(pos) ?: return null
            when (b) {
                0x3b -> {
                    plan.keep(pos, 1)
                    return if (!changed && pos + 1 == src.size) null else plan
                }
                0x2c -> {
                    val d = src.at(pos, 10) ?: return null
                    var p = pos + 10
                    if ((u8(d, 9) and 0x80) != 0) p += 3L shl ((u8(d, 9) and 7) + 1)
                    p = gifSkipBlocks(src, p + 1)
                    if (p < 0) return null
                    plan.keep(pos, p - pos)
                    if (plan.parts.size > MAX_PARTS) return null
                    pos = p
                }
                0x21 -> {
                    val e = src.at(pos, 2) ?: return null
                    val p = gifSkipBlocks(src, pos + 2)
                    if (p < 0) return null
                    var drop = u8(e, 1) == 0xfe
                    if (u8(e, 1) == 0xff) {
                        val a = src.at(pos + 2, 12)
                        drop = a != null && u8(a, 0) == 11 && has(a, 1, "XMP DataXMP")
                    }
                    if (drop) changed = true
                    else {
                        plan.keep(pos, p - pos)
                        if (plan.parts.size > MAX_PARTS) return null
                    }
                    pos = p
                }
                else -> return null
            }
        }
    }

    /** Where the data sub-blocks starting at p end, past their empty terminator, or -1 when the file ends first. */
    private fun gifSkipBlocks(src: Source, start: Long): Long {
        var p = start
        while (true) {
            val n = src.byteAt(p) ?: return -1
            if (n == 0) return p + 1
            p += 1 + n
        }
    }

    // ---- MP4 / QuickTime ----

    private const val XMP_UUID = "¾zÏË\u0097©Bè\u009cq\u0099\u0094\u0091ã¯¬"

    private val NOT_VIDEO_BRANDS = setOf(
        "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
        "mif1", "mif2", "msf1", "miaf", "MiHA", "MiHB", "MiHE", "MiPr",
        "avif", "avis", "avio", "avci", "avcs", "jpeg", "jpgs", "crx ",
        "M4A ", "M4B ", "M4P ", "F4A ", "F4B ",
    )

    private class Edit(val off: Long, val n: Long, val lit: ByteArray? = null)
    private class Walk(val edits: ArrayList<Edit> = ArrayList(), var moov: Boolean = false)

    /**
     * Blanks an MP4's or QuickTime movie's metadata where it lies (udta and
     * meta boxes, XMP boxes become free boxes of the same size) and zeroes the
     * times the movie, its tracks and their media were made. No byte moves, so
     * the movie's index stays right.
     */
    private fun planMP4(src: Source): Plan? {
        val n = u32be(src.at(0, 8) ?: return null, 0)
        if (n < 16 || n > 4096) return null
        val ftyp = src.at(0, n.toInt()) ?: return null
        var i = 8
        while (i + 4 <= n) {
            if (i != 12 && text(ftyp, i, 4) in NOT_VIDEO_BRANDS) return null
            i += 4
        }
        val w = Walk()
        if (!walkBoxes(src, w, 0, src.size, "") || !w.moov || w.edits.isEmpty() || w.edits.size > MAX_PARTS) return null
        val plan = Plan()
        var at = 0L
        for (e in w.edits) {
            plan.keep(at, e.off - at)
            if (e.lit != null) plan.add(e.lit) else plan.zeros(e.n)
            at = e.off + e.n
        }
        plan.keep(at, src.size - at)
        return plan
    }

    private fun walkBoxes(src: Source, w: Walk, start: Long, end: Long, inside: String): Boolean {
        var pos = start
        while (pos < end) {
            val h = if (end - pos < 8) null else src.at(pos, 8)
            if (h == null) {
                val rest = src.at(pos, (end - pos).toInt())
                return rest != null && end - pos < 8 && rest.all { it.toInt() == 0 }
            }
            var size = u32be(h, 0)
            var hdr = 8
            val type = text(h, 4, 4)
            if (size == 1L) {
                val l = (if (end - pos < 16) null else src.at(pos + 8, 8)) ?: return false
                val hi = u32be(l, 0)
                val lo = u32be(l, 4)
                if (hi > 0x1fffff) return false
                size = (hi shl 32) or lo
                hdr = 16
            } else if (size == 0L) {
                if (inside != "") return false
                size = end - pos
            }
            if (size < hdr || size > end - pos || w.edits.size > MAX_PARTS) return false
            when {
                inside == "" && type == "moov" -> {
                    w.moov = true
                    if (!walkBoxes(src, w, pos + hdr, pos + size, "moov")) return false
                }
                (inside == "moov" && type == "trak") || (inside == "trak" && type == "mdia") -> {
                    if (!walkBoxes(src, w, pos + hdr, pos + size, type)) return false
                }
                ((inside == "moov" || inside == "trak") && (type == "udta" || type == "meta")) || (inside == "" && type == "meta") -> blank(src, w, pos, size, hdr)
                inside != "mdia" && type == "uuid" -> {
                    val u = src.at(pos + hdr, 16)
                    if (u != null && size - hdr >= 16 && text(u, 0, 16) == XMP_UUID) blank(src, w, pos, size, hdr)
                }
                (inside == "moov" && type == "mvhd") || (inside == "trak" && type == "tkhd") || (inside == "mdia" && type == "mdhd") -> clearTimes(src, w, pos, size, hdr)
            }
            pos += size
        }
        return true
    }

    /** Turns the box at pos into a free box of the same size, zeroed. */
    private fun blank(src: Source, w: Walk, pos: Long, size: Long, hdr: Int) {
        val h = src.at(pos, hdr)!!.copyOf()
        byteArrayOf(0x66, 0x72, 0x65, 0x65).copyInto(h, 4)
        w.edits += Edit(pos, hdr.toLong(), h)
        w.edits += Edit(pos + hdr, size - hdr)
    }

    /** Zeroes the creation and modification times of a movie, track or media header. */
    private fun clearTimes(src: Source, w: Walk, pos: Long, size: Long, hdr: Int) {
        val v = src.at(pos + hdr, 1) ?: return
        if (u8(v, 0) > 1) return
        val n = if (u8(v, 0) == 1) 16 else 8
        if (size - hdr < 4 + n) return
        val t = src.at(pos + hdr + 4, n)
        if (t != null && t.any { it.toInt() != 0 }) w.edits += Edit(pos + hdr + 4, n.toLong())
    }
}
