package fish.nexa.ui.markdown.format

import fish.nexa.ui.markdown.Align
import fish.nexa.ui.markdown.AlertKind
import fish.nexa.ui.markdown.Js
import java.util.concurrent.atomic.AtomicInteger

// ---------------------------------------------------------------------------
// The formatting editor's document (web/src/components/composer/format/model.ts).
//
// A message is a flat list of blocks, the way it reads: each paragraph line,
// list item and heading is a block of its own, and a quote, callout or folded
// section is the run of neighbouring blocks that carry the same `wrap`, as in
// a word processor rather than a tree. Text is a list of runs, each with the
// marks it carries; mentions, custom emoji, times and footnote references are
// atoms, one character wide, kept as the markdown that makes them.
//
// Everything here is pure: operations return new blocks and never change the
// ones they are given, so a snapshot for undo is just the list.
// ---------------------------------------------------------------------------

/** Formats that are on or off. */
enum class Flag(val key: String) { B("b"), I("i"), U("u"), S("s"), SPOILER("spoiler"), MARK("mark"), SUP("sup"), SUB("sub"), CODE("code") }

data class LinkMark(val url: String, val noEmbed: Boolean)

/** A colour: text (`fg`), highlight (`bg`) or both, as palette names or #rrggbb. */
data class ColorMark(val fg: String?, val bg: String?)

data class Marks(
    val b: Boolean = false,
    val i: Boolean = false,
    val u: Boolean = false,
    val s: Boolean = false,
    val spoiler: Boolean = false,
    val code: Boolean = false,
    val mark: Boolean = false,
    val sup: Boolean = false,
    val sub: Boolean = false,
    val link: LinkMark? = null,
    val color: ColorMark? = null,
) {
    operator fun get(f: Flag): Boolean = when (f) {
        Flag.B -> b
        Flag.I -> i
        Flag.U -> u
        Flag.S -> s
        Flag.SPOILER -> spoiler
        Flag.CODE -> code
        Flag.MARK -> mark
        Flag.SUP -> sup
        Flag.SUB -> sub
    }

    fun with(f: Flag, on: Boolean): Marks = when (f) {
        Flag.B -> copy(b = on)
        Flag.I -> copy(i = on)
        Flag.U -> copy(u = on)
        Flag.S -> copy(s = on)
        Flag.SPOILER -> copy(spoiler = on)
        Flag.CODE -> copy(code = on)
        Flag.MARK -> copy(mark = on)
        Flag.SUP -> copy(sup = on)
        Flag.SUB -> copy(sub = on)
    }

    companion object {
        val NONE = Marks()
    }
}

enum class AtomKind(val key: String) { USER("user"), CHANNEL("channel"), ROLE("role"), EMOJI("emoji"), TIME("time"), FNREF("fnref"), LINK("link") }

sealed class Inline {
    abstract val marks: Marks

    data class Text(val text: String, override val marks: Marks = Marks.NONE) : Inline()

    /** Something that is one piece: `raw` is its markdown, `label` what the editor shows, `img` a custom emoji's picture. */
    data class Atom(val atom: AtomKind, val raw: String, val label: String, val img: String? = null, override val marks: Marks = Marks.NONE) : Inline()

    fun withMarks(m: Marks): Inline = when (this) {
        is Text -> copy(marks = m)
        is Atom -> copy(marks = m)
    }
}

/** What a run of blocks sits in: a quote, one of the five callouts, or a folded section. */
enum class Wrap(val key: String) {
    QUOTE("quote"), NOTE("note"), TIP("tip"), IMPORTANT("important"), WARNING("warning"), CAUTION("caution"), DETAILS("details");

    companion object {
        fun of(kind: AlertKind): Wrap = entries.first { it.key == kind.key }
    }
}

enum class TextKind(val key: String) {
    P("p"), H1("h1"), H2("h2"), H3("h3"), H4("h4"), H5("h5"), H6("h6"), SUBTEXT("subtext"), LI("li"), NOTE("note");

    val headingLevel: Int get() = if (key.length == 2 && key[0] == 'h') key[1] - '0' else 0

    companion object {
        fun heading(level: Int): TextKind = entries.first { it.key == "h$level" }
    }
}

data class ListInfo(
    val ordered: Boolean,
    val task: Boolean,
    val checked: Boolean,
    /** How many lists deep, from 0. */
    val indent: Int,
    /** An ordered list's first number, kept from the source; null counts on from the item before. */
    val start: Int?,
)

sealed class Block {
    abstract val id: Int
    abstract val wrap: Wrap?
    abstract val kind: String

    fun withWrap(w: Wrap?): Block = when (this) {
        is TextBlock -> copy(wrap = w)
        is CodeBlock -> copy(wrap = w)
        is RuleBlock -> copy(wrap = w)
        is TableBlock -> copy(wrap = w)
        is FileBlock -> copy(wrap = w)
    }

    fun withId(i: Int): Block = when (this) {
        is TextBlock -> copy(id = i)
        is CodeBlock -> copy(id = i)
        is RuleBlock -> copy(id = i)
        is TableBlock -> copy(id = i)
        is FileBlock -> copy(id = i)
    }
}

