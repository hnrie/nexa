package fish.nexa.crypto

import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile

/**
 * The attachment format (web/src/crypto/fileChunks.ts and file.ts):
 *
 *   "ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext and tag]
 *
 * Chunk i covers plaintext [i*CHUNK, (i+1)*CHUNK) under iv = base iv ‖ u32be(i)
 * and the additional data "file/v1", so chunks cannot be reordered, dropped or
 * spliced in from another file. An empty file is still one chunk. Every chunk
 * but the last is exactly CHUNK bytes, so where any chunk sits is known without
 * reading what comes before it: that is what lets a video seek.
 */
object FileCrypto {
    const val CHUNK = 4 * 1024 * 1024
    val MAGIC = Bytes.utf8("ECF1")
    const val BASE_IV_LEN = Bytes.IV_LEN - 4
    const val HEADER_LEN = 4 + BASE_IV_LEN
    const val LEN_PREFIX = 4
    const val FRAME_LEN = LEN_PREFIX + CHUNK + Bytes.TAG_LEN
    val FILE_AAD = Bytes.utf8("file/v1")

    fun newFileKey(): ByteArray = Bytes.random(32)
    fun newBaseIv(): ByteArray = Bytes.random(BASE_IV_LEN)

    fun chunkCount(plainSize: Long): Int = maxOf(1L, (plainSize + CHUNK - 1) / CHUNK).toInt()

    fun encryptedSize(plainSize: Long): Long = HEADER_LEN + chunkCount(plainSize).toLong() * (LEN_PREFIX + Bytes.TAG_LEN) + plainSize

    /** Where chunk i's frame begins in the ciphertext. */
    fun frameOffset(i: Int): Long = HEADER_LEN + i.toLong() * FRAME_LEN

    private fun chunkIv(baseIv: ByteArray, i: Int) = Bytes.concat(baseIv, Bytes.u32be(i.toLong()))

    /**
     * The ciphertext of chunks [first, first + count), with the header in
     * front when first is 0: the bytes at [frameOffset(first) or 0,
     * frameOffset(first + count)) of the whole encrypted file. The same key,
     * iv and bytes always give the same output, so a piece sent again after a
     * failure comes out identical.
     */
    fun encryptChunks(file: RandomAccessFile, plainSize: Long, key: ByteArray, baseIv: ByteArray, first: Int, count: Int): ByteArray {
        val chunks = chunkCount(plainSize)
        require(first >= 0 && count >= 1 && first + count <= chunks) { "encryptChunks: no such chunks" }
        require(baseIv.size == BASE_IV_LEN) { "encryptChunks: base iv must be 8 bytes" }
        val plain = minOf(plainSize, (first + count).toLong() * CHUNK) - first.toLong() * CHUNK
        val head = if (first == 0) HEADER_LEN else 0
        val out = ByteArray((head + count.toLong() * (LEN_PREFIX + Bytes.TAG_LEN) + plain).toInt())
        var off = 0
        if (head > 0) {
            System.arraycopy(MAGIC, 0, out, 0, 4)
            System.arraycopy(baseIv, 0, out, 4, BASE_IV_LEN)
            off = HEADER_LEN
        }
        val buf = ByteArray(CHUNK)
        for (i in first until first + count) {
            val start = i.toLong() * CHUNK
            val len = minOf(CHUNK.toLong(), plainSize - start).toInt()
            file.seek(start)
            file.readFully(buf, 0, len)
            val ct = Bytes.gcmEncrypt(key, chunkIv(baseIv, i), buf, FILE_AAD, 0, len)
            System.arraycopy(Bytes.u32be(ct.size.toLong()), 0, out, off, 4)
            off += 4
            System.arraycopy(ct, 0, out, off, ct.size)
            off += ct.size
        }
        buf.fill(0)
        return out
    }

    /** Encrypts a whole small buffer (a picture's copy, a sticker) in one go. */
    fun encryptBytes(data: ByteArray, key: ByteArray, baseIv: ByteArray = newBaseIv()): ByteArray {
        val chunks = chunkCount(data.size.toLong())
        val out = java.io.ByteArrayOutputStream(encryptedSize(data.size.toLong()).toInt())
        out.write(MAGIC)
        out.write(baseIv)
        for (i in 0 until chunks) {
            val start = i * CHUNK
            val len = minOf(CHUNK, data.size - start)
            val ct = Bytes.gcmEncrypt(key, chunkIv(baseIv, i), data, FILE_AAD, start, len)
            out.write(Bytes.u32be(ct.size.toLong()))
            out.write(ct)
        }
        return out.toByteArray()
    }

