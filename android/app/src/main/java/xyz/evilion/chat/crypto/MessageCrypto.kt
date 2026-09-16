package xyz.evilion.chat.crypto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Message envelopes, matching web/src/crypto/message.ts.
 *
 * The server only ever sees an [Envelope]: a conversation id, an epoch and an
 * opaque AES-256-GCM ciphertext. The channel and author are bound into the
 * additional authenticated data, so a ciphertext cannot be replayed into
 * another channel or attributed to another author.
 */
@Serializable
data class Envelope(
    val v: Int = 1,
    val conv: String,
    val epoch: Int,
    /** base64 of the 12-byte GCM nonce. */
    val iv: String,
    /** base64 of the ciphertext and tag. */
    val ct: String,
)

data class Aad(val conv: String, val epoch: Int, val channelId: String, val authorId: String)

data class AttachmentMeta(
    val blobId: String,
    val name: String,
    val type: String,
    val size: Long,
    /** base64 of the per-file AES key. */
    val key: String,
    val width: Int? = null,
    val height: Int? = null,
    val spoiler: Boolean = false,
    val duration: Double? = null,
)

data class StickerRef(
    val id: String,
    val blob: String? = null,
    val name: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val animated: Boolean = false,
)

/** A link preview the sender generated; the server never makes one. */
data class Embed(
    val url: String,
    val type: String? = null,
    val title: String? = null,
    val description: String? = null,
    val siteName: String? = null,
    val image: String? = null,
    val imageW: Int? = null,
    val imageH: Int? = null,
    val videoId: String? = null,
    val mime: String? = null,
    val color: String? = null,
    val inviteCode: String? = null,
    val memberCount: Int? = null,
    val onlineCount: Int? = null,
)

data class MessagePayload(
    val text: String? = null,
    val attachments: List<AttachmentMeta> = emptyList(),
    val sticker: StickerRef? = null,
    val embeds: List<Embed> = emptyList(),
    val flags: Int? = null,
) {
    val isEmpty: Boolean get() = text.isNullOrEmpty() && attachments.isEmpty() && sticker == null && embeds.isEmpty()
}

object MessageCrypto {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    fun aadBytes(a: Aad): ByteArray = "${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}".toByteArray()

    fun encrypt(channelKey: ByteArray, aad: Aad, payload: MessagePayload): Envelope {
        val iv = Bytes.random(Aes.IV_LEN)
        val plaintext = json.encodeToString(JsonObject.serializer(), toJson(payload)).toByteArray()
        val ct = Aes.encrypt(channelKey, iv, plaintext, aadBytes(aad))
        return Envelope(v = 1, conv = aad.conv, epoch = aad.epoch, iv = Bytes.b64(iv), ct = Bytes.b64(ct))
    }

    fun decrypt(channelKey: ByteArray, env: Envelope, aad: Aad): MessagePayload {
        if (env.v != 1) throw DecryptError("unsupported envelope version")
        val iv = Bytes.unb64OrNull(env.iv) ?: throw DecryptError("malformed envelope")
        val ct = Bytes.unb64OrNull(env.ct) ?: throw DecryptError("malformed envelope")
        if (iv.size != Aes.IV_LEN) throw DecryptError("malformed envelope")
        val plaintext = try {
            Aes.decrypt(channelKey, iv, ct, aadBytes(aad))
        } catch (_: Exception) {
            throw DecryptError("message failed to decrypt")
        }
        val parsed = try {
            json.parseToJsonElement(plaintext.decodeToString())
        } catch (_: Exception) {
            throw DecryptError("malformed message payload")
        }
        if (parsed !is JsonObject) throw DecryptError("malformed message payload")
        return fromJson(parsed)
    }