data class TextBlock(
    override val id: Int,
    val textKind: TextKind,
    override val wrap: Wrap?,
    val content: List<Inline>,
    val list: ListInfo? = null,
    /** A footnote's label. */
    val label: String? = null,
) : Block() {
    override val kind: String get() = textKind.key
}

data class CodeBlock(override val id: Int, override val wrap: Wrap?, val lang: String, val text: String) : Block() {
    override val kind: String get() = "code"
}

data class RuleBlock(override val id: Int, override val wrap: Wrap?) : Block() {
    override val kind: String get() = "hr"
}

/** The header row first; every row has align.size cells. */
data class TableBlock(override val id: Int, override val wrap: Wrap?, val align: List<Align?>, val rows: List<List<List<Inline>>>) : Block() {
    override val kind: String get() = "table"
}

/** A file a note holds, where it sits in the text; `width` is how much of the line a picture takes, in percent. */
data class FileBlock(override val id: Int, override val wrap: Wrap?, val file: String, val name: String, val width: Int? = null) : Block() {
    override val kind: String get() = "file"
}

/** A place in the document: a block, a table cell when it is in one (row, column), and an offset in characters. */
data class Pos(val b: Int, val o: Int, val cell: Pair<Int, Int>? = null)

data class Sel(val anchor: Pos, val focus: Pos)

data class Edit(val blocks: List<Block>, val sel: Sel)

object FormatModel {
    /** How deep lists go in the editor, the same as the parser. */
    const val MAX_INDENT = 5

    val FLAGS = listOf(Flag.B, Flag.I, Flag.U, Flag.S, Flag.SPOILER, Flag.MARK, Flag.SUP, Flag.SUB, Flag.CODE)

    private val nextId = AtomicInteger(1)

    fun newId(): Int = nextId.incrementAndGet()

    /** A block with nothing to type in: a rule or a file. It is stepped over, and removed whole. */
    fun isVoid(b: Block?): Boolean = b is RuleBlock || b is FileBlock

    fun isText(b: Block?): Boolean = b is TextBlock

    fun textBlock(kind: TextKind = TextKind.P, content: List<Inline> = emptyList(), wrap: Wrap? = null, list: ListInfo? = null, label: String? = null): TextBlock =
        TextBlock(newId(), kind, wrap, content, list, label)

    fun text(t: String, marks: Marks = Marks.NONE): Inline = Inline.Text(t, marks)

    // -----------------------------------------------------------------------
    // marks
    // -----------------------------------------------------------------------

    fun sameMarks(a: Marks, b: Marks): Boolean = a == b

    /** Marks with a flag set or cleared. */
    fun withMark(m: Marks, key: Flag, on: Boolean): Marks = m.with(key, on)

    fun withColor(m: Marks, part: String, value: String?): Marks {
        val cur = m.color ?: ColorMark(null, null)
        val next = if (part == "fg") cur.copy(fg = value) else cur.copy(bg = value)
        return m.copy(color = if (!next.fg.isNullOrEmpty() || !next.bg.isNullOrEmpty()) next else null)
    }

    fun withLink(m: Marks, link: LinkMark?): Marks = m.copy(link = link)

    // -----------------------------------------------------------------------
    // runs
    // -----------------------------------------------------------------------

    fun runLength(r: Inline): Int = if (r is Inline.Text) r.text.length else 1

    fun inlineLength(content: List<Inline>): Int = content.sumOf { runLength(it) }