    /**
     * Decrypts a whole encrypted file as it streams in, writing plaintext as
     * each chunk authenticates. Throws [DecryptError] on anything altered or
     * cut short; whatever was written before that must be thrown away.
     */
    fun decryptStream(input: InputStream, key: ByteArray, output: OutputStream, expectedSize: Long? = null, onProgress: ((Long) -> Unit)? = null): Long {
        if (expectedSize != null && expectedSize < 0) throw DecryptError("file: invalid size")
        val din = DataInputStream(input)
        val header = ByteArray(HEADER_LEN)
        try {
            din.readFully(header)
        } catch (_: EOFException) {
            throw DecryptError("file: truncated header")
        }
        if (!Bytes.equal(header.copyOfRange(0, 4), MAGIC)) throw DecryptError("file: bad magic")
        val baseIv = header.copyOfRange(4, HEADER_LEN)
        val lenBuf = ByteArray(4)
        val buf = ByteArray(CHUNK + Bytes.TAG_LEN)
        var i = 0
        var done = 0L
        while (true) {
            val first = din.read()
            if (first < 0) break
            lenBuf[0] = first.toByte()
            try {
                din.readFully(lenBuf, 1, 3)
            } catch (_: EOFException) {
                throw DecryptError("file: truncated chunk header")
            }
            val len = Bytes.readU32be(lenBuf, 0)
            if (len < Bytes.TAG_LEN || len > CHUNK + Bytes.TAG_LEN) throw DecryptError("file: truncated chunk")
            try {
                din.readFully(buf, 0, len.toInt())
            } catch (_: EOFException) {
                throw DecryptError("file: truncated chunk")
            }
            val pt = try {
                Bytes.gcmDecrypt(key, chunkIv(baseIv, i), buf, FILE_AAD, 0, len.toInt())
            } catch (_: DecryptError) {
                throw DecryptError("file: chunk failed to authenticate")
            }
            if (expectedSize != null && pt.size.toLong() != minOf(CHUNK.toLong(), expectedSize - done)) {
                throw DecryptError("file: unexpected chunk size")
            }
            output.write(pt)
            done += pt.size
            onProgress?.invoke(done)
            i++
        }
        if (i == 0) throw DecryptError("file: no chunks")
        if (expectedSize != null && (done != expectedSize || i != chunkCount(expectedSize))) throw DecryptError("file: truncated file")
        return done
    }

    fun decryptBytes(data: ByteArray, key: ByteArray): ByteArray {
        val out = java.io.ByteArrayOutputStream(maxOf(0, data.size - HEADER_LEN))
        decryptStream(data.inputStream(), key, out)
        return out.toByteArray()
    }

    /** The plaintext size of an encrypted file of `encSize` bytes, when every chunk but the last is full. */
    fun plainSizeOf(encSize: Long): Long {
        if (encSize < HEADER_LEN + LEN_PREFIX + Bytes.TAG_LEN) return 0
        val body = encSize - HEADER_LEN
        val full = body / FRAME_LEN
        val rest = body % FRAME_LEN
        return full * CHUNK + if (rest > 0) rest - LEN_PREFIX - Bytes.TAG_LEN else 0
    }

    /** Decrypts one chunk's frame (length prefix included), fetched on its own for seeking. */
    fun decryptFrame(frame: ByteArray, key: ByteArray, baseIv: ByteArray, i: Int): ByteArray {
        if (frame.size < LEN_PREFIX + Bytes.TAG_LEN) throw DecryptError("file: truncated chunk")
        val len = Bytes.readU32be(frame, 0)
        if (len.toInt() != frame.size - LEN_PREFIX) throw DecryptError("file: truncated chunk")
        return try {
            Bytes.gcmDecrypt(key, chunkIv(baseIv, i), frame, FILE_AAD, LEN_PREFIX, frame.size - LEN_PREFIX)
        } catch (_: DecryptError) {
            throw DecryptError("file: chunk failed to authenticate")
        }
    }
}
