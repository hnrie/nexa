package fish.nexa.ui.markdown.format

import fish.nexa.ui.markdown.Js
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.markdown.MarkdownColors
import fish.nexa.ui.markdown.NameLookup
import fish.nexa.ui.markdown.Node
import fish.nexa.ui.markdown.Shortcodes
import fish.nexa.ui.markdown.format.FormatModel.MAX_INDENT
import fish.nexa.ui.markdown.format.FormatModel.isText
import fish.nexa.ui.markdown.format.FormatModel.newId
import fish.nexa.ui.markdown.format.FormatModel.normalize
import fish.nexa.ui.markdown.format.FormatModel.sameMarks
import fish.nexa.ui.markdown.format.FormatModel.textBlock
import fish.nexa.ui.markdown.format.FormatModel.withColor
import java.util.IdentityHashMap

/** What turns ids into the names and pictures the editor shows for mentions and emoji. */
interface AtomNames : NameLookup {
    /** A custom emoji's picture, `css` pixels across. */
    fun emojiUrl(id: String, animated: Boolean, css: Int): String?
}

/**
 * The formatting editor's blocks to and from markdown
 * (web/src/components/composer/format/markdown.ts). Markdown is read through
 * the parser's own nodes, and written so that it reads back as exactly the
 * same runs: markers chosen to nest, text escaped only where it would be read
 * as markup, and every line checked with the real parser.
 */
object FormatMarkdown {
    /** What the editor read: its blocks, and whether something nested was shown one level deep only. */
    data class Loaded(val blocks: List<Block>, val simplified: Boolean)

    /**
     * How atoms are labelled: names for mentions and emoji pictures, the
     * catalogue for unknown ones, and a time's words (by default its number;
     * the app passes [fish.nexa.ui.markdown.Timestamps.text]).
     */
    class Labels(
        val names: AtomNames? = null,
        val tr: (String) -> String = Markdown::translate,
        val stamp: (Node.Timestamp) -> String = { Js.numberToString(it.unix) },
    )

    private class LoadState(val out: MutableList<Block>, var simplified: Boolean, val labels: Labels)

    /** A message (or a note, with `files` and a larger `max`) as the editor's blocks. */
    fun fromMarkdown(src: String, labels: Labels = Labels(), files: Boolean = false, max: Int = 0): Loaded {
        val st = LoadState(ArrayList(), false, labels)
        // exact: the spaces at the ends of lines are the writer's, and stay
        blocksOf(Markdown.parse(src, files = files, max = max, exact = true), null, st)
        // trailing and leading blank lines say nothing, and the parser drops them
        while (st.out.size > 1 && emptyLine(st.out.last())) st.out.removeAt(st.out.size - 1)
        return Loaded(if (st.out.isNotEmpty()) withoutSeparators(st.out) else listOf(textBlock()), st.simplified)
    }

    /** One line of markdown as runs, block syntax left as it is: what pasting it into a line puts there. */
    fun inlineFromMarkdown(line: String, labels: Labels = Labels()): List<Inline> {
        val out = ArrayList<Inline>()
        inline(Markdown.parse(line, inline = true).filter { it !is Node.Br }, Marks.NONE, out, LoadState(ArrayList(), false, labels))
        return normalize(out)
    }

    private val ANGLED = setOf(Wrap.QUOTE, Wrap.NOTE, Wrap.TIP, Wrap.IMPORTANT, Wrap.WARNING, Wrap.CAUTION)

    /** The blank line markdown needs between a quote and a callout, or two tables, is not a line anyone wrote. */
    private fun withoutSeparators(blocks: List<Block>): List<Block> = blocks.filterIndexed { k, b ->
        if (!emptyLine(b)) return@filterIndexed true
        val before = blocks.getOrNull(k - 1)
        val after = blocks.getOrNull(k + 1)
        if (before == null || after == null) return@filterIndexed true
        val angled = before.wrap in ANGLED && after.wrap in ANGLED && before.wrap != after.wrap
        val tables = before is TableBlock && after is TableBlock && before.wrap == null && after.wrap == null
        !(angled || tables)
    }

    private fun emptyLine(b: Block?): Boolean = b is TextBlock && b.textKind == TextKind.P && b.wrap == null && b.content.isEmpty()

    /** Keeps a new quote, callout or section apart from one of the same kind just before it. */
    private fun apart(st: LoadState, wrap: Wrap) {
        val last = st.out.lastOrNull()
        if (last != null && last.wrap == wrap) st.out += textBlock()
    }

    /** A paragraph's lines, split where its line breaks are. */
    private fun lines(children: List<Node>, st: LoadState): List<List<Inline>> {
        val out = arrayListOf<MutableList<Inline>>(ArrayList())
        for (n in children) {
            if (n is Node.Br) out.add(ArrayList()) else inline(listOf(n), Marks.NONE, out.last(), st)
        }
        return out.map { normalize(it) }
    }

