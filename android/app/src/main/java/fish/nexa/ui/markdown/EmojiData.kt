package fish.nexa.ui.markdown

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** One emoji of the picker: its Unicode name (`label`), category, search words, codes and skin tones. */
class EmojiEntry(
    val unicode: String,
    val hexcode: String,
    val label: String,
    val group: Int,
    val tags: List<String>,
    val shortcodes: List<String>,
    /** The skin tone variants Twemoji has drawn; null when there are none. */
    val skins: List<Skin>?,
)

/** A skin tone variant: one tone (1 light to 5 dark), or one per person in a group (`tones`). */
class Skin(val tone: Int?, val tones: List<Int>?, val unicode: String)

/**
 * The emoji picker's list (components/pickers/emojiIndex.ts): every emoji of
 * emojibase-data that Twemoji has drawn, in Unicode's order, by category,
 * with the iamcal names first and emojibase's behind them. Read once, the
 * first time it is asked for; [has] says which pictures exist.
 */
object EmojiData {
    /** Unicode's emoji categories, as the picker shows them (2, the skin tones and hair, is left out). */
    class Group(val id: Int, val nameKey: String, val items: List<EmojiEntry>)

    private val GROUP_KEYS = listOf(
        0 to "pickers.emojiIndex.smileysEmotion",
        1 to "pickers.emojiIndex.peopleBody",
        3 to "pickers.emojiIndex.animalsNature",
        4 to "pickers.emojiIndex.foodDrink",
        5 to "pickers.emojiIndex.travelPlaces",
        6 to "pickers.emojiIndex.activities",
        7 to "pickers.emojiIndex.objects",
        8 to "pickers.emojiIndex.symbols",
        9 to "pickers.emojiIndex.flags",
    )

    /** The skin tones in the order the picker offers them, default first. */
    val TONE_KEYS = listOf(
        "pickers.emojiPicker.toneDefault", "pickers.emojiPicker.toneLight", "pickers.emojiPicker.toneMediumLight",
        "pickers.emojiPicker.toneMedium", "pickers.emojiPicker.toneMediumDark", "pickers.emojiPicker.toneDark",
    )

    /** Whether Twemoji has a picture for an emoji; the app sets it from its sprite index. Unknown counts as yes. */
    @Volatile var has: (String) -> Boolean = { true }

    private class Loaded(
        val all: List<EmojiEntry>,
        val groups: List<Group>,
        val byShortcode: Map<String, EmojiEntry>,
        val byUnicode: Map<String, EmojiEntry>,
    )

    @Volatile private var data: Loaded? = null
    private val lock = Any()

    /** Skin tone modifiers, light to dark. */
    private val TONE_MODIFIERS = mapOf("1F3FB" to 1, "1F3FC" to 2, "1F3FD" to 3, "1F3FE" to 4, "1F3FF" to 5)

    /** The tone of a variant read from its code points: one, or one per person; null for none. */
    fun toneOf(hexcode: String): List<Int>? {
        val tones = hexcode.uppercase().split("-").mapNotNull { TONE_MODIFIERS[it] }
        return tones.ifEmpty { null }
    }

    fun loaded(): Boolean = data?.all?.isNotEmpty() == true

    fun all(): List<EmojiEntry> = load()?.all ?: emptyList()

    /** The emoji by category, in the picker's order. */
    fun groups(): List<Group> = load()?.groups ?: emptyList()

    fun byShortcode(name: String): EmojiEntry? = load()?.byShortcode?.get(Js.lower(name))

    fun byUnicode(unicode: String): EmojiEntry? = load()?.byUnicode?.get(unicode)

    /** Reads the list now, off the main thread, so the picker opens at once. */
    fun preload() {
        load()
    }

    /** Forgets the list, so it is read again with a new [has] (tests). */
    fun reset() {
        synchronized(lock) { data = null }
    }

