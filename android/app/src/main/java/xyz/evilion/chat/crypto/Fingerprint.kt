package xyz.evilion.chat.crypto

import java.security.MessageDigest

/**
 * Safety numbers: a short, readable stand-in for an identity public key,
 * matching web/src/crypto/fingerprint.ts byte for byte.
 *
 * Remembering the key first seen for someone (see KeyPins) catches a key that
 * *changes*. It cannot catch a key that was the server's own from the very
 * first sight, because there is nothing on the device to compare it against.
 * Only two people checking somewhere the server cannot reach closes that, so
 * there has to be something short enough to read down a phone line.
 *
 * The derivation follows Signal's safety numbers, for their reasons:
 *
 * - **Decimal digits, not words.** A wordlist would have to be identical on
 *   three platforms and reads badly in the eleven languages this app ships.
 *   Digits are unambiguous spoken aloud in any of them.
 * - **Groups of five.** People compare in chunks; a thirty-character run is
 *   where the eye slips.
 * - **Iterated hashing.** Thirty digits is about 99.7 bits, which nobody is
 *   brute-forcing. The iteration is for the reader who checks only the first
 *   group or two: grinding a key whose fingerprint merely *starts* the same
 *   costs 5200 SHA-256 evaluations a try rather than one.
 *
 * The exact bytes matter, because a phone and a browser must print the same
 * digits for the same key or the comparison means nothing:
 *
 *     h = SHA-256("evilion-chat/fingerprint/v1" ‖ key)
 *     h = SHA-256(h ‖ key), repeated until 5200 hashes have been taken
 *     digits = for g in 0..5: uint40be(h[5g .. 5g+5]) mod 100000, zero-padded
 *
 * CryptoTest pins the result for a key the web tests pin too; change one and
 * the other fails.
 */
object Fingerprint {
    private val PREFIX = "evilion-chat/fingerprint/v1".toByteArray()

    /** Total SHA-256 evaluations, Signal's count. */
    private const val ROUNDS = 5200

    private const val GROUPS = 6
    private const val GROUP_BYTES = 5
    private const val GROUP_MOD = 100_000L

    /** An x25519 public key is 32 bytes; anything else is not a key we can name. */
    private const val KEY_LEN = 32

    /**
     * The safety number for an identity public key: thirty digits in six
     * groups, such as `84234 17400 39277 85751 92324 02841`.
     */
    fun of(publicKey: ByteArray): String {
        require(publicKey.size == KEY_LEN) { "fingerprint: not an identity public key" }
        val sha = MessageDigest.getInstance("SHA-256")
        var h = sha.digest(Bytes.concat(PREFIX, publicKey))
        for (i in 1 until ROUNDS) h = sha.digest(Bytes.concat(h, publicKey))
        return (0 until GROUPS).joinToString(" ") { g -> group(h, g * GROUP_BYTES) }
    }

    /**
     * The same thing for a key in the shape the API carries it. Null rather
     * than an exception for a missing or malformed key: callers are drawing a
     * profile, where a blank space is the honest answer.
     */
    fun ofB64(publicKeyB64: String?): String? {
        if (publicKeyB64.isNullOrEmpty()) return null
        val bytes = Bytes.unb64OrNull(publicKeyB64) ?: return null
        if (bytes.size != KEY_LEN) return null
        return of(bytes)
    }

    /** The five digits a group of five bytes stands for, read big-endian. */
    private fun group(h: ByteArray, at: Int): String {
        var n = 0L
        for (i in 0 until GROUP_BYTES) n = (n shl 8) or (h[at + i].toLong() and 0xff)
        return (n % GROUP_MOD).toString().padStart(5, '0')
    }
}