    private fun blocksOf(nodes: List<Node>, wrap: Wrap?, st: LoadState) {
        for (node in nodes) {
            when (node) {
                is Node.Paragraph -> for (line in lines(node.children, st)) st.out += textBlock(TextKind.P, line, wrap)
                is Node.Heading -> st.out += textBlock(TextKind.heading(node.level), lines(node.children, st).flatten(), wrap)
                is Node.Subtext -> st.out += textBlock(TextKind.SUBTEXT, lines(node.children, st).flatten(), wrap)
                is Node.Quote -> {
                    if (wrap != null) st.simplified = true else apart(st, Wrap.QUOTE)
                    for (line in lines(node.children, st)) st.out += textBlock(TextKind.P, line, wrap ?: Wrap.QUOTE)
                }
                is Node.Alert -> {
                    if (wrap != null) {
                        st.simplified = true
                        blocksOf(node.children, wrap, st)
                    } else {
                        val w = Wrap.of(node.kind)
                        apart(st, w)
                        if (node.children.isEmpty()) st.out += textBlock(TextKind.P, emptyList(), w) else blocksOf(node.children, w, st)
                    }
                }
                is Node.Details -> {
                    if (wrap != null) {
                        st.simplified = true
                        st.out += textBlock(TextKind.P, lines(node.summary, st).flatten(), wrap)
                        blocksOf(node.children, wrap, st)
                    } else {
                        apart(st, Wrap.DETAILS)
                        st.out += textBlock(TextKind.P, lines(node.summary, st).flatten(), Wrap.DETAILS)
                        blocksOf(node.children, Wrap.DETAILS, st)
                    }
                }
                is Node.ListBlock -> listOf(node, wrap, 0, st)
                is Node.CodeBlock -> st.out += CodeBlock(newId(), wrap, node.lang ?: "", node.text)
                is Node.Hr -> st.out += RuleBlock(newId(), wrap)
                is Node.File -> st.out += FileBlock(newId(), wrap, node.id, node.name, node.width)
                is Node.Table -> st.out += TableBlock(newId(), wrap, node.align.toList(), (listOf(node.head) + node.rows).map { row -> row.map { cell -> lines(cell, st).flatten() } })
                is Node.Footnotes -> for (note in node.notes) st.out += textBlock(TextKind.NOTE, lines(note.children, st).flatten(), wrap, label = note.label)
                else -> {
                    // inline nodes at the top level (never from a full parse): one line
                    val line = ArrayList<Inline>()
                    inline(listOf(node), Marks.NONE, line, st)
                    st.out += textBlock(TextKind.P, normalize(line), wrap)
                }
            }
        }
    }

    private fun listOf(list: Node.ListBlock, wrap: Wrap?, indent: Int, st: LoadState) {
        list.items.forEachIndexed { n, item ->
            val box = item.firstOrNull() as? Node.Task
            val words = ArrayList<Node>()
            val inner = ArrayList<Node.ListBlock>()
            for (child in if (box != null) item.drop(1) else item) {
                if (child is Node.ListBlock) inner += child else words += child
            }
            val content = ArrayList<Inline>()
            inline(words, Marks.NONE, content, st)
            st.out += textBlock(
                TextKind.LI, normalize(content), wrap,
                list = ListInfo(list.ordered, box != null, box?.checked == true, minOf(indent, MAX_INDENT), if (n == 0 && list.ordered) list.start else null),
            )
            for (sub in inner) listOf(sub, wrap, indent + 1, st)
        }
    }

    private fun inline(nodes: List<Node>, marks: Marks, out: MutableList<Inline>, st: LoadState) {
        val names = st.labels.names
        val tr = st.labels.tr
        for (n in nodes) {
            when (n) {
                is Node.Text -> out += Inline.Text(n.text, marks)
                is Node.Strong -> inline(n.children, marks.copy(b = true), out, st)
                is Node.Em -> inline(n.children, marks.copy(i = true), out, st)
                is Node.U -> inline(n.children, marks.copy(u = true), out, st)
                is Node.S -> inline(n.children, marks.copy(s = true), out, st)
                is Node.Spoiler -> inline(n.children, marks.copy(spoiler = true), out, st)
                is Node.Mark -> inline(n.children, marks.copy(mark = true), out, st)
                is Node.Sup -> inline(n.children, marks.copy(sup = true), out, st)
                is Node.Sub -> inline(n.children, marks.copy(sub = true), out, st)
                is Node.Color -> {
                    var m = marks
                    if (!n.fg.isNullOrEmpty()) m = withColor(m, "fg", n.fg)
                    if (!n.bg.isNullOrEmpty()) m = withColor(m, "bg", n.bg)
                    inline(n.children, m, out, st)
                }
                is Node.Code -> out += Inline.Text(n.text, marks.copy(code = true))
                is Node.Link -> when {
                    n.masked -> inline(n.children, marks.copy(link = LinkMark(n.url, n.noEmbed)), out, st)
                    n.noEmbed -> out += Inline.Atom(AtomKind.LINK, "<" + n.url + ">", n.url, null, marks)
                    // a bare address is text that happens to be a link, and stays one when written back
                    else -> out += Inline.Text(n.url, marks)
                }
                is Node.Mention -> when (n.kind) {
                    fish.nexa.ui.markdown.MentionKind.EVERYONE, fish.nexa.ui.markdown.MentionKind.HERE -> out += Inline.Text("@" + n.kind.key, marks)
                    fish.nexa.ui.markdown.MentionKind.USER -> {
                        val u = names?.user(n.id!!)
                        val label = "@" + (if (u != null) u.displayName.ifEmpty { u.username } else tr("render.unknownUser"))
                        out += Inline.Atom(AtomKind.USER, "<@" + n.id + ">", label, null, marks)
                    }
                    fish.nexa.ui.markdown.MentionKind.CHANNEL -> {
                        val label = "#" + (names?.channel(n.id!!)?.takeIf { it.isNotEmpty() } ?: tr("render.unknownChannel"))
                        out += Inline.Atom(AtomKind.CHANNEL, "<#" + n.id + ">", label, null, marks)
                    }
                    fish.nexa.ui.markdown.MentionKind.ROLE -> {
                        val label = "@" + (names?.role(n.id!!)?.takeIf { it.isNotEmpty() } ?: tr("render.unknownRole"))
                        out += Inline.Atom(AtomKind.ROLE, "<@&" + n.id + ">", label, null, marks)
                    }
                }
                is Node.Emoji -> out += Inline.Atom(
                    AtomKind.EMOJI, "<" + (if (n.animated) "a" else "") + ":" + n.name + ":" + n.id + ">", ":" + n.name + ":",
                    names?.emojiUrl(n.id, n.animated, 22), marks,
                )
                is Node.UnicodeEmoji -> out += Inline.Text(n.text, marks)
                is Node.Timestamp -> out += Inline.Atom(AtomKind.TIME, "<t:" + Js.numberToString(n.unix) + ":" + n.style + ">", st.labels.stamp(n), null, marks)
                is Node.FootnoteRef -> out += Inline.Atom(AtomKind.FNREF, "[^" + n.label + "]", n.n.toString(), null, marks)
                else -> Unit
            }
        }
    }

