package fish.nexa.ui.format

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import fish.nexa.Nexa
import fish.nexa.media.Media
import fish.nexa.ui.chat.AppNames
import fish.nexa.ui.markdown.Align
import fish.nexa.ui.markdown.Timestamps
import fish.nexa.ui.markdown.format.AtomNames
import fish.nexa.ui.markdown.format.Block
import fish.nexa.ui.markdown.format.CodeBlock
import fish.nexa.ui.markdown.format.FileBlock
import fish.nexa.ui.markdown.format.Flag
import fish.nexa.ui.markdown.format.FormatMarkdown
import fish.nexa.ui.markdown.format.FormatModel
import fish.nexa.ui.markdown.format.Inline
import fish.nexa.ui.markdown.format.LinkMark
import fish.nexa.ui.markdown.format.ListInfo
import fish.nexa.ui.markdown.format.Marks
import fish.nexa.ui.markdown.format.Pos
import fish.nexa.ui.markdown.format.RuleBlock
import fish.nexa.ui.markdown.format.Sel
import fish.nexa.ui.markdown.format.TableBlock
import fish.nexa.ui.markdown.format.TextBlock
import fish.nexa.ui.markdown.format.TextKind
import fish.nexa.ui.markdown.format.Wrap
import java.util.Locale

/** One field on the page: a text block, a code block, or a table cell (row, column). */
data class FieldKey(val id: Int, val cell: Pair<Int, Int>? = null)

/** A field's text as laid out, and how its offsets map to what is drawn (an atom shows its label). */
class FieldLayout(val text: androidx.compose.ui.text.TextLayoutResult, val transformation: androidx.compose.ui.text.input.VisualTransformation)

/** What the toolbar asks of the surface (surface.ts `Command`). */
sealed interface Cmd {
    data class Mark(val flag: Flag) : Cmd
    /** `part` is "fg" (text) or "bg" (highlight); a null value takes the colour off. */
    data class Colour(val part: String, val value: String?) : Cmd
    /** A null url takes the link off; `text` names a link added with nothing selected. */
    data class Link(val url: String?, val text: String = "") : Cmd
    data class Kind(val kind: TextKind) : Cmd
    /** "bullet", "ordered" or "task". */
    data class ListOf(val type: String) : Cmd
    data class Indent(val delta: Int) : Cmd
    data object Check : Cmd
    data class WrapIn(val wrap: Wrap) : Cmd
    data object Code : Cmd
    data class Lang(val lang: String) : Cmd
    data class Table(val rows: Int, val cols: Int) : Cmd
    /** A change to the table the caret is in; null deletes the table. */
    data class TableEdit(val op: FormatModel.TableOp?) : Cmd
    data object Rule : Cmd
    data object Clear : Cmd
    data object Undo : Cmd
    data object Redo : Cmd
    data class Text(val text: String) : Cmd
    /** A note's file, on a line of its own after the caret's. */
    data class File(val file: String, val name: String) : Cmd
    /** How much of the line a note's picture takes, in percent. */
    data class FileWidth(val id: Int, val width: Int) : Cmd
    /** Takes a block out: a file, from its own remove button. */
    data class RemoveBlock(val id: Int) : Cmd
}

/** A place another copy of a note can find: a block by where it was and what it says (surface.ts PlaceMark). */
data class PlaceMark(val b: Int, val o: Int, val cell: Pair<Int, Int>?, val k: String)

/** Where someone's selection runs from and to; the same place twice is a caret. */
data class CursorMark(val a: PlaceMark, val f: PlaceMark)

/** surface.ts `SurfaceState`: what the toolbar shows as on, and what the caret is in. */
data class SurfaceState(
    val marks: Marks,
    val kind: String?,
    val list: ListInfo?,
    val wrap: Wrap?,
    val table: TableAt?,
    val codeLang: String?,
    val link: LinkMark?,
    val collapsed: Boolean,
    val canUndo: Boolean,
    val canRedo: Boolean,
    val selectedText: String,
)

data class TableAt(val row: Int, val col: Int, val rows: Int, val cols: Int, val align: Align?)

/** Names for mentions and pictures for custom emoji, as the chat draws them. */
object EditorNames : AtomNames, fish.nexa.ui.markdown.NameLookup by AppNames {
    override fun emojiUrl(id: String, animated: Boolean, css: Int): String =
        Media.emojiUrl(id, css, Nexa.app.resources.displayMetrics.density, still = !animated)
}

/**
 * The formatting editor's surface (web/src/components/composer/format/surface.ts)
 * without the DOM: the document as blocks, the caret, the history, and every
 * command and rule of typing the web's has. The page draws each text block,
 * code block and table cell as a field of its own and reports what the
 * keyboard did to it here; this turns that into changes to the model and
 * says where the caret goes next.
 */
