package xyz.evilion.chat.ui.pickers

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.StickerPack

/** What the picker hands back when something is tapped. */
sealed interface Pick {
    /**
     * A unicode emoji. [base] is the emoji without a skin tone, which is what
     * is remembered; [text] is what is sent.
     */
    data class Unicode(val base: String, val text: String) : Pick

    /** A server emoji or one out of an emoji pack; the id is the image's blob. */
    data class Custom(val name: String, val blobId: String, val animated: Boolean) : Pick
}

/** A GIF, whether it came from a search or from the favourites list. */
data class GifPick(val url: String, val w: Int = 0, val h: Int = 0)

/**
 * The bits of the picker that are not drawing: what a pick turns into, and the
 * settings the picker reads and writes.
 *
 * The settings document is shared with the browser and the desktop app, so the
 * shapes here have to be exactly the ones they expect:
 *
 * - `recentEmoji` holds **base** unicode only, because the web resolves it back
 *   through a unicode map (`EmojiPicker.tsx`) and silently drops anything it
 *   cannot find. This app used to write toned emoji and `<:name:blob>` tokens
 *   into it, so every custom and toned emoji the phone remembered was thrown
 *   away by the browser and the two clients overwrote each other's list.
 * - `recentCustomEmoji` is this app's own key for custom emoji tokens. The web
 *   does not read it, but it carries unknown fields through untouched, so it
 *   survives a save from any client.
 * - `favoriteGifs` is the web's array of `{url, w?, h?}`, newest first.
 */
object Expressions {
    private const val RECENT = "recentEmoji"
    private const val RECENT_CUSTOM = "recentCustomEmoji"
    private const val FAVORITES = "favoriteGifs"
    private const val SKIN_TONE = "skinTone"

    /** The reactions offered before anything has been used. */
    val QUICK = listOf("\uD83D\uDC4D", "\uD83D\uDE02", "\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDE2E", "\uD83D\uDE22")

    /** How many of each are kept, matching the web. */
    private const val MAX_RECENT = 40
    private const val MAX_FAVORITES = 500

    private val CUSTOM_TOKEN = Regex("^<(a)?:([^:]+):([^:]+)>$")

    /** The markdown a custom emoji is written as, or the emoji itself. */
    fun token(pick: Pick): String = when (pick) {
        is Pick.Unicode -> pick.text
        is Pick.Custom -> "<${if (pick.animated) "a" else ""}:${pick.name}:${pick.blobId}>"
    }

    /**
     * What the server stores a reaction under: the plain emoji, or `a?:name:blob`
     * with no angle brackets. This used to be a regex inlined in the message
     * actions sheet, which meant a second place that had to agree with the
     * token format.
     */
    fun reactionKey(pick: Pick): String = when (pick) {
        is Pick.Unicode -> pick.text
        is Pick.Custom -> "${if (pick.animated) "a" else ""}:${pick.name}:${pick.blobId}"
    }

    /** A `<a?:name:blob>` token read back into a pick, or null when it is not one. */
    fun parseToken(token: String): Pick.Custom? {
        val m = CUSTOM_TOKEN.find(token) ?: return null
        return Pick.Custom(m.groupValues[2], m.groupValues[3], m.groupValues[1] == "a")
    }

    // --- recents ----------------------------------------------------------

    /**
     * Keys for `remember`, so the picker is not rebuilt by an unrelated field.
     *
     * The settings document is one object and the composer writes a draft into
     * it on **every keystroke**, so keying anything on the whole document means
     * rebuilding two thousand cells because somebody typed a letter.
     */
    fun recentKey(doc: JsonObject): Any = listOf(doc[RECENT], doc[RECENT_CUSTOM])

    fun favoritesKey(doc: JsonObject): Any? = doc[FAVORITES]

    /** The unicode emoji last used, as the web writes them: base, no skin tone. */
    fun recentUnicode(doc: JsonObject): List<String> =
        strings(doc, RECENT).filterNot { it.startsWith("<") || it.isEmpty() }

    /** The custom emoji last used, from this app's own key. */
    fun recentCustom(doc: JsonObject): List<Pick.Custom> =
        strings(doc, RECENT_CUSTOM).mapNotNull { parseToken(it) }

    /** Recents as the picker shows them: custom first, then unicode, both capped. */
    fun recents(doc: JsonObject, tone: Int): List<Pick> {
        val custom = recentCustom(doc).take(MAX_RECENT)
        val unicode = recentUnicode(doc).take(MAX_RECENT).map { base ->
            val entry = EmojiIndex.byText(base)
            Pick.Unicode(base, if (entry != null) EmojiIndex.withTone(entry, tone) else base)
        }
        return custom + unicode
    }

    /** Moves a pick to the front of the list the rest of the account shares. */
    fun remember(pick: Pick) {
        when (pick) {
            is Pick.Unicode -> push(RECENT, pick.base)
            is Pick.Custom -> push(RECENT_CUSTOM, token(pick))
        }
    }