    // -----------------------------------------------------------------------
    // the editor's blocks -> markdown
    // -----------------------------------------------------------------------

    /**
     * The editor's blocks as markdown. With `lines`, each block that writes a
     * line of its own is given the index of that line (a code block, its
     * opening fence), so a place in a block can be found in the markdown.
     */
    fun toMarkdown(blocks: List<Block>, lines: IdentityHashMap<Block, Int>? = null): String {
        var start = 0
        var end = blocks.size
        // the parser drops blank lines at either end, so they are not written
        while (start < end && emptyLine(blocks[start])) start++
        while (end > start && emptyLine(blocks[end - 1])) end--
        val out = ArrayList<String>()
        var prevWrap: Wrap? = null
        var hadPrev = false
        var prevTable = false
        var i = start
        while (i < end) {
            val wrap = blocks[i].wrap
            var j = i
            while (j < end && blocks[j].wrap == wrap) j++
            val run = blocks.subList(i, j)
            if (wrap != null && wrap in ANGLED && hadPrev && prevWrap != null && prevWrap in ANGLED) out += ""
            if (prevTable && run.firstOrNull() is TableBlock) out += ""
            val base = out.size
            val at = if (lines != null) IdentityHashMap<Block, Int>() else null
            when {
                wrap == Wrap.QUOTE -> {
                    out += quoteLines(run)
                    run.forEachIndexed { k, b -> at?.put(b, k) }
                }
                wrap == Wrap.DETAILS -> out += detailsLines(run, at)
                wrap != null -> {
                    out += "> [!" + wrap.key.uppercase() + "]"
                    out += withoutTrailingBlanks(flowLines(run, false, at)).map { if (it.isEmpty()) ">" else "> $it" }
                    // under the callout's own line
                    if (at != null) for (e in at.entries) e.setValue(e.value + 1)
                }
                else -> out += flowLines(run, prevTable, at)
            }
            if (lines != null && at != null) for ((b, k) in at) if (base + k < out.size) lines[b] = base + k
            prevWrap = wrap
            hadPrev = true
            prevTable = wrap == null && run.lastOrNull() is TableBlock
            i = j
        }
        return out.joinToString("\n")
    }

    private fun quoteLines(run: List<Block>): List<String> = run.mapIndexed { n, block ->
        val content = when (block) {
            is TextBlock -> inlineMarkdown(block.content)
            is CodeBlock -> block.text.replace('\n', ' ')
            else -> ""
        }
        // a first line reading [!NOTE] would make the quote a callout
        val line = if (n == 0 && RuleShapes.isAlert(content)) "\\" + content else content
        if (line.isEmpty()) ">" else "> $line"
    }

    private fun detailsLines(run: List<Block>, at: IdentityHashMap<Block, Int>?): List<String> {
        val head = run.firstOrNull()
        val summary = if (head is TextBlock) inlineMarkdown(head.content) else ""
        val body = if (head is TextBlock) run.drop(1) else run
        val inner = if (at != null) IdentityHashMap<Block, Int>() else null
        val lines = ArrayList<String>()
        lines += if (summary.isNotEmpty()) "::: details $summary" else "::: details"
        lines += withoutTrailingBlanks(flowLines(body, false, inner))
        lines += ":::"
        if (at != null) {
            if (head is TextBlock) at[head] = 0
            for ((b, k) in inner ?: IdentityHashMap()) at[b] = k + 1
        }
        return lines
    }

    /** A callout or section ends at its last line with words. */
    private fun withoutTrailingBlanks(lines: List<String>): List<String> {
        var end = lines.size
        while (end > 0 && lines[end - 1].isEmpty()) end--
        return lines.subList(0, end)
    }

    private class Level(val col: Int, val width: Int, val next: Int, val ordered: Boolean)

