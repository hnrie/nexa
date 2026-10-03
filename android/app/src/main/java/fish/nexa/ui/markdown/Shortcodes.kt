package fish.nexa.ui.markdown

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.InputStream

/**
 * Where the emoji data is read from: the app's assets (written by
 * android/tools/emoji_assets.mjs from the web's own emojibase-data), or, in
 * tests, files on disk. Set once when the app starts.
 */
object EmojiAssets {
    @Volatile internal var shortcodes: (() -> InputStream)? = null
    @Volatile internal var emoji: (() -> InputStream)? = null

    fun init(context: Context) {
        val app = context.applicationContext
        shortcodes = { app.assets.open("emoji/shortcodes.json") }
        emoji = { app.assets.open("emoji/emoji.json") }
    }

    /** Reads the data from elsewhere (tests). */
    fun use(shortcodes: () -> InputStream, emoji: () -> InputStream) {
        this.shortcodes = shortcodes
        this.emoji = emoji
    }

    internal fun read(open: (() -> InputStream)?): JsonObject? = try {
        open?.invoke()?.use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
    } catch (_: Exception) {
        null
    }
}

/**
 * `:shortcode:` names for unicode emoji (lib/shortcodes.ts). The names follow
 * the iamcal set, which is what most chat apps use, so a name typed anywhere
 * else works here; the emojibase set is read behind it so its older names keep
 * resolving too. The table is read the first time anything asks for it
 * ([preload] does that early, off the main thread).
 */
object Shortcodes {
    private class Table(val byName: Map<String, String>, val names: Map<String, String>)

    @Volatile private var table: Table? = null
    private val lock = Any()

    /** Whether a text could hold a `:name:` at all, by the parser's own pattern. */
    fun mightHaveShortcode(text: String): Boolean {
        var i = text.indexOf(':')
        while (i >= 0) {
            var j = i + 1
            while (j < text.length && j - i - 1 < 61 && text[j].let { it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '+' || it == '-' }) j++
            val run = j - i - 1
            if (run in 1..60 && j < text.length && text[j] == ':') return true
            i = text.indexOf(':', i + 1)
        }
        return false
    }

    /** The emoji for a `:name:` (any capitals), or null for a name no set has. */
    fun toEmoji(name: String): String? = load()?.byName?.get(Js.lower(name))

    /** The name an emoji goes by, without colons: the one that brings it back as `:name:`. */
    fun nameOf(emoji: String): String? = load()?.names?.get(emoji.replace("️", ""))

    fun ready(): Boolean = table != null

    /** Reads the table now, so the first message that needs it does not wait. */
    fun preload() {
        load()
    }

    private fun load(): Table? {
        table?.let { return it }
        synchronized(lock) {
            table?.let { return it }
            val root = EmojiAssets.read(EmojiAssets.shortcodes) ?: return null
            val map = HashMap<String, String>()
            val reverse = HashMap<String, String>()
            // iamcal first, so its name wins where the two sets disagree
            for (set in listOf("iamcal", "emojibase")) {
                for (entry in root[set] as? JsonArray ?: JsonArray(emptyList())) {
                    val pair = entry as JsonArray
                    val names = (pair[1] as JsonArray).map { it.jsonPrimitive.content }
                    add(map, reverse, pair[0].jsonPrimitive.content, names)
                }
            }
            return Table(map, reverse).also { table = it }
        }
    }

    private fun add(map: HashMap<String, String>, reverse: HashMap<String, String>, hexcode: String, list: List<String>) {
        val emoji = charsOf(hexcode)
        if (emoji.isEmpty()) return
        for (name in list) map.putIfAbsent(Js.lower(name), emoji)
        // the first name a set gives is the one it goes by
        val plain = emoji.replace("️", "")
        val first = list.firstOrNull()
        if (!first.isNullOrEmpty()) reverse.putIfAbsent(plain, Js.lower(first))
    }

    /** The emoji a hexcode names ("1F44D-1F3FD"), or "" when a part is no number. */
    internal fun charsOf(hexcode: String): String {
        val out = StringBuilder()
        for (part in hexcode.split("-")) {
            val cp = parseHexPrefix(part) ?: return ""
            if (cp > 0x10FFFF) return ""
            out.appendCodePoint(cp)
        }
        return out.toString()
    }

    /** `Number.parseInt(part, 16)`: the hex digits at the start, null for none. */
    private fun parseHexPrefix(s: String): Int? {
        val t = Js.trimStart(s)
        var j = 0
        var v = 0L
        while (j < t.length && Character.digit(t[j], 16).let { it >= 0 && t[j].code < 128 }) {
            v = v * 16 + Character.digit(t[j], 16)
            if (v > 0x10FFFF) v = 0x110000
            j++
        }
        return if (j == 0) null else v.toInt()
    }
}
