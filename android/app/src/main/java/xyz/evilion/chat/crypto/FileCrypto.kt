package xyz.evilion.chat.crypto

import java.io.File
import java.io.InputStream
import java.io.OutputStream

/**
 * The attachment format, matching web/src/crypto/fileChunks.ts.
 *
 * Layout: "ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext].
 * Chunk `i` covers input bytes [i*CHUNK, (i+1)*CHUNK) and is encrypted under
 * iv = base iv ‖ u32be(i), which binds each chunk to its position: chunks
 * cannot be reordered, dropped or spliced in from another file without failing
 * the tag. A zero-length input still produces one chunk, so an empty file
 * authenticates.
 */
object FileCrypto {
    const val CHUNK = 4 * 1024 * 1024
    val MAGIC = "ECF1".toByteArray()
    const val BASE_IV_LEN = Aes.IV_LEN - 4
    val HEADER_LEN = MAGIC.size + BASE_IV_LEN
    const val LEN_PREFIX = 4
    /** The frame of every chunk but the last. */
    val FRAME_LEN = LEN_PREFIX + CHUNK + Aes.TAG_LEN
    private val FILE_AAD = "file/v1".toByteArray()

    fun newFileKey(): ByteArray = Bytes.random(Kdf.KEY_LEN)

    fun newBaseIv(): ByteArray = Bytes.random(BASE_IV_LEN)

    fun chunkCount(plainSize: Long): Int =
        maxOf(1L, (plainSize + CHUNK - 1) / CHUNK).toInt()

    /** The exact size of the ciphertext for `plainSize` bytes, known before encrypting. */
    fun encryptedSize(plainSize: Long): Long =
        HEADER_LEN + chunkCount(plainSize).toLong() * (LEN_PREFIX + Aes.TAG_LEN) + plainSize

    /** Where chunk `i`'s frame begins in the ciphertext. */
    fun frameOffset(i: Int): Long = HEADER_LEN + i.toLong() * FRAME_LEN

    private fun chunkIv(baseIv: ByteArray, index: Int): ByteArray = Bytes.concat(baseIv, Bytes.u32be(index))

    /**
     * The ciphertext of chunks [first, first + count), preceded by the header
     * when `first` is 0: the bytes that belong at that stretch of the file.
     * `read` hands back the plaintext of one chunk.
     */
    fun encryptChunks(
        key: ByteArray,
        baseIv: ByteArray,
        first: Int,
        count: Int,
        read: (index: Int) -> ByteArray,
        out: OutputStream,
    ) {
        if (first == 0) {
            out.write(MAGIC)
            out.write(baseIv)
        }
        for (i in first until first + count) {
            val plaintext = read(i)
            val ct = Aes.encrypt(key, chunkIv(baseIv, i), plaintext, FILE_AAD)
            out.write(Bytes.u32be(ct.size))
            out.write(ct)
        }
    }

    /** Encrypts a whole small payload (a sticker, an avatar-sized file) in one go. */
    fun encryptBytes(data: ByteArray, key: ByteArray = newFileKey()): Pair<ByteArray, ByteArray> {
        val baseIv = newBaseIv()
        val out = java.io.ByteArrayOutputStream(encryptedSize(data.size.toLong()).toInt())
        encryptChunks(key, baseIv, 0, chunkCount(data.size.toLong()), { i ->
            val start = i * CHUNK
            data.copyOfRange(start, minOf(start + CHUNK, data.size))
        }, out)
        return key to out.toByteArray()
    }

    /**
     * Decrypts a downloaded attachment into `dest`. Chunks are authenticated as
     * they go, so a truncated or altered file fails rather than being written
     * out in part.
     */
    fun decryptStream(input: InputStream, key: ByteArray, dest: OutputStream, onProgress: ((Long) -> Unit)? = null): Long {
        val header = Bytes.readUpTo(input, HEADER_LEN)
        if (header.size < HEADER_LEN) throw DecryptError("file: truncated header")
        if (!Bytes.equal(header.copyOf(MAGIC.size), MAGIC)) throw DecryptError("file: bad magic")
        val baseIv = header.copyOfRange(MAGIC.size, HEADER_LEN)

        var index = 0
        var written = 0L
        while (true) {
            val lenBytes = Bytes.readUpTo(input, LEN_PREFIX)
            if (lenBytes.isEmpty()) break
            if (lenBytes.size < LEN_PREFIX) throw DecryptError("file: truncated chunk header")
            val len = Bytes.readU32be(lenBytes, 0)
            if (len < Aes.TAG_LEN || len > CHUNK + Aes.TAG_LEN) throw DecryptError("file: bad chunk length")
            val ct = Bytes.readUpTo(input, len)
            if (ct.size < len) throw DecryptError("file: truncated chunk")
            val plaintext = try {
                Aes.decrypt(key, chunkIv(baseIv, index), ct, FILE_AAD)
            } catch (_: Exception) {
                throw DecryptError("file: chunk failed to authenticate")
            }
            dest.write(plaintext)
            written += plaintext.size
            onProgress?.invoke(written)
            index++
        }
        if (index == 0) throw DecryptError("file: no chunks")
        return written
    }

    fun decryptToFile(input: InputStream, key: ByteArray, dest: File, onProgress: ((Long) -> Unit)? = null): File {
        dest.parentFile?.mkdirs()
        val tmp = File(dest.parentFile, dest.name + ".part")
        try {
            tmp.outputStream().buffered().use { out -> decryptStream(input, key, out, onProgress) }
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) throw DecryptError("file: could not be saved")
        } catch (e: Throwable) {
            tmp.delete()
            throw e
        }
        return dest
    }

    /**
     * One chunk of an encrypted file that is being read out of order, for
     * seeking in a video without decrypting what comes before it.
     */
    fun decryptChunk(ct: ByteArray, key: ByteArray, baseIv: ByteArray, index: Int): ByteArray =
        try {
            Aes.decrypt(key, chunkIv(baseIv, index), ct, FILE_AAD)
        } catch (_: Exception) {
            throw DecryptError("file: chunk failed to authenticate")
        }
}
