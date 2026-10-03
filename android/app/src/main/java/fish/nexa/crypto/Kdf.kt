package fish.nexa.crypto

import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import java.text.Normalizer

/**
 * Password and recovery-key derivation, as web/src/crypto/kdf.ts does it.
 *
 * argon2id stretches the password (NFKC, UTF-8) into a master key; HKDF splits
 * that into the key the server checks and the key that unwraps the identity.
 */
data class KdfParams(val m: Int, val t: Int, val p: Int, val v: Int = 1)

/** The server's parameters were outside what this client will use: see [Kdf.acceptable]. */
class WeakKdfError(message: String) : Exception(message)

object Kdf {
    val DEFAULT = KdfParams(m = 65536, t = 3, p = 1, v = 1)

    // The server's own validKDF range: a hostile server that asks for nothing
    // could grind the password back out of the auth key, and one that asks for
    // a gibibyte would hang the phone.
    private val FLOOR = KdfParams(m = 32768, t = 2, p = 1)
    private const val CEIL_M = 1 shl 20
    private const val CEIL_T = 20
    private const val CEIL_P = 4

    fun acceptable(p: KdfParams): Boolean =
        p.v == 1 && p.m in FLOOR.m..CEIL_M && p.t in FLOOR.t..CEIL_T && p.p in FLOOR.p..CEIL_P

    private const val KEY_LEN = 32
    private val INFO_AUTH = Bytes.utf8("evilion-chat/auth/v1")
    private val INFO_ENC = Bytes.utf8("evilion-chat/enc/v1")
    private val INFO_SETTINGS = Bytes.utf8("evilion-chat/settings/v1")
    private val INFO_RECOVERY_AUTH = Bytes.utf8("evilion-chat/recovery-auth/v1")
    private val INFO_RECOVERY_ENC = Bytes.utf8("evilion-chat/recovery-enc/v1")

    private val argon2 by lazy { Argon2Kt() }

    private fun expand(ikm: ByteArray, info: ByteArray) = Bytes.hkdf(ikm, ByteArray(0), info, KEY_LEN)

    /** Stretch a password into the 32-byte master key. Slow on purpose: call it off the main thread. */
    fun deriveMaster(password: String, salt: ByteArray, p: KdfParams): ByteArray {
        if (!acceptable(p)) throw WeakKdfError("argon2id parameters outside the accepted range: m=${p.m} t=${p.t} p=${p.p} v=${p.v}")
        val pw = Bytes.utf8(Normalizer.normalize(password, Normalizer.Form.NFKC))
        val result = argon2.hash(
            mode = Argon2Mode.ARGON2_ID,
            password = pw,
            salt = salt,
            tCostInIterations = p.t,
            mCostInKibibyte = p.m,
            parallelism = p.p,
            hashLengthInBytes = KEY_LEN,
            version = Argon2Version.V13,
        )
        pw.fill(0)
        return result.rawHashAsByteArray()
    }

    fun authKey(master: ByteArray) = expand(master, INFO_AUTH)
    fun encKey(master: ByteArray) = expand(master, INFO_ENC)

    /** Encrypts synced settings; bound to the identity so it survives a password change. */
    fun settingsKey(identityPrivate: ByteArray) = expand(identityPrivate, INFO_SETTINGS)

    /** A new recovery key: 32 random bytes, shown as eight groups of eight hex digits. */
    fun newRecoveryKey(): Pair<ByteArray, String> {
        val bytes = Bytes.random(32)
        val hex = Bytes.hex(bytes).uppercase()
        return bytes to (0 until 8).joinToString("-") { hex.substring(it * 8, it * 8 + 8) }
    }

    /** Reads a displayed recovery key back; dashes, spaces and case do not matter. */
    fun recoveryKeyBytes(display: String): ByteArray {
        val hex = display.replace(Regex("[\\s-]"), "")
        require(hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) { "invalid recovery key" }
        return ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    fun recoveryAuthKey(recovery: ByteArray) = expand(recovery, INFO_RECOVERY_AUTH)
    fun recoveryEncKey(recovery: ByteArray) = expand(recovery, INFO_RECOVERY_ENC)
}
