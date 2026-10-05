package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.crypto.Aad
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.Envelope
import fish.nexa.crypto.Identity
import fish.nexa.crypto.Keys
import fish.nexa.crypto.MessageCrypto
import fish.nexa.crypto.MessagePayload
import fish.nexa.net.Channel
import fish.nexa.net.Message
import fish.nexa.net.Snowflake
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

/** A followed announcement channel, as the channel it posts into sees it. */
@Serializable
data class Follow(
    val id: Snowflake,
    @SerialName("source_id") val sourceId: Snowflake = "",
    @SerialName("target_id") val targetId: Snowflake = "",
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("creator_id") val creatorId: Snowflake? = null,
    @SerialName("public_key") val publicKey: String = "",
    /** Its private key sealed with the target channel's key. */
    val secret: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("source_server_name") val sourceServerName: String = "",
    @SerialName("source_server_icon_id") val sourceServerIconId: Snowflake? = null,
    @SerialName("source_channel_name") val sourceChannelName: String = "",
    @SerialName("source_server_id") val sourceServerId: Snowflake? = null,
)

/**
 * Following announcement channels, end-to-end encrypted (web/src/lib/follows.ts).
 * A follow has a key pair of its own: the public half is what a publisher's
 * app seals each copy to, and the private half travels sealed with the
 * following channel's key, so only the people of that channel can open what
 * is published into it.
 */
object Follows {
    /** What a follow's sealed key is bound to: the channel it opens posts in, and the channel they come from. */
    private fun secretAad(conv: String, epoch: Int, targetId: String, sourceId: String) = Aad(conv, epoch, targetId, "follow:$sourceId")

    /** What a copy is bound to: the follow it was sealed for, and the post it is a copy of. */
    private fun copyAad(followId: String, sourceMessageId: String) = Bytes.utf8("crosspost|$followId|$sourceMessageId")

    private class FollowKey(val priv: ByteArray, val pub: ByteArray)

    /** The follows of each channel this app has opened, by follow. */
    private val keys = ConcurrentHashMap<String, Map<String, FollowKey>>()
    private val fetching = ConcurrentHashMap<String, Deferred<Unit>>()
    /** When each channel's follows were last fetched, so a copy that cannot be opened does not fetch them every time. */
    private val fetchedAt = ConcurrentHashMap<String, Long>()
    /** Follows whose key this app has sealed again under a newer channel key. */
    private val resealed: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** What a channel follows changed (or the keys did): opened again, and its copies with them. */
    fun forget(channelId: String) {
        keys.remove(channelId)
        fetchedAt.remove(channelId)
        Nexa.scope.launch {
            fetch(channelId).await()
            Nexa.messages.reopenCopies(channelId)
        }
    }

    fun clear() {
        keys.clear()
        fetchedAt.clear()
        resealed.clear()
    }

    /** Follows an announcement channel into a channel this account manages webhooks in. */
    suspend fun followInto(source: Channel, target: Channel): Follow {
        val conv = Nexa.channels.convFor(target.id)
        val (epoch, root) = Nexa.keys.ring.latest(conv) ?: throw IllegalStateException("no key for that channel")
        val key = fish.nexa.crypto.Conv.channelKey(root, target.id)
        val pair = Identity.generate()
        val secret = MessageCrypto.encrypt(key, secretAad(conv, epoch, target.id, source.id), MessagePayload(t = Bytes.b64(pair.privateKey)))
        val body = buildJsonObject {
            put("target_channel_id", target.id)
            put("public_key", Bytes.b64(pair.publicKey))
            put("secret", secret.toJson())
        }
        val f = Nexa.api.request("POST", "/channels/${source.id}/followers", Follow.serializer(), body)
        keys.remove(target.id)
        return f
    }

