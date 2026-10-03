package fish.nexa.markdown

import fish.nexa.ui.markdown.Flatten
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.markdown.MapNames
import fish.nexa.ui.markdown.UserName
import fish.nexa.ui.markdown.WebUrl
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.BeforeClass
import org.junit.Test

/** The parser and what is derived from its nodes, against the web's own output over thousands of messages. */
class ParseVectorsTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun assets() = Vectors.useAssets()
    }

    private fun str(o: JsonObject, k: String) = o[k]!!.jsonPrimitive.content

    @Test
    fun parse() {
        val cases = Vectors["parse"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("parse", cases) { c ->
            val src = str(c, "src")
            val got = Vectors.nodes(Markdown.parse(src))
            if (Vectors.same(got, c["ast"])) null else "src ${Vectors.show(src)}\nweb    ${c["ast"].toString().take(1500)}\nkotlin ${got.toString().take(1500)}"
        }
    }

    @Test
    fun parseModes() {
        val cases = Vectors["modes"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("parse modes", cases) { c ->
            val src = str(c, "src")
            val opts = c["opts"]!!.jsonObject
            val got = Vectors.nodes(
                Markdown.parse(
                    src,
                    inline = opts["inline"]?.jsonPrimitive?.booleanOrNull == true,
                    files = opts["files"]?.jsonPrimitive?.booleanOrNull == true,
                    max = opts["max"]?.jsonPrimitive?.int ?: 0,
                    exact = opts["exact"]?.jsonPrimitive?.booleanOrNull == true,
                ),
            )
            if (Vectors.same(got, c["ast"])) null else "src ${Vectors.show(src)} opts $opts\nweb    ${c["ast"].toString().take(1500)}\nkotlin ${got.toString().take(1500)}"
        }
    }

    private val names = MapNames(
        users = mapOf("123" to UserName("Ann", "ann"), "456" to UserName("", "bob")),
        channels = mapOf("789" to "general"),
        roles = mapOf("10" to "Mods"),
    )

    @Test
    fun plainTextEmojiOnlyUrlsAndFlatten() {
        val cases = Vectors["plain"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("plainText / isEmojiOnly / extractUrls / flattenInline", cases) { c ->
            val src = str(c, "src")
            val nodes = Markdown.parse(src)
            val problems = ArrayList<String>()
            val bare = Markdown.plainText(nodes, null, Vectors.tr)
            if (bare != str(c, "bare")) problems += "bare: web ${Vectors.show(str(c, "bare"))} kotlin ${Vectors.show(bare)}"
            val named = Markdown.plainText(nodes, names, Vectors.tr)
            if (named != str(c, "named")) problems += "named: web ${Vectors.show(str(c, "named"))} kotlin ${Vectors.show(named)}"
            val only = Markdown.isEmojiOnly(nodes)
            if (only != c["emojiOnly"]!!.jsonPrimitive.boolean) problems += "emojiOnly: web ${c["emojiOnly"]} kotlin $only"
            val urls = buildJsonArray { for (u in Markdown.extractUrls(src)) add(JsonPrimitive(u)) }
            if (!Vectors.same(urls, c["urls"])) problems += "urls: web ${c["urls"]} kotlin $urls"
            val flat = Vectors.nodes(Flatten.inline(nodes))
            if (!Vectors.same(flat, c["flat"])) problems += "flat: web ${c["flat"].toString().take(800)} kotlin ${flat.toString().take(800)}"
            if (problems.isEmpty()) null else "src ${Vectors.show(src)}\n" + problems.joinToString("\n")
        }
    }

    @Test
    fun trimUrl() {
        val cases = Vectors["trimUrl"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("trimUrl", cases) { c ->
            val got = Markdown.trimUrl(str(c, "url"))
            if (got == str(c, "out")) null else "url ${Vectors.show(str(c, "url"))}: web ${str(c, "out")} kotlin $got"
        }
    }

    @Test
    fun misleadingLabels() {
        val cases = Vectors["misleading"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("misleadingLabel", cases) { c ->
            val got = Markdown.misleadingLabel(str(c, "label"), str(c, "url"))
            if (got == c["value"]!!.jsonPrimitive.boolean) null else "label ${Vectors.show(str(c, "label"))} url ${str(c, "url")}: web ${c["value"]} kotlin $got"
        }
    }

    @Test
    fun urlParts() {
        val cases = Vectors["url"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("new URL()", cases) { c ->
            val u = WebUrl.parse(str(c, "url"))
            val ok = c["ok"]!!.jsonPrimitive.boolean
            when {
                !ok && u == null -> null
                !ok -> "url ${Vectors.show(str(c, "url"))}: web refuses it, kotlin reads ${u!!.href}"
                u == null -> "url ${Vectors.show(str(c, "url"))}: web reads ${str(c, "href")}, kotlin refuses it"
                else -> {
                    val diffs = listOf(
                        "hostname" to u.hostname, "host" to u.host, "origin" to u.origin, "pathname" to u.pathname,
                        "search" to u.search, "hash" to u.hash, "href" to u.href,
                    ).filter { (k, v) -> v != str(c, k) }
                    if (diffs.isEmpty()) null else "url ${Vectors.show(str(c, "url"))}: " + diffs.joinToString { (k, v) -> "$k web ${str(c, k)} kotlin $v" }
                }
            }
        }
    }

    @Test
    fun fileLines() {
        val cases = Vectors["files"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("fileLine / fileWidth", cases) { c ->
            val width = c["width"]!!.jsonPrimitive.contentOrNull?.toDouble()
            val line = Markdown.fileLine(str(c, "id"), str(c, "name"), width)
            val w = Markdown.fileWidth(width)
            val wantW = c["w"]!!.jsonPrimitive.contentOrNull?.toDouble()?.toInt()
            if (line == str(c, "line") && w == wantW) null else "file $c: kotlin line ${Vectors.show(line)} width $w"
        }
    }

    @Suppress("unused")
    private fun JsonArray.strings() = map { it.jsonPrimitive.content }
}
