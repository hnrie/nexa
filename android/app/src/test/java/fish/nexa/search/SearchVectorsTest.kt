package fish.nexa.search

import fish.nexa.net.Channel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import java.util.TimeZone
import java.util.zip.GZIPInputStream

/**
 * The web's own answers (android/tools/search_vectors.ts, run in
 * America/New_York) against the port: folding, tokenizing, excerpts and
 * highlights, the query language, what a message carries, the engine's
 * results in every tab and order, and the suggestions.
 */
class SearchVectorsTest {
    companion object {
        lateinit var data: JsonObject

        @JvmStatic
        @BeforeClass
        fun load() {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            Locale.setDefault(Locale.US)
            val stream = SearchVectorsTest::class.java.classLoader!!.getResourceAsStream("web-search-vectors.json.gz")!!
            data = GZIPInputStream(stream).use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
        }

        private val ZONE = ZoneId.of("America/New_York")
    }

    private fun list(key: String): List<JsonObject> = data[key]!!.jsonArray.map { it.jsonObject }
    private fun JsonObject.s(k: String): String = this[k]!!.jsonPrimitive.content
    private fun JsonObject.sOrNull(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
    private fun JsonObject.i(k: String): Int = this[k]!!.jsonPrimitive.intOrNull!!
    private fun JsonObject.l(k: String): Long? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.longOrNull
    private fun JsonObject.strings(k: String): List<String> = this[k]!!.jsonArray.map { it.jsonPrimitive.content }
    private fun JsonObject.stringsOrNull(k: String): List<String>? = (this[k] as? JsonArray)?.map { it.jsonPrimitive.content }

    @Test
    fun folding() {
        for (v in list("fold")) assertEquals(v.s("text"), v.s("folded"), SearchText.fold(v.s("text")))
        for (v in list("foldWithMap")) {
            val f = SearchText.foldWithMap(v.s("text"))
            assertEquals(v.s("text"), v.s("shown"), f.shown)
            assertEquals(v.s("text"), v.s("folded"), f.folded)
            assertEquals(v.s("text"), v["map"]!!.jsonArray.map { it.jsonPrimitive.intOrNull!! }, f.map.toList())
        }
    }

    @Test
    fun tokens() {
        fun toks(el: JsonElement) = el.jsonArray.map { it.jsonObject.s("text") to it.jsonObject["prefix"]!!.jsonPrimitive.booleanOrNull!! }
        for (v in list("tokenize")) {
            val f = v.s("folded")
            assertEquals(f, toks(v["tokens"]!!), SearchText.tokenize(f).map { it.text to it.prefix })
            assertEquals(f, toks(v["terms"]!!), SearchText.termTokens(f).map { it.text to it.prefix })
        }
    }

    @Test
    fun excerptsAndHighlights() {
        for (v in list("excerpt")) assertEquals(v.s("text") + v["needles"], v.s("out"), SearchText.excerptAround(v.s("text"), v.strings("needles")))
        for (v in list("excerptMax")) assertEquals(v.s("out"), SearchText.excerptAround(v.s("text"), v.strings("needles"), v.i("max")))
        for (v in list("highlight")) {
            val want = v["runs"]!!.jsonArray.map { it.jsonObject.s("text") to it.jsonObject["hit"]!!.jsonPrimitive.booleanOrNull!! }
            assertEquals(v.s("text") + v["needles"], want, SearchText.highlightRuns(v.s("text"), v.strings("needles")).map { it.text to it.hit })
        }
    }

    @Test
    fun dates() {
        for (v in list("dateRange")) {
            val r = v["range"] as? JsonObject
            val got = SearchQueries.dateRange(v.s("v"), ZONE)
            assertEquals(v.s("v"), r?.l("start"), got?.start)
            assertEquals(v.s("v"), r?.l("end"), got?.end)
        }
    }

    private val ctx by lazy {
        val users = LinkedHashMap<String, SearchQueries.Person>()
        fun user(id: String, username: String, display: String) {
            users[id] = SearchQueries.Person(id, username, display)
        }
        user("2000", "alice", "Alice")
        user("2001", "bob", "Bob Builder")
        user("2002", "carol", "Carol")
        user("2003", "ann", "Ann Lee")
        user("2004", "ännchen", "Ännchen Müller")
        user("2005", "dave_s", "Dave S.")
        SearchQueries.Ctx(
            users = users,
            nicknames = linkedMapOf("2001" to listOf("bobby"), "2003" to listOf("annie", "the boss")),
            channelNames = linkedMapOf(
                "1000" to listOf("general"),
                "1001" to listOf("random"),
                "1002" to listOf("bob builder", "bob"),
                "1003" to listOf("weekend plans"),
                "1004" to listOf("café talk"),
            ),
            meId = "2000",
        )
    }

    private fun resolvedJson(r: SearchQueries.Resolved): Map<String, Any?> = linkedMapOf(
        "terms" to r.terms, "phrases" to r.phrases, "exclude" to r.exclude, "from" to r.from, "channels" to r.channels, "mentions" to r.mentions,
        "everyone" to r.everyone, "has" to r.has, "since" to r.since, "until" to r.until, "pinned" to r.pinned,
    )

    private fun resolvedFrom(o: JsonObject): Map<String, Any?> = linkedMapOf(
        "terms" to o.strings("terms"), "phrases" to o.strings("phrases"), "exclude" to o.strings("exclude"), "from" to o.stringsOrNull("from"),
        "channels" to o.stringsOrNull("channels"), "mentions" to o.stringsOrNull("mentions"), "everyone" to o["everyone"]!!.jsonPrimitive.booleanOrNull,
        "has" to o.strings("has"), "since" to o.l("since"), "until" to o.l("until"), "pinned" to (o["pinned"] as? JsonPrimitive)?.booleanOrNull,
    )

    @Test
    fun queries() {
        for (v in list("parse")) {
            val q = v.s("q")
            val p = SearchQueries.parse(q)
            val want = v["parsed"]!!.jsonObject
            assertEquals(q, want.strings("terms"), p.terms)
            assertEquals(q, want.strings("phrases"), p.phrases)
            assertEquals(q, want.strings("exclude"), p.exclude)
            assertEquals(q, want.strings("from"), p.from)
            assertEquals(q, want.strings("in"), p.inside)
            assertEquals(q, want.strings("mentions"), p.mentions)
            assertEquals(q, want.strings("has"), p.has)
            assertEquals(q, want.l("since"), p.since)
            assertEquals(q, want.l("until"), p.until)
            assertEquals(q, (want["pinned"] as? JsonPrimitive)?.booleanOrNull, p.pinned)
            val toks = want["tokens"]!!.jsonArray.map {
                val t = it.jsonObject
                listOf(t.s("kind"), t.sOrNull("key"), t.s("value"), t.i("start"), t.i("end"), (t["invalid"] as? JsonPrimitive)?.booleanOrNull ?: false)
            }
            assertEquals(q, toks, p.tokens.map { listOf(it.kind, it.key, it.value, it.start, it.end, it.invalid) })
            assertEquals(q, v["empty"]!!.jsonPrimitive.booleanOrNull, SearchQueries.isEmpty(p))
            assertEquals(q, v.strings("needles"), SearchQueries.needlesOf(p))
            assertEquals(q, resolvedFrom(v["resolved"]!!.jsonObject), resolvedJson(SearchQueries.resolve(p, ctx)))
        }
        for (v in list("withoutToken")) assertEquals(v.s("q"), v.s("out"), SearchQueries.withoutToken(v.s("q"), v.i("start"), v.i("end")))
        for (v in list("filterValue")) assertEquals(v.s("out"), SearchQueries.filterValue(v.s("v")))
    }

    private val docs by lazy { data["docs"]!!.jsonArray.map { SearchDocs.fromJson(it)!! } }

    @Test
    fun whatMessagesCarry() {
        val byId = docs.associateBy { it.id }
        for (v in list("docFacts")) {
            val d = byId[v.s("id")]!!
            assertEquals(d.id, v.s("searchable"), SearchDocs.searchableText(d))
            assertEquals(d.id, v.strings("links"), SearchDocs.linksIn(d.t))
            assertEquals(d.id, v.strings("media"), SearchDocs.mediaOf(d).map { if (it is MediaItem.File) "file:${it.att.blobId}" else "link:${(it as MediaItem.Link).embed.url}" })
            assertEquals(d.id, v.strings("files"), SearchDocs.filesOf(d).map { it.blobId })
            assertEquals(d.id, v.strings("linkItems"), SearchDocs.linksOf(d).map { "${it.url}|${if (it.preview != null) "p" else ""}" })
            assertEquals(d.id, v.strings("has"), SearchDocs.hasKinds(d).sorted())
        }
        for (v in list("linksIn")) assertEquals(v.s("t"), v.strings("links"), SearchDocs.linksIn(v.s("t")))
        // and a doc survives being written out and read back
        for (d in docs) assertEquals(d, SearchDocs.fromJson(SearchDocs.toJson(d)))
    }

    @Test
    fun matching() {
        for (v in list("matches")) {
            val r = SearchQueries.resolve(SearchQueries.parse(v.s("q")), ctx)
            assertEquals(v.s("q"), v.strings("ids"), docs.filter { SearchQueries.matches(it, r) }.map { it.id })
        }
    }

    private fun engine(): SearchEngine {
        val e = SearchEngine()
        for (d in docs) e.upsert(d)
        e.upsert(docs[3].copy(t = docs[3].t + " edited", ed = 1))
        e.remove(docs[5].id)
        e.upsert(docs[7].copy(fl = 1))
        return e
    }

    private fun countsOf(o: JsonObject) = SearchTab.entries.associateWith { o[it.wire]!!.jsonPrimitive.intOrNull!! }

    @Test
    fun engineResults() {
        val e = engine()
        assertEquals(data["engineSize"]!!.jsonPrimitive.intOrNull!!, e.size)
        for (v in list("engine")) {
            val q = v.s("q")
            val tab = SearchTab.entries.first { it.wire == v.s("tab") }
            val sort = SearchSort.entries.first { it.wire == v.s("sort") }
            val res = e.query(EngineRequest(SearchQueries.resolve(SearchQueries.parse(q), ctx), null, emptyList(), tab, sort, 0, 25))
            val what = "$q / ${tab.wire} / ${sort.wire}"
            assertEquals(what, countsOf(v["counts"]!!.jsonObject), res.counts)
            assertEquals(what, v.i("total"), res.total)
            assertEquals(what, v.strings("ids"), res.docs.map { it.id })
        }
        for (v in list("engineScoped")) {
            val q = v.s("q")
            val scope = v.strings("scope")
            val res = e.query(EngineRequest(SearchQueries.resolve(SearchQueries.parse(q), ctx), scope, v.strings("hide"), SearchTab.MESSAGES, SearchSort.NEWEST, 5, 10))
            assertEquals("$q in $scope", countsOf(v["counts"]!!.jsonObject), res.counts)
            assertEquals("$q in $scope", v.i("total"), res.total)
            assertEquals("$q in $scope", v.strings("ids"), res.docs.map { it.id })
        }
    }

    private fun chan(id: String, type: String, name: String, server: String? = null, recipients: List<String> = emptyList()) =
        Channel(id = id, serverId = server, type = type, name = name, recipientIds = recipients)

    private val channels by lazy {
        listOf(
            chan("1000", "text", "general", "3000"),
            chan("1001", "text", "random", "3000"),
            chan("1002", "dm", "", recipients = listOf("2000", "2001")),
            chan("1003", "group_dm", "weekend plans", recipients = listOf("2000", "2002", "2003")),
            chan("1004", "text", "café talk", "3001"),
        )
    }

    private val names by lazy {
        SearchNames(
            users = ctx.users,
            meId = "2000",
            person = { id -> if (id == "2001") "bobby" else ctx.users[id]?.displayName ?: "Unknown" },
            channel = { c -> if (c.serverId != null) "#${c.name}" else if (c.type == "dm") ctx.users[c.recipientIds.firstOrNull { it != "2000" } ?: ""]?.displayName ?: "" else c.name },
            serverName = { id -> when (id) { "3000" -> "Alice's server"; "3001" -> "Cafe Club"; else -> null } },
            ctx = ctx,
        )
    }

    /** JavaScript's localeCompare is ICU's collation for the runtime's language. */
    private val collator: Comparator<String> by lazy {
        val c = com.ibm.icu.text.Collator.getInstance(com.ibm.icu.util.ULocale.US)
        Comparator { a, b -> c.compare(a, b) }
    }

    @Test
    fun suggestions() {
        val now = java.time.Instant.parse("2026-10-03T15:00:00Z").toEpochMilli()
        for (v in list("suggest")) {
            val raw = v.s("raw")
            val caret = v.i("caret")
            val what = "$raw @ $caret"
            val partial = v["partial"] as? JsonObject
            val p = Suggest.partialAt(raw, caret)
            assertEquals(what, partial?.let { listOf(it.sOrNull("key"), it.s("value"), it.i("start"), it.i("end")) }, p?.let { listOf(it.key, it.value, it.start, it.end) })
            val got = Suggest.suggest(Suggest.Input(raw, caret, names, channels, listOf("2001"), listOf("old search", "from:bob hello", "café"), now, ZONE, collator))
            val want = v["groups"]!!.jsonArray.map { g ->
                val go = g.jsonObject
                go.s("kind") to go["items"]!!.jsonArray.map { it ->
                    val o = it.jsonObject
                    val date = o["date"] as? JsonObject
                    listOf(o.s("id"), o.s("kind"), o.s("text"), o.i("caret"), o.sOrNull("key"), o.sOrNull("value"), o.sOrNull("userId"), o.sOrNull("channel"), o.sOrNull("has"), date?.let { d -> listOf(d.l("start"), d.s("unit"), d.sOrNull("relative")) }, o.sOrNull("recent"))
                }
            }
            val mine = got.map { g -> g.kind to g.items.map { listOf(it.id, it.kind, it.text, it.caret, it.key, it.value, it.userId, it.channel?.id, it.has, it.date?.let { d -> listOf(d.start, d.unit, d.relative) }, it.recent) } }
            assertEquals(what, want, mine)
        }
        for (v in list("replacePiece")) {
            val out = v["out"]!!.jsonObject
            val got = Suggest.replacePiece(v.s("raw"), v.i("start"), v.i("end"), v.s("insert"), v["finished"]!!.jsonPrimitive.booleanOrNull!!)
            assertEquals(out.s("text"), got.text)
            assertEquals(out.i("caret"), got.caret)
        }
        val byId = channels.associateBy { it.id }
        for (v in list("channelValue")) assertEquals(v.s("value"), Suggest.channelValue(byId[v.s("id")]!!, names))
    }
}
