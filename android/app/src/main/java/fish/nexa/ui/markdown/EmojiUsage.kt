package fish.nexa.ui.markdown

import fish.nexa.net.Emoji
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.text.Collator
import java.util.Locale
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Which emoji this account reaches for, and how lately (lib/emojiUsage.ts).
 * Each emoji has a score that goes up by one every time it is used, in a
 * message sent or as a reaction, and halves for every week it is not. Kept
 * with the account's synced settings as `emojiUsage`, so every device learns
 * the same habits; only the 60 highest are kept, and nothing is counted while
 * smart suggestions (`smartEmoji`) are off.
 */
object EmojiUsage {
    /** The score when it was last used, and when that was (Unix ms). */
    data class Use(val s: Double, val at: Double)

    /** A score halves over this long without the emoji being used. */
    const val HALF_LIFE_MS = 7.0 * 24 * 60 * 60 * 1000
    /** How many emoji are remembered: the highest scores. */
    const val KEEP = 60

    /** The key a unicode emoji is counted under: its skin tones together, with or without a variation selector. */
    fun unicodeKey(emoji: String): String {
        val out = StringBuilder(emoji.length)
        var i = 0
        while (i < emoji.length) {
            val cp = emoji.codePointAt(i)
            if (cp !in 0x1F3FB..0x1F3FF && cp != 0xFE0F) out.appendCodePoint(cp)
            i += Character.charCount(cp)
        }
        return out.toString()
    }

    /** The key a custom emoji is counted under: the picture its token names. */
    fun customKey(blobId: String): String = "c:$blobId"

    /** The key of a reaction as the server keeps it: a unicode emoji, or `a?:name:blobId`. */
    fun reactionKey(emoji: String): String {
        // /^a?:[^:]+:(\d+)$/
        val from = if (emoji.startsWith("a:")) 2 else if (emoji.startsWith(":")) 1 else -1
        if (from > 0) {
            val colon = emoji.indexOf(':', from)
            if (colon > from && colon + 1 < emoji.length && (colon + 1 until emoji.length).all { emoji[it] in '0'..'9' }) {
                return customKey(emoji.substring(colon + 1))
            }
        }
        return unicodeKey(emoji)
    }

    /** An emoji's score now. */
    fun scoreOf(use: Use?, now: Double): Double = if (use == null) 0.0 else use.s * 0.5.pow(max(0.0, now - use.at) / HALF_LIFE_MS)

    private fun keepBest(map: LinkedHashMap<String, Use>, now: Double): LinkedHashMap<String, Use> {
        if (map.size <= KEEP) return map
        val best = map.entries.sortedByDescending { scoreOf(it.value, now) }.take(KEEP)
        return LinkedHashMap<String, Use>().apply { for ((k, v) in best) put(k, v) }
    }

    /** Usage with one more use of each key, keeping the ones that score highest. */
    fun withUse(usage: Map<String, Use>, keys: List<String>, now: Double): Map<String, Use> {
        val next = LinkedHashMap(usage)
        for (key in LinkedHashSet(keys)) next[key] = Use(scoreOf(next[key], now) + 1, now)
        return keepBest(next, now)
    }

    /** The keys in order of use, most first. */
    fun rankedKeys(usage: Map<String, Use>, now: Double): List<String> =
        usage.entries.map { it.key to scoreOf(it.value, now) }.filter { it.second > 0 }.sortedByDescending { it.second }.map { it.first }

    /** The emoji a message uses, each once: a row of ten hearts is one choice of heart. */
    fun keysIn(text: String): List<String> {
        val out = LinkedHashSet<String>()
        fun walk(nodes: List<Node>) {
            for (n in nodes) {
                when (n) {
                    is Node.UnicodeEmoji -> out += unicodeKey(n.text)
                    is Node.Emoji -> out += customKey(n.id)
                    is Node.Details -> walk(n.summary + n.children)
                    is Node.Container -> walk(n.children)
                    is Node.ListBlock -> for (item in n.items) walk(item)
                    is Node.Table -> for (row in listOf(n.head) + n.rows) for (cell in row) walk(cell)
                    is Node.Footnotes -> for (note in n.notes) walk(note.children)
                    else -> Unit
                }
            }
        }
        if (text.isNotEmpty()) walk(Markdown.parse(text))
        return out.toList()
    }