    private fun toJson(p: MessagePayload): JsonObject = buildJsonObject {
        p.text?.let { put("t", it) }
        if (p.attachments.isNotEmpty()) {
            put("att", buildJsonArray {
                for (a in p.attachments) add(buildJsonObject {
                    put("blob_id", a.blobId)
                    put("name", a.name)
                    put("type", a.type)
                    put("size", a.size)
                    put("key", a.key)
                    a.width?.let { put("w", it) }
                    a.height?.let { put("h", it) }
                    a.duration?.let { put("duration", it) }
                    if (a.spoiler) put("spoiler", true)
                })
            })
        }
        p.sticker?.let { s ->
            put("sticker", buildJsonObject {
                put("id", s.id)
                s.blob?.let { put("blob", it) }
                s.name?.let { put("name", it) }
                s.width?.let { put("w", it) }
                s.height?.let { put("h", it) }
                if (s.animated) put("animated", true)
            })
        }
        if (p.embeds.isNotEmpty()) {
            put("embeds", buildJsonArray {
                for (e in p.embeds) add(buildJsonObject {
                    put("url", e.url)
                    e.type?.let { put("type", it) }
                    e.title?.let { put("title", it) }
                    e.description?.let { put("description", it) }
                    e.siteName?.let { put("site_name", it) }
                    e.image?.let { put("image", it) }
                    e.imageW?.let { put("image_w", it) }
                    e.imageH?.let { put("image_h", it) }
                    e.videoId?.let { put("video_id", it) }
                    e.mime?.let { put("mime", it) }
                    e.color?.let { put("color", it) }
                    e.inviteCode?.let { put("invite_code", it) }
                    e.memberCount?.let { put("member_count", it) }
                    e.onlineCount?.let { put("online_count", it) }
                })
            })
        }
        p.flags?.let { put("flags", it) }
    }

    /**
     * Anyone holding the key can encrypt whatever they like, so only
     * well-typed fields are kept; a payload that had content but none of it
     * usable counts as undecryptable, exactly as the web client treats it.
     */
    private fun fromJson(o: JsonObject): MessagePayload {
        val text = o.str("t")
        val attachments = (o["att"] as? JsonArray)?.mapNotNull { attachment(it) } ?: emptyList()
        val sticker = (o["sticker"] as? JsonObject)?.let { s ->
            s.str("id")?.let { id ->
                StickerRef(id, s.str("blob"), s.str("name"), s.int("w"), s.int("h"), s.bool("animated") == true)
            }
        }
        val embeds = (o["embeds"] as? JsonArray)?.mapNotNull { e ->
            val obj = e as? JsonObject ?: return@mapNotNull null
            val url = obj.str("url") ?: return@mapNotNull null
            Embed(
                url = url, type = obj.str("type"), title = obj.str("title"), description = obj.str("description"),
                siteName = obj.str("site_name"), image = obj.str("image"), imageW = obj.int("image_w"),
                imageH = obj.int("image_h"), videoId = obj.str("video_id"), mime = obj.str("mime"),
                color = obj.str("color"), inviteCode = obj.str("invite_code"),
                memberCount = obj.int("member_count"), onlineCount = obj.int("online_count"),
            )
        } ?: emptyList()
        val hadContent = o.containsKey("t") || o.containsKey("att") || o.containsKey("sticker") || o.containsKey("embeds")
        val out = MessagePayload(text, attachments, sticker, embeds, o.int("flags"))
        if (hadContent && out.isEmpty) throw DecryptError("malformed message payload")
        return out
    }

    private fun attachment(e: JsonElement): AttachmentMeta? {
        val o = e as? JsonObject ?: return null
        val blobId = o.str("blob_id") ?: return null
        val name = o.str("name") ?: return null
        val type = o.str("type") ?: return null
        val key = o.str("key") ?: return null
        val size = o.long("size") ?: return null
        if (size < 0) return null
        return AttachmentMeta(blobId, name, type, size, key, o.int("w"), o.int("h"), o.bool("spoiler") == true, o.double("duration"))
    }

    private fun JsonObject.prim(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)
    private fun JsonObject.str(key: String): String? = prim(key)?.takeIf { it.isString }?.content
    private fun JsonObject.int(key: String): Int? = prim(key)?.takeIf { !it.isString }?.intOrNull
    private fun JsonObject.long(key: String): Long? = prim(key)?.takeIf { !it.isString }?.longOrNull
    private fun JsonObject.double(key: String): Double? = prim(key)?.takeIf { !it.isString }?.doubleOrNull
    private fun JsonObject.bool(key: String): Boolean? = prim(key)?.takeIf { !it.isString }?.content?.toBooleanStrictOrNull()
}
