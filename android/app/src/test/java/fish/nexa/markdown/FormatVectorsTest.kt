package fish.nexa.markdown

import fish.nexa.ui.markdown.Align
import fish.nexa.ui.markdown.UserName
import fish.nexa.ui.markdown.format.AtomKind
import fish.nexa.ui.markdown.format.AtomNames
import fish.nexa.ui.markdown.format.Block
import fish.nexa.ui.markdown.format.CodeBlock
import fish.nexa.ui.markdown.format.ColorMark
import fish.nexa.ui.markdown.format.Edit
import fish.nexa.ui.markdown.format.FileBlock
import fish.nexa.ui.markdown.format.Flag
import fish.nexa.ui.markdown.format.FormatMarkdown
import fish.nexa.ui.markdown.format.FormatModel
import fish.nexa.ui.markdown.format.Inline
import fish.nexa.ui.markdown.format.LinkMark
import fish.nexa.ui.markdown.format.Marks
import fish.nexa.ui.markdown.format.Pos
import fish.nexa.ui.markdown.format.RuleBlock
import fish.nexa.ui.markdown.format.Sel
import fish.nexa.ui.markdown.format.TableBlock
import fish.nexa.ui.markdown.format.TextBlock
import fish.nexa.ui.markdown.format.TextKind
import fish.nexa.ui.markdown.format.Wrap
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.BeforeClass
import org.junit.Test
import java.util.zip.GZIPInputStream

