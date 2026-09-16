package xyz.evilion.chat.crypto

import java.util.concurrent.ConcurrentHashMap

/**
 * Conversation key material, matching web/src/crypto/conv.ts.
 *
 * A conversation has a root key per epoch; rotating membership bumps the epoch
 * and issues a new root. Per-channel keys derive from the root, so one grant
 * covers every channel in the conversation.
 */
object Conv {
    fun newRootKey(): ByteArray = Bytes.random(Kdf.KEY_LEN)

    fun channelKey(root: ByteArray, channelId: String): ByteArray =
        Kdf.hkdf(root, "chan:$channelId".toByteArray())

    /**
     * The key a call's audio and video frames are sealed with. Everyone who can
     * read the channel can hear its call; it is derived apart from the message
     * key so that one never stands in for the other.
     */
    fun voiceFrameKey(root: ByteArray, channelId: String): ByteArray =
        Kdf.hkdf(root, "voice:$channelId".toByteArray())
}

/** The root keys this session can read, by conversation and epoch. */
class KeyRing {
    private val rings = ConcurrentHashMap<String, ConcurrentHashMap<Int, ByteArray>>()
    private val channelKeys = ConcurrentHashMap<String, ByteArray>()

    fun set(conv: String, epoch: Int, root: ByteArray) {
        rings.getOrPut(conv) { ConcurrentHashMap() }[epoch] = root
    }

    fun get(conv: String, epoch: Int): ByteArray? = rings[conv]?.get(epoch)

    fun latest(conv: String): Pair<Int, ByteArray>? =
        rings[conv]?.entries?.maxByOrNull { it.key }?.let { it.key to it.value }

    fun has(conv: String): Boolean = (rings[conv]?.size ?: 0) > 0

    fun convs(): List<String> = rings.keys.toList()

    fun epochs(conv: String): List<Int> = rings[conv]?.keys?.sorted() ?: emptyList()

    /** The channel key for one epoch, derived once and kept. */
    fun channelKey(conv: String, epoch: Int, channelId: String): ByteArray? {
        val cacheKey = "$conv:$epoch:$channelId"
        channelKeys[cacheKey]?.let { return it }
        val root = get(conv, epoch) ?: return null
        return Conv.channelKey(root, channelId).also { channelKeys[cacheKey] = it }
    }

    fun clear() {
        rings.clear()
        channelKeys.clear()
    }
}
