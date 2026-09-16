package xyz.evilion.chat.crypto

import java.security.SecureRandom
import java.util.Base64

/** Byte-level primitives, matching web/src/crypto/bytes.ts. */
object Bytes {
    private val random = SecureRandom()

    fun random(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

    /** Standard base64 with padding, as the server's Go encoder produces. */
    fun b64(data: ByteArray): String = Base64.getEncoder().encodeToString(data)

    fun unb64(text: String): ByteArray = Base64.getDecoder().decode(text)

    /** Null instead of throwing, for anything that came off the wire. */
    fun unb64OrNull(text: String?): ByteArray? =
        if (text == null) null else runCatching { Base64.getDecoder().decode(text) }.getOrNull()

    fun concat(vararg parts: ByteArray): ByteArray {
        val out = ByteArray(parts.sumOf { it.size })
        var at = 0
        for (p in parts) {
            p.copyInto(out, at)
            at += p.size
        }
        return out
    }

    fun u32be(n: Int): ByteArray =
        byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())

    fun readU32be(data: ByteArray, offset: Int): Int =
        ((data[offset].toInt() and 0xff) shl 24) or
            ((data[offset + 1].toInt() and 0xff) shl 16) or
            ((data[offset + 2].toInt() and 0xff) shl 8) or
            (data[offset + 3].toInt() and 0xff)

    /** Constant time; a length mismatch is false without looking further. */
    fun equal(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    fun hex(data: ByteArray): String = data.joinToString("") { "%02x".format(it) }

    fun wipe(data: ByteArray?) {
        data?.fill(0)
    }
}

/** Thrown whenever a ciphertext fails to authenticate or is malformed. */
class DecryptError(message: String = "decryption failed") : Exception(message)