    /** Blocks with no wrap of their own, or the inside of a callout or section. */
    private fun flowLines(run: List<Block>, afterTable: Boolean = false, at: IdentityHashMap<Block, Int>? = null): List<String> {
        val out = ArrayList<String>()
        // per list level: the column items start at, their marker's width, the next number
        val levels = ArrayList<Level>()
        var prevTable = afterTable
        for (block in run) {
            if (!(block is TextBlock && block.textKind == TextKind.LI)) levels.clear()
            // a table after a table gets a blank line first; every other block starts where the lines stand
            at?.put(block, out.size + if (prevTable && block is TableBlock) 1 else 0)
            when (block) {
                is CodeBlock -> {
                    var longest = 0
                    var k = 0
                    while (k < block.text.length) {
                        if (block.text[k] == '`') {
                            var e = k
                            while (e < block.text.length && block.text[e] == '`') e++
                            longest = maxOf(longest, e - k)
                            k = e
                        } else k++
                    }
                    val fence = if (longest >= 3) "`".repeat(longest + 1) else "```"
                    val lang = block.lang.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' || it == '+' || it == '-' }
                    out += fence + lang
                    out += block.text.split("\n")
                    out += fence
                }
                is RuleBlock -> out += "---"
                is FileBlock -> out += Markdown.fileLine(block.file, block.name, block.width?.toDouble())
                is TableBlock -> {
                    if (prevTable) out += ""
                    fun row(cells: List<List<Inline>>) = "| " + cells.joinToString(" | ") { inlineMarkdown(it, cell = true).ifEmpty { " " } } + " |"
                    out += row(block.rows.firstOrNull() ?: emptyList())
                    out += "|" + block.align.joinToString("|") {
                        when (it) {
                            fish.nexa.ui.markdown.Align.CENTER -> ":-:"
                            fish.nexa.ui.markdown.Align.LEFT -> ":--"
                            fish.nexa.ui.markdown.Align.RIGHT -> "--:"
                            null -> "---"
                        }
                    } + "|"
                    for (r in block.rows.drop(1)) out += row(r)
                }
                is TextBlock -> out += textLine(block, levels, prevTable)
            }
            prevTable = block is TableBlock
        }
        return out
    }

    private fun textLine(block: TextBlock, levels: ArrayList<Level>, afterTable: Boolean): String {
        val content = inlineMarkdown(block.content)
        when (block.textKind) {
            TextKind.H1, TextKind.H2, TextKind.H3, TextKind.H4, TextKind.H5, TextKind.H6 -> {
                // trailing hashes would be read as the heading's closing ones
                return "#".repeat(block.textKind.headingLevel) + " " + escapeClosingHashes(content)
            }
            TextKind.SUBTEXT -> return "-# $content"
            TextKind.NOTE -> return "[^" + (block.label ?: "note") + "]: " + content
            TextKind.LI -> {
                val list = block.list ?: ListInfo(ordered = false, task = false, checked = false, indent = 0, start = null)
                val depth = minOf(list.indent, levels.size)
                while (levels.size > depth + 1) levels.removeAt(levels.size - 1)
                val parent = levels.getOrNull(depth - 1)
                val col = if (parent != null) parent.col + parent.width else 0
                val cur = levels.getOrNull(depth)
                var n = 1
                if (list.ordered) n = list.start ?: if (cur != null && cur.ordered) cur.next else 1
                val marker = if (list.ordered) "$n." else "-"
                val level = Level(col, marker.length + 1, n + 1, list.ordered)
                if (levels.size > depth) levels[depth] = level else levels += level
                val box = if (list.task) (if (list.checked) "[x] " else "[ ] ") else ""
                // words starting [ ] or [x] would tick a box that is not there
                val words = if (!list.task && startsLikeBox(content)) "\\" + content else content
                val line = " ".repeat(col) + marker + " " + box + words
                return if (rule(line)) " ".repeat(col) + marker + " " + box + "\\" + words else line
            }
            else -> return paragraphLine(content, afterTable)
        }
    }

    /** `/^\[[ xX]\]([ \t]|$)/` */
    private fun startsLikeBox(s: String): Boolean =
        s.length >= 3 && s[0] == '[' && (s[1] == ' ' || s[1] == 'x' || s[1] == 'X') && s[2] == ']' && (s.length == 3 || s[3] == ' ' || s[3] == '\t')

    /** A heading's words ending in `#`s after a space: the hashes get a backslash so they stay words. */
    private fun escapeClosingHashes(content: String): String {
        // /(^|[ \t])#+[ \t]*$/.test, then the first /#+([ \t]*)$/ gets a backslash before it
        var t = content.length
        while (t > 0 && (content[t - 1] == ' ' || content[t - 1] == '\t')) t--
        var h = t
        while (h > 0 && content[h - 1] == '#') h--
        if (h == t) return content
        if (h > 0 && content[h - 1] != ' ' && content[h - 1] != '\t') return content
        return content.substring(0, h) + "\\" + content.substring(h)
    }

    private val parser = RuleShapes

    private fun rule(line: String) = parser.isRule(line)