    /**
     * Usage learned from messages already sent: every emoji a message used
     * counts once, as a use at the time it was sent. A score already known for
     * an emoji stays where it is higher, so nothing is counted twice.
     */
    fun fromHistory(existing: Map<String, Use>, messages: List<Pair<String, Double>>, now: Double): Map<String, Use> {
        val learned = LinkedHashMap<String, Double>()
        for ((text, at) in messages) {
            val weight = 0.5.pow(max(0.0, now - at) / HALF_LIFE_MS)
            for (key in keysIn(text)) learned[key] = (learned[key] ?: 0.0) + weight
        }
        val out = LinkedHashMap(existing)
        for ((key, s) in learned) if (s > scoreOf(out[key], now)) out[key] = Use(s, now)
        return keepBest(out, now)
    }

    /** Reads a stored copy defensively: only well-formed entries come through. */
    fun sanitize(v: JsonElement?, now: Double): Map<String, Use> {
        val obj = v as? JsonObject ?: return emptyMap()
        val out = LinkedHashMap<String, Use>()
        for ((key, use) in obj) {
            if (key.length > 80) continue
            val o = use as? JsonObject ?: continue
            val s = (o["s"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
            val at = (o["at"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
            if (s != null && s.isFinite() && s > 0 && at != null && at.isFinite()) out[key] = Use(s, at)
        }
        return keepBest(out, now)
    }

    fun toJson(usage: Map<String, Use>): JsonObject = buildJsonObject {
        for ((k, u) in usage) put(k, buildJsonObject {
            put("s", u.s)
            put("at", u.at)
        })
    }

    private fun smartOn(settings: JsonObject): Boolean = (settings["smartEmoji"] as? JsonPrimitive)?.booleanOrNull ?: true

    /**
     * Counts a use of each emoji while smart suggestions are on: the settings
     * patch to apply (`{"emojiUsage": …}`), or null when there is nothing to
     * count. `settings` is the account's current settings document.
     */
    fun noteUsePatch(settings: JsonObject, keys: List<String>, now: Double): JsonObject? {
        if (!smartOn(settings) || keys.isEmpty()) return null
        val usage = sanitize(settings["emojiUsage"], now)
        return buildJsonObject { put("emojiUsage", toJson(withUse(usage, keys, now))) }
    }

    /**
     * What learning from this account's own sent messages changes, the first
     * time smart suggestions are used (lib/emojiSuggest.ts learnEmojiHistory):
     * the patch with the learned usage and `emojiLearned`, or null when smart
     * suggestions are off or this was done already. `messages` are text and
     * when it was sent.
     */
    fun historyPatch(settings: JsonObject, messages: List<Pair<String, Double>>, now: Double): JsonObject? {
        if (!smartOn(settings) || (settings["emojiLearned"] as? JsonPrimitive)?.booleanOrNull == true) return null
        val usage = fromHistory(sanitize(settings["emojiUsage"], now), messages, now)
        return buildJsonObject {
            put("emojiUsage", toJson(usage))
            put("emojiLearned", true)
        }
    }
}

/**
 * Roughly how often emoji are used everywhere (lib/emojiPopular.ts), for
 * suggesting emoji to someone whose habits are not known yet: in tiers, after
 * the Unicode Consortium's emoji frequency ranking.
 */
object EmojiPopular {
    private val TIERS = listOf(
        "😂 ❤️ 🤣 👍 😭 🙏 😘 🥰 😍 😊",
        "🎉 😁 💕 🥺 😅 🔥 ☺️ 🤦 ♥️ 🤷 🙄 😆 🤗 😉 🎂 🤔 👏 🙂 😳 🥳 😎 👌 💜 😔 💪 ✨ 💖 👀 😋 😏 😢 👉 💗 😩 💯 🌹 💞 🎈 💙 😃 💔 😡 😄 🙌 😀 💀",
        "💐 😜 🙈 🤞 🤤 🤪 ❣️ 💋 👇 😌 💓 🤩 🙃 😬 😱 😴 🤭 😐 🌞 😒 😇 🌸 😈 🎶 ✌️ 🎊 🥵 😞 💚 ☀️ 🖤 💰 😚 👑 🎁 💥 🙋 ☹️ 😑 🥴 👈 💩 ✅ 👋 🤮 😤 🤢 🌟 ❗ 😥 🌈 💛 😝 😫 😲 ‼️ 🌻 🤯 💃 👊 🤬 😕 ⚡ ☕ 🍀 💦 ⭐ 🦋 🤨 🌺 😹 🤘 🌷 💝 💤 🤝 😓 💘 🍻 😟 😣 🧐 😠 🤠 😻 🌙 😛 🤙 🙊 🧡 🤍 😶 🫶 🥹 🫠 🤡 👻 💫 😮 🥲 😪 🤓 👎 😖 🫡 🤌 🍕 🎵 👆 🤟 💨 🎄 💎 🥂 🍷 🍺 💅 🙇 🤑 🥶 😷",
    )

    /** How far each tier lifts an emoji among others that match as well. */
    private val LIFTS = intArrayOf(14, 10, 6)

    private val byKey: Map<String, Int> = HashMap<String, Int>().apply {
        TIERS.forEachIndexed { i, tier ->
            for (e in tier.split(" ")) if (e.isNotEmpty()) putIfAbsent(EmojiUsage.unicodeKey(e), LIFTS[i])
        }
    }

    /** How much an emoji's everyday popularity lifts it; 0 for one that is not especially common. */
    fun popularity(unicode: String): Int = byKey[EmojiUsage.unicodeKey(unicode)] ?: 0
}

/**
 * Smart emoji suggestions: what the message box offers after a ":"
 * (lib/emojiSuggest.ts). A bare ":" offers the emoji this account uses most,
 * then the picker's recent row, then a few everybody reaches for. Letters
 * match a name by the start of any of its words as well as its own start;
 * then several words' starts, initials and, for three letters or more,
 * anywhere inside. Among matches about as good, what this account uses goes
 * first, then what is common everywhere.
 */
object EmojiSuggest {
    /** A suggestion's emoji: one of Unicode's, or a custom one (`own` when it is this server's). */
    sealed class Candidate {
        data class Unicode(val entry: EmojiEntry) : Candidate()
        data class Custom(val emoji: Emoji, val own: Boolean = false) : Candidate()
    }

    /** A suggestion with the name it goes by in the list: the code that matched what was typed. */
    data class Suggestion(val candidate: Candidate, val name: String)

    /** The group of Unicode's emoji the flags are in. */
    private const val FLAGS = 9

    /** Offered after a bare ":" to someone who has not used any yet. */
    val STARTER_EMOJI = listOf("👍", "😂", "❤️", "😭", "🙏", "🔥", "😊", "🎉")

    /** How many suggestions show. */
    const val SUGGESTIONS = 10

    private val CAMEL = Regex("([a-z0-9])([A-Z])")
    private val WORD_SPLIT = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF_\\-.]+")
    private val QUERY_SPLIT = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF_\\-]+")

    /** A name's words: split at underscores, dashes, dots and spaces, and where a lower-case letter meets a capital. */
    fun wordsOf(name: String): List<String> = Js.lower(CAMEL.replace(name, "$1 $2")).split(WORD_SPLIT).filter { it.isNotEmpty() }

    /** How well one name answers a query, higher for better; -1 for not at all. */
    fun nameMatch(name: String, query: String): Double {
        val n = Js.lower(name)
        val q = Js.lower(query)
        if (q.isEmpty()) return -1.0
        if (n == q) return 100.0
        // a longer name that matches as well is a little further from what was typed
        val tail = min(4.0, (n.length - q.length) * 0.2)
        val words = wordsOf(name)
        if (q in words) return 90 - tail
        if (n.startsWith(q)) return 88 - tail
        if (words.any { it.startsWith(q) }) return 86 - tail
        val parts = q.split(QUERY_SPLIT).filter { it.isNotEmpty() }
        if (parts.size > 1) {
            var at = 0
            val found = parts.all { p ->
                while (at < words.size && !words[at].startsWith(p)) at++
                at++ < words.size
            }
            if (found) return 80 - tail
        }
        if (q.length >= 2 && q.length <= words.size && (0 until q.length).all { i -> words[i].firstOrNull() == q[i] }) return 64.0
        if (q.length >= 3 && n.contains(q)) return 34 - tail
        return -1.0
    }

    /** How far an emoji's use lifts it: nothing when unused, more the more it is used, up to a point. */
    fun useBoost(score: Double): Double = if (score > 0) min(70.0, 25 + 12 * (ln(1 + score) / ln(2.0))) else 0.0

    private fun keyOf(c: Candidate): String = when (c) {
        is Candidate.Unicode -> EmojiUsage.unicodeKey(c.entry.unicode)
        is Candidate.Custom -> EmojiUsage.customKey(c.emoji.blobId)
    }

    /** The name an emoji goes by when nothing was typed: its first code, or its own name. */
    private fun shownName(c: Candidate): String = when (c) {
        is Candidate.Custom -> c.emoji.name
        is Candidate.Unicode -> c.entry.shortcodes.firstOrNull() ?: c.entry.label
    }

    /** How well an emoji answers a query, and by which of its codes; -1 for not at all. */
    private fun matchOf(c: Candidate, query: String): Pair<Double, String> {
        if (c is Candidate.Custom) return nameMatch(c.emoji.name, query) to c.emoji.name
        val entry = (c as Candidate.Unicode).entry
        var score = -1.0
        var name = shownName(c)
        for (sc in entry.shortcodes) {
            val m = nameMatch(sc, query)
            if (m > score) {
                score = m
                name = sc
            }
        }
        // its name in words well behind its codes
        val label = nameMatch(entry.label, query)
        if (label >= 0 && label - 8 > score) score = label - 8
        val q = Js.lower(query)
        for (tag in entry.tags) {
            if (tag == q) score = max(score, 56.0)
            else if (q.length >= 3 && tag.startsWith(q)) score = max(score, 40.0)
        }
        // a short query is rarely a country, and two letters start a dozen of them
        if (entry.group == FLAGS && score >= 0 && score < 100) score -= 8
        return score to name
    }

    private fun commonness(c: Candidate): Int = if (c is Candidate.Unicode) EmojiPopular.popularity(c.entry.unicode) else 0

    /**
     * The suggestions, best first. `candidates` are every emoji to choose from,
     * custom ones first as the box lists them; `recent` is the picker's recent
     * row, newest first.
     */
    fun suggest(
        query: String,
        candidates: List<Candidate>,
        usage: Map<String, EmojiUsage.Use>,
        recent: List<String>,
        now: Double,
        limit: Int = SUGGESTIONS,
    ): List<Suggestion> {
        val recentAt = HashMap<String, Int>()
        recent.forEachIndexed { i, u -> recentAt[EmojiUsage.unicodeKey(u)] = i }
        fun lift(c: Candidate): Double {
            val key = keyOf(c)
            val r = recentAt[key]
            return max(useBoost(EmojiUsage.scoreOf(usage[key], now)), if (r == null) 0.0 else max(0.0, 18.0 - r))
        }
        if (query.isEmpty()) {
            val byKey = LinkedHashMap<String, Candidate>()
            for (c in candidates) byKey.putIfAbsent(keyOf(c), c)
            val order = EmojiUsage.rankedKeys(usage, now) + recent.map(EmojiUsage::unicodeKey) + STARTER_EMOJI.map(EmojiUsage::unicodeKey)
            val out = ArrayList<Suggestion>()
            val seen = HashSet<String>()
            for (key in order) {
                val c = byKey[key] ?: continue
                if (!seen.add(key)) continue
                out += Suggestion(c, shownName(c))
                if (out.size >= limit) break
            }
            return out
        }
        class Scored(val c: Candidate, val name: String, val s: Double, val i: Int)
        val scored = ArrayList<Scored>()
        candidates.forEachIndexed { i, c ->
            val (score, name) = matchOf(c, query)
            if (score < 0) return@forEachIndexed
            // this server's own emoji, by a hair: its :name: is the one a message here gets
            val own = if (c is Candidate.Custom && c.own) 2 else 0
            scored += Scored(c, name, score + lift(c) + commonness(c) + own, i)
        }
        scored.sortWith { a, b -> if (b.s != a.s) b.s.compareTo(a.s) else a.i - b.i }
        val out = ArrayList<Suggestion>()
        val seen = HashSet<String>()
        for (x in scored) {
            if (!seen.add(keyOf(x.c))) continue
            out += Suggestion(x.c, x.name)
            if (out.size >= limit) break
        }
        return out
    }
}

/** Custom emoji as messages and reactions carry them (stores/expressions.ts, components/chat/Reactions.tsx). */
object CustomEmoji {
    /** The markdown token for a custom emoji: the picture's blob id, so it renders for everyone anywhere. */
    fun token(e: Emoji): String = "<" + (if (e.animated) "a" else "") + ":" + e.name + ":" + e.blobId + ">"

    /** The reaction key for a custom emoji (what the server stores): `a?:name:blobId`. */
    fun reactionKey(e: Emoji): String = (if (e.animated) "a" else "") + ":" + e.name + ":" + e.blobId

    /**
     * The reaction key for a pick: a custom emoji's own key, a bare
     * `<a?:name:id>` token without its brackets, or the unicode emoji itself.
     */
    fun reactionKeyOfPick(unicode: String, custom: Emoji? = null): String {
        if (custom != null) return reactionKey(custom)
        // /^<(a?):(\w+):(\d+)>$/
        if (unicode.startsWith("<") && unicode.endsWith(">")) {
            val inner = unicode.substring(1, unicode.length - 1)
            val animated = inner.startsWith("a:")
            val rest = if (animated) inner.substring(2) else if (inner.startsWith(":")) inner.substring(1) else null
            if (rest != null) {
                val colon = rest.indexOf(':')
                val name = if (colon > 0) rest.substring(0, colon) else ""
                val id = if (colon > 0) rest.substring(colon + 1) else ""
                if (name.isNotEmpty() && name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' } && id.isNotEmpty() && id.all { it in '0'..'9' }) {
                    return (if (animated) "a" else "") + ":" + name + ":" + id
                }
            }
        }
        return unicode
    }

    /** A custom reaction key read back: its picture's id, name and whether it moves; null for a unicode emoji. */
    data class Parsed(val id: String, val name: String, val animated: Boolean)

    fun parseReaction(emoji: String): Parsed? {
        // /^(a?):?([\w]+):(\d+)$/
        val m = Regex("^(a?):?([A-Za-z0-9_]+):([0-9]+)$").find(emoji) ?: return null
        return Parsed(m.groupValues[3], m.groupValues[2], m.groupValues[1] == "a")
    }

    /** How a reaction is named to people: a custom emoji by its :name:, a unicode one as itself. */
    fun label(emoji: String): String = parseReaction(emoji)?.let { ":" + it.name + ":" } ?: emoji

    /** A reaction's name for the card listing who reacted: a custom :name:, a unicode emoji's first shortcode, or "". */
    fun nameForReactors(emoji: String): String {
        if (parseReaction(emoji) != null) return label(emoji)
        val sc = EmojiData.byUnicode(emoji)?.shortcodes?.firstOrNull()
        return if (sc != null) ":$sc:" else ""
    }

    /** Custom emoji whose name is, starts with or contains the query, best first. */
    fun search(emojis: List<Emoji>, q: String, limit: Int = 20, locale: Locale = Locale.getDefault()): List<Emoji> {
        val query = EmojiData.stripColons(Js.lower(Js.trim(q)))
        if (query.isEmpty()) return emptyList()
        val scored = ArrayList<Pair<Emoji, Int>>()
        for (e in emojis) {
            val n = Js.lower(e.name)
            when {
                n == query -> scored += e to 100
                n.startsWith(query) -> scored += e to 80
                n.contains(query) -> scored += e to 40
            }
        }
        val collator = Collator.getInstance(locale)
        return scored.sortedWith { a, b -> if (b.second != a.second) b.second - a.second else collator.compare(a.first.name, b.first.name) }.take(limit).map { it.first }
    }
}