class FormatSurface(
    /** The markdown it opened with: closing with anything else asks first. */
    val initial: String,
    /** A note's page: files on lines of their own, and as much text as a note holds. */
    private val files: Boolean = false,
    private val max: Int = 0,
    /** Whether the keyboard comes up as it opens (the message editor) or waits to be asked (a note). */
    focusOnOpen: Boolean = true,
) {
    private val labels = FormatMarkdown.Labels(
        names = EditorNames,
        tr = { key -> fish.nexa.ui.t(key) },
        stamp = { node -> Timestamps.text(node, System.currentTimeMillis(), Locale.getDefault()) },
    )

    var blocks by mutableStateOf<List<Block>>(emptyList())
        private set
    var sel by mutableStateOf(FormatModel.caret(0, 0))
        private set
    /** Marks chosen with nothing selected: the next typing at that caret takes them. */
    private var pending by mutableStateOf<Pair<Pos, Marks>?>(null)
    private val past = ArrayList<Pair<List<Block>, Sel>>()
    private val future = ArrayList<Pair<List<Block>, Sel>>()
    private var lastTyping = 0L
    var canUndo by mutableStateOf(false)
        private set
    var canRedo by mutableStateOf(false)
        private set
    /** Whether what was loaded had nesting shown one level deep only. */
    val simplified: Boolean

    /** Each field as it last was: its text, selection and the keyboard's composition. */
    val values = mutableStateMapOf<FieldKey, TextFieldValue>()

    /** Where each field is on the screen and how its text is laid out, for carets drawn over the page. */
    val placed = HashMap<FieldKey, androidx.compose.ui.layout.LayoutCoordinates>()
    val laidOut = HashMap<FieldKey, FieldLayout>()

    /** Where the caret goes after a change that put it in another field; `seq` bumps every time. */
    data class Focus(val key: FieldKey, val seq: Int)

    var focusTo by mutableStateOf<Focus?>(null)
        private set
    private var seq = 0

    /** The document changed. */
    var onChange: (() -> Unit)? = null
    /** Ctrl+Enter, Ctrl+K and Escape from a hardware keyboard. */
    var onSubmit: (() -> Unit)? = null
    var onLinkKey: (() -> Unit)? = null
    var onEscape: (() -> Unit)? = null

    init {
        val loaded = FormatMarkdown.fromMarkdown(initial, labels, files, max)
        blocks = FormatModel.ensureBlock(loaded.blocks)
        simplified = loaded.simplified
        val last = blocks.lastIndex
        sel = FormatModel.caret(last, FormatModel.sizeAt(blocks, Pos(last, 0)))
        sync(force = true)
        // the keyboard comes to the page as it opens, the caret at the end
        if (focusOnOpen) focusCaret()
    }

    fun markdown(): String = FormatMarkdown.toMarkdown(blocks)

    // -----------------------------------------------------------------------
    // fields

    companion object {
        /** What an atom (a mention, an emoji, a time) is in a field's text: one character. */
        const val ATOM = '￼'
        private const val COALESCE_MS = 1000L
        private const val MAX_HISTORY = 200
        private val LANG_CHARS = Regex("[^a-zA-Z0-9_+-]")

        fun textOf(content: List<Inline>): String = buildString { for (r in content) if (r is Inline.Text) append(r.text) else append(ATOM) }
    }

    fun indexOf(key: FieldKey): Int = blocks.indexOfFirst { it.id == key.id }

    private fun keyAt(p: Pos): FieldKey? {
        val block = blocks.getOrNull(p.b) ?: return null
        return when (block) {
            is TextBlock, is CodeBlock -> FieldKey(block.id)
            is TableBlock -> FieldKey(block.id, p.cell ?: (0 to 0))
            else -> null
        }
    }

    /** The runs a field holds (null for a code block, which is plain text). */
    fun contentOf(block: Block?, cell: Pair<Int, Int>?): List<Inline>? = when (block) {
        is TextBlock -> block.content
        is TableBlock -> cell?.let { block.rows.getOrNull(it.first)?.getOrNull(it.second) } ?: emptyList()
        else -> null
    }

    private fun fieldText(block: Block?, cell: Pair<Int, Int>?): String? = when (block) {
        is TextBlock -> textOf(block.content)
        is CodeBlock -> block.text
        is TableBlock -> textOf(contentOf(block, cell) ?: emptyList())
        else -> null
    }

    /** Every field's value made to match the model; the field with the caret gets the selection. */
    private fun sync(force: Boolean) {
        val focusKey = keyAt(sel.focus)
        val seen = HashSet<FieldKey>()
        fun put(key: FieldKey, text: String) {
            seen += key
            val old = values[key]
            if (key == focusKey) {
                val a = if (sel.anchor.b == sel.focus.b && sel.anchor.cell == sel.focus.cell) sel.anchor.o else sel.focus.o
                val range = TextRange(a.coerceIn(0, text.length), sel.focus.o.coerceIn(0, text.length))
                if (old == null || old.text != text || (force && old.selection != range)) values[key] = TextFieldValue(text, range)
            } else if (old == null || old.text != text) {
                values[key] = TextFieldValue(text, TextRange(minOf(old?.selection?.end ?: text.length, text.length)))
            }
        }
        for (block in blocks) {
            when (block) {
                is TextBlock, is CodeBlock -> put(FieldKey(block.id), fieldText(block, null) ?: "")
                is TableBlock -> block.rows.forEachIndexed { r, row -> row.indices.forEach { c -> put(FieldKey(block.id, r to c), textOf(row[c])) } }
                else -> Unit
            }
        }
        values.keys.filter { it !in seen }.forEach { values.remove(it) }
        placed.keys.retainAll(seen)
        laidOut.keys.retainAll(seen)
    }

    /** Puts the keyboard where the caret now is. */
    private fun focusCaret() {
        val key = keyAt(sel.focus) ?: return
        focusTo = Focus(key, ++seq)
    }

    // -----------------------------------------------------------------------
    // history and applying

    private fun remember(typing: Boolean) {
        val now = System.currentTimeMillis()
        if (typing && now - lastTyping < COALESCE_MS && past.isNotEmpty()) {
            lastTyping = now
            return
        }
        lastTyping = if (typing) now else 0
        past += blocks to sel
        if (past.size > MAX_HISTORY) past.removeAt(0)
        future.clear()
        canUndo = true
        canRedo = false
    }

    /** A change made on the model: drawn, the caret put back, the keyboard taken there. */
    private fun apply(next: List<Block>, s: Sel, record: Boolean = true) {
        if (record) remember(false)
        blocks = next.ifEmpty { listOf(FormatModel.textBlock()) }
        sel = Sel(FormatModel.clampPos(blocks, s.anchor), FormatModel.clampPos(blocks, s.focus))
        pending = null
        sync(force = true)
        focusCaret()
        onChange?.invoke()
    }

    private fun undo() {
        val prev = past.removeLastOrNull() ?: return
        future += blocks to sel
        lastTyping = 0
        apply(prev.first, prev.second, record = false)
        canUndo = past.isNotEmpty()
        canRedo = true
    }

    private fun redo() {
        val next = future.removeLastOrNull() ?: return
        past += blocks to sel
        apply(next.first, next.second, record = false)
        canUndo = true
        canRedo = future.isNotEmpty()
    }

    // -----------------------------------------------------------------------
    // what the keyboard did

    /** The field the keyboard is in, if it is in this page. */
    var activeKey by mutableStateOf<FieldKey?>(null)
        private set

    /** A field let the keyboard go. */
    fun blurred(key: FieldKey) {
        if (activeKey == key) activeKey = null
    }

    /** A field took focus: the caret is where that field has it. */
    fun focused(key: FieldKey) {
        activeKey = key
        val b = indexOf(key)
        if (b < 0) return
        val v = values[key] ?: return
        val next = Sel(Pos(b, v.selection.start, key.cell), Pos(b, v.selection.end, key.cell))
        if (next != sel) {
            sel = next
            if (pending?.first != next.focus) pending = null
        }
    }

    /**
     * A field whose keyboard buffer is ahead of the model: the model changed
     * the field's text in answer to typing in it (Enter split the line, "- "
     * made a list), and the keyboard sent more before the field caught up.
     * What the buffer held around its caret then, so what comes after it can
     * be put where the model's caret is.
     */
    private class Stale(val key: FieldKey, var prefix: String, val suffix: String, val at: Long)

    private var stale: Stale? = null

    private fun markStale(key: FieldKey, v: TextFieldValue?) {
        if (v == null) return
        val c = v.selection.end.coerceIn(0, v.text.length)
        stale = Stale(key, v.text.substring(0, c), v.text.substring(c), System.currentTimeMillis())
    }

    /** Typing that reached a stale buffer, put at the model's caret; false when it is not that. */
    private fun route(st: Stale, v: TextFieldValue): Boolean {
        val t = v.text
        if (!t.endsWith(st.suffix) || t.length < st.suffix.length) return false
        val body = t.substring(0, t.length - st.suffix.length)
        when {
            body.startsWith(st.prefix) -> {
                val more = body.substring(st.prefix.length)
                if (more.isNotEmpty()) {
                    val target = keyAt(sel.focus) ?: return true
                    val tb = indexOf(target)
                    if (tb >= 0) typed(target, tb, sel.focus.o, sel.focus.o, more, null)
                }
            }
            st.prefix.startsWith(body) -> repeat(st.prefix.length - body.length) {
                keyAt(sel.focus)?.let { target -> hardKey(target, null, enter = false, backspace = true, delete = false) }
            }
            else -> return false
        }
        st.prefix = body
        // the keyboard is still in this field until the next frame moves it
        stale = st
        return true
    }

    /** A field's new value: a moved caret, or text typed, deleted or replaced. */
    fun onValue(key: FieldKey, v: TextFieldValue) {
        val st = stale
        if (st != null && st.key == key) {
            if (System.currentTimeMillis() - st.at < 1500 && route(st, v)) return
            stale = null
        }
        val b = indexOf(key)
        if (b < 0) return
        val block = blocks[b]
        val old = values[key]?.text ?: fieldText(block, key.cell) ?: return
        if (v.text == old) {
            values[key] = v
            focused(key)
            return
        }
        val (from, to, inserted) = diff(old, v.text, v.selection)
        typed(key, b, from, to, inserted, v)
    }

    /**
     * Where two texts differ: the old range that went and the text that came,
     * which ends at the caret when the caret says so (typing a letter that
     * repeats the one before it is still typed where the caret is).
     */
    private fun diff(a: String, b: String, selection: TextRange): Triple<Int, Int, String> {
        if (selection.collapsed) {
            val c = selection.end
            val tail = b.length - c
            if (c in 0..b.length && tail <= a.length && a.endsWith(b.substring(c))) {
                val limit = minOf(c, a.length - tail)
                var p = 0
                while (p < limit && a[p] == b[p]) p++
                return Triple(p, a.length - tail, b.substring(p, c))
            }
        }
        var p = 0
        val max = minOf(a.length, b.length)
        while (p < max && a[p] == b[p]) p++
        var s = 0
        while (s < max - p && a[a.length - 1 - s] == b[b.length - 1 - s]) s++
        return Triple(p, a.length - s, b.substring(p, b.length - s))
    }

    private fun typed(key: FieldKey, b: Int, from: Int, to: Int, inserted: String, v: TextFieldValue?) {
        val block = blocks[b]
        // a space after "- ", "1.", "[]", "#", ">" or "-#" at the start of a plain line
        if (inserted == " " && from == to && shortcut(b, from, key.cell)) {
            markStale(key, v)
            return
        }
        if ('\n' in inserted && block !is CodeBlock) {
            val parts = inserted.split('\n')
            replace(key, b, from, to, parts[0], null)
            for (part in parts.drop(1)) {
                enter()
                if (key.cell != null) break
                if (part.isNotEmpty()) typeText(part)
            }
            markStale(key, v)
            return
        }
        replace(key, b, from, to, inserted, v)
    }

    /** Replaces from..to in one field with text, taking the marks typing there takes. */
    private fun replace(key: FieldKey, b: Int, from: Int, to: Int, inserted: String, v: TextFieldValue?) {
        var next = blocks
        if (to > from) next = FormatModel.deleteRange(next, Sel(Pos(b, from, key.cell), Pos(b, to, key.cell))).blocks
        val keep = pending?.second
        var caretAt = from
        if (inserted.isNotEmpty()) {
            val content = contentOf(next[b], key.cell) ?: emptyList()
            val marks = keep ?: FormatModel.marksAt(content, from)
            next = FormatModel.insertAt(next, Pos(b, from, key.cell), listOf(Inline.Text(inserted, marks))).blocks
            caretAt = from + inserted.length
        }
        remember(typing = true)
        blocks = next
        val now = fieldText(blocks[b], key.cell) ?: ""
        if (v != null && v.text == now) {
            values[key] = v
            sel = Sel(Pos(b, v.selection.start, key.cell), Pos(b, v.selection.end, key.cell))
        } else {
            sel = FormatModel.caret(b, caretAt, key.cell)
            values[key] = TextFieldValue(now, TextRange(caretAt))
        }
        // marks chosen at the caret last for as long as the typing goes on there
        pending = keep?.let { sel.focus to it }
        onChange?.invoke()
    }

    /** Text typed at the caret (over a selection), from the toolbar or a paste: surface.ts typeText. */
    private fun typeText(text: String) {
        var next = blocks
        var s = sel
        if (!FormatModel.collapsed(s)) {
            val e = FormatModel.deleteRange(next, s)
            next = e.blocks
            s = e.sel
        }
        val at = s.focus
        val content = contentOf(next.getOrNull(at.b), at.cell) ?: emptyList()
        val keep = pending?.second
        val marks = keep ?: FormatModel.marksAt(content, at.o)
        val e = FormatModel.insertAt(next, at, listOf(Inline.Text(text, marks)))
        remember(typing = true)
        apply(e.blocks, e.sel, record = false)
        if (keep != null) pending = sel.focus to keep
    }

    /** Enter: surface.ts enter(). */
    fun enter() {
        val (from, _) = FormatModel.ordered(sel)
        var next = blocks
        var at = from
        if (!FormatModel.collapsed(sel)) {
            val e = FormatModel.deleteRange(next, sel)
            next = e.blocks
            at = e.sel.focus
        }
        val block = next.getOrNull(at.b)
        if (block is TableBlock && at.cell != null) {
            // Enter in a table moves down a row, adding one at the bottom
            val (r, c) = at.cell
            var out = next
            if (r + 1 >= block.rows.size) out = FormatModel.editTable(next, at.b, FormatModel.TableOp.AddRow(block.rows.size))
            apply(out, FormatModel.caret(at.b, 0, (r + 1) to c))
            return
        }
        // a line typed as ```js or --- becomes a code block or a rule on Enter
        if (block is TextBlock && block.textKind == TextKind.P && block.wrap != Wrap.QUOTE) {
            val only = block.content.singleOrNull()
            val line = when {
                block.content.isEmpty() -> ""
                only is Inline.Text && only.marks == Marks.NONE -> only.text
                else -> null
            }
            val fence = line?.let { Regex("^```([a-zA-Z0-9_+-]*)$").find(it) }
            if (fence != null && at.o == line.length) {
                val out = next.toMutableList()
                out[at.b] = CodeBlock(FormatModel.newId(), block.wrap, fence.groupValues[1], "")
                if (out.getOrNull(at.b + 1) !is TextBlock) out.add(at.b + 1, FormatModel.textBlock(TextKind.P, emptyList(), block.wrap))
                apply(out, FormatModel.caret(at.b, 0))
                return
            }
            if (line == "---" && at.o == 3) {
                val out = next.toMutableList()
                out.removeAt(at.b)
                out.addAll(at.b, listOf(RuleBlock(FormatModel.newId(), block.wrap), FormatModel.textBlock(TextKind.P, emptyList(), block.wrap)))
                apply(out, FormatModel.caret(at.b + 1, 0))
                return
            }
        }
        val e = FormatModel.splitAt(next, at)
        apply(e.blocks, e.sel)
    }

    /**
     * Markdown typed at the start of a line turns the line into what it says,
     * on the space after it: "- " a list, "1. " a numbered one, "[] " a
     * checklist, "# " a heading, "> " a quote, "-# " small print.
     */
    private fun shortcut(b: Int, o: Int, cell: Pair<Int, Int>?): Boolean {
        if (cell != null) return false
        val block = blocks.getOrNull(b) as? TextBlock ?: return false
        if (block.textKind != TextKind.P) return false
        val before = block.content.joinToString("") { if (it is Inline.Text) it.text else "\u0000" }.take(o)
        fun list(ordered: Boolean, task: Boolean, checked: Boolean, start: Int?): (TextBlock) -> TextBlock = { t ->
            t.copy(textKind = TextKind.LI, wrap = if (t.wrap == Wrap.QUOTE) null else t.wrap, list = ListInfo(ordered, task, checked, 0, start))
        }
        val numbered = Regex("^(\\d{1,9})[.)]$").find(before)
        val hashes = Regex("^(#{1,6})$").find(before)
        val make: ((TextBlock) -> TextBlock)? = when {
            Regex("^[-*]$").matches(before) -> list(false, false, false, null)
            numbered != null -> numbered.groupValues[1].toLong().let { n -> list(true, false, false, if (n == 1L) null else n.toInt()) }
            Regex("^\\[ ?]$").matches(before) -> list(false, true, false, null)
            Regex("^\\[[xX]]$").matches(before) -> list(false, true, true, null)
            hashes != null -> { t -> t.copy(textKind = TextKind.heading(hashes.groupValues[1].length), wrap = if (t.wrap == Wrap.QUOTE) null else t.wrap) }
            before == ">" -> { t -> t.copy(wrap = Wrap.QUOTE) }
            before == "-#" -> { t -> t.copy(textKind = TextKind.SUBTEXT) }
            else -> null
        }
        if (make == null) return false
        val out = blocks.toMutableList()
        out[b] = make(block.copy(content = FormatModel.spliceInline(block.content, 0, o, emptyList())))
        apply(out, FormatModel.caret(b, 0))
        return true
    }

    /**
     * A key from a hardware keyboard, applied to the model before the field
     * sees it: several keys can arrive within one frame, before the field
     * has caught up with a change the model made (a shortcut, Enter), so the
     * field's own copy would be out of date. True when it was handled.
     */
    fun hardKey(key: FieldKey, text: String?, enter: Boolean, backspace: Boolean, delete: Boolean): Boolean {
        val b = indexOf(key)
        if (b < 0) return false
        val v = values[key] ?: return false
        val from = minOf(v.selection.start, v.selection.end)
        val to = maxOf(v.selection.start, v.selection.end)
        val block = blocks[b]
        when {
            backspace -> {
                if (from == to && from == 0) return backAtStart(key)
                val start = if (from == to) previousBoundary(v.text, from) else from
                typed(key, b, start, to, "", null)
            }
            delete -> {
                if (from == to && to >= v.text.length) return deleteAtEnd(key)
                val end = if (from == to) nextBoundary(v.text, to) else to
                typed(key, b, from, end, "", null)
            }
            enter -> {
                if (block is CodeBlock) typed(key, b, from, to, "\n", null)
                else {
                    sel = Sel(Pos(b, v.selection.start, key.cell), Pos(b, v.selection.end, key.cell))
                    enter()
                }
            }
            text != null -> typed(key, b, from, to, text, null)
            else -> return false
        }
        return true
    }

    private fun previousBoundary(text: String, at: Int): Int {
        val it = java.text.BreakIterator.getCharacterInstance()
        it.setText(text)
        return it.preceding(at.coerceIn(1, text.length)).coerceAtLeast(0)
    }

    private fun nextBoundary(text: String, at: Int): Int {
        val it = java.text.BreakIterator.getCharacterInstance()
        it.setText(text)
        val n = it.following(at.coerceIn(0, maxOf(0, text.length - 1)))
        return if (n == java.text.BreakIterator.DONE) text.length else n
    }

    /** Backspace with the caret at the start of a field: a list or heading turns plain, then joins the line above. */
    fun backAtStart(key: FieldKey): Boolean {
        val b = indexOf(key)
        if (b < 0 || key.cell != null) return key.cell != null
        val e = FormatModel.joinBackward(blocks, b)
        apply(e.blocks, e.sel)
        return true
    }

    /** Delete with the caret at the end of a field: the next line joins this one. */
    fun deleteAtEnd(key: FieldKey): Boolean {
        val b = indexOf(key)
        if (b < 0 || key.cell != null) return key.cell != null
        val e = FormatModel.joinForward(blocks, b)
        apply(e.blocks, e.sel)
        return true
    }

    /** Tab in a table: the next cell, a new row past the last. */
    fun moveCell(key: FieldKey, step: Int) {
        val b = indexOf(key)
        val table = blocks.getOrNull(b) as? TableBlock ?: return
        val (r, c) = key.cell ?: return
        val cols = table.align.size
        val k = r * cols + c + step
        if (k < 0) return
        if (k >= table.rows.size * cols) {
            val out = FormatModel.editTable(blocks, b, FormatModel.TableOp.AddRow(table.rows.size))
            apply(out, FormatModel.caret(b, 0, table.rows.size to 0))
            return
        }
        sel = FormatModel.caret(b, 0, (k / cols) to (k % cols))
        sync(force = true)
        focusCaret()
    }

    /** Puts the caret at the end of the document (a tap below the last line). */
    fun focusEnd() {
        val last = blocks.lastIndex
        val block = blocks[last]
        if (block !is TextBlock) {
            apply(blocks + FormatModel.textBlock(TextKind.P, emptyList(), null), FormatModel.caret(last + 1, 0))
            return
        }
        sel = FormatModel.caret(last, FormatModel.sizeAt(blocks, Pos(last, 0)))
        sync(force = true)
        focusCaret()
    }

    /** Ticks or unticks a checklist item from its box. */
    fun toggleChecked(id: Int) {
        val b = blocks.indexOfFirst { it.id == id }
        if (b < 0) return
        apply(FormatModel.toggleChecked(blocks, b), sel)
    }

    // -----------------------------------------------------------------------
    // the toolbar

    fun state(): SurfaceState {
        val (from, to) = FormatModel.ordered(sel)
        val block = blocks.getOrNull(sel.focus.b)
        val flat = FormatModel.collapsed(sel)
        val content = contentOf(block, sel.focus.cell)
        var marks = Marks.NONE
        if (flat) {
            marks = pending?.second ?: content?.let { FormatModel.marksAt(it, sel.focus.o) } ?: Marks.NONE
        } else {
            for (f in Flag.entries) if (FormatModel.selectionHas(blocks, sel) { it[f] }) marks = marks.with(f, true)
            val colours = HashSet<Any?>()
            FormatModel.selectionHas(blocks, sel) { colours += it.color; true }
            if (colours.size == 1) marks = marks.copy(color = colours.first() as? fish.nexa.ui.markdown.format.ColorMark)
        }
        var link: LinkMark? = null
        if (content != null && from.b == to.b && FormatModel.sameCell(from, to)) {
            val around = FormatModel.linkAround(content, sel.focus.o)
            if (around != null && (if (flat) sel.focus.o > around.from && sel.focus.o < around.to else from.o >= around.from && to.o <= around.to)) link = LinkMark(around.url, around.noEmbed)
        }
        val table = (block as? TableBlock)?.let { t ->
            val (r, c) = sel.focus.cell ?: (0 to 0)
            TableAt(r, c, t.rows.size, t.align.size, t.align.getOrNull(c))
        }
        return SurfaceState(
            marks = marks,
            kind = block?.kind,
            list = (block as? TextBlock)?.list,
            wrap = block?.wrap,
            table = table,
            codeLang = (block as? CodeBlock)?.lang,
            link = link,
            collapsed = flat,
            canUndo = canUndo,
            canRedo = canRedo,
            selectedText = FormatModel.selectedRuns(blocks, sel).joinToString("") { if (it is Inline.Text) it.text else (it as Inline.Atom).label },
        )
    }

    /** surface.ts command(). */
    fun command(cmd: Cmd) {
        val s = sel
        val (from, _) = FormatModel.ordered(s)
        val flat = FormatModel.collapsed(s)
        val block = blocks.getOrNull(from.b)
        when (cmd) {
            is Cmd.Mark -> {
                if (flat) {
                    // nothing selected: the next typing takes the mark, as in any word processor
                    val content = contentOf(block, from.cell) ?: return
                    val cur = pending?.second ?: FormatModel.marksAt(content, from.o)
                    pending = from to FormatModel.withMark(cur, cmd.flag, !cur[cmd.flag])
                    focusCaret()
                    return
                }
                val on = !FormatModel.selectionHas(blocks, s) { it[cmd.flag] }
                apply(FormatModel.mapSelection(blocks, s) { FormatModel.withMark(it, cmd.flag, on) }, s)
            }
            is Cmd.Colour -> {
                if (flat) {
                    val content = contentOf(block, from.cell) ?: return
                    val cur = pending?.second ?: FormatModel.marksAt(content, from.o)
                    pending = from to FormatModel.withColor(cur, cmd.part, cmd.value)
                    focusCaret()
                    return
                }
                apply(FormatModel.mapSelection(blocks, s) { FormatModel.withColor(it, cmd.part, cmd.value) }, s)
            }
            is Cmd.Link -> {
                val link = cmd.url?.let { LinkMark(it, false) }
                val content = contentOf(block, from.cell)
                if (flat && content != null) {
                    val around = FormatModel.linkAround(content, from.o)
                    if (around != null && from.o > around.from && from.o < around.to) {
                        // the caret is in a link: change or take off the whole link
                        val whole = Sel(from.copy(o = around.from), from.copy(o = around.to))
                        apply(FormatModel.mapSelection(blocks, whole) { FormatModel.withLink(it, link) }, whole)
                        return
                    }
                    if (link != null) {
                        // nothing selected: the link goes in with its words, or its address as its words
                        val words = cmd.text.trim().ifEmpty { link.url }
                        val marks = FormatModel.withLink(FormatModel.marksAt(content, from.o), link)
                        val e = FormatModel.insertAt(blocks, from, listOf(Inline.Text(words, marks)))
                        apply(e.blocks, e.sel)
                    }
                    return
                }
                apply(FormatModel.mapSelection(blocks, s) { FormatModel.withLink(it, link) }, s)
            }
            is Cmd.Kind -> apply(FormatModel.setKind(blocks, s, cmd.kind), s)
            is Cmd.ListOf -> apply(FormatModel.toggleList(blocks, s, cmd.type), s)
            is Cmd.Indent -> apply(FormatModel.indentBy(blocks, s, cmd.delta), s)
            Cmd.Check -> apply(FormatModel.toggleChecked(blocks, from.b), s)
            is Cmd.WrapIn -> FormatModel.toggleWrap(blocks, s, cmd.wrap).let { apply(it.blocks, it.sel) }
            Cmd.Code -> FormatModel.toggleCode(blocks, s).let { apply(it.blocks, it.sel) }
            is Cmd.Lang -> {
                if (block !is CodeBlock) return
                val out = blocks.toMutableList()
                out[from.b] = block.copy(lang = cmd.lang.replace(LANG_CHARS, "").take(32))
                apply(out, s)
            }
            is Cmd.Table -> FormatModel.insertBlock(blocks, s, FormatModel.emptyTable(maxOf(2, cmd.rows), maxOf(1, cmd.cols))).let { apply(it.blocks, it.sel) }
            is Cmd.TableEdit -> {
                if (block !is TableBlock) return
                val op = cmd.op
                if (op == null) {
                    val out = blocks.toMutableList()
                    out.removeAt(from.b)
                    if (out.getOrNull(from.b) !is TextBlock) out.add(from.b, FormatModel.textBlock(TextKind.P, emptyList(), block.wrap))
                    apply(out, FormatModel.caret(from.b, 0))
                    return
                }
                val out = FormatModel.editTable(blocks, from.b, op)
                val t = out.getOrNull(from.b)
                if (t !is TableBlock) {
                    apply(out, FormatModel.caret(minOf(from.b, out.lastIndex), 0))
                    return
                }
                var (r, c) = from.cell ?: (0 to 0)
                if (op is FormatModel.TableOp.AddRow) r = op.at
                if (op is FormatModel.TableOp.AddCol) c = op.at
                r = minOf(r, t.rows.lastIndex)
                c = minOf(c, t.align.lastIndex)
                apply(out, FormatModel.caret(from.b, 0, r to c))
            }
            Cmd.Rule -> FormatModel.insertBlock(blocks, s, RuleBlock(FormatModel.newId(), null)).let { apply(it.blocks, it.sel) }
            Cmd.Clear -> {
                if (flat) {
                    pending = from to Marks.NONE
                    focusCaret()
                    return
                }
                apply(FormatModel.clearFormatting(blocks, s), s)
            }
            Cmd.Undo -> undo()
            Cmd.Redo -> redo()
            is Cmd.Text -> typeText(cmd.text)
            is Cmd.File -> FormatModel.insertBlock(blocks, s, FileBlock(FormatModel.newId(), null, cmd.file, cmd.name)).let { apply(it.blocks, it.sel) }
            is Cmd.FileWidth -> {
                val at = blocks.indexOfFirst { it.id == cmd.id }
                val file = blocks.getOrNull(at) as? FileBlock ?: return
                val width = fish.nexa.ui.markdown.Markdown.fileWidth(cmd.width.toDouble())
                if (width == file.width) return
                val out = blocks.toMutableList()
                out[at] = file.copy(width = width)
                apply(out, sel)
            }
            is Cmd.RemoveBlock -> {
                val at = blocks.indexOfFirst { it.id == cmd.id }
                if (at < 0) return
                val out = blocks.toMutableList()
                out.removeAt(at)
                // the caret goes where the block was: the start of what took its place, or the end of the line before
                val next = when {
                    out.getOrNull(at) != null && !FormatModel.isVoid(out[at]) -> FormatModel.caret(at, 0)
                    at > 0 -> FormatModel.caret(at - 1, FormatModel.sizeAt(out, Pos(at - 1, 0)))
                    else -> FormatModel.caret(0, 0)
                }
                apply(out, next)
            }
        }
    }

    // -----------------------------------------------------------------------
    // a note written together (surface.ts caretMarkdown, placeOf, reload, cursor, locate)

    /** Whether a word is being composed (an input method, dictation): the document is not swapped under it. */
    val busy: Boolean get() = activeKey?.let { values[it]?.composition } != null

    /** The page changed under the caret without anything being typed (someone else's words came in). */
    var onReload: (() -> Unit)? = null

    private fun signature(block: Block): String = block.kind + "\u0000" + FormatMarkdown.toMarkdown(listOf(block))

    /** A short hash of what a block says (FNV-1a), to find it again in another copy of the note. */
    private fun blockKey(block: Block?): String {
        if (block == null) return ""
        val text = signature(block)
        var h = 0x811c9dc5.toInt()
        for (ch in text) {
            h = h xor ch.code
            h *= 0x01000193
        }
        return (h.toLong() and 0xffffffffL).toString(36)
    }

    /** A block's characters as the caret counts them: an atom is one. */
    private fun counted(block: Block?): String? = when (block) {
        is CodeBlock -> block.text
        is TextBlock -> textOf(block.content)
        else -> null
    }

    /** Where each line of a text starts. */
    private fun lineStarts(text: String): IntArray {
        val out = ArrayList<Int>()
        out += 0
        var i = text.indexOf('\n')
        while (i >= 0) {
            out += i + 1
            i = text.indexOf('\n', i + 1)
        }
        return out.toIntArray()
    }

    /**
     * Where a block's words start on its line of markdown, past what makes the
     * line a heading, an item, a quote: the line ends with the words, written as
     * they are, unless a backslash had to be put before something at their start.
     */
    private fun contentStart(line: String, block: Block): Int {
        if (block !is TextBlock) return -1
        val words = FormatMarkdown.inlineMarkdown(block.content)
        if (line.endsWith(words)) return line.length - words.length
        if (words.isNotEmpty() && line.endsWith(words.substring(1))) return maxOf(0, line.length - words.length - 1)
        return -1
    }

    /**
     * Where the caret is, as an offset into the markdown this page writes,
     * when it can be said exactly: a caret, not a selection, in the text of a
     * block, with no emoji or mention before it on its line. Null otherwise,
     * and while the keyboard is elsewhere.
     */
    fun caretMarkdown(): Int? {
        if (busy || activeKey == null) return null
        val (anchor, focus) = sel
        if (FormatModel.comparePos(anchor, focus) != 0 || focus.cell != null) return null
        val block = blocks.getOrNull(focus.b) ?: return null
        val visible = counted(block) ?: return null
        val lines = java.util.IdentityHashMap<Block, Int>()
        val md = FormatMarkdown.toMarkdown(blocks, lines)
        val line = lines[block] ?: return null
        val starts = lineStarts(md)
        if (block is CodeBlock) {
            // the code starts on the line after its fence, written as it is
            val at = starts.getOrNull(line + 1) ?: return null
            return at + minOf(focus.o, block.text.length)
        }
        val prefix = visible.substring(0, minOf(focus.o, visible.length))
        if (ATOM in prefix) return null
        val from = starts.getOrNull(line) ?: return null
        val text = md.substring(from, (starts.getOrNull(line + 1) ?: (md.length + 1)) - 1)
        var i = contentStart(text, block)
        if (i < 0) return null
        for (ch in prefix) {
            while (i < text.length && text[i] != ch) i++
            if (i >= text.length) return null
            i++
        }
        return from + i
    }

    /** The place an offset into `markdown` names, when that markdown is what these blocks write. */
    private fun placeOf(markdown: String, at: Int): Pos? {
        val lines = java.util.IdentityHashMap<Block, Int>()
        if (FormatMarkdown.toMarkdown(blocks, lines) != markdown) return null
        val starts = lineStarts(markdown)
        // the line the offset is on
        var lo = 0
        var hi = starts.size - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) shr 1
            if (starts[mid] <= at) lo = mid else hi = mid - 1
        }
        for (b in blocks.indices) {
            val block = blocks[b]
            val line = lines[block] ?: continue
            if (block is CodeBlock) {
                val first = starts.getOrNull(line + 1)
                val count = block.text.split('\n').size
                if (first != null && lo >= line + 1 && lo < line + 1 + count) return Pos(b, maxOf(0, minOf(block.text.length, at - first)))
                continue
            }
            if (line != lo || block !is TextBlock) continue
            val visible = counted(block) ?: ""
            val from = starts[line]
            val text = markdown.substring(from, (starts.getOrNull(line + 1) ?: (markdown.length + 1)) - 1)
            val start = contentStart(text, block)
            if (start < 0) return null
            var j = 0
            var i = start
            while (i < at - from && j < visible.length) {
                if (text[i] == visible[j]) j++
                i++
            }
            return Pos(b, j)
        }
        return null
    }

    /**
     * Where a place in the old document is in the new one, when someone
     * else's change replaced it. A place in a block that stayed is the same
     * place. In a block that changed, it stays with the words around it.
     */
    private fun follow(before: List<Block>, next: List<Block>, map: IntArray, p: Pos): Pos {
        val to = map.getOrNull(p.b) ?: return p
        if (to >= 0) return p.copy(b = to)
        // between the nearest blocks that stayed, as far in as it was
        var above = p.b - 1
        while (above >= 0 && map[above] < 0) above--
        var below = p.b + 1
        while (below < before.size && map[below] < 0) below++
        val lo = if (above >= 0) map[above] + 1 else 0
        val hi = if (below < before.size) map[below] - 1 else next.size - 1
        if (hi < lo) {
            // the block is gone with nothing in its place: the end of the one before
            val b = maxOf(0, lo - 1)
            return Pos(b, if (lo > 0) FormatModel.sizeAt(next, Pos(b, 0)) else 0)
        }
        val b = minOf(hi, lo + (p.b - (above + 1)))
        val was = counted(before[p.b])
        val now = counted(next.getOrNull(b))
        if (was == null || now == null || p.cell != null) return Pos(b, 0, if (next.getOrNull(b) is TableBlock) p.cell ?: (0 to 0) else null)
        var pre = 0
        while (pre < was.length && pre < now.length && was[pre] == now[pre]) pre++
        var suf = 0
        while (suf < was.length - pre && suf < now.length - pre && was[was.length - 1 - suf] == now[now.length - 1 - suf]) suf++
        if (p.o <= pre) return Pos(b, p.o)
        if (p.o >= was.length - suf) return Pos(b, now.length - (was.length - p.o))
        return Pos(b, now.length - suf)
    }

    /**
     * Shows other markdown in place of what is here, with the caret kept
     * where it was as nearly as the new text allows: for a note someone else
     * changed while it is open. `caretAt`, when the caller knows it, is
     * exactly where the caret goes, as an offset into the new markdown.
     * Nothing is done while a word is being composed; the caller tries again.
     */
    fun reload(markdown: String, caretAt: Int?): Boolean {
        if (busy) return false
        val had = activeKey != null
        val loaded = FormatMarkdown.fromMarkdown(markdown, labels, files, max)
        val before = blocks
        val next = FormatModel.ensureBlock(loaded.blocks).toMutableList()
        // A block that reads the same as before is the same block: it keeps
        // its field on the page, so only what someone changed is drawn again.
        val map = Alignment.of(before.map(::signature), next.map(::signature))
        map.forEachIndexed { i, j -> if (j >= 0) next[j] = before[i] }
        // A block that changed keeps the id of the one it took the place of,
        // so the line being written in stays the field with the keyboard.
        val used = HashSet<Int>()
        for (j in map) if (j >= 0) used += next[j].id
        var i = 0
        var j = 0
        while (i <= before.size && j <= next.size) {
            var ai = i
            while (ai < before.size && map[ai] < 0) ai++
            val aj = if (ai < before.size) map[ai] else next.size
            var a = i
            var b = j
            while (a < ai && b < aj) {
                val old = before[a]
                if (old::class == next[b]::class && old.id !in used) {
                    next[b] = next[b].withId(old.id)
                    used += old.id
                }
                a++
                b++
            }
            i = ai + 1
            j = aj + 1
        }
        val moved = { p: Pos -> FormatModel.clampPos(next, follow(before, next, map, p)) }
        var s = Sel(moved(sel.anchor), moved(sel.focus))
        // Where the caller says the caret goes, it goes. Without that, someone
        // else's words put in right where the caret was could land on either
        // side of it, and the next letter typed would end up among theirs.
        blocks = next
        val exact = if (had && caretAt != null) placeOf(markdown, caretAt) else null
        if (exact != null) s = FormatModel.caret(exact.b, exact.o)
        sel = s
        pending = null
        past.clear()
        future.clear()
        canUndo = false
        canRedo = false
        stale = null
        val wasKey = activeKey
        sync(force = true)
        // the keyboard follows the caret only when its line is another field now
        if (had && keyAt(sel.focus) != wasKey) focusCaret()
        onReload?.invoke()
        return true
    }

    /** Where this page's caret and selection are, as places another copy of the note can find. */
    fun cursor(): CursorMark = CursorMark(mark(sel.anchor), mark(sel.focus))

    private fun mark(p: Pos): PlaceMark = PlaceMark(p.b, p.o, p.cell, blockKey(blocks.getOrNull(p.b)))

    /**
     * A place from another copy of the note, in this one: the block that says
     * what it said, nearest where it was, or, when none does (it is the one
     * being written in), the block in its place.
     */
    fun locate(m: PlaceMark): Pos? {
        if (m.b < 0 || m.o < 0) return null
        var b = -1
        if (blockKey(blocks.getOrNull(m.b)) == m.k) b = m.b
        else {
            var d = 1
            while (d < 64 && b < 0) {
                if (blockKey(blocks.getOrNull(m.b - d)) == m.k) b = m.b - d
                else if (blockKey(blocks.getOrNull(m.b + d)) == m.k) b = m.b + d
                d++
            }
        }
        if (b < 0) b = minOf(m.b, blocks.size - 1)
        val cell = m.cell?.takeIf { it.first >= 0 && it.second >= 0 }
        return FormatModel.clampPos(blocks, Pos(b, m.o, cell))
    }

    /** Puts the keyboard in the page, at the caret (a tap on the page below the title). */
    fun focus() = focusCaret()

    /** The field a place is in, for a cursor drawn over the page. */
    fun fieldAt(p: Pos): FieldKey? = keyAt(p)
}
