package fish.nexa.media

import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * lib/gifFavorites.ts: GIFs starred from messages and link previews, kept in
 * the account's synced settings (newest first, at most 500) for the GIF
 * picker. An uploaded GIF is kept with its attachment so it can be sent again.
 */
object GifFavorites {
    const val MAX = 500

    private fun list(): List<JsonObject> = (Nexa.settings.doc.value["favoriteGifs"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

    private fun urlOf(f: JsonObject) = (f["url"] as? JsonPrimitive)?.contentOrNull ?: ""

    fun isFavorite(url: String): Boolean {
        val key = MediaLinks.mediaKey(url)
        return list().any { MediaLinks.mediaKey(urlOf(it)) == key }
    }

    /** Stars or unstars a GIF; true when it is a favourite now. */
    fun toggle(url: String, w: Double?, h: Double?, att: AttachmentMeta?): Boolean {
        val favs = list()
        val key = MediaLinks.mediaKey(url)
        val now = if (favs.any { MediaLinks.mediaKey(urlOf(it)) == key }) {
            Nexa.settings.patch(buildJsonObject { put("favoriteGifs", JsonArray(favs.filter { MediaLinks.mediaKey(urlOf(it)) != key })) })
            false
        } else {
            val saved = buildJsonObject {
                put("url", url)
                w?.takeIf { it > 0 }?.let { put("w", it) }
                h?.takeIf { it > 0 }?.let { put("h", it) }
                att?.let { put("att", it.toJson()) }
            }
            Nexa.settings.patch(buildJsonObject { put("favoriteGifs", JsonArray((listOf(saved) + favs).take(MAX))) })
            true
        }
        return now
    }
}