/** The formatting editor's model and markdown (components/composer/format), against the web. */
class FormatVectorsTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun assets() = Vectors.useAssets()

        val data: JsonObject by lazy {
            val stream = FormatVectorsTest::class.java.classLoader!!.getResourceAsStream("web-format-vectors.json.gz")!!
            GZIPInputStream(stream).use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
        }
    }

    private val names = object : AtomNames {
        override fun user(id: String) = mapOf("123" to UserName("Ann", "ann"), "456" to UserName("", "bob"))[id]
        override fun channel(id: String) = mapOf("789" to "general")[id]
        override fun role(id: String) = mapOf("10" to "Mods")[id]
        override fun emojiUrl(id: String, animated: Boolean, css: Int) = "/e/$id?a=$animated&s=$css"
    }

    private val labels = FormatMarkdown.Labels(names, Vectors.tr) { "" }

    private fun JsonObject.s(k: String): String? = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull

    // --- Kotlin to the web's JSON -----------------------------------------------

    private fun marksJson(m: Marks): JsonObject = buildJsonObject {
        for (f in FormatModel.FLAGS) if (m[f]) put(f.key, true)
        m.link?.let { put("link", buildJsonObject { put("url", it.url); put("noEmbed", it.noEmbed) }) }
        m.color?.let { put("color", buildJsonObject { put("fg", it.fg?.let(::JsonPrimitive) ?: JsonNull); put("bg", it.bg?.let(::JsonPrimitive) ?: JsonNull) }) }
    }

    private fun runJson(r: Inline): JsonObject = when (r) {
        is Inline.Text -> buildJsonObject {
            put("kind", "text")
            put("text", r.text)
            put("marks", marksJson(r.marks))
        }
        is Inline.Atom -> buildJsonObject {
            put("kind", "atom")
            put("atom", r.atom.key)
            put("raw", r.raw)
            put("label", if (r.atom == AtomKind.TIME) "" else r.label)
            r.img?.let { put("img", it) }
            put("marks", marksJson(r.marks))
        }
    }

    private fun runsJson(runs: List<Inline>) = buildJsonArray { for (r in runs) add(runJson(r)) }

    private fun blockJson(b: Block): JsonObject = buildJsonObject {
        put("kind", b.kind)
        put("wrap", b.wrap?.key?.let(::JsonPrimitive) ?: JsonNull)
        when (b) {
            is TextBlock -> {
                put("content", runsJson(b.content))
                b.list?.let { l ->
                    put("list", buildJsonObject {
                        put("ordered", l.ordered); put("task", l.task); put("checked", l.checked); put("indent", l.indent)
                        put("start", l.start?.let(::JsonPrimitive) ?: JsonNull)
                    })
                }
                b.label?.let { put("label", it) }
            }
            is CodeBlock -> {
                put("lang", b.lang)
                put("text", b.text)
            }
            is RuleBlock -> Unit
            is TableBlock -> {
                put("align", buildJsonArray { for (a in b.align) add(a?.key?.let(::JsonPrimitive) ?: JsonNull) })
                put("rows", buildJsonArray { for (row in b.rows) add(buildJsonArray { for (cell in row) add(runsJson(cell)) }) })
            }
            is FileBlock -> {
                put("file", b.file)
                put("name", b.name)
                b.width?.let { put("width", it) }
                b.align?.let { put("align", it) }
            }
        }
    }

    private fun blocksJson(blocks: List<Block>) = buildJsonArray { for (b in blocks) add(blockJson(b)) }

    private fun posJson(p: Pos) = buildJsonObject {
        put("b", p.b)
        put("o", p.o)
        p.cell?.let { put("cell", buildJsonArray { add(JsonPrimitive(it.first)); add(JsonPrimitive(it.second)) }) }
    }

    private fun selJson(s: Sel) = buildJsonObject {
        put("anchor", posJson(s.anchor))
        put("focus", posJson(s.focus))
    }

    // --- the web's JSON to Kotlin ----------------------------------------------

    private fun marks(e: JsonElement?): Marks {
        val o = e?.jsonObject ?: return Marks.NONE
        var m = Marks.NONE
        for (f in FormatModel.FLAGS) if (o[f.key]?.jsonPrimitive?.booleanOrNull == true) m = m.with(f, true)
        o["link"]?.takeIf { it !is JsonNull }?.jsonObject?.let { m = m.copy(link = LinkMark(it.s("url")!!, it["noEmbed"]!!.jsonPrimitive.boolean)) }
        o["color"]?.takeIf { it !is JsonNull }?.jsonObject?.let { m = m.copy(color = ColorMark(it.s("fg"), it.s("bg"))) }
        return m
    }

    private fun run(e: JsonElement): Inline {
        val o = e.jsonObject
        return if (o.s("kind") == "text") Inline.Text(o.s("text")!!, marks(o["marks"]))
        else Inline.Atom(AtomKind.entries.first { it.key == o.s("atom") }, o.s("raw")!!, o.s("label")!!, o.s("img"), marks(o["marks"]))
    }

    private fun runs(e: JsonElement?) = e!!.jsonArray.map(::run)

    private fun pos(e: JsonElement?): Pos {
        val o = e!!.jsonObject
        val cell = o["cell"]?.jsonArray?.let { it[0].jsonPrimitive.int to it[1].jsonPrimitive.int }
        return Pos(o["b"]!!.jsonPrimitive.int, o["o"]!!.jsonPrimitive.int, cell)
    }

    private fun sel(e: JsonElement?): Sel = e!!.jsonObject.let { Sel(pos(it["anchor"]), pos(it["focus"])) }

    private fun flag(key: String) = Flag.entries.first { it.key == key }

    // --- the checks ----------------------------------------------------------------

    @Test
    fun loads() {
        val cases = data["loads"]!!.jsonArray.map { it.jsonObject }
        Vectors.expectAll("fromMarkdown / toMarkdown", cases) { c ->
            val src = c.s("src")!!
            val loaded = FormatMarkdown.fromMarkdown(src, labels)
            val got = blocksJson(loaded.blocks)
            val md = FormatMarkdown.toMarkdown(loaded.blocks)
            val problems = ArrayList<String>()
            if (!Vectors.same(got, c["blocks"])) problems += "blocks\nweb    ${c["blocks"].toString().take(1500)}\nkotlin ${got.toString().take(1500)}"
            if (loaded.simplified != c["simplified"]!!.jsonPrimitive.boolean) problems += "simplified web ${c["simplified"]} kotlin ${loaded.simplified}"
            if (md != c.s("md")) problems += "md\nweb    ${Vectors.show(c.s("md")!!)}\nkotlin ${Vectors.show(md)}"
            if (problems.isEmpty()) null else "src ${Vectors.show(src)}\n" + problems.joinToString("\n")
        }
    }

    @Test
    fun noteFiles() {
        val cases = data["files"]!!.jsonArray.map { it.jsonObject }
        Vectors.expectAll("fromMarkdown with files", cases) { c ->
            val src = c.s("src")!!
            val loaded = FormatMarkdown.fromMarkdown(src, labels, files = true, max = 20000)
            val got = blocksJson(loaded.blocks)
            val md = FormatMarkdown.toMarkdown(loaded.blocks)
            if (Vectors.same(got, c["blocks"]) && md == c.s("md")) null else "src ${Vectors.show(src)}\nweb    ${Vectors.show(c.s("md")!!)}\nkotlin ${Vectors.show(md)}"
        }
    }

    @Test
    fun pastedLines() {
        val cases = data["lines"]!!.jsonArray.map { it.jsonObject }
        Vectors.expectAll("inlineFromMarkdown", cases) { c ->
            val src = c.s("src")!!
            val got = runsJson(FormatMarkdown.inlineFromMarkdown(src.split("\n")[0], labels))
            if (Vectors.same(got, c["runs"])) null else "src ${Vectors.show(src)}\nweb    ${c["runs"]}\nkotlin $got"
        }
    }

    @Test
    fun runsToMarkdown() {
        val cases = data["runs"]!!.jsonArray.map { it.jsonObject }
        Vectors.expectAll("inlineMarkdown / misleads", cases) { c ->
            val r = runs(c["runs"])
            val md = FormatMarkdown.inlineMarkdown(r)
            val cell = FormatMarkdown.inlineMarkdown(r, cell = true)
            val mis = FormatMarkdown.misleads(r)
            if (md == c.s("md") && cell == c.s("cell") && mis == c["misleads"]!!.jsonPrimitive.boolean) null
            else "runs ${c["runs"]}\nweb    ${Vectors.show(c.s("md")!!)} | ${Vectors.show(c.s("cell")!!)} | ${c["misleads"]}\nkotlin ${Vectors.show(md)} | ${Vectors.show(cell)} | $mis"
        }
    }

    private fun apply(blocks: List<Block>, current: Sel, o: JsonObject): Edit {
        val s by lazy { sel(o["sel"]) }
        return when (o.s("op")) {
            "insert" -> FormatModel.insertAt(blocks, pos(o["at"]), runs(o["runs"]))
            "split" -> FormatModel.splitAt(blocks, pos(o["at"]))
            "joinBack" -> FormatModel.joinBackward(blocks, o["index"]!!.jsonPrimitive.int)
            "joinFwd" -> FormatModel.joinForward(blocks, o["index"]!!.jsonPrimitive.int)
            "check" -> Edit(FormatModel.toggleChecked(blocks, o["index"]!!.jsonPrimitive.int), current)
            "delete" -> FormatModel.deleteRange(blocks, s)
            "mark" -> Edit(FormatModel.mapSelection(blocks, s) { FormatModel.withMark(it, flag(o.s("flag")!!), o["on"]!!.jsonPrimitive.boolean) }, s)
            "color" -> Edit(FormatModel.mapSelection(blocks, s) { FormatModel.withColor(it, o.s("part")!!, o.s("value")) }, s)
            "link" -> {
                val link = o["link"]?.takeIf { it !is JsonNull }?.jsonObject?.let { LinkMark(it.s("url")!!, it["noEmbed"]!!.jsonPrimitive.boolean) }
                Edit(FormatModel.mapSelection(blocks, s) { FormatModel.withLink(it, link) }, s)
            }
            "kind" -> Edit(FormatModel.setKind(blocks, s, TextKind.entries.first { it.key == o.s("kind") }), s)
            "list" -> Edit(FormatModel.toggleList(blocks, s, o.s("type")!!), s)
            "indent" -> Edit(FormatModel.indentBy(blocks, s, o["delta"]!!.jsonPrimitive.int), s)
            "wrap" -> FormatModel.toggleWrap(blocks, s, Wrap.entries.first { it.key == o.s("wrap") })
            "code" -> FormatModel.toggleCode(blocks, s)
            "block" -> {
                val block: Block = when (o.s("block")) {
                    "hr" -> RuleBlock(FormatModel.newId(), null)
                    "table" -> FormatModel.emptyTable(2, 2)
                    else -> CodeBlock(FormatModel.newId(), null, "", "")
                }
                FormatModel.insertBlock(blocks, s, block)
            }
            "table" -> {
                val t = o["tableOp"]!!.jsonObject
                val op = when (t.s("kind")) {
                    "addRow" -> FormatModel.TableOp.AddRow(t["at"]!!.jsonPrimitive.int)
                    "addCol" -> FormatModel.TableOp.AddCol(t["at"]!!.jsonPrimitive.int)
                    "delRow" -> FormatModel.TableOp.DelRow(t["at"]!!.jsonPrimitive.int)
                    "delCol" -> FormatModel.TableOp.DelCol(t["at"]!!.jsonPrimitive.int)
                    else -> FormatModel.TableOp.SetAlign(t["col"]!!.jsonPrimitive.int, t.s("align")?.let { k -> Align.entries.first { it.key == k } })
                }
                Edit(FormatModel.editTable(blocks, o["index"]!!.jsonPrimitive.int, op), current)
            }
            "clear" -> Edit(FormatModel.clearFormatting(blocks, s), s)
            else -> error("unknown op ${o.s("op")}")
        }
    }

    @Test
    fun edits() {
        val cases = data["edits"]!!.jsonArray.map { it.jsonObject }
        Vectors.expectAll("editing the model", cases) { c ->
            var blocks = FormatMarkdown.fromMarkdown(c.s("src")!!, labels).blocks
            var sel = FormatModel.caret(0, 0)
            for ((k, stepEl) in c["steps"]!!.jsonArray.withIndex()) {
                val step = stepEl.jsonObject
                val op = step["op"]!!.jsonObject
                val edit = apply(blocks, sel, op)
                blocks = edit.blocks
                sel = edit.sel
                val problems = ArrayList<String>()
                if (!Vectors.same(blocksJson(blocks), step["blocks"])) problems += "blocks\nweb    ${step["blocks"].toString().take(1200)}\nkotlin ${blocksJson(blocks).toString().take(1200)}"
                if (!Vectors.same(selJson(sel), step["sel"])) problems += "sel web ${step["sel"]} kotlin ${selJson(sel)}"
                val md = FormatMarkdown.toMarkdown(blocks)
                if (md != step.jsonObject.s("md")) problems += "md\nweb    ${Vectors.show(step.s("md")!!)}\nkotlin ${Vectors.show(md)}"
                val probe = step["probe"]!!.jsonObject
                val ps = sel(probe["sel"])
                if (FormatModel.selectionHas(blocks, ps) { it.b } != probe["has"]!!.jsonPrimitive.boolean) problems += "selectionHas"
                if (!Vectors.same(runsJson(FormatModel.selectedRuns(blocks, ps)), probe["runs"])) problems += "selectedRuns web ${probe["runs"]} kotlin ${runsJson(FormatModel.selectedRuns(blocks, ps))}"
                step["marksAt"]?.takeIf { it !is JsonNull }?.jsonObject?.let { m ->
                    val tb = blocks[m["b"]!!.jsonPrimitive.int] as TextBlock
                    val o = m["o"]!!.jsonPrimitive.int
                    if (!Vectors.same(marksJson(FormatModel.marksAt(tb.content, o)), m["marks"])) problems += "marksAt web ${m["marks"]} kotlin ${marksJson(FormatModel.marksAt(tb.content, o))}"
                    val link = FormatModel.linkAround(tb.content, o)
                    val wantLink = m["link"]?.takeIf { it !is JsonNull }?.jsonObject
                    val linkOk = if (wantLink == null) link == null else link != null && link.from == wantLink["from"]!!.jsonPrimitive.int && link.to == wantLink["to"]!!.jsonPrimitive.int && link.url == wantLink.s("url") && link.noEmbed == wantLink["noEmbed"]!!.jsonPrimitive.boolean
                    if (!linkOk) problems += "linkAround web $wantLink kotlin $link"
                }
                if (problems.isNotEmpty()) return@expectAll "src ${Vectors.show(c.s("src")!!)} step $k op $op\n" + problems.joinToString("\n")
            }
            null
        }
    }
}
