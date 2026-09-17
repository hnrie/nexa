package xyz.evilion.chat.ui.pickers

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import xyz.evilion.chat.i18n.t

/** One unicode emoji, with the names and words it can be found by. */
data class EmojiEntry(
    val unicode: String,
    val group: Int,
    val label: String,
    val shortcodes: List<String>,
    val tags: List<String>,
    val skins: List<String>,
)

/**
 * The unicode emoji set, with the same iamcal shortcodes the web client uses,
 * so `:shrug:` means the same thing in both. It is a 147 KB asset read once on
 * a background thread.
 */
object EmojiIndex {
    val GROUPS = listOf(
        0 to t("pickers.emojiIndex.smileysEmotion"),
        1 to t("pickers.emojiIndex.peopleBody"),
        3 to t("pickers.emojiIndex.animalsNature"),
        4 to t("pickers.emojiIndex.foodDrink"),
        5 to t("pickers.emojiIndex.travelPlaces"),
        6 to t("pickers.emojiIndex.activities"),
        7 to t("pickers.emojiIndex.objects"),
        8 to t("pickers.emojiIndex.symbols"),
        9 to t("pickers.emojiIndex.flags"),
    )

    @Volatile
    private var entries: List<EmojiEntry> = emptyList()

    @Volatile
    private var byShortcode: Map<String, EmojiEntry> = emptyMap()

    val loaded: Boolean get() = entries.isNotEmpty()

    suspend fun load(context: Context) {
        if (entries.isNotEmpty()) return
        withContext(Dispatchers.IO) {
            val parsed = mutableListOf<EmojiEntry>()
            runCatching {
                context.assets.open("emoji.tsv").bufferedReader().useLines { lines ->
                    for (line in lines) {
                        val parts = line.split('\t')
                        if (parts.size < 5) continue
                        parsed += EmojiEntry(
                            unicode = parts[0],
                            group = parts[1].toIntOrNull() ?: 0,
                            label = parts[2],
                            shortcodes = parts[3].split(' ').filter { it.isNotEmpty() },
                            tags = parts[4].split(' ').filter { it.isNotEmpty() },
                            skins = parts.getOrNull(5)?.split(',')?.filter { it.isNotEmpty() } ?: emptyList(),
                        )
                    }
                }
            }
            entries = parsed
            byShortcode = buildMap {
                for (e in parsed) for (name in e.shortcodes) putIfAbsent(name, e)
            }
        }
    }

    fun all(): List<EmojiEntry> = entries

    fun group(id: Int): List<EmojiEntry> = entries.filter { it.group == id }

    fun byName(name: String): EmojiEntry? = byShortcode[name.lowercase()]

    fun search(query: String, limit: Int = 90): List<EmojiEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        val starts = mutableListOf<EmojiEntry>()
        val contains = mutableListOf<EmojiEntry>()
        for (e in entries) {
            when {
                e.shortcodes.any { it.startsWith(q) } -> starts += e
                e.shortcodes.any { it.contains(q) } || e.tags.any { it.startsWith(q) } || e.label.contains(q) -> contains += e
            }
            if (starts.size >= limit) break
        }
        return (starts + contains).take(limit)
    }

    /** Turns `:shortcode:` in typed text into the emoji itself, as the web client does. */
    fun expandShortcodes(text: String): String {
        if (!text.contains(':') || entries.isEmpty()) return text
        return Regex(":([a-z0-9_+-]{1,60}):").replace(text) { m ->
            byShortcode[m.groupValues[1]]?.unicode ?: m.value
        }
    }

    /** A skin tone applied to an emoji that has them: 0 is the default. */
    fun withTone(entry: EmojiEntry, tone: Int): String =
        if (tone in 1..entry.skins.size) entry.skins[tone - 1] else entry.unicode
}
