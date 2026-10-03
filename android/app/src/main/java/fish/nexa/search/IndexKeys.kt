package fish.nexa.search

import fish.nexa.crypto.Bytes

/**
 * The key that seals the search index on this device (web/src/search/keys.ts).
 *
 * A random key made on this device for this account, never sent anywhere,
 * kept wrapped under a key derived from the account's identity key, so it
 * can only be opened while the account is unlocked here. The wrapped key is
 * kept in the app's secure store (itself sealed by the Android Keystore).
 * Signing out removes it first, which makes whatever is left on disk
 * unreadable for good.
 */
object IndexKeys {
    private val INFO = Bytes.utf8("evilion-chat/search-index/v1")

    /** Where the wrapped key is kept: something that stores and forgets a few bytes per name. */
    interface Slot {
        fun get(name: String): String?
        fun put(name: String, value: String)
        fun delete(name: String)
    }

    fun slotName(userId: String) = "ec.searchKey.$userId"

    private fun kek(identityPrivateKey: ByteArray): ByteArray = Bytes.hkdf(identityPrivateKey, ByteArray(0), INFO, 32)

    private fun aad(userId: String) = Bytes.utf8("search-key/v1|$userId")

    class IndexKey(val key: ByteArray, /** Made just now: whatever was on disk before cannot be opened with it. */ val fresh: Boolean)

    /** The wrapped form of a key: iv then ciphertext, base64, as the web keeps it. */
    fun wrap(userId: String, identityPrivateKey: ByteArray, raw: ByteArray): String {
        val kek = kek(identityPrivateKey)
        try {
            val iv = Bytes.random(12)
            return Bytes.b64(Bytes.concat(iv, Bytes.gcmEncrypt(kek, iv, raw, aad(userId))))
        } finally {
            kek.fill(0)
        }
    }

    /** The key back from its wrapped form, or null when it was wrapped under another identity key or is damaged. */
    fun unwrap(userId: String, identityPrivateKey: ByteArray, stored: String): ByteArray? {
        val kek = kek(identityPrivateKey)
        return try {
            val blob = Bytes.unb64(stored)
            if (blob.size < 12 + 16) return null
            Bytes.gcmDecrypt(kek, blob.copyOfRange(0, 12), blob, aad(userId), 12, blob.size - 12)
        } catch (_: Exception) {
            null
        } finally {
            kek.fill(0)
        }
    }

    /** This account's index key on this device, made if there is none. */
    fun keyFor(slot: Slot, userId: String, identityPrivateKey: ByteArray): IndexKey? {
        slot.get(slotName(userId))?.let { stored -> unwrap(userId, identityPrivateKey, stored)?.let { return IndexKey(it, false) } }
        // none, or wrapped under another identity key (a recovery gave the account a new one): a new key, and a new index with it
        val raw = Bytes.random(32)
        val wrapped = wrap(userId, identityPrivateKey, raw)
        slot.put(slotName(userId), wrapped)
        if (slot.get(slotName(userId)) != wrapped) return null
        return IndexKey(raw, true)
    }

    fun forget(slot: Slot, userId: String) = slot.delete(slotName(userId))
}