    /** Drops a custom emoji whose image no longer loads, rather than leaving a grey box. */
    fun forgetCustom(token: String) {
        val doc = SettingsStore.doc.value
        val kept = strings(doc, RECENT_CUSTOM).filterNot { it == token }
        if (kept.size != strings(doc, RECENT_CUSTOM).size) {
            SettingsStore.put(RECENT_CUSTOM, JsonArray(kept.map { JsonPrimitive(it) }))
        }
    }

    private fun push(key: String, value: String) {
        if (value.isEmpty()) return
        val current = strings(SettingsStore.doc.value, key)
        val next = listOf(value) + current.filterNot { it == value }
        SettingsStore.put(key, JsonArray(next.take(MAX_RECENT).map { JsonPrimitive(it) }))
    }

    // --- skin tone --------------------------------------------------------

    /** The six hands the tone menu offers, default first, as the web draws them. */
    val TONE_HANDS = listOf("✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿")

    fun toneNames(): List<String> = listOf(
        t("pickers.emojiPicker.toneDefault"),
        t("pickers.emojiPicker.toneLight"),
        t("pickers.emojiPicker.toneMediumLight"),
        t("pickers.emojiPicker.toneMedium"),
        t("pickers.emojiPicker.toneMediumDark"),
        t("pickers.emojiPicker.toneDark"),
    )

    fun skinTone(doc: JsonObject): Int =
        ((doc[SKIN_TONE] as? JsonPrimitive)?.intOrNull ?: 0).coerceIn(0, 5)

    /** New on Android: until now the only way to change it was to open the web client. */
    fun setSkinTone(tone: Int) = SettingsStore.put(SKIN_TONE, tone.coerceIn(0, 5))

    // --- GIF favourites ---------------------------------------------------

    fun favorites(doc: JsonObject): List<GifPick> =
        (doc[FAVORITES] as? JsonArray)?.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val url = (obj["url"] as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            GifPick(url, (obj["w"] as? JsonPrimitive)?.intOrNull ?: 0, (obj["h"] as? JsonPrimitive)?.intOrNull ?: 0)
        } ?: emptyList()

    fun isFavorite(doc: JsonObject, url: String): Boolean = favorites(doc).any { it.url == url }

    /** Adds or removes, newest first, capped where the web caps it. */
    fun toggleFavorite(gif: GifPick) {
        val current = favorites(SettingsStore.doc.value)
        val next = if (current.any { it.url == gif.url }) {
            current.filterNot { it.url == gif.url }
        } else {
            (listOf(gif) + current).take(MAX_FAVORITES)
        }
        writeFavorites(next)
    }

    fun removeFavorites(urls: Set<String>) {
        if (urls.isEmpty()) return
        writeFavorites(favorites(SettingsStore.doc.value).filterNot { it.url in urls })
    }

    private fun writeFavorites(list: List<GifPick>) {
        SettingsStore.put(
            FAVORITES,
            buildJsonArray {
                for (gif in list) add(
                    buildJsonObject {
                        put("url", JsonPrimitive(gif.url))
                        if (gif.w > 0) put("w", JsonPrimitive(gif.w))
                        if (gif.h > 0) put("h", JsonPrimitive(gif.h))
                    },
                )
            },
        )
    }

    // --- packs ------------------------------------------------------------

    /** A group of sticker packs, as the picker heads them. */
    data class PackGroup(val label: String, val packs: List<StickerPack>)

    /**
     * Sticker packs grouped the way the web groups them
     * (`web/src/stores/expressions.ts`): this server's, then mine, then ones I
     * installed, then other servers'. Each pack shows exactly once.
     */
    fun groupPacks(packs: List<StickerPack>, serverId: String?, meId: String?): List<PackGroup> {
        var rest = packs.filter { it.kind != "emoji" }.sortedByDescending { it.updatedAt }
        val groups = mutableListOf<PackGroup>()
        fun take(label: String, test: (StickerPack) -> Boolean) {
            val taken = rest.filter(test)
            if (taken.isEmpty()) return
            rest = rest.filterNot(test)
            groups += PackGroup(label, taken)
        }
        take(t("expressions.thisServer")) { serverId != null && it.serverId == serverId }
        take(t("expressions.myPacks")) { it.ownerUserId != null && it.ownerUserId == meId }
        take(t("expressions.installed")) { it.installed }
        take(t("expressions.otherServers")) { it.serverId != null }
        return groups
    }

    /**
     * Emoji packs, newest first.
     *
     * No `installed` filter: the web does not filter them, so the phone used to
     * hide emoji packs the browser showed.
     */
    fun emojiPacks(packs: List<StickerPack>): List<StickerPack> =
        packs.filter { it.kind == "emoji" && it.stickers.isNotEmpty() }.sortedByDescending { it.updatedAt }

    private fun strings(doc: JsonObject, name: String): List<String> =
        (doc[name] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
}
