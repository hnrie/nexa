package fish.nexa.crypto

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Byte-level primitives the rest of the crypto package shares, the same ones
 * web/src/crypto/bytes.ts and aes.ts provide: standard base64 with padding
 * (Go's StdEncoding), UTF-8, AES-256-GCM with a 12-byte nonce and a 16-byte
 * tag, HMAC/HKDF-SHA256 and SHA-256.
 */
object Bytes {
    private val random = SecureRandom()

    fun random(n: Int): ByteArray {
        require(n >= 0) { "random: invalid length" }
        return ByteArray(n).also { random.nextBytes(it) }
    }

    fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    private val B64_RE = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")

    /** Strict standard base64, as the web client's b64.dec: anything else is an error, not a guess. */
    fun unb64(s: String): ByteArray {
        if (!B64_RE.matches(s)) throw IllegalArgumentException("invalid base64")
        return Base64.getDecoder().decode(s)
    }

    fun unb64OrNull(s: String?): ByteArray? = try {
        if (s == null) null else unb64(s)
    } catch (_: IllegalArgumentException) {
        null
    }

    /** Base64 as an address can carry it: "-" and "_", no padding. */
    fun b64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private val B64URL_RE = Regex("^[A-Za-z0-9_-]*$")

    fun unb64url(s: String): ByteArray {
        if (!B64URL_RE.matches(s)) throw IllegalArgumentException("invalid base64url")
        return Base64.getUrlDecoder().decode(s)
    }

    fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

    fun str(b: ByteArray): String = String(b, Charsets.UTF_8)

    fun concat(vararg parts: ByteArray): ByteArray {
        val out = ByteArray(parts.sumOf { it.size })
        var at = 0
        for (p in parts) {
            System.arraycopy(p, 0, out, at, p.size)
            at += p.size
        }
        return out
    }

    /** Constant time for equal lengths; a length mismatch is simply false. */
    fun equal(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    fun u32be(n: Long): ByteArray {
        require(n in 0..0xffffffffL) { "u32be: out of range" }
        return byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())
    }

    fun readU32be(b: ByteArray, off: Int): Long {
        require(off >= 0 && off + 4 <= b.size) { "readU32be: out of range" }
        return ((b[off].toLong() and 0xff) shl 24) or ((b[off + 1].toLong() and 0xff) shl 16) or
            ((b[off + 2].toLong() and 0xff) shl 8) or (b[off + 3].toLong() and 0xff)
    }

    fun hex(b: ByteArray): String = buildString(b.size * 2) {
        for (x in b) {
            append(HEX[(x.toInt() shr 4) and 0xf])
            append(HEX[x.toInt() and 0xf])
        }
    }

    private const val HEX = "0123456789abcdef"

    fun sha256(vararg parts: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        for (p in parts) md.update(p)
        return md.digest()
    }

    fun hmacSha256(key: ByteArray, vararg parts: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        // An empty HMAC key is the same as a block of zeros, which the JCE will accept.
        mac.init(SecretKeySpec(if (key.isEmpty()) ByteArray(32) else key, "HmacSHA256"))
        for (p in parts) mac.update(p)
        return mac.doFinal()
    }

    /** RFC 5869 HKDF-SHA256; an empty salt is HashLen zeros, as noble treats it. */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmacSha256(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        val out = ByteArray(length)
        var t = ByteArray(0)
        var at = 0
        var counter = 1
        while (at < length) {
            t = hmacSha256(prk, t, info, byteArrayOf(counter.toByte()))
            val n = minOf(t.size, length - at)
            System.arraycopy(t, 0, out, at, n)
            at += n
            counter++
        }
        return out
    }

    const val IV_LEN = 12
    const val TAG_LEN = 16

    fun gcmEncrypt(key: ByteArray, iv: ByteArray, plaintext: ByteArray, aad: ByteArray, off: Int = 0, len: Int = plaintext.size): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
        if (aad.isNotEmpty()) c.updateAAD(aad)
        return c.doFinal(plaintext, off, len)
    }

    /** Throws [DecryptError] on any failure, so a bad tag reads the same as a malformed blob. */
    fun gcmDecrypt(key: ByteArray, iv: ByteArray, ciphertext: ByteArray, aad: ByteArray, off: Int = 0, len: Int = ciphertext.size): ByteArray {
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_LEN * 8, iv))
            if (aad.isNotEmpty()) c.updateAAD(aad)
            return c.doFinal(ciphertext, off, len)
        } catch (e: Exception) {
            throw DecryptError("decryption failed")
        }
    }
}

/** Thrown whenever a ciphertext fails to authenticate or is malformed. */
class DecryptError(message: String = "decryption failed") : Exception(message)