    /** Joins neighbouring text runs with the same marks and drops empty ones. */
    fun normalize(content: List<Inline>): List<Inline> {
        val out = ArrayList<Inline>()
        for (r in content) {
            if (r is Inline.Text && r.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (r is Inline.Text && last is Inline.Text && sameMarks(last.marks, r.marks)) {
                out[out.size - 1] = last.copy(text = last.text + r.text)
                continue
            }
            out += r
        }
        return out
    }

    /** The runs between two offsets. */
    fun sliceInline(content: List<Inline>, from: Int, to: Int): List<Inline> {
        val out = ArrayList<Inline>()
        var at = 0
        for (r in content) {
            val len = runLength(r)
            val s = maxOf(from, at)
            val e = minOf(to, at + len)
            if (s < e) {
                if (r is Inline.Text) out += r.copy(text = r.text.substring(s - at, e - at)) else out += r
            }
            at += len
            if (at >= to) break
        }
        return out
    }

    fun spliceInline(content: List<Inline>, from: Int, to: Int, insert: List<Inline>): List<Inline> {
        val len = inlineLength(content)
        return normalize(sliceInline(content, 0, from) + insert + sliceInline(content, to, len))
    }

    /** Runs from `from` to `to` with their marks changed by `fn`. */
    fun mapMarks(content: List<Inline>, from: Int, to: Int, fn: (Marks) -> Marks): List<Inline> {
        val len = inlineLength(content)
        val middle = sliceInline(content, from, to).map { it.withMarks(fn(it.marks)) }
        return normalize(sliceInline(content, 0, from) + middle + sliceInline(content, to, len))
    }

    /** The marks typing at `offset` would take on: those of the character before it, or after it at the start. */
    fun marksAt(content: List<Inline>, offset: Int): Marks {
        var at = 0
        var before: Marks? = null
        for (r in content) {
            val len = runLength(r)
            if (offset > at && offset <= at + len) before = r.marks
            if (offset == 0 && len > 0) return inheritable(r.marks)
            at += len
        }
        return before?.let { inheritable(it) } ?: Marks.NONE
    }

    /** What carries on into newly typed text: a link and code do not spill past their end. */
    private fun inheritable(m: Marks): Marks = if (m.link == null && !m.code) m else m.copy(link = null, code = false)

    /** Whether every character from `from` to `to` passes `test`. */
    fun allHave(content: List<Inline>, from: Int, to: Int, test: (Marks) -> Boolean): Boolean {
        val part = sliceInline(content, from, to)
        return part.isNotEmpty() && part.all { test(it.marks) }
    }

    /** The text, atoms read as their markdown: what a code block made of these runs would hold. */
    fun plainOf(content: List<Inline>): String = content.joinToString("") { if (it is Inline.Text) it.text else (it as Inline.Atom).raw }

    data class LinkSpan(val from: Int, val to: Int, val url: String, val noEmbed: Boolean)

    /** The extent of the link around `offset`, if there is one. */
    fun linkAround(content: List<Inline>, offset: Int): LinkSpan? {
        var at = 0
        class Span(val from: Int, var to: Int, val link: LinkMark)
        val spans = ArrayList<Span>()
        for (r in content) {
            val len = runLength(r)
            val link = r.marks.link
            if (link != null) {
                val last = spans.lastOrNull()
                if (last != null && last.to == at && last.link.url == link.url) last.to = at + len else spans += Span(at, at + len, link)
            }
            at += len
        }
        val hit = spans.firstOrNull { offset >= it.from && offset <= it.to } ?: return null
        return LinkSpan(hit.from, hit.to, hit.link.url, hit.link.noEmbed)
    }

    // -----------------------------------------------------------------------
    // positions
    // -----------------------------------------------------------------------

    fun comparePos(a: Pos, b: Pos): Int {
        if (a.b != b.b) return a.b - b.b
        if (a.cell != null && b.cell != null) {
            if (a.cell.first != b.cell.first) return a.cell.first - b.cell.first
            if (a.cell.second != b.cell.second) return a.cell.second - b.cell.second
        }
        return a.o - b.o
    }

    fun ordered(sel: Sel): Pair<Pos, Pos> = if (comparePos(sel.anchor, sel.focus) <= 0) sel.anchor to sel.focus else sel.focus to sel.anchor

    fun collapsed(sel: Sel): Boolean = comparePos(sel.anchor, sel.focus) == 0 && sameCell(sel.anchor, sel.focus)

    fun sameCell(a: Pos, b: Pos): Boolean {
        if (a.b != b.b) return false
        if (a.cell == null || b.cell == null) return a.cell == null && b.cell == null
        return a.cell == b.cell
    }

    fun caret(b: Int, o: Int, cell: Pair<Int, Int>? = null): Sel {
        val p = Pos(b, o, cell)
        return Sel(p, p)
    }

    /** How many characters a block (or one of its cells) holds, for clamping a position. */
    fun sizeAt(blocks: List<Block>, p: Pos): Int {
        val block = blocks.getOrNull(p.b) ?: return 0
        if (block is TableBlock) {
            val cell = p.cell?.let { block.rows.getOrNull(it.first)?.getOrNull(it.second) }
            return cell?.let { inlineLength(it) } ?: 0
        }
        if (block is CodeBlock) return block.text.length
        if (isVoid(block)) return 0
        return inlineLength((block as TextBlock).content)
    }

    fun clampPos(blocks: List<Block>, p: Pos): Pos {
        val b = maxOf(0, minOf(blocks.size - 1, p.b))
        val block = blocks.getOrNull(b)
        val cell = if (block is TableBlock) {
            val r = maxOf(0, minOf(block.rows.size - 1, p.cell?.first ?: 0))
            val c = maxOf(0, minOf(block.align.size - 1, p.cell?.second ?: 0))
            r to c
        } else null
        val q = Pos(b, 0, cell)
        return q.copy(o = maxOf(0, minOf(sizeAt(blocks, q), p.o)))
    }

    // -----------------------------------------------------------------------
    // editing
    // -----------------------------------------------------------------------

    /** The document is never empty: there is always a paragraph to type in. */
    fun ensureBlock(blocks: List<Block>): List<Block> = blocks.ifEmpty { listOf(textBlock()) }

    /** `String.prototype.slice` for indexes from 0 up: clamped to the string. */
    internal fun String.jsSlice(from: Int, to: Int = length): String {
        val a = from.coerceIn(0, length)
        val b = to.coerceIn(0, length)
        return if (a >= b) "" else substring(a, b)
    }

    private fun <T> MutableList<T>.splice(at: Int, remove: Int, vararg add: T) {
        val start = at.coerceIn(0, size)
        repeat(minOf(remove, size - start)) { removeAt(start) }
        addAll(start, add.toList())
    }

    private fun <T> MutableList<T>.splice(at: Int, remove: Int, add: List<T>) {
        val start = at.coerceIn(0, size)
        repeat(minOf(remove, size - start)) { removeAt(start) }
        addAll(start, add)
    }

    private fun rowsCopy(rows: List<List<List<Inline>>>): MutableList<MutableList<List<Inline>>> = rows.map { it.toMutableList() }.toMutableList()

    /** Inserts runs at a caret in a text block or a table cell (code takes text only). */
    fun insertAt(blocks: List<Block>, at: Pos, runs: List<Inline>): Edit {
        val block = blocks.getOrNull(at.b) ?: return Edit(blocks, caret(at.b, at.o))
        val out = blocks.toMutableList()
        val add = inlineLength(runs)
        if (block is CodeBlock) {
            val t = plainOf(runs)
            out[at.b] = block.copy(text = block.text.jsSlice(0, at.o) + t + block.text.jsSlice(at.o))
            return Edit(out, caret(at.b, at.o + t.length))
        }
        if (block is TableBlock && at.cell != null) {
            val (r, c) = at.cell
            val rows = rowsCopy(block.rows)
            val cell = rows.getOrNull(r)?.getOrNull(c) ?: emptyList()
            // a cell is one line: line breaks become spaces
            val flat = runs.map { if (it is Inline.Text) it.copy(text = it.text.replace('\n', ' ')) else it }
            rows[r][c] = spliceInline(cell, at.o, at.o, flat)
            out[at.b] = block.copy(rows = rows)
            return Edit(out, caret(at.b, at.o + add, r to c))
        }
        if (block !is TextBlock) return Edit(blocks, caret(at.b, at.o))
        out[at.b] = block.copy(content = spliceInline(block.content, at.o, at.o, runs))
        return Edit(out, caret(at.b, at.o + add))
    }

    /** What Enter makes of the block it splits: the kind the new line takes, and its list. */
    private fun continuation(block: TextBlock): Pair<TextKind, ListInfo?> =
        if (block.textKind == TextKind.LI && block.list != null) TextKind.LI to block.list.copy(checked = false, start = null) else TextKind.P to null

    /**
     * Enter. A text block splits in two, the new one carrying on the list or
     * callout; Enter on an empty list item or callout line steps out of it
     * instead. In a code block it is a new line.
     */
    fun splitAt(blocks: List<Block>, at: Pos): Edit {
        val block = blocks.getOrNull(at.b) ?: return Edit(blocks, caret(at.b, at.o))
        if (block is CodeBlock) return insertAt(blocks, at, listOf(text("\n")))
        val out = blocks.toMutableList()
        if (isVoid(block) || block is TableBlock) {
            // a new line after it
            out.splice(at.b + 1, 0, textBlock(TextKind.P, emptyList(), block.wrap))
            return Edit(out, caret(at.b + 1, 0))
        }
        block as TextBlock
        val len = inlineLength(block.content)
        if (len == 0 && block.textKind == TextKind.LI && block.list != null) {
            // an empty item steps out one level, and out of the list from the top
            out[at.b] = if (block.list.indent > 0) block.copy(list = block.list.copy(indent = block.list.indent - 1)) else block.copy(textKind = TextKind.P, list = null)
            return Edit(out, caret(at.b, 0))
        }
        if (len == 0 && block.wrap != null && at.b > 0 && blocks.getOrNull(at.b - 1)?.wrap == block.wrap) {
            // an empty line at the end of a quote, callout or section leaves it
            val next = blocks.getOrNull(at.b + 1)
            if (next == null || next.wrap != block.wrap) {
                out[at.b] = block.copy(wrap = null, textKind = TextKind.P)
                return Edit(out, caret(at.b, 0))
            }
        }
        val head = sliceInline(block.content, 0, at.o)
        val tail = sliceInline(block.content, at.o, len)
        val (contKind, contList) = continuation(block)
        out[at.b] = block.copy(content = normalize(head))
        // Enter at the very start of a heading pushes it down, leaving an empty line above
        if (at.o == 0 && len > 0) {
            val li = block.textKind == TextKind.LI
            out.splice(at.b, 0, textBlock(if (li) TextKind.LI else TextKind.P, emptyList(), block.wrap, if (li) contList else null))
            out[at.b + 1] = block
            return Edit(out, caret(at.b + 1, 0))
        }
        out.splice(at.b + 1, 0, textBlock(contKind, normalize(tail), block.wrap, if (contKind == TextKind.LI) contList else null))
        return Edit(out, caret(at.b + 1, 0))
    }

    /** Backspace at the start of a block: a list item, heading or callout line turns plain first, then joins the one above. */
    fun joinBackward(blocks: List<Block>, index: Int): Edit {
        val block = blocks.getOrNull(index) ?: return Edit(blocks, caret(index, 0))
        val out = blocks.toMutableList()
        if (block is TextBlock) {
            if (block.textKind == TextKind.LI && block.list != null) {
                out[index] = if (block.list.indent > 0) block.copy(list = block.list.copy(indent = block.list.indent - 1)) else block.copy(textKind = TextKind.P, list = null)
                return Edit(out, caret(index, 0))
            }
            if (block.textKind != TextKind.P) {
                out[index] = block.copy(textKind = TextKind.P, label = null)
                return Edit(out, caret(index, 0))
            }
            if (block.wrap != null && blocks.getOrNull(index - 1)?.wrap != block.wrap) {
                out[index] = block.copy(wrap = null)
                return Edit(out, caret(index, 0))
            }
        }
        val prev = blocks.getOrNull(index - 1) ?: return Edit(blocks, caret(index, 0))
        if (isVoid(prev)) {
            out.removeAt(index - 1)
            return Edit(out, caret(index - 1, 0))
        }
        if (prev is TableBlock) {
            // into the table's last cell, rather than through it
            val r = prev.rows.size - 1
            val c = prev.align.size - 1
            if (block is TextBlock && inlineLength(block.content) == 0) out.removeAt(index)
            return Edit(out, caret(index - 1, inlineLength(prev.rows.getOrNull(r)?.getOrNull(c) ?: emptyList()), r to c))
        }
        if (prev is CodeBlock) {
            val add = if (block is TextBlock) plainOf(block.content) else if (block is CodeBlock) block.text else ""
            val sep = if (add.isNotEmpty() && prev.text.isNotEmpty()) "\n" else ""
            out[index - 1] = prev.copy(text = prev.text + sep + add)
            out.removeAt(index)
            return Edit(out, caret(index - 1, prev.text.length + sep.length))
        }
        prev as TextBlock
        if (block !is TextBlock) {
            if (block is CodeBlock && block.text.isEmpty()) {
                out.removeAt(index)
                return Edit(ensureBlock(out), caret(index - 1, inlineLength(prev.content)))
            }
            return Edit(blocks, caret(index - 1, inlineLength(prev.content)))
        }
        val at = inlineLength(prev.content)
        out[index - 1] = prev.copy(content = normalize(prev.content + block.content))
        out.removeAt(index)
        return Edit(out, caret(index - 1, at))
    }

    /** Delete at the end of a block: the next one joins it. */
    fun joinForward(blocks: List<Block>, index: Int): Edit {
        val block = blocks.getOrNull(index)
        val next = blocks.getOrNull(index + 1)
        if (block == null || next == null) return Edit(blocks, caret(index, if (block != null) sizeAt(blocks, Pos(index, 0)) else 0))
        if (isVoid(next)) {
            val out = blocks.toMutableList()
            out.removeAt(index + 1)
            return Edit(out, caret(index, sizeAt(blocks, Pos(index, 0))))
        }
        if (block is TextBlock && next is TextBlock) {
            val at = inlineLength(block.content)
            val out = blocks.toMutableList()
            out[index] = block.copy(content = normalize(block.content + next.content))
            out.removeAt(index + 1)
            return Edit(out, caret(index, at))
        }
        return Edit(blocks, caret(index, sizeAt(blocks, Pos(index, 0))))
    }

    /**
     * Deletes a selection, within a block or across blocks. Across the cells
     * of one table it empties them; across blocks, a table or rule it reaches
     * into goes whole, and the text on either side joins.
     */
    fun deleteRange(blocks: List<Block>, sel: Sel): Edit {
        val (from, to) = ordered(sel)
        if (from.b == to.b && from.cell != null && to.cell != null && !sameCell(from, to)) {
            val table = blocks[from.b] as TableBlock
            val cols = table.align.size
            val rows = rowsCopy(table.rows)
            val first = from.cell.first * cols + from.cell.second
            val last = to.cell.first * cols + to.cell.second
            for (k in first..last) {
                val r = k / cols
                val c = k % cols
                val cell = rows[r].getOrNull(c) ?: emptyList()
                val len = inlineLength(cell)
                rows[r][c] = spliceInline(cell, if (k == first) from.o else 0, if (k == last) to.o else len, emptyList())
            }
            val out = blocks.toMutableList()
            out[from.b] = table.copy(rows = rows)
            return Edit(out, caret(from.b, from.o, from.cell))
        }
        if (from.b == to.b && sameCell(from, to)) {
            val block = blocks.getOrNull(from.b) ?: return Edit(blocks, caret(from.b, from.o))
            val out = blocks.toMutableList()
            when {
                block is CodeBlock -> out[from.b] = block.copy(text = block.text.jsSlice(0, from.o) + block.text.jsSlice(to.o))
                block is TableBlock && from.cell != null -> {
                    val (r, c) = from.cell
                    val rows = rowsCopy(block.rows)
                    rows[r][c] = spliceInline(rows[r].getOrNull(c) ?: emptyList(), from.o, to.o, emptyList())
                    out[from.b] = block.copy(rows = rows)
                }
                block is TextBlock -> out[from.b] = block.copy(content = spliceInline(block.content, from.o, to.o, emptyList()))
            }
            return Edit(out, if (from.cell != null) caret(from.b, from.o, from.cell) else caret(from.b, from.o))
        }
        // a table or rule at either end goes whole; text or code there keeps what lies outside the selection
        val first = blocks.getOrNull(from.b)
        val last = blocks.getOrNull(to.b)
        val head = if (first is TextBlock || first is CodeBlock) cut(first!!, 0, from.o) else null
        val tail = if (last is TextBlock || last is CodeBlock) cut(last!!, to.o, Int.MAX_VALUE) else null
        val kept = ArrayList<Block>()
        if (head is TextBlock && tail is TextBlock) kept += head.copy(content = normalize(head.content + tail.content))
        else if (head is CodeBlock && tail is CodeBlock) kept += head.copy(text = head.text + tail.text)
        else {
            if (head != null) kept += head
            if (tail != null) kept += tail
        }
        if (kept.isEmpty()) kept += textBlock(TextKind.P, emptyList(), if (first?.wrap == Wrap.QUOTE) Wrap.QUOTE else first?.wrap)
        val out = blocks.toMutableList()
        out.splice(from.b, to.b - from.b + 1, kept)
        return Edit(ensureBlock(out), caret(from.b, if (head != null) from.o else 0))
    }

    /** A block's text from one offset to another (to the end with Int.MAX_VALUE), as a block of the same kind. */
    private fun cut(block: Block, from: Int, to: Int): Block {
        if (block is CodeBlock) return block.copy(text = block.text.jsSlice(from, to))
        if (block !is TextBlock) return block
        val len = inlineLength(block.content)
        return block.copy(content = sliceInline(block.content, from, minOf(len, to)))
    }

    /** The indexes of the blocks a selection touches. */
    fun blocksIn(sel: Sel): List<Int> {
        val (from, to) = ordered(sel)
        return (from.b..to.b).toList()
    }

    /** Applies `fn` to the marks of what the selection covers, in text blocks and table cells alike; code blocks keep none. */
    fun mapSelection(blocks: List<Block>, sel: Sel, fn: (Marks) -> Marks): List<Block> {
        val (from, to) = ordered(sel)
        val out = blocks.toMutableList()
        for (b in from.b..to.b) {
            val block = out.getOrNull(b) ?: continue
            if (block is TableBlock) {
                if (from.cell != null && to.cell != null && from.b == to.b && sameCell(from, to)) {
                    val (r, c) = from.cell
                    val rows = rowsCopy(block.rows)
                    rows[r][c] = mapMarks(rows[r].getOrNull(c) ?: emptyList(), from.o, to.o, fn)
                    out[b] = block.copy(rows = rows)
                } else {
                    // a table the selection runs across is formatted whole
                    out[b] = block.copy(rows = block.rows.map { row -> row.map { cell -> mapMarks(cell, 0, inlineLength(cell), fn) } })
                }
                continue
            }
            if (block !is TextBlock) continue
            val len = inlineLength(block.content)
            val s = if (b == from.b) from.o else 0
            val e = if (b == to.b) to.o else len
            out[b] = block.copy(content = mapMarks(block.content, s, e, fn))
        }
        return out
    }

    /** Whether everything the selection covers passes `test`; false for an empty selection. */
    fun selectionHas(blocks: List<Block>, sel: Sel, test: (Marks) -> Boolean): Boolean {
        val (from, to) = ordered(sel)
        var seen = false
        for (b in from.b..to.b) {
            val block = blocks.getOrNull(b) ?: continue
            val parts: List<List<Inline>> = when {
                block is TableBlock -> if (from.cell != null && sameCell(from, to)) listOf(sliceInline(block.rows.getOrNull(from.cell.first)?.getOrNull(from.cell.second) ?: emptyList(), from.o, to.o)) else block.rows.flatten()
                block is TextBlock -> {
                    val len = inlineLength(block.content)
                    listOf(sliceInline(block.content, if (b == from.b) from.o else 0, if (b == to.b) to.o else len))
                }
                else -> emptyList()
            }
            for (part in parts) {
                for (r in part) {
                    if (r is Inline.Text && Js.trim(r.text).isEmpty()) continue
                    seen = true
                    if (!test(r.marks)) return false
                }
            }
        }
        return seen
    }

    /** The runs of a selection that sits inside one block or cell, for copying and for a link's words. */
    fun selectedRuns(blocks: List<Block>, sel: Sel): List<Inline> {
        val (from, to) = ordered(sel)
        if (from.b != to.b || !sameCell(from, to)) return emptyList()
        val block = blocks.getOrNull(from.b) ?: return emptyList()
        if (block is TableBlock && from.cell != null) return sliceInline(block.rows.getOrNull(from.cell.first)?.getOrNull(from.cell.second) ?: emptyList(), from.o, to.o)
        if (block is CodeBlock) return listOf(text(block.text.jsSlice(from.o, to.o)))
        if (block !is TextBlock) return emptyList()
        return sliceInline(block.content, from.o, to.o)
    }

    // -----------------------------------------------------------------------
    // blocks
    // -----------------------------------------------------------------------

    /** Makes the selected text blocks headings, subtext or plain lines. */
    fun setKind(blocks: List<Block>, sel: Sel, kind: TextKind): List<Block> {
        val out = blocks.toMutableList()
        for (b in blocksIn(sel)) {
            val block = out.getOrNull(b) as? TextBlock ?: continue
            // a heading cannot be in a plain quote (a quote holds lines of text), so it leaves the quote
            val wrap = if (block.wrap == Wrap.QUOTE && kind != TextKind.P) null else block.wrap
            out[b] = block.copy(textKind = kind, list = null, label = null, wrap = wrap)
        }
        return out
    }

    /** Makes the selected lines a list of this kind ("bullet", "ordered" or "task"), or plain lines when they all are one already. */
    fun toggleList(blocks: List<Block>, sel: Sel, type: String): List<Block> {
        val indexes = blocksIn(sel).filter { blocks.getOrNull(it) is TextBlock }
        fun isIt(block: Block?): Boolean {
            if (block !is TextBlock || block.textKind != TextKind.LI || block.list == null) return false
            return if (type == "task") block.list.task else !block.list.task && block.list.ordered == (type == "ordered")
        }
        val all = indexes.isNotEmpty() && indexes.all { isIt(blocks[it]) }
        val out = blocks.toMutableList()
        for (b in indexes) {
            val block = out[b] as TextBlock
            if (all) {
                out[b] = block.copy(textKind = TextKind.P, list = null)
                continue
            }
            val was = block.list
            // lists cannot be in a plain quote either
            val wrap = if (block.wrap == Wrap.QUOTE) null else block.wrap
            out[b] = block.copy(
                textKind = TextKind.LI,
                wrap = wrap,
                label = null,
                list = ListInfo(
                    ordered = type == "ordered",
                    task = type == "task",
                    checked = if (type == "task") was?.checked ?: false else false,
                    indent = was?.indent ?: 0,
                    start = if (type == "ordered" && was?.ordered == true) was.start else null,
                ),
            )
        }
        return out
    }

    /** Tab and Shift+Tab in a list: one level in or out. */
    fun indentBy(blocks: List<Block>, sel: Sel, delta: Int): List<Block> {
        val out = blocks.toMutableList()
        for (b in blocksIn(sel)) {
            val block = out.getOrNull(b) as? TextBlock ?: continue
            if (block.textKind != TextKind.LI || block.list == null) continue
            var prevIndent = -1
            if (b - 1 >= 0) {
                val p = out[b - 1]
                if (p is TextBlock && p.textKind == TextKind.LI && p.list != null && p.wrap == block.wrap) prevIndent = p.list.indent
            }
            // one level deeper than the item above at most, as markdown can say no more
            val indent = maxOf(0, minOf(MAX_INDENT, block.list.indent + delta, prevIndent + 1))
            out[b] = block.copy(list = block.list.copy(indent = indent))
        }
        return out
    }

    fun toggleChecked(blocks: List<Block>, index: Int): List<Block> {
        val block = blocks.getOrNull(index) as? TextBlock ?: return blocks
        if (block.list?.task != true) return blocks
        val out = blocks.toMutableList()
        out[index] = block.copy(list = block.list.copy(checked = !block.list.checked))
        return out
    }

    /**
     * Puts the selected blocks in a quote, callout or folded section, or takes
     * them out when they all are in one of that kind. A plain quote holds
     * lines of text, so headings and list items in it become plain lines;
     * code, rules and tables stay outside it.
     */
    fun toggleWrap(blocks: List<Block>, sel: Sel, wrap: Wrap): Edit {
        val indexes = blocksIn(sel)
        val all = indexes.all { blocks.getOrNull(it)?.wrap == wrap }
        val out = blocks.toMutableList()
        for (b in indexes) {
            val block = out.getOrNull(b) ?: continue
            if (all) {
                out[b] = block.withWrap(null)
                continue
            }
            if (wrap == Wrap.QUOTE) {
                if (block !is TextBlock) continue
                out[b] = block.copy(textKind = TextKind.P, list = null, label = null, wrap = wrap)
            } else out[b] = block.withWrap(wrap)
        }
        val (from, to) = ordered(sel)
        if (!all && wrap == Wrap.DETAILS && out.getOrNull(from.b - 1)?.wrap != Wrap.DETAILS) {
            // a new folded section: its first line is the summary
            val first = out.getOrNull(from.b)
            if (from.b == to.b && first is TextBlock) {
                if (first.textKind != TextKind.P) out[from.b] = first.copy(textKind = TextKind.P, list = null, label = null)
                out.splice(from.b + 1, 0, textBlock(TextKind.P, emptyList(), Wrap.DETAILS))
                return Edit(out, if (inlineLength(first.content) > 0) caret(from.b + 1, 0) else caret(from.b, 0))
            }
            if (first !is TextBlock) {
                out.splice(from.b, 0, textBlock(TextKind.P, emptyList(), Wrap.DETAILS))
                return Edit(out, caret(from.b, 0))
            }
        }
        return Edit(out, Sel(from, to))
    }

    /** Turns the selected lines into one code block, or a code block back into lines. */
    fun toggleCode(blocks: List<Block>, sel: Sel): Edit {
        val indexes = blocksIn(sel)
        val first = blocks.getOrNull(indexes.firstOrNull() ?: 0)
        if (first is CodeBlock && indexes.size == 1) {
            val wrap = if (first.wrap == Wrap.QUOTE) null else first.wrap
            val lines = first.text.split("\n").map { line -> textBlock(TextKind.P, if (line.isNotEmpty()) listOf(text(line)) else emptyList(), wrap) }
            val out = blocks.toMutableList()
            out.splice(indexes[0], 1, lines)
            return Edit(out, caret(indexes[0], 0))
        }
        val texts = indexes.mapNotNull { blocks.getOrNull(it) as? TextBlock }
        if (texts.isEmpty()) return Edit(blocks, sel)
        val joined = texts.joinToString("\n") { plainOf(it.content) }
        val code = CodeBlock(newId(), if (texts[0].wrap == Wrap.QUOTE) null else texts[0].wrap, "", joined)
        val out = blocks.toMutableList()
        val start = indexes.first { blocks.getOrNull(it) is TextBlock }
        val end = indexes.last { blocks.getOrNull(it) is TextBlock }
        out.splice(start, end - start + 1, code)
        return Edit(out, caret(start, joined.length))
    }

    /** Inserts a block after the caret's block, or in place of an empty line; the caret goes to the line after it. */
    fun insertBlock(blocks: List<Block>, sel: Sel, block: Block): Edit {
        val (from, _) = ordered(sel)
        val here = blocks.getOrNull(from.b)
        val out = blocks.toMutableList()
        val wrap = if (here != null && here.wrap != Wrap.QUOTE) here.wrap else null
        val placed = block.withWrap(wrap)
        val at: Int
        if (here is TextBlock && here.textKind == TextKind.P && inlineLength(here.content) == 0) {
            out.splice(from.b, 1, placed)
            at = from.b
        } else {
            out.splice(from.b + 1, 0, placed)
            at = from.b + 1
        }
        // there is always a line to carry on typing after it
        if (out.getOrNull(at + 1) !is TextBlock) out.splice(at + 1, 0, textBlock(TextKind.P, emptyList(), wrap))
        if (placed is TableBlock) return Edit(out, caret(at, 0, 0 to 0))
        if (placed is CodeBlock) return Edit(out, caret(at, 0))
        return Edit(out, caret(at + 1, 0))
    }

    fun emptyTable(rows: Int, cols: Int): TableBlock = TableBlock(newId(), null, List(cols) { null }, List(rows) { List(cols) { emptyList() } })

    sealed class TableOp {
        data class AddRow(val at: Int) : TableOp()
        data class AddCol(val at: Int) : TableOp()
        data class DelRow(val at: Int) : TableOp()
        data class DelCol(val at: Int) : TableOp()
        data class SetAlign(val col: Int, val align: Align?) : TableOp()
    }

    /** Table edits: rows and columns in or out, a column's alignment. */
    fun editTable(blocks: List<Block>, index: Int, op: TableOp): List<Block> {
        val table = blocks.getOrNull(index) as? TableBlock ?: return blocks
        val out = blocks.toMutableList()
        val cols = table.align.size
        var rows: MutableList<MutableList<List<Inline>>> = rowsCopy(table.rows)
        var align = table.align.toMutableList()
        when (op) {
            is TableOp.AddRow -> rows.add(maxOf(1, op.at).coerceAtMost(rows.size), MutableList(cols) { emptyList<Inline>() })
            is TableOp.AddCol -> {
                rows = rows.map { row -> row.toMutableList().also { it.add(op.at.coerceIn(0, it.size), emptyList<Inline>()) } }.toMutableList()
                align.add(op.at.coerceIn(0, align.size), null)
            }
            // the header row stays: a table without one is not a table
            is TableOp.DelRow -> if (op.at > 0 && op.at < rows.size) rows.removeAt(op.at)
            is TableOp.DelCol -> {
                if (cols <= 1) {
                    out.removeAt(index)
                    return ensureBlock(out)
                }
                rows = rows.map { row -> row.filterIndexed { c, _ -> c != op.at }.toMutableList() }.toMutableList()
                align = align.filterIndexed { c, _ -> c != op.at }.toMutableList()
            }
            is TableOp.SetAlign -> if (op.col in align.indices) align[op.col] = op.align
        }
        out[index] = table.copy(rows = rows, align = align)
        return out
    }

    /** Takes every mark off the selection, and makes headings and subtext plain lines again. */
    fun clearFormatting(blocks: List<Block>, sel: Sel): List<Block> {
        val out = mapSelection(blocks, sel) { Marks.NONE }.toMutableList()
        for (b in blocksIn(sel)) {
            val block = out.getOrNull(b) as? TextBlock ?: continue
            if (block.textKind != TextKind.P && block.textKind != TextKind.LI && block.textKind != TextKind.NOTE) out[b] = block.copy(textKind = TextKind.P)
        }
        return out
    }
}
