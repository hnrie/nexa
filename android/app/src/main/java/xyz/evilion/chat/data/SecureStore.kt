package xyz.evilion.chat.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.Identity
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What this device keeps between launches: the session token, the account's
 * identity key and the conversation root keys it has been granted.
 *
 * All of it is sealed with a key held in the Android keystore, which on modern
 * phones lives in hardware and never reaches the app. That is strictly more
 * than the browser can do, where the same material sits in IndexedDB in the
 * clear. If the keystore refuses (some devices, some work profiles), the file
 * is written as it is: still inside app-private storage, no worse than the web.
 */
object SecureStore {
    private const val TAG = "SecureStore"
    private const val KEY_ALIAS = "evilion.chat.master"
    private const val FILE = "secure.bin"
    private const val IV_LEN = 12

    @Serializable
    data class StoredRoot(val conv: String, val epoch: Int, val root: String)

    @Serializable
    data class Vault(
        val token: String? = null,
        val userId: String? = null,
        val publicKey: String? = null,
        val privateKey: String? = null,
        val roots: List<StoredRoot> = emptyList(),
        val serverUrl: String? = null,
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Volatile
    private var cache: Vault? = null

    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    @Synchronized
    fun read(): Vault {
        cache?.let { return it }
        val file = File(appContext.filesDir, FILE)
        val loaded = if (!file.exists()) {
            Vault()
        } else {
            runCatching {
                val raw = file.readBytes()
                val plain = if (raw.size > IV_LEN && keyOrNull() != null) {
                    decrypt(raw)
                } else {
                    raw
                }
                json.decodeFromString<Vault>(plain.decodeToString())
            }.getOrElse {
                Log.w(TAG, "could not read the key store; starting fresh", it)
                Vault()
            }
        }
        cache = loaded
        return loaded
    }

    @Synchronized
    fun write(update: (Vault) -> Vault) {
        val next = update(read())
        cache = next
        val bytes = json.encodeToString(Vault.serializer(), next).toByteArray()
        val file = File(appContext.filesDir, FILE)
        runCatching {
            val out = if (keyOrNull() != null) encrypt(bytes) else bytes
            file.writeBytes(out)
        }.onFailure { Log.w(TAG, "could not write the key store", it) }
    }

    fun token(): String? = read().token

    fun saveToken(token: String?, userId: String?) = write { it.copy(token = token, userId = userId) }

    fun identity(userId: String): Identity? {
        val v = read()
        if (v.userId != userId) return null
        val pub = Bytes.unb64OrNull(v.publicKey) ?: return null
        val priv = Bytes.unb64OrNull(v.privateKey) ?: return null
        return Identity(pub, priv)
    }

    fun saveIdentity(userId: String, identity: Identity) = write {
        it.copy(userId = userId, publicKey = Bytes.b64(identity.publicKey), privateKey = Bytes.b64(identity.privateKey))
    }

    fun forgetIdentity() = write { it.copy(publicKey = null, privateKey = null) }

    fun roots(userId: String): List<Triple<String, Int, ByteArray>> {
        val v = read()
        if (v.userId != userId) return emptyList()
        return v.roots.mapNotNull { r ->
            Bytes.unb64OrNull(r.root)?.let { Triple(r.conv, r.epoch, it) }
        }
    }

    fun saveRoots(userId: String, roots: List<Triple<String, Int, ByteArray>>) = write {
        it.copy(userId = userId, roots = roots.map { (conv, epoch, root) -> StoredRoot(conv, epoch, Bytes.b64(root)) })
    }

    fun serverUrl(): String? = read().serverUrl

    fun saveServerUrl(url: String) = write { it.copy(serverUrl = url) }

    /** Signing out: nothing of the account is left on the device. */
    @Synchronized
    fun clear() {
        cache = Vault(serverUrl = read().serverUrl)
        write { Vault(serverUrl = it.serverUrl) }
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Bytes.concat(cipher.iv, cipher.doFinal(plain))
    }

    private fun decrypt(raw: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_LEN))
        return cipher.doFinal(raw, IV_LEN, raw.size - IV_LEN)
    }

    private fun keyOrNull(): SecretKey? = runCatching { key() }.getOrNull()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