    /**
     * A plain line, with a backslash before whatever at its start would make
     * it a block. Right after a table, and wherever it could be a table's dash
     * row, its pipes are escaped so it stays text.
     */
    private fun paragraphLine(content: String, afterTable: Boolean): String {
        var s = content
        var leadEnd = 0
        while (leadEnd < s.length && (s[leadEnd] == ' ' || s[leadEnd] == '\t')) leadEnd++
        val lead = s.substring(0, leadEnd)
        val rest = s.substring(leadEnd)
        if (parser.isHeading(rest) || (rest.length in 1..6 && rest.all { it == '#' })) s = lead + "\\" + rest
        else if (rest.startsWith(">")) s = lead + "\\" + rest
        else if (rest.startsWith("-# ")) s = lead + "\\" + rest
        else if (parser.isRule(s)) s = lead + "\\" + rest
        else if (rest.startsWith(":::")) s = lead + "\\" + rest
        else if (parser.isFootnoteDef(rest)) s = lead + "\\" + rest
        else {
            val item = parser.listItem(s)
            if (item != null) {
                val markerAt = item.first + (item.second?.length ?: 0)
                s = s.substring(0, markerAt) + "\\" + s.substring(markerAt)
            }
        }
        val dashes = s.isNotEmpty() && s.all { it == ' ' || it == '\t' || it == '|' || it == ':' || it == '-' } && s.contains('|') && s.contains('-')
        if (afterTable || dashes) s = escapePipes(escapePipes(s))
        return s
    }

    private val PIPE = Regex("(^|[^\\\\])\\|")

    /** `s.replace(/(^|[^\\])\|/g, "$1\\|")`. */
    private fun escapePipes(s: String): String = PIPE.replace(s, "$1\\\\|")

    // -----------------------------------------------------------------------
    // inline
    // -----------------------------------------------------------------------

    /** From outermost to innermost; code is innermost of all, as nothing inside it can be marked. */
    private val ORDER = listOf("link", "color", "spoiler", "s", "u", "b", "i", "mark", "sup", "sub")

    /** One character (a code point), or an atom's markdown. */
    private class Cell(val ch: String, val atom: Boolean, var marks: Marks)

    private class Piece(val raw: Boolean, var s: String, val inLabel: Boolean = false, val inBraces: Boolean = false, val italic: Int? = null)

    private class Stuck(val flag: Flag, val from: Int, val to: Int)

    private class Span(val flag: Flag, val open: Int, val close: Int, val from: Int, val to: Int)

    private fun keysOf(m: Marks): List<String> {
        val out = ArrayList<String>()
        m.link?.let { out += "link\u0000" + it.url + "\u0000" + (if (it.noEmbed) 1 else 0) }
        m.color?.let { out += "color\u0000" + (it.fg ?: "") + "\u0000" + (it.bg ?: "") }
        if (m.spoiler) out += "spoiler"
        if (m.s) out += "s"
        if (m.u) out += "u"
        if (m.b) out += "b"
        if (m.i) out += "i"
        if (m.mark) out += "mark"
        if (m.sup) out += "sup"
        if (m.sub) out += "sub"
        return out
    }

    private fun rank(key: String): Int = ORDER.indexOf(key.substringBefore('\u0000'))

    private fun cellsOf(content: List<Inline>): List<Cell> {
        val out = ArrayList<Cell>()
        for (r in content) {
            if (r is Inline.Atom) out += Cell(r.raw, true, r.marks)
            else {
                val t = (r as Inline.Text).text.replace('\n', ' ')
                var k = 0
                while (k < t.length) {
                    val cp = t.codePointAt(k)
                    val n = Character.charCount(cp)
                    out += Cell(t.substring(k, k + n), false, r.marks)
                    k += n
                }
            }
        }
        return out
    }

    /** `/\s/.test(ch)` for one code point. */
    private fun space(ch: String): Boolean = ch.length == 1 && Js.isSpace(ch[0])

    private val HUGGING = listOf(Flag.B, Flag.I, Flag.U, Flag.MARK)

    /** Moves spaces at the edges of bold, italics, underline and highlight outside them. */
    private fun hug(cells: List<Cell>): List<Cell> {
        val out = cells.map { Cell(it.ch, it.atom, it.marks) }
        for (f in HUGGING) {
            var k = 0
            while (k < out.size) {
                if (!out[k].marks[f]) {
                    k++
                    continue
                }
                var e = k
                while (e < out.size && out[e].marks[f] && !out[e].marks.code) e++
                if (e == k) {
                    k++
                    continue
                }
                var s = k
                while (s < e && !out[s].atom && space(out[s].ch)) {
                    out[s].marks = out[s].marks.with(f, false)
                    s++
                }
                var z = e
                while (z > s && !out[z - 1].atom && space(out[z - 1].ch)) {
                    out[z - 1].marks = out[z - 1].marks.with(f, false)
                    z--
                }
                k = e
            }
        }
        return out
    }

    /**
     * Underline and highlight only begin and end at the edge of a word, so a
     * span whose marker would touch a letter is written without that mark
     * rather than with markers the reader would see.
     */
    private fun wordEdges(cells: List<Cell>): List<Cell> {
        var out = cells
        repeat(4) {
            val stuck = ArrayList<Stuck>()
            pieces(out, "*", stuck)
            if (stuck.isEmpty()) return out
            out = out.map { Cell(it.ch, it.atom, it.marks) }
            for (s in stuck) for (j in s.from until s.to) out[j].marks = out[j].marks.with(s.flag, false)
        }
        return out
    }

