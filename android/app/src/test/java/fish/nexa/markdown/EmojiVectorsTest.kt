package fish.nexa.markdown

import fish.nexa.net.Emoji
import fish.nexa.ui.markdown.CustomEmoji
import fish.nexa.ui.markdown.EmojiData
import fish.nexa.ui.markdown.EmojiPopular
import fish.nexa.ui.markdown.EmojiSuggest
import fish.nexa.ui.markdown.EmojiUsage
import fish.nexa.ui.markdown.ShortcodeTyping
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.BeforeClass
import org.junit.Test
import java.util.Locale

/** Emoji usage, smart suggestions, the picker's list and reaction keys, against the web. */
class EmojiVectorsTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun assets() = Vectors.useAssets()
    }

    private val now: Double get() = Vectors["generated"].jsonObject["now"]!!.jsonPrimitive.double
    private val week = EmojiUsage.HALF_LIFE_MS
    private val usage get() = mapOf("😀" to EmojiUsage.Use(3.0, now - week), "c:30" to EmojiUsage.Use(1.0, now), "👍" to EmojiUsage.Use(10.0, now - 4 * week))
    private val u get() = Vectors["usage"].jsonObject

    private fun JsonObject.s(k: String): String? = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull
    private fun strings(e: JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.content }

    private fun usageJson(m: Map<String, EmojiUsage.Use>): JsonElement = EmojiUsage.toJson(m)

    /** Same keys in the same order, and scores equal to the last few bits. */
    private fun sameUsage(got: Map<String, EmojiUsage.Use>, want: JsonObject): Boolean {
        if (got.keys.toList() != want.keys.toList()) return false
        return got.all { (k, v) ->
            val w = want[k]!!.jsonObject
            close(v.s, w["s"]!!.jsonPrimitive.double) && close(v.at, w["at"]!!.jsonPrimitive.double)
        }
    }

    private fun close(a: Double, b: Double) = a == b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b))

    @Test
    fun usageKeysAndScores() {
        for (k in u["keys"]!!.jsonArray.map { it.jsonObject }) {
            val e = k.s("e")!!
            assertEquals("unicodeKey $e", k.s("unicode"), EmojiUsage.unicodeKey(e))
            assertEquals("reactionKey $e", k.s("reaction"), EmojiUsage.reactionKey(e))
            assertEquals("customKey $e", k.s("custom"), EmojiUsage.customKey(e))
        }
        val scores = u["score"]!!.jsonArray.map { it.jsonPrimitive.double }
        assert(close(scores[0], EmojiUsage.scoreOf(usage["😀"], now)))
        assert(close(scores[1], EmojiUsage.scoreOf(null, now)))
        assert(close(scores[2], EmojiUsage.scoreOf(usage["👍"], now + week)))
        assert(sameUsage(EmojiUsage.withUse(usage, listOf("😀", "😀", "🔥"), now), u["withUse"]!!.jsonObject)) { "withUse ${usageJson(EmojiUsage.withUse(usage, listOf("😀", "😀", "🔥"), now))} web ${u["withUse"]}" }
        assertEquals(strings(u["ranked"]), EmojiUsage.rankedKeys(usage, now))
        for (k in u["keysIn"]!!.jsonArray.map { it.jsonObject }) assertEquals("keysIn ${k.s("text")}", strings(k["keys"]), EmojiUsage.keysIn(k.s("text")!!))
        val history = EmojiUsage.fromHistory(usage, listOf("😀 🔥" to now - week, "🔥" to now, "<:blob:30>" to now - 2 * week), now)
        assert(sameUsage(history, u["history"]!!.jsonObject)) { "history ${usageJson(history)} web ${u["history"]}" }
        val stored = buildJsonObject {
            put("ok", buildJsonObject { put("s", 1); put("at", 5) })
            put("bad", buildJsonObject { put("s", -1); put("at", 5) })
            put("nan", buildJsonObject { put("s", "x"); put("at", 5) })
            put("k".repeat(81), buildJsonObject { put("s", 1); put("at", 1) })
            put("arr", JsonArray(listOf(JsonPrimitive(1))))
        }
        assert(sameUsage(EmojiUsage.sanitize(stored, now), u["sanitized"]!!.jsonObject))
        val many = LinkedHashMap<String, EmojiUsage.Use>().apply { for (i in 0 until 70) put("k$i", EmojiUsage.Use(i + 1.0, now)) }
        assert(sameUsage(EmojiUsage.withUse(many, listOf("new"), now), u["trimmed"]!!.jsonObject)) { "trimmed" }
        for (p in u["popularity"]!!.jsonArray.map { it.jsonObject }) assertEquals("popularity ${p.s("e")}", p["p"]!!.jsonPrimitive.int, EmojiPopular.popularity(p.s("e")!!))
        for (w in u["words"]!!.jsonArray.map { it.jsonObject }) assertEquals("wordsOf ${w.s("n")}", strings(w["words"]), EmojiSuggest.wordsOf(w.s("n")!!))
        for (m in u["match"]!!.jsonArray.map { it.jsonObject }) {
            val got = EmojiSuggest.nameMatch(m.s("name")!!, m.s("q")!!)
            assert(close(got, m["score"]!!.jsonPrimitive.double)) { "nameMatch ${m.s("name")} ${m.s("q")}: web ${m["score"]} kotlin $got" }
        }
        for (b in u["boost"]!!.jsonArray.map { it.jsonObject }) {
            val got = EmojiSuggest.useBoost(b["s"]!!.jsonPrimitive.double)
            assert(close(got, b["b"]!!.jsonPrimitive.double)) { "useBoost ${b["s"]}: web ${b["b"]} kotlin $got" }
        }
    }

    @Test
    fun patches() {
        val settings = buildJsonObject { put("smartEmoji", true); put("emojiUsage", EmojiUsage.toJson(usage)) }
        val patch = EmojiUsage.noteUsePatch(settings, listOf("🔥"), now)!!
        assert(sameUsage(EmojiUsage.sanitize(patch["emojiUsage"], now), EmojiUsage.toJson(EmojiUsage.withUse(usage, listOf("🔥"), now))))
        assertNull(EmojiUsage.noteUsePatch(buildJsonObject { put("smartEmoji", false) }, listOf("🔥"), now))
        assertNull(EmojiUsage.noteUsePatch(settings, emptyList(), now))
        val learned = EmojiUsage.historyPatch(settings, listOf("🎉" to now), now)!!
        assertEquals(JsonPrimitive(true), learned["emojiLearned"])
        assertNull(EmojiUsage.historyPatch(buildJsonObject { put("emojiLearned", true) }, listOf("🎉" to now), now))
    }

    @Test
    fun picker() {
        val p = Vectors["picker"].jsonObject
        assertEquals(p["count"]!!.jsonPrimitive.int, EmojiData.all().size)
        val groups = p["groups"]!!.jsonArray.map { it.jsonObject }
        assertEquals(groups.map { it["id"]!!.jsonPrimitive.int }, EmojiData.groups().map { it.id })
        for ((g, mine) in groups.zip(EmojiData.groups())) {
            assertEquals("group ${mine.id} size", g["size"]!!.jsonPrimitive.int, mine.items.size)
            assertEquals("group ${mine.id} head", strings(g["head"]), mine.items.take(8).map { it.unicode })
            assertEquals("group ${mine.id} tail", strings(g["tail"]), mine.items.takeLast(4).map { it.unicode })
        }
        for (e in p["entries"]!!.jsonArray.map { it.jsonObject }) {
            val mine = EmojiData.byUnicode(e.s("unicode")!!)
            if (e.containsKey("missing")) {
                assertNull(mine)
                continue
            }
            mine!!
            assertEquals(e.s("hexcode"), mine.hexcode)
            assertEquals(e.s("label"), mine.label)
            assertEquals(e["group"]!!.jsonPrimitive.int, mine.group)
            assertEquals(strings(e["tags"]), mine.tags)
            assertEquals(strings(e["shortcodes"]), mine.shortcodes)
            val skins = e["skins"]!!.takeIf { it !is JsonNull }?.jsonArray?.map { it.jsonObject }
            assertEquals("skins of ${mine.unicode}", skins?.map { it.s("unicode") }, mine.skins?.map { it.unicode })
            skins?.zip(mine.skins!!)?.forEach { (w, s) ->
                val tone = w["tone"]!!
                if (tone is JsonArray) assertEquals(tone.map { it.jsonPrimitive.int }, s.tones) else assertEquals(tone.jsonPrimitive.int, s.tone)
            }
        }
        for (s in p["searches"]!!.jsonArray.map { it.jsonObject }) assertEquals("search ${s.s("q")}", strings(s["out"]), EmojiData.search(s.s("q")!!).map { it.unicode })
        for (t in p["tones"]!!.jsonArray.map { it.jsonObject }) {
            val e = EmojiData.byUnicode(t.s("unicode")!!)
            assertEquals("tone ${t.s("unicode")} ${t["tone"]}", t.s("out"), e?.let { EmojiData.withTone(it, t["tone"]!!.jsonPrimitive.int) })
        }
        for (c in p["byCode"]!!.jsonArray.map { it.jsonObject }) assertEquals("byShortcode ${c.s("name")}", c.s("unicode"), EmojiData.byShortcode(c.s("name")!!)?.unicode)
        for (t in p["toneOf"]!!.jsonArray.map { it.jsonObject }) {
            val want = t["tone"]!!
            val got = EmojiData.toneOf(t.s("hex")!!)
            when (want) {
                is JsonNull -> assertNull(got)
                is JsonArray -> assertEquals(want.map { it.jsonPrimitive.int }, got)
                else -> assertEquals(listOf(want.jsonPrimitive.int), got)
            }
        }
        val popular = p["popular"]!!.jsonObject
        val mine = EmojiData.all().flatMap { e -> listOf(e.unicode) + (e.skins ?: emptyList()).map { it.unicode } }.filter { EmojiPopular.popularity(it) != 0 }
        assertEquals(popular.keys, mine.toSet())
        for ((k, v) in popular) assertEquals("popularity $k", v.jsonPrimitive.int, EmojiPopular.popularity(k))
    }

    private val custom = listOf(
        Emoji("e1", serverId = "s1", name = "blob_heart", blobId = "900", animated = false),
        Emoji("e2", serverId = "s1", name = "partyBlob", blobId = "901", animated = true),
        Emoji("e3", serverId = "s2", name = "heart", blobId = "902", animated = false),
    )

    @Test
    fun suggestions() {
        val candidates = custom.mapIndexed { i, e -> EmojiSuggest.Candidate.Custom(e, own = i < 2) } + EmojiData.all().map { EmojiSuggest.Candidate.Unicode(it) }
        val sugUsage = mapOf(
            EmojiUsage.unicodeKey("💔") to EmojiUsage.Use(4.0, now - week),
            "c:901" to EmojiUsage.Use(2.0, now),
            EmojiUsage.unicodeKey("🔥") to EmojiUsage.Use(1.0, now - 30 * week),
        )
        val cases = Vectors["suggestions"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("suggestEmoji", cases) { c ->
            val variant = c["variant"]!!.jsonPrimitive.int
            val got = EmojiSuggest.suggest(
                c.s("query")!!, candidates,
                if (variant == 0) emptyMap() else sugUsage,
                if (variant == 0) emptyList() else listOf("😀", "❤️", "🔥"),
                now,
            ).map {
                val (kind, key) = when (val k = it.candidate) {
                    is EmojiSuggest.Candidate.Unicode -> "emoji" to k.entry.unicode
                    is EmojiSuggest.Candidate.Custom -> "customEmoji" to k.emoji.blobId
                }
                Triple(kind, key, it.name)
            }
            val want = c["out"]!!.jsonArray.map { it.jsonObject }.map { Triple(it.s("kind")!!, it.s("key")!!, it.s("name")!!) }
            if (got == want) null else "query ${c.s("query")} variant $variant\nweb    $want\nkotlin $got"
        }
    }

    @Test
    fun reactions() {
        val r = Vectors["reactions"].jsonObject
        for ((t, e) in r["tokens"]!!.jsonArray.map { it.jsonObject }.zip(custom)) {
            assertEquals(t.s("token"), CustomEmoji.token(e))
            assertEquals(t.s("key"), CustomEmoji.reactionKey(e))
        }
        for (p in r["picks"]!!.jsonArray.map { it.jsonObject }) {
            val pick = custom.firstOrNull { it.blobId == p.s("custom") }
            assertEquals("pick ${p.s("unicode")}", p.s("key"), CustomEmoji.reactionKeyOfPick(p.s("unicode")!!, pick))
        }
        for (s in r["search"]!!.jsonArray.map { it.jsonObject }) assertEquals("search ${s.s("q")}", strings(s["out"]), CustomEmoji.search(custom, s.s("q")!!, locale = Locale.ENGLISH).map { it.blobId })
        assertEquals(strings(r["starter"]), EmojiSuggest.STARTER_EMOJI)
    }

    @Test
    fun closingAShortcodeTurnsItIntoItsEmoji() {
        // the caret counts UTF-16 units, as the web's does: 😄 is two
        assertEquals("hi 😄" to 5, ShortcodeTyping.closeShortcode("hi :smile:", 10, 0))
        assertEquals("👍🏽 x" to 4, ShortcodeTyping.closeShortcode(":+1: x", 4, 3))
        assertNull(ShortcodeTyping.closeShortcode("`:smile:", 8, 0))
        assertNull(ShortcodeTyping.closeShortcode(":nope_not_one:", 14, 0))
        assertNull(ShortcodeTyping.closeShortcode(":blob:", 6, 0) { it == "blob" })
    }
}
