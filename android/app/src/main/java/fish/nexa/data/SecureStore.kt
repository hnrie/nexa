package fish.nexa.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import fish.nexa.crypto.Bytes
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small secrets kept on this device: the session token, the identity key, the
 * conversation roots this device has opened, and the identity keys it pinned.
 *
 * Each record is a file sealed with an AES-256-GCM key that lives in the
 * Android Keystore (in hardware on most phones) and never leaves it, so the
 * files read as noise to anything but this app on this phone. The browser
 * keeps the same material in IndexedDB in the clear; this is stricter, never
 * looser. Records are named per account.
 */
class SecureStore(context: Context) {
    private val dir = File(context.noBackupFilesDir, "secure").apply { mkdirs() }

    private val key: SecretKey by lazy {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    private fun file(name: String) = File(dir, name.replace(Regex("[^A-Za-z0-9._-]"), "_"))

    @Synchronized fun put(name: String, data: ByteArray) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key)
        val sealed = Bytes.concat(c.iv, c.doFinal(data))
        val f = file(name)
        val tmp = File(dir, f.name + ".tmp")
        tmp.writeBytes(sealed)
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
    }

    @Synchronized fun get(name: String): ByteArray? {
        val f = file(name)
        if (!f.exists()) return null
        return try {
            val raw = f.readBytes()
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            c.doFinal(raw, 12, raw.size - 12)
        } catch (_: Exception) {
            // a record that no longer opens (the app's keystore entry was reset) is gone
            f.delete()
            null
        }
    }

    fun putString(name: String, value: String) = put(name, Bytes.utf8(value))
    fun getString(name: String): String? = get(name)?.let { Bytes.str(it) }

    @Synchronized fun delete(name: String) {
        file(name).delete()
    }

    @Synchronized fun deletePrefix(prefix: String) {
        val p = file(prefix).name
        dir.listFiles()?.filter { it.name.startsWith(p) }?.forEach { it.delete() }
    }

    companion object {
        private const val ALIAS = "nexa-device-key"
    }
}
