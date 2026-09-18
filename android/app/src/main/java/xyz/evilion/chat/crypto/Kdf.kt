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

    /**
     * The weakest and the heaviest argon2id parameters this client will stretch
     * a password with.
     *
     * Registration picks DEFAULT, but every later sign-in asks the *server*
     * which parameters to use, because the account may have been registered
     * with others. A server that answers {m = 8, t = 1} makes the stretching
     * free, and since the client then hands `hkdf(argon2id(password, …), auth)`
     * back as proof of knowledge, that server grinds the proof into the
     * plaintext password in seconds — and with the password it unwraps the
     * identity private key it already stores.
     *
     * The numbers are the server's own, from validKDF in
     * internal/api/auth_handlers.go, which is what it accepts when a client
     * *submits* parameters. Mirroring them exactly means no account the server
     * ever allowed to register can be refused by its own client. The ceiling
     * matters as much as the floor on a phone: without it a hostile server
     * wedges the app with a gibibyte of memory and twenty passes, which is
     * indistinguishable from a hang.
     */
    val FLOOR = Params(m = 32768, t = 2, p = 1)
    val CEILING = Params(m = 1 shl 20, t = 20, p = 4)

    /** Thrown instead of deriving anything with parameters outside that range. */
    class WeakParams(message: String) : Exception(message)

    /**
     * Whether parameters are ones this client is willing to use. The params
     * version is checked too: registration has only ever written 1, and a
     * version this build does not know is not something to guess at.
     */
    fun acceptable(p: Params): Boolean =
        p.v == 1 && p.m >= FLOOR.m && p.m <= CEILING.m && p.t >= FLOOR.t && p.t <= CEILING.t && p.p >= FLOOR.p && p.p <= CEILING.p

    private val INFO_AUTH = "evilion-chat/auth/v1".toByteArray()
    private val INFO_ENC = "evilion-chat/enc/v1".toByteArray()
    private val INFO_SETTINGS = "evilion-chat/settings/v1".toByteArray()
    private val INFO_RECOVERY_AUTH = "evilion-chat/recovery-auth/v1".toByteArray()
    private val INFO_RECOVERY_ENC = "evilion-chat/recovery-enc/v1".toByteArray()

    private const val RECOVERY_BYTES = 32
    private const val RECOVERY_GROUPS = 8
    private const val RECOVERY_GROUP_LEN = 8

    private val argon2 by lazy { Argon2Kt() }

    /**
     * Stretch a password into a 32-byte master key. Slow on purpose: seconds,
     * not milliseconds.
     *
     * The parameter check sits here, at the one place every argon2id
     * derivation in the app passes through, rather than only where the
     * parameters arrive: a path added later that forgets to check is then
     * still safe.
     */
    fun deriveMaster(password: String, salt: ByteArray, params: Params): ByteArray {
        if (!acceptable(params)) throw WeakParams("argon2id parameters outside the accepted range: m=${params.m} t=${params.t} p=${params.p} v=${params.v}")
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