    private fun openSecret(f: Follow): FollowKey? {
        val env = runCatching { Envelope.from(MessageCrypto.json.parseToJsonElement(f.secret)) }.getOrNull() ?: return null
        val key = Nexa.keys.channelKey(env.conv, env.epoch, f.targetId) ?: return null
        return try {
            val p = MessageCrypto.decrypt(key, env, secretAad(env.conv, env.epoch, f.targetId, f.sourceId))
            val priv = Bytes.unb64(p.t ?: return null)
            val pub = Identity.publicKeyOf(priv)
            if (Bytes.b64(pub) != f.publicKey) return null
            resealIfOld(f, env, priv)
            FollowKey(priv, pub)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * People who join after a channel's key changes only get its newest key,
     * so a follow's key sealed under an older one is sealed again under the
     * newest by whoever can still open it.
     */
    private fun resealIfOld(f: Follow, env: Envelope, priv: ByteArray) {
        val (epoch, root) = Nexa.keys.ring.latest(env.conv) ?: return
        if (epoch <= env.epoch || !resealed.add(f.id)) return
        val key = fish.nexa.crypto.Conv.channelKey(root, f.targetId)
        Nexa.scope.launch {
            try {
                val secret = MessageCrypto.encrypt(key, secretAad(env.conv, epoch, f.targetId, f.sourceId), MessagePayload(t = Bytes.b64(priv)))
                Nexa.api.request("PUT", "/follows/${f.id}/secret", buildJsonObject { put("secret", secret.toJson()) })
            } catch (_: Exception) {
                resealed.remove(f.id)
            }
        }
    }

    /** Fetches what a channel follows and opens each follow's key. */
    private fun fetch(channelId: String): Deferred<Unit> {
        fetching[channelId]?.let { return it }
        val done = CompletableDeferred<Unit>()
        if (fetching.putIfAbsent(channelId, done) != null) return fetching[channelId] ?: done
        fetchedAt[channelId] = System.currentTimeMillis()
        Nexa.scope.launch {
            try {
                val list = Nexa.api.get("/channels/$channelId/follows", ListSerializer(Follow.serializer()))
                val out = HashMap<String, FollowKey>()
                for (f in list) openSecret(f)?.let { out[f.id] = it }
                keys[channelId] = out
            } catch (_: Exception) {
            } finally {
                fetching.remove(channelId)
                done.complete(Unit)
            }
        }
        return done
    }

    /**
     * Opens a published copy in a following channel with the keys already
     * here. Null when they are not (yet): they are fetched, and the copy is
     * opened again when they come.
     */
    fun openCopy(msg: Message): Result<MessagePayload>? {
        val info = msg.crosspost ?: return Result.failure(DecryptError("bad"))
        val sealed = msg.ciphertext as? JsonObject ?: return Result.failure(DecryptError("bad"))
        if ((sealed["v"] as? JsonPrimitive)?.intOrNull != 2) return Result.failure(DecryptError("bad"))
        val held = keys[msg.channelId]
        val fk = held?.get(info.followId)
        if (fk == null) {
            // a follow made (or its key sealed again) since the list was fetched
            val last = fetchedAt[msg.channelId] ?: 0L
            if (held == null || System.currentTimeMillis() - last > 30_000) Nexa.scope.launch {
                if (held != null) keys.remove(msg.channelId)
                fetch(msg.channelId).await()
                Nexa.messages.reopenCopies(msg.channelId)
            }
            return null
        }
        fun field(k: String) = (sealed[k] as? JsonPrimitive)?.contentOrNull
        return try {
            val k = Keys.open(fk.priv, fk.pub, Bytes.unb64(field("key") ?: return Result.failure(DecryptError("bad"))))
            val pt = Bytes.gcmDecrypt(k, Bytes.unb64(field("iv") ?: ""), Bytes.unb64(field("ct") ?: ""), copyAad(info.followId, info.messageId))
            val parsed = MessageCrypto.json.parseToJsonElement(Bytes.str(pt)) as? JsonObject ?: return Result.failure(DecryptError("bad"))
            Result.success(MessageCrypto.sanitizePayload(parsed))
        } catch (e: Exception) {
            Result.failure(DecryptError("bad"))
        }
    }

    /** What of a post goes out with it: what it says, its files and embeds, its sticker. */
    private fun copyPayload(p: MessagePayload) = MessagePayload(
        t = p.t?.takeIf { it.isNotEmpty() },
        att = p.att?.takeIf { it.isNotEmpty() },
        embeds = p.embeds?.takeIf { it.isNotEmpty() },
        sticker = p.sticker,
        flags = p.flags?.takeIf { it != 0.0 },
    )

    /**
     * Publishes a post of an announcement channel to every channel following
     * it (or brings the copies up to date after an edit): each copy sealed with
     * a key of its own, that key sealed to the follow. Says how many channels
     * it went to.
     */
    suspend fun publish(channelId: String, messageId: String, payload: MessagePayload): Int {
        val res = Nexa.api.get("/channels/$channelId/followers") as? JsonObject
        val followers = (res?.get("followers") as? JsonArray) ?: JsonArray(emptyList())
        val body = Bytes.utf8(copyPayload(payload).toJson().toString())
        val copies = buildJsonArray {
            for (el in followers) {
                val o = el as? JsonObject ?: continue
                val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: continue
                val pub = Bytes.unb64OrNull((o["public_key"] as? JsonPrimitive)?.contentOrNull) ?: continue
                if (pub.size != 32) continue
                val k = Bytes.random(32)
                val iv = Bytes.random(Bytes.IV_LEN)
                val ct = Bytes.gcmEncrypt(k, iv, body, copyAad(id, messageId))
                add(buildJsonObject {
                    put("follow_id", id)
                    put("ciphertext", buildJsonObject {
                        put("v", 2)
                        put("key", Bytes.b64(Keys.seal(pub, k)))
                        put("iv", Bytes.b64(iv))
                        put("ct", Bytes.b64(ct))
                    })
                })
            }
        }
        val out = Nexa.api.request("POST", "/channels/$channelId/messages/$messageId/crosspost", buildJsonObject { put("copies", copies) }) as? JsonObject
        return (out?.get("copies") as? JsonPrimitive)?.intOrNull ?: 0
    }
}