    private class Segment(val marks: Marks, val cells: MutableList<Cell>)

    private fun segmentsOf(cells: List<Cell>): List<Segment> {
        val out = ArrayList<Segment>()
        for (c in cells) {
            val last = out.lastOrNull()
            if (last != null && sameMarks(last.marks, c.marks)) last.cells += c else out += Segment(c.marks, arrayListOf(c))
        }
        return out
    }

    /** encodeURIComponent for one white space character. */
    private fun encodeChar(c: Char): String = String(charArrayOf(c)).toByteArray(Charsets.UTF_8).joinToString("") { "%" + "%02X".format(it.toInt() and 0xFF) }

    private fun destination(url: String, noEmbed: Boolean): String {
        if (noEmbed) return "<" + url.map { if (Js.isSpace(it) || it == '>') encodeChar(it) else it.toString() }.joinToString("") + ">"
        // one level of balanced parentheses reads as part of the address; anything else is encoded
        val u = url.map { if (Js.isSpace(it)) encodeChar(it) else it.toString() }.joinToString("")
        if (balanced(u)) return u
        return u.replace("(", "%28").replace(")", "%29")
    }

    /** `/^(?:[^()]|\([^()]*\))*$/` */
    private fun balanced(s: String): Boolean {
        var k = 0
        while (k < s.length) {
            when (s[k]) {
                ')' -> return false
                '(' -> {
                    var e = k + 1
                    while (e < s.length && s[e] != '(' && s[e] != ')') e++
                    if (e >= s.length || s[e] != ')') return false
                    k = e + 1
                }
                else -> k++
            }
        }
        return true
    }

    private fun openOf(key: String, italic: String): String = when (key.substringBefore('\u0000')) {
        "link", "color" -> "["
        "spoiler" -> "||"
        "s" -> "~~"
        "u" -> "__"
        "b" -> "**"
        "i" -> italic
        "mark" -> "=="
        "sup" -> "^{"
        else -> "_{"
    }

    private fun closeOf(key: String, italic: String): String {
        val parts = key.split('\u0000')
        return when (parts[0]) {
            "link" -> "](" + destination(parts.getOrElse(1) { "" }, parts.getOrNull(2) == "1") + ")"
            "color" -> "]{" + MarkdownColors.formatSpec(MarkdownColors.Spec(parts.getOrNull(1)?.ifEmpty { null }, parts.getOrNull(2)?.ifEmpty { null })) + "}"
            "sup", "sub" -> "}"
            else -> openOf(key, italic)
        }
    }

    /** A code span: fenced with more backticks than it holds, padded when it starts or ends with one. */
    private fun codeSpan(code: String): String {
        if (code.isEmpty()) return ""
        var longest = 0
        var k = 0
        while (k < code.length) {
            if (code[k] == '`') {
                var e = k
                while (e < code.length && code[e] == '`') e++
                longest = maxOf(longest, e - k)
                k = e
            } else k++
        }
        val fence = "`".repeat(longest + 1)
        val pad = if (code.startsWith("`") || code.endsWith("`")) " " else ""
        return fence + pad + code + pad + fence
    }

    private fun isWord(s: String): Boolean = s.length == 1 && Js.isWordUnit(s[0])

    private fun pieces(cells: List<Cell>, italic: String, stuck: MutableList<Stuck>? = null): List<Piece> {
        val segs = segmentsOf(cells)
        val out = ArrayList<Piece>()
        val stack = ArrayList<String>()
        val pairs = ArrayList<Int>()
        var pair = 0
        // where each underline and highlight opened: its piece and its first cell
        val edges = HashMap<String, Pair<Int, Int>>()
        val spans = ArrayList<Span>()
        var cell = 0
        val keys = segs.map { keysOf(it.marks) }
        fun lasts(k: Int, key: String): Int {
            var n = 0
            while (k + n < segs.size && key in keys[k + n]) n++
            return n
        }
        fun close(key: String) {
            out += if (key == "i") Piece(true, italic, italic = pairs.removeAt(pairs.size - 1)) else Piece(true, closeOf(key, italic))
            val edge = edges[key]
            if (edge != null && (key == "u" || key == "mark")) spans += Span(if (key == "u") Flag.U else Flag.MARK, edge.first, out.size - 1, edge.second, cell)
        }
        segs.forEachIndexed { k, seg ->
            val want = keys[k]
            val cut = stack.indexOfFirst { it !in want }
            if (cut >= 0) {
                for (j in stack.size - 1 downTo cut) close(stack[j])
                while (stack.size > cut) stack.removeAt(stack.size - 1)
            }
            val open = want.filter { it !in stack }.sortedWith { a, b ->
                val d = lasts(k, b) - lasts(k, a)
                if (d != 0) d else rank(a) - rank(b)
            }
            for (key in open) {
                if (key == "i") {
                    pair++
                    pairs += pair
                    out += Piece(true, italic, italic = pair)
                } else out += Piece(true, openOf(key, italic))
                edges[key] = (out.size - 1) to cell
                stack += key
            }
            cell += seg.cells.size
            val inLabel = stack.any { it.startsWith("link") || it.startsWith("color") }
            val inBraces = "sup" in stack || "sub" in stack
            if (seg.marks.code) {
                out += Piece(true, codeSpan(seg.cells.joinToString("") { it.ch }))
                return@forEachIndexed
            }
            val buf = StringBuilder()
            for (c in seg.cells) {
                if (c.atom) {
                    if (buf.isNotEmpty()) out += Piece(false, buf.toString(), inLabel, inBraces)
                    buf.setLength(0)
                    out += Piece(true, c.ch)
                } else buf.append(c.ch)
            }
            if (buf.isNotEmpty()) out += Piece(false, buf.toString(), inLabel, inBraces)
        }
        for (j in stack.size - 1 downTo 0) close(stack[j])
        if (italic == "*") chooseItalics(out)
        if (stuck != null) {
            fun before(k: Int): String {
                for (j in k - 1 downTo 0) if (out[j].s.isNotEmpty()) return out[j].s.takeLast(1)
                return ""
            }
            fun after(k: Int): String {
                for (j in k + 1 until out.size) if (out[j].s.isNotEmpty()) return out[j].s.take(1)
                return ""
            }
            for (s in spans) if (isWord(before(s.open)) || isWord(after(s.close))) stuck += Stuck(s.flag, s.from, s.to)
        }
        return out
    }

