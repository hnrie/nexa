package fish.nexa.voice

import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Conv
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A call's frame keys: (key index, raw key) by ascending epoch, the index sealed with, and what they were made from. */
class VoiceKeys(val keys: List<Pair<Int, ByteArray>>, val send: Int, val version: String)

/**
 * The keys a call's frames are sealed with (web/src/voice/e2ee.ts): for the
 * newest few epochs of the channel's conversation, HKDF(root, "voice:" +
 * channel id), indexed by the epoch's low byte, sealing with the newest.
 */
object CallKeys {
    /**
     * How many of a conversation's newest epochs a call can open. A call only
     * ever seals with the newest, and a device a few rotations behind catches up
     * within seconds.
     */
    private const val CALL_EPOCHS = 8

    private fun callEpochs(conv: String): List<Int> = Nexa.keys.ring.epochs(conv).sorted().takeLast(CALL_EPOCHS)

    /** What `keysFor` would report, without deriving anything. */
    fun versionFor(channelId: String): String? {
        val conv = Nexa.channels.convFor(channelId)
        val epochs = callEpochs(conv)
        if (epochs.isEmpty()) return null
        return "$conv:${epochs.joinToString(",")}"
    }

    fun keysFor(channelId: String): VoiceKeys? {
        val conv = Nexa.channels.convFor(channelId)
        val epochs = callEpochs(conv)
        val newest = epochs.lastOrNull() ?: return null
        val keys = epochs.mapNotNull { epoch -> Nexa.keys.ring.get(conv, epoch)?.let { (epoch and 0xff) to Conv.voiceFrameKey(it, channelId) } }
        if (keys.isEmpty()) return null
        return VoiceKeys(keys, newest and 0xff, "$conv:${epochs.joinToString(",")}")
    }

    // --- guests (web/src/voice/guestKeys.ts) -------------------------------

    /** How many of the newest keys a relay carries, well inside what a guest takes from one. */
    private const val RELAY_NEWEST = 8

    /** Relayed keys are sealed with a key derived from the link's call key, never with a key that seals frames. */
    private fun relayKey(linkKey: ByteArray): ByteArray = Bytes.hkdf(linkKey, ByteArray(0), Bytes.utf8("guest-relay"), 32)

    /** Binds a sealed key to its call, its guest and its epoch, so it cannot be passed off as another. */
    private fun relayAad(channelId: String, guestId: String, epoch: Int): ByteArray = Bytes.utf8("guest-key:$channelId:$guestId:$epoch")

    /**
     * The call keys newer than a guest's link, sealed for that guest:
     * `{"base": <link epoch>, "keys": [{"epoch", "iv", "ct"}]}`, or null when
     * this device does not hold the link's epoch or has nothing newer.
     */
    fun sealForGuest(channelId: String, guestId: String, base: Int, epochs: List<Int>, rootOf: (Int) -> ByteArray?): JsonObject? {
        val baseRoot = rootOf(base) ?: return null
        val wrap = relayKey(Conv.voiceFrameKey(baseRoot, channelId))
        val wanted = epochs.filter { it > base }.sorted().takeLast(RELAY_NEWEST)
        val sealed = wanted.mapNotNull { epoch ->
            val root = rootOf(epoch) ?: return@mapNotNull null
            val iv = Bytes.random(12)
            val ct = Bytes.gcmEncrypt(wrap, iv, Conv.voiceFrameKey(root, channelId), relayAad(channelId, guestId, epoch))
            Triple(epoch, Bytes.b64(iv), Bytes.b64(ct))
        }
        if (sealed.isEmpty()) return null
        return buildJsonObject {
            put("base", base)
            put("keys", buildJsonArray {
                for ((epoch, iv, ct) in sealed) add(buildJsonObject {
                    put("epoch", epoch)
                    put("iv", iv)
                    put("ct", ct)
                })
            })
        }
    }
}
