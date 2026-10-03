package fish.nexa.markdown

import fish.nexa.ui.markdown.Align
import fish.nexa.ui.markdown.EmojiAssets
import fish.nexa.ui.markdown.Footnote
import fish.nexa.ui.markdown.Node
import fish.nexa.ui.markdown.WebUrl
import com.ibm.icu.text.IDNA
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.io.FileInputStream
import java.util.zip.GZIPInputStream

/**
 * The web's own answers (android/tools/markdown_vectors.ts), read once for
 * every test, and the helpers that put the Kotlin answers into the same JSON
 * shape so the two can be compared.
 */
object Vectors {
    /** Tests run in android/app; the web client is two levels up. */
    private val root = File(".").absoluteFile

    val data: JsonObject by lazy {
        val stream = Vectors::class.java.classLoader!!.getResourceAsStream("web-markdown-vectors.json.gz")!!
        GZIPInputStream(stream).use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
    }

    operator fun get(key: String): JsonElement = data[key]!!

    val english: Map<String, String> by lazy {
        val file = File(root, "../../web/src/i18n/locales/en.json")
        val obj = Json.parseToJsonElement(file.readText()) as JsonObject
        obj.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }.toMap()
    }

    /** The English catalogue, as the web's `t()` reads it with no values. */
    val tr: (String) -> String = { key -> english[key] ?: key }

    fun useAssets() {
        val assets = File(root, "src/main/assets/emoji")
        EmojiAssets.use({ FileInputStream(File(assets, "shortcodes.json")) }, { FileInputStream(File(assets, "emoji.json")) })
        WebUrl.idna = ::icuIdna
    }

    /** UTS 46 as the URL standard uses it, with ICU4J standing in for the phone's android.icu. */
    private fun icuIdna(domain: String): String? {
        val uts46 = IDNA.getUTS46Instance(IDNA.NONTRANSITIONAL_TO_ASCII or IDNA.NONTRANSITIONAL_TO_UNICODE or IDNA.CHECK_BIDI or IDNA.CHECK_CONTEXTJ)
        val info = IDNA.Info()
        val out = StringBuilder()
        uts46.nameToASCII(domain, out, info)
        val ignored = setOf(
            IDNA.Error.EMPTY_LABEL, IDNA.Error.LABEL_TOO_LONG, IDNA.Error.DOMAIN_NAME_TOO_LONG,
            IDNA.Error.LEADING_HYPHEN, IDNA.Error.TRAILING_HYPHEN, IDNA.Error.HYPHEN_3_4,
        )
        return if (info.errors.all { it in ignored }) out.toString() else null
    }

    fun nodes(list: List<Node>): JsonArray = buildJsonArray { for (n in list) add(node(n)) }

    fun node(n: Node): JsonObject = buildJsonObject {
        put("type", n.type)
        when (n) {
            is Node.Text -> put("text", n.text)
            is Node.Br, is Node.Hr -> Unit
            is Node.Code -> put("text", n.text)
            is Node.CodeBlock -> {
                put("lang", n.lang?.let { JsonPrimitive(it) } ?: JsonNull)
                put("text", n.text)
            }
            is Node.Heading -> {
                put("level", n.level)
                put("children", nodes(n.children))
            }
            is Node.Alert -> {
                put("kind", n.kind.key)
                put("children", nodes(n.children))
            }
            is Node.Color -> {
                put("fg", n.fg?.let { JsonPrimitive(it) } ?: JsonNull)
                put("bg", n.bg?.let { JsonPrimitive(it) } ?: JsonNull)
                put("children", nodes(n.children))
            }
            is Node.Link -> {
                put("url", n.url)
                put("children", nodes(n.children))
                put("masked", n.masked)
                put("noEmbed", n.noEmbed)
            }
            is Node.Container -> put("children", nodes(n.children))
            is Node.ListBlock -> {
                put("ordered", n.ordered)
                put("start", n.start)
                put("items", buildJsonArray { for (item in n.items) add(nodes(item)) })
            }
            is Node.Task -> put("checked", n.checked)
            is Node.File -> {
                put("id", n.id)
                put("name", n.name)
                n.width?.let { put("width", it) }
            }
            is Node.Table -> {
                put("align", buildJsonArray { for (a in n.align) add(a?.let { JsonPrimitive(it.key) } ?: JsonNull) })
                put("head", buildJsonArray { for (c in n.head) add(nodes(c)) })
                put("rows", buildJsonArray { for (r in n.rows) add(buildJsonArray { for (c in r) add(nodes(c)) }) })
            }
            is Node.Details -> {
                put("summary", nodes(n.summary))
                put("children", nodes(n.children))
            }
            is Node.FootnoteRef -> {
                put("label", n.label)
                put("n", n.n)
            }
            is Node.Footnotes -> put("notes", buildJsonArray { for (f in n.notes) add(note(f)) })
            is Node.Mention -> {
                put("kind", n.kind.key)
                n.id?.let { put("id", it) }
            }
            is Node.Emoji -> {
                put("name", n.name)
                put("id", n.id)
                put("animated", n.animated)
            }
            is Node.UnicodeEmoji -> put("text", n.text)
            is Node.Timestamp -> {
                put("unix", n.unix)
                put("style", n.style.toString())
            }
        }
    }

    private fun note(f: Footnote) = buildJsonObject {
        put("label", f.label)
        put("n", f.n)
        put("children", nodes(f.children))
    }

    @Suppress("unused")
    private fun align(a: Align?) = a?.key

    /** JSON equality, numbers compared as numbers (1e19 and 10000000000000000000 are one value). */
    fun same(a: JsonElement?, b: JsonElement?): Boolean {
        if (a == null || b == null) return a == b
        if (a is JsonNull || b is JsonNull) return a is JsonNull && b is JsonNull
        if (a is JsonPrimitive && b is JsonPrimitive) {
            if (a.isString || b.isString) return a.isString == b.isString && a.content == b.content
            val x = a.doubleOrNull
            val y = b.doubleOrNull
            if (x != null && y != null) return x == y
            return a.content == b.content
        }
        if (a is JsonArray && b is JsonArray) return a.size == b.size && a.indices.all { same(a[it], b[it]) }
        if (a is JsonObject && b is JsonObject) return a.keys == b.keys && a.keys.all { same(a[it], b[it]) }
        return false
    }

    /** Runs `check` over every case, then fails listing the first few that differ. */
    fun <T> expectAll(name: String, cases: List<T>, check: (T) -> String?) {
        val failures = ArrayList<String>()
        for (c in cases) {
            val msg = try {
                check(c)
            } catch (e: Throwable) {
                "threw ${e::class.simpleName}: ${e.message}\n${e.stackTrace.take(6).joinToString("\n")}"
            }
            if (msg != null) failures += msg
        }
        if (failures.isNotEmpty()) {
            throw AssertionError("$name: ${failures.size} of ${cases.size} differ from the web\n\n" + failures.take(12).joinToString("\n\n---\n\n"))
        }
        println("$name: ${cases.size} cases match the web")
    }

    fun show(s: String): String = Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(if (s.length > 300) s.take(300) + "…" else s))
}