    /**
     * Italics are written with `*` unless a star right beside the marker
     * would run into it, in which case `_` is used where the words around allow it.
     */
    private fun chooseItalics(parts: List<Piece>) {
        val pairs = LinkedHashMap<Int, IntArray>()
        parts.forEachIndexed { k, p ->
            val id = p.italic ?: return@forEachIndexed
            val cur = pairs[id]
            pairs[id] = if (cur != null) intArrayOf(cur[0], k) else intArrayOf(k, k)
        }
        fun markerBefore(k: Int): String {
            for (j in k - 1 downTo 0) if (parts[j].s.isNotEmpty()) return if (parts[j].raw) parts[j].s.takeLast(1) else ""
            return ""
        }
        fun markerAfter(k: Int): String {
            for (j in k + 1 until parts.size) if (parts[j].s.isNotEmpty()) return if (parts[j].raw) parts[j].s.take(1) else ""
            return ""
        }
        fun charBefore(k: Int): String {
            for (j in k - 1 downTo 0) if (parts[j].s.isNotEmpty()) return parts[j].s.takeLast(1)
            return ""
        }
        fun charAfter(k: Int): String {
            for (j in k + 1 until parts.size) if (parts[j].s.isNotEmpty()) return parts[j].s.take(1)
            return ""
        }
        for ((open, close) in pairs.values.map { it[0] to it[1] }) {
            val touching = listOf(markerBefore(open), markerAfter(open), markerBefore(close), markerAfter(close))
            if ("*" !in touching) continue
            // an underscore cannot sit inside a word, nor against another underscore
            if ("_" in touching || isWord(charBefore(open)) || isWord(charAfter(close))) continue
            parts[open].s = "_"
            parts[close].s = "_"
        }
    }

    private fun punct(c: Char) = c in '!'..'/' || c in ':'..'@' || c in '['..'`' || c in '{'..'~'

    /** The http(s) addresses in a piece of text, as /https?:\/\/[^\s<]+/gi finds them, trimmed as links are. */
    private fun urlRanges(s: String): List<IntRange> {
        val out = ArrayList<IntRange>()
        var k = 0
        while (k < s.length) {
            if (Js.regionMatchesAsciiIgnoreCase(s, k, "http")) {
                var j = k + 4
                if (j < s.length && (s[j] == 's' || s[j] == 'S') && s.startsWith("://", j + 1)) j++
                if (s.startsWith("://", j)) {
                    j += 3
                    val bodyStart = j
                    while (j < s.length && s[j] != '<' && !Js.isSpace(s[j])) j++
                    if (j > bodyStart) {
                        val url = Markdown.trimUrl(s.substring(k, j))
                        if (url.length > 8) out += k until k + url.length
                        k = j
                        continue
                    }
                }
            }
            k++
        }
        return out
    }

    /**
     * Escapes the text pieces, knowing what surrounds each character in the
     * final line: only what could be read as markup gets a backslash, unless
     * `full` asks for every punctuation mark to get one. Web addresses are
     * left whole, so they still link.
     */
    private fun assemble(parts: List<Piece>, cell: Boolean, full: Boolean): String {
        val plain = parts.joinToString("") { it.s }
        var at = 0
        val out = StringBuilder()
        for (p in parts) {
            if (p.raw) {
                out.append(p.s)
                at += p.s.length
                continue
            }
            val s = p.s
            val urls = urlRanges(s)
            var k = 0
            while (k < s.length) {
                val url = urls.firstOrNull { k in it }
                if (url != null) {
                    out.append(s, k, url.last + 1)
                    at += url.last + 1 - k
                    k = url.last + 1
                    continue
                }
                val c = s[k]
                val prev = if (at - 1 >= 0 && at - 1 < plain.length) plain[at - 1].toString() else ""
                val next = if (at + 1 < plain.length) plain[at + 1].toString() else ""
                val ahead = if (at <= plain.length) plain.substring(at) else ""
                var esc = false
                if (punct(c)) {
                    esc = if (full) true else when (c) {
                        '\\' -> next.isNotEmpty() && punct(next[0])
                        '*', '`' -> true
                        '_' -> !(isWord(prev) && isWord(next)) || next == "{"
                        '~' -> prev == "~" || next == "~"
                        '|' -> cell || prev == "|" || next == "|"
                        '=' -> prev == "=" || next == "="
                        '^' -> next == "{"
                        '[' -> next == "^" || ahead.contains("](") || ahead.contains("]{")
                        ']' -> p.inLabel
                        '{', '}' -> p.inBraces
                        '<' -> angleAhead(ahead)
                        ':' -> {
                            val name = shortcodeAhead(ahead)
                            name != null && Shortcodes.toEmoji(name) != null
                        }
                        else -> false
                    }
                }
                if (esc) out.append('\\')
                out.append(c)
                at++
                k++
            }
        }
        return out.toString()
    }

