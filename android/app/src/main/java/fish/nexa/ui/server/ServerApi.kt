package fish.nexa.ui.server

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import fish.nexa.Nexa
import fish.nexa.net.Channel
import fish.nexa.net.Snowflake
import fish.nexa.net.wireJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** api/webhooks.ts Webhook: an incoming webhook (its token and URL only for those who may manage it). */
@Serializable
data class Webhook(
    val id: Snowflake,
    val type: Int = 1,
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("channel_id") val channelId: Snowflake = "",
    val name: String = "",
    val avatar: Snowflake? = null,
    val token: String? = null,
    val url: String? = null,
    val user: WebhookUser? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class WebhookUser(
    val id: Snowflake = "",
    val username: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("avatar_id") val avatarId: Snowflake? = null,
)

/** GET /servers/{id}/keys: one conversation's key history and whether it waits for a rotation. */
@Serializable
data class ServerKeyInfo(
    @SerialName("conv_id") val convId: Snowflake,
    val name: String = "",
    val epochs: List<KeyEpoch> = emptyList(),
    val flags: KeyFlags? = null,
)

@Serializable
data class KeyEpoch(
    @SerialName("conv_id") val convId: Snowflake = "",
    val epoch: Int = 0,
    @SerialName("created_by") val createdBy: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
    val reason: String = "",
)

@Serializable
data class KeyFlags(
    @SerialName("conv_id") val convId: Snowflake = "",
    @SerialName("needs_rotation") val needsRotation: Boolean = false,
    @SerialName("needs_own_key") val needsOwnKey: Boolean = false,
)

/** A file the person picked: its bytes, type and name. */
class Picked(val bytes: ByteArray, val type: String, val name: String)

object ServerApi {
    /** Sends raw bytes (an icon, an emoji, a sticker) and reads the JSON answer. */
    suspend fun upload(method: String, path: String, bytes: ByteArray, contentType: String): JsonElement {
        val api = Nexa.api
        val req = api.requestBuilder(path).method(method, bytes.toRequestBody(contentType.toMediaType())).build()
        return api.execute(api.transfer, req, true)
    }

    /** Reads a picked file whole (pictures and stickers are a few megabytes at most). */
    suspend fun read(context: Context, uri: Uri): Picked = withContext(Dispatchers.IO) {
        val cr = context.contentResolver
        var name = uri.lastPathSegment ?: "file"
        cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { name = it }
        }
        val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
        val type = cr.getType(uri) ?: typeFromName(name)
        Picked(bytes, type, name)
    }

    /** What a file is from its name, for pickers that do not say (TGS, WebM). */
    fun typeFromName(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "apng" -> "image/apng"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "jpg", "jpeg" -> "image/jpeg"
        "tgs" -> "application/x-tgsticker"
        "webm" -> "video/webm"
        else -> "application/octet-stream"
    }

    fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /** The server's channels again, after a change the events may not all have brought. */
    suspend fun reloadChannels(serverId: String) {
        val list = Nexa.api.get("/servers/$serverId/channels", ListSerializer(Channel.serializer()))
        Nexa.channels.upsert(list)
    }

    fun json(el: JsonElement): String = wireJson.encodeToString(JsonElement.serializer(), el)
}