    private fun load(): Loaded? {
        data?.let { return it }
        synchronized(lock) {
            data?.let { return it }
            val names = EmojiAssets.read(EmojiAssets.shortcodes) ?: return null
            val root = EmojiAssets.read(EmojiAssets.emoji) ?: return null
            // iamcal is the naming most chat apps use; emojibase's names stay searchable behind it
            val codes = HashMap<String, MutableList<String>>()
            for (entry in names["iamcal"] as JsonArray) {
                val pair = entry as JsonArray
                codes[pair[0].jsonPrimitive.content] = (pair[1] as JsonArray).map { it.jsonPrimitive.content }.toMutableList()
            }
            for (entry in names["emojibase"] as JsonArray) {
                val pair = entry as JsonArray
                val hex = pair[0].jsonPrimitive.content
                val have = codes[hex] ?: mutableListOf()
                val extra = (pair[1] as JsonArray).map { it.jsonPrimitive.content }
                codes[hex] = (have + extra.filter { it !in have }).toMutableList()
            }
            class Raw(val unicode: String, val hexcode: String, val label: String, val group: Int?, val order: Int?, val tags: List<String>, val skins: JsonArray)
            val list = (root["emoji"] as JsonArray).map { e ->
                val a = e as JsonArray
                Raw(
                    a[0].jsonPrimitive.content, a[1].jsonPrimitive.content, a[2].jsonPrimitive.content,
                    (a[3] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull,
                    (a[4] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull,
                    (a[5] as JsonArray).map { it.jsonPrimitive.content },
                    a[6] as JsonArray,
                )
            }.filter { it.group != null && it.group != 2 }.sortedBy { it.order ?: 0 }
            val all = list.filter { has(it.unicode) }.map { e ->
                val skins = e.skins.mapNotNull { s ->
                    val sk = s as JsonArray
                    val unicode = sk[1].jsonPrimitive.content
                    val given = sk[2]
                    val skin = when {
                        given is JsonArray -> Skin(null, given.map { it.jsonPrimitive.int }, unicode)
                        given is JsonPrimitive && given !is JsonNull -> Skin(given.int, null, unicode)
                        else -> toneOf(sk[0].jsonPrimitive.content)?.let { if (it.size == 1) Skin(it[0], null, unicode) else Skin(null, it, unicode) }
                    }
                    skin?.takeIf { has(unicode) }
                }
                EmojiEntry(e.unicode, e.hexcode, e.label, e.group ?: 0, e.tags, codes[e.hexcode] ?: emptyList(), skins.ifEmpty { null })
            }
            val groups = GROUP_KEYS.map { (id, key) -> Group(id, key, all.filter { it.group == id }) }.filter { it.items.isNotEmpty() }
            val byShortcode = HashMap<String, EmojiEntry>()
            val byUnicode = HashMap<String, EmojiEntry>()
            for (e in all) {
                byUnicode[e.unicode] = e
                for (s in e.shortcodes) byShortcode.putIfAbsent(s, e)
            }
            return Loaded(all, groups, byShortcode, byUnicode).also { data = it }
        }
    }

    /** Prefix and substring search over codes, names and tags, best first. */
    fun search(q: String, limit: Int = 50): List<EmojiEntry> {
        val query = stripColons(Js.lower(Js.trim(q)))
        if (query.isEmpty()) return emptyList()
        val scored = ArrayList<Pair<EmojiEntry, Int>>()
        for (e in all()) {
            var s = -1
            for (sc in e.shortcodes) {
                if (sc == query) s = maxOf(s, 100)
                else if (sc.startsWith(query)) s = maxOf(s, 80)
                else if (sc.contains(query)) s = maxOf(s, 40)
            }
            val label = Js.lower(e.label)
            if (label == query) s = maxOf(s, 90)
            else if (label.startsWith(query)) s = maxOf(s, 70)
            else if (label.contains(query)) s = maxOf(s, 35)
            else if (e.tags.any { it.startsWith(query) }) s = maxOf(s, 30)
            if (s >= 0) scored += e to s
        }
        // a stable sort, as the web's
        return scored.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    /** `q.replace(/^:|:$/g, "")`: one colon off each end. */
    internal fun stripColons(q: String): String {
        var s = q
        if (s.startsWith(":")) s = s.substring(1)
        if (s.endsWith(":")) s = s.substring(0, s.length - 1)
        return s
    }

    /** The emoji in a skin tone (1 to 5), or as it is when it has no variants. */
    fun withTone(e: EmojiEntry, tone: Int): String {
        val skins = e.skins
        if (tone == 0 || skins == null) return e.unicode
        val hit = skins.firstOrNull { s -> if (s.tones != null) s.tones.all { it == tone } else s.tone == tone }
        return hit?.unicode ?: e.unicode
    }
}