    /** `/^<(@|#|:|a:|t:|https?:\/\/)/i` */
    private fun angleAhead(ahead: String): Boolean {
        if (!ahead.startsWith("<")) return false
        val r = ahead.substring(1)
        if (r.startsWith("@") || r.startsWith("#") || r.startsWith(":")) return true
        if (Js.regionMatchesAsciiIgnoreCase(r, 0, "a:") || Js.regionMatchesAsciiIgnoreCase(r, 0, "t:")) return true
        if (Js.regionMatchesAsciiIgnoreCase(r, 0, "http")) {
            var j = 4
            if (j < r.length && (r[j] == 's' || r[j] == 'S') && r.startsWith("://", j + 1)) return true
            return r.startsWith("://", j)
        }
        return false
    }

    /** `/^:([a-z0-9_+-]{1,60}):/`: the name, or null. */
    private fun shortcodeAhead(ahead: String): String? {
        if (!ahead.startsWith(":")) return null
        var j = 1
        while (j < ahead.length && j <= 61 && ahead[j].let { it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '+' || it == '-' }) j++
        val len = j - 1
        return if (len in 1..60 && j < ahead.length && ahead[j] == ':') ahead.substring(1, j) else null
    }

    /** The runs the parser reads back from a line, for checking a line says what it should. */
    private fun readBack(line: String): List<Inline> {
        val out = ArrayList<Inline>()
        inline(Markdown.parse(line, inline = true), Marks.NONE, out, LoadState(ArrayList(), false, Labels(tr = { it })))
        return normalize(out)
    }

    private fun sameRuns(a: List<Inline>, b: List<Inline>): Boolean {
        if (a.size != b.size) return false
        return a.indices.all { k ->
            val r = a[k]
            val o = b[k]
            if (r::class != o::class || !sameMarks(r.marks, o.marks)) false
            else if (r is Inline.Text) r.text == (o as Inline.Text).text else (r as Inline.Atom).raw == (o as Inline.Atom).raw
        }
    }

    private fun runsOf(cells: List<Cell>): List<Inline> = normalize(cells.map { if (it.atom) Inline.Atom(AtomKind.FNREF, it.ch, it.ch, null, it.marks) else Inline.Text(it.ch, it.marks) })

    /**
     * A line's worth of runs as markdown. The markers are chosen to nest (the
     * longest-lasting outermost), text is escaped only where it would be read
     * as markup, and the result is read back with the real parser: when it
     * would not say what the runs say, the next way of writing it is tried,
     * down to escaping every punctuation mark.
     */
    fun inlineMarkdown(content: List<Inline>, cell: Boolean = false): String {
        val cells = wordEdges(hug(cellsOf(content)))
        val want = comparable(runsOf(cells))
        var first: String? = null
        for ((italic, full) in listOf("*" to false, "_" to false, "*" to true, "_" to true)) {
            val line = assemble(pieces(cells, italic), cell, full)
            if (first.isNullOrEmpty()) first = line
            if (sameRuns(comparable(readBack(line)), want)) return line
        }
        // nothing reads back exactly: most often a label naming another site than its link goes to
        return first ?: ""
    }

    /** Atoms compare by their markdown, whatever label each side gave them. */
    private fun comparable(runs: List<Inline>): List<Inline> = runs.map { if (it is Inline.Atom) it.copy(atom = AtomKind.FNREF, label = it.raw, img = null) else it }

    /** Whether a link's words name some other site than the one it goes to (the reader will see both). */
    fun misleads(content: List<Inline>): Boolean {
        val byUrl = LinkedHashMap<String, String>()
        for (r in content) {
            val link = r.marks.link ?: continue
            byUrl[link.url] = (byUrl[link.url] ?: "") + if (r is Inline.Text) r.text else (r as Inline.Atom).label
        }
        return byUrl.any { (url, label) -> Markdown.misleadingLabel(label, url) }
    }
}

/** The parser's own line shapes, for writing lines that are not read as blocks. */
internal object RuleShapes {
    fun isRule(line: String): Boolean = Markdown.lineIsRule(line)
    fun isHeading(line: String): Boolean = Markdown.lineIsHeading(line)
    fun isFootnoteDef(line: String): Boolean = Markdown.lineIsFootnoteDef(line)
    fun isAlert(line: String): Boolean = Markdown.lineIsAlert(line)

    /** A list item's marker: its indent's length and its number when ordered; null when the line is no item. */
    fun listItem(line: String): Pair<Int, String?>? = Markdown.lineListItem(line)
}
