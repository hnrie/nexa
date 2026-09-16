package xyz.evilion.chat.crypto

import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import java.text.Normalizer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Password and recovery-key derivation, matching web/src/crypto/kdf.ts.
 *
 * The password never leaves the device: argon2id stretches it into a master
 * key, and HKDF splits that into an authentication key (sent to the server as
 * proof of knowledge) and an encryption key (which wraps the identity key).
 */
object Kdf {
    const val KEY_LEN = 32

    data class Params(val m: Int, val t: Int, val p: Int, val v: Int = 1)

    val DEFAULT = Params(m = 65536, t = 3, p = 1)

    private val INFO_AUTH = "evilion-chat/auth/v1".toByteArray()
    private val INFO_ENC = "evilion-chat/enc/v1".toByteArray()
    private val INFO_SETTINGS = "evilion-chat/settings/v1".toByteArray()
    private val INFO_RECOVERY_AUTH = "evilion-chat/recovery-auth/v1".toByteArray()
    private val INFO_RECOVERY_ENC = "evilion-chat/recovery-enc/v1".toByteArray()

    private const val RECOVERY_BYTES = 32
    private const val RECOVERY_GROUPS = 8
    private const val RECOVERY_GROUP_LEN = 8

    private val argon2 by lazy { Argon2Kt() }

    /** Stretch a password into a 32-byte master key. Slow on purpose: seconds, not milliseconds. */
    fun deriveMaster(password: String, salt: ByteArray, params: Params): ByteArray {
        val normalized = Normalizer.normalize(password, Normalizer.Form.NFKC).toByteArray(Charsets.UTF_8)
        val result = argon2.hash(
            mode = Argon2Mode.ARGON2_ID,
            password = normalized,
            salt = salt,
            tCostInIterations = params.t,
            mCostInKibibyte = params.m,
            parallelism = params.p,
            hashLengthInBytes = KEY_LEN,
        )
        val out = result.rawHashAsByteArray()
        normalized.fill(0)
        return out
    }

    fun authKey(master: ByteArray): ByteArray = hkdf(master, INFO_AUTH)

    fun encKey(master: ByteArray): ByteArray = hkdf(master, INFO_ENC)

    /** Encrypts user settings; bound to the identity key so it survives a password change. */
    fun settingsKey(identityPrivateKey: ByteArray): ByteArray = hkdf(identityPrivateKey, INFO_SETTINGS)

    fun recoveryKeys(bytes: ByteArray): Pair<ByteArray, ByteArray> =
        hkdf(bytes, INFO_RECOVERY_AUTH) to hkdf(bytes, INFO_RECOVERY_ENC)

    /** A new recovery key: the bytes, and the grouped hex a person writes down. */
    fun newRecoveryKey(): Pair<ByteArray, String> {
        val bytes = Bytes.random(RECOVERY_BYTES)
        val hex = Bytes.hex(bytes).uppercase()
        val groups = (0 until RECOVERY_GROUPS).map { hex.substring(it * RECOVERY_GROUP_LEN, (it + 1) * RECOVERY_GROUP_LEN) }
        return bytes to groups.joinToString("-")
    }

    /** Parse a displayed recovery key. Dashes, spaces and case are all ignored. */
    fun recoveryKeyToBytes(display: String): ByteArray {
        val hex = display.replace(Regex("[\\s-]"), "")
        require(hex.length == RECOVERY_BYTES * 2 && hex.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }) {
            "invalid recovery key"
        }
        return ByteArray(RECOVERY_BYTES) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    /** HKDF-SHA256 with an empty salt, which is what every derivation here uses. */
    fun hkdf(ikm: ByteArray, info: ByteArray, length: Int = KEY_LEN): ByteArray {
        val prk = hmac(ByteArray(32), ikm)
        val out = ByteArray(length)
        var block = ByteArray(0)
        var done = 0
        var counter = 1
        while (done < length) {
            block = hmac(prk, Bytes.concat(block, info, byteArrayOf(counter.toByte())))
            val n = minOf(block.size, length - done)
            block.copyInto(out, done, 0, n)
            done += n
            counter++
        }
        return out
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }
}
