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
) {
    /** What a screen reader says and what the picker's footer shows. */
    val shortcode: String get() = shortcodes.firstOrNull() ?: label
}

/**
 * The unicode emoji set, with the same iamcal shortcodes the web client uses,
 * so `:shrug:` means the same thing in both. It is a 147 KB asset read once on
 * a background thread.
 */
object EmojiIndex {
    /**
     * The nine categories, in the order the picker shows them.
     *
     * A function rather than a `val`: the names are translated, and a `val`
     * would keep whichever language was in use the first time anything touched
     * this object.
     */
    fun groups(): List<Pair<Int, String>> = listOf(
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

    /** An emoji that stands for each category, for the picker's rail. */
    val GROUP_ICONS = mapOf(
        0 to "😀", 1 to "👋", 3 to "🐻", 4 to "🍔", 5 to "✈️",
        6 to "⚽", 7 to "💡", 8 to "🔣", 9 to "🏁",
    )

    @Volatile
    private var entries: List<EmojiEntry> = emptyList()

    @Volatile
    private var byShortcode: Map<String, EmojiEntry> = emptyMap()

    @Volatile
    private var byUnicode: Map<String, EmojiEntry> = emptyMap()

    /**
     * The nine groups, each filtered once.
     *
     * The picker used to call a `filter` over all 1 906 entries nine times
     * inside a lazy grid's content lambda — nine new lists on every
     * recomposition, on the thread drawing the frame.
     */
    @Volatile
    private var byGroup: Map<Int, List<EmojiEntry>> = emptyMap()

    /** True when the asset could not be read, so the picker can say so rather than spin. */
    @Volatile
    var loadFailed: Boolean = false
        private set

    val loaded: Boolean get() = entries.isNotEmpty()

    suspend fun load(context: Context) {
        if (entries.isNotEmpty()) return
        withContext(Dispatchers.IO) {
            val parsed = mutableListOf<EmojiEntry>()
            val read = runCatching {
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
            }.isSuccess
            loadFailed = !read || parsed.isEmpty()
            entries = parsed
            byShortcode = buildMap {
                for (e in parsed) for (name in e.shortcodes) putIfAbsent(name, e)
            }
            byUnicode = buildMap {
                for (e in parsed) {
                    putIfAbsent(e.unicode, e)
                    for (skin in e.skins) putIfAbsent(skin, e)
                }
            }
            byGroup = parsed.groupBy { it.group }
        }
    }

    fun all(): List<EmojiEntry> = entries

    fun group(id: Int): List<EmojiEntry> = byGroup[id].orEmpty()

    fun byName(name: String): EmojiEntry? = byShortcode[name.lowercase()]

    /** The entry an emoji came from, toned or not, so a recent can be drawn and named. */
    fun byText(text: String): EmojiEntry? = byUnicode[text]

    /**
     * Shortcodes, labels and tags, scored the way the web client scores them
     * (`web/src/components/pickers/emojiIndex.ts`) so a query ranks the same in
     * both. The old version split matches into "starts with" and "contains" and
     * broke out of the loop as soon as it had enough of the first, which could
     * return a worse match while a better one sat further down the file.
     */
    fun search(query: String, limit: Int = 100): List<EmojiEntry> {
        val q = normalize(query)
        if (q.isEmpty()) return emptyList()
        val scored = ArrayList<Pair<EmojiEntry, Int>>(64)
        for (e in entries) {
            var s = -1
            for (sc in e.shortcodes) {
                if (sc == q) s = maxOf(s, 100)
                else if (sc.startsWith(q)) s = maxOf(s, 80)
                else if (sc.contains(q)) s = maxOf(s, 40)
            }
            val label = e.label.lowercase()
            if (label == q) s = maxOf(s, 90)
            else if (label.startsWith(q)) s = maxOf(s, 70)
            else if (label.contains(q)) s = maxOf(s, 35)
            else if (e.tags.any { it.startsWith(q) }) s = maxOf(s, 30)
            if (s >= 0) scored += e to s
        }
        // sortedByDescending is stable, so equal scores keep the file's order
        return scored.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    /** Lower case, trimmed, and without the colons someone pasted around it. */
    fun normalize(query: String): String =
        query.trim().lowercase().removePrefix(":").removeSuffix(":")

    /**
     * Turns `:shortcode:` in typed text into the emoji itself.
     *
     * Code spans, fenced blocks and URLs are left exactly as typed: this runs
     * on the way out, so a `:cat:` inside a code fence that got replaced would
     * be replaced in the stored message and could not be got back. The web
     * client does its expansion while drawing, where the question does not
     * arise, but nothing on Android draws it.
     */
    fun expandShortcodes(text: String): String {
        if (!text.contains(':') || entries.isEmpty()) return text
        if (!text.contains('`') && !text.contains("://")) return replaceIn(text)
        val out = StringBuilder(text.length)
        var last = 0
        for (span in LITERAL.findAll(text)) {
            out.append(replaceIn(text.substring(last, span.range.first)))
            out.append(span.value)
            last = span.range.last + 1
        }
        out.append(replaceIn(text.substring(last)))
        return out.toString()
    }

    private fun replaceIn(text: String): String =
        if (!text.contains(':')) text
        else SHORTCODE.replace(text) { m -> byShortcode[m.groupValues[1]]?.unicode ?: m.value }

    private val SHORTCODE = Regex(":([a-z0-9_+-]{1,60}):")

    /** Runs of text a shortcode inside must be left alone. */
    private val LITERAL = Regex("```[\\s\\S]*?```|`[^`\\n]*`|\\w+://\\S+")

    /** A skin tone applied to an emoji that has them: 0 is the default. */
    fun withTone(entry: EmojiEntry, tone: Int): String =
        if (tone in 1..entry.skins.size) entry.skins[tone - 1] else entry.unicode
}
