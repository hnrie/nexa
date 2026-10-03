package fish.nexa.ui.markdown

import java.util.Collections
import java.util.IdentityHashMap

/**
 * Nexa's markdown, read exactly as the web reads it (web/src/markdown/parse.ts):
 * the chat syntax people know, with GitHub's blocks on top of it.
 *
 * The parser is a single left-to-right scan. Block constructs are recognised
 * at line starts only; inline constructs are parsed one line at a time, which
 * is what makes `**a\nb**` stay literal. Recursion is capped and every search
 * for a closing marker is bounded or remembered, so adversarial input can
 * neither blow the stack nor go quadratic. Every index is a UTF-16 index, as
 * in JavaScript, and every regular expression of the web's is matched by hand
 * with its exact rules (see [Js] for white space and letters).
 */
object Markdown {
    /** Nesting cap for inline constructs; keeps the parser linear on marker soup. */
    const val MAX_DEPTH = 24
    /** How deep callouts and collapsible sections may hold one another. */
    const val MAX_BLOCK_DEPTH = 4
    /** Lists nest this deep; a deeper item joins the deepest list. */
    const val MAX_LIST_DEPTH = 6
    /** Columns in a table; a wider one stays text, and a row's extra cells are dropped. */
    const val MAX_TABLE_COLS = 24
    /** How far a `^{…}` or `_{…}` looks for its closing brace. */
    const val MAX_BRACE = 256
    /** How far a `[label]` looks for its closing bracket. */
    const val MAX_LABEL = 512
    /** At most this many embeds per message. */
    const val MAX_URLS = 5
    /** Above this many emoji a message is no longer rendered jumbo. */
    const val MAX_JUMBO_EMOJI = 30
    /** Only this much of a message is parsed (a note may ask for more with `max`). */
    const val MAX_SOURCE = 8000
    /** The narrowest a picture in a note may be drawn, in percent of the line. */
    const val FILE_MIN_WIDTH = 15

    /**
     * A message as nodes. `inline` turns every block off (previews), newlines
     * still becoming [Node.Br]; `files` reads a note's file lines; `max` lets a
     * note be longer than a message; `exact` keeps the spaces at the ends of
     * lines, for an editor reading text back into itself.
     */
    fun parse(src: String, inline: Boolean = false, files: Boolean = false, max: Int = 0, exact: Boolean = false): List<Node> {
        val limit = maxOf(MAX_SOURCE, max)
        val text = normalize(if (src.length > limit) src.substring(0, limit) else src)
        if (text.isEmpty()) return emptyList()
        val p = Parser(files, exact)
        val notes = LinkedHashMap<String, Note>()
        val nodes = if (inline) p.parseInline(text, 0) else p.parseBlocks(text, 0, notes)
        return if (text.contains("[^")) p.resolveFootnotes(nodes, notes) else nodes
    }

    /** A picture's width as a note may hold it: a whole percentage, the full line left unsaid. */
    fun fileWidth(w: Double?): Int? {
        if (w == null || w.isNaN() || w.isInfinite()) return null
        val n = Math.round(w).toInt()
        return if (n >= 100) null else maxOf(FILE_MIN_WIDTH, n)
    }

    /** The line that puts a file in a note's text. */
    fun fileLine(id: String, name: String, width: Double? = null): String {
        val w = fileWidth(width)
        val clean = Js.trim(name.replace(Regex("[\\[\\]\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+"), " "))
        return "![" + clean.take(200) + "](nexa-file:" + id + (if (w != null) "?w=$w" else "") + ")"
    }

    private fun normalize(src: String): String {
        val s = if (src.indexOf('\r') >= 0) src.replace("\r\n", "\n").replace('\r', '\n') else src
        // Blank lines at the end go; spaces at the end of the last line with words stay.
        var end = s.length
        for (i in s.length - 1 downTo 0) {
            val c = s[i]
            if (c == '\n') end = i else if (c != ' ' && c != '\t') break
        }
        var start = 0
        while (start < end && s[start] == '\n') start++
        return s.substring(start, end)
    }

    // -----------------------------------------------------------------------
    // derived helpers
    // -----------------------------------------------------------------------

    /** Drops trailing sentence punctuation and unbalanced closing brackets. */
    fun trimUrl(url: String): String {
        var open = 0
        var close = 0
        var openSq = 0
        var closeSq = 0
        for (c in url) {
            when (c) {
                '(' -> open++
                ')' -> close++
                '[' -> openSq++
                ']' -> closeSq++
            }
        }
        var end = url.length
        while (end > 0) {
            val last = url[end - 1]
            if (last == '.' || last == ',' || last == ';' || last == ':' || last == '!' || last == '?') {
                end--
                continue
            }
            if (last == ')' && close > open) {
                close--
                end--
                continue
            }
            if (last == ']' && closeSq > openSq) {
                closeSq--
                end--
                continue
            }
            break
        }
        return url.substring(0, end)
    }

    /** True when a message is nothing but (at most 30) emoji, so it renders jumbo. */
    fun isEmojiOnly(nodes: List<Node>): Boolean {
        var count = 0
        var ok = true
        fun walk(list: List<Node>) {
            for (node in list) {
                if (!ok) return
                when (node) {
                    is Node.Emoji, is Node.UnicodeEmoji -> count++
                    is Node.Text -> if (Js.trim(node.text).isNotEmpty()) ok = false
                    is Node.Br -> Unit
                    is Node.Paragraph -> walk(node.children)
                    else -> ok = false
                }
            }
        }
        walk(nodes)
        return ok && count in 1..MAX_JUMBO_EMOJI
    }

    /** A callout's title in the reader's language: Note, Tip, Important, Warning, Caution. */
    fun alertTitle(kind: AlertKind, tr: (String) -> String = ::translate): String = tr(kind.titleKey)

    /**
     * Human-readable flattening for notifications, replies and search. Without
     * `names`, mentions read as their raw ids; spoilers never give away what
     * they hide.
     */
    fun plainText(nodes: List<Node>, names: NameLookup? = null, tr: (String) -> String = ::translate): String {
        val out = StringBuilder()
        for (node in nodes) {
            if (isBlock(node) && out.isNotEmpty() && out[out.length - 1] != '\n') out.append('\n')
            out.append(nodeText(node, names, tr))
        }
        return out.toString()
    }

    private fun isBlock(node: Node): Boolean = when (node) {
        is Node.Paragraph, is Node.Quote, is Node.Heading, is Node.Subtext, is Node.ListBlock, is Node.CodeBlock,
        is Node.Hr, is Node.Table, is Node.Alert, is Node.Details, is Node.Footnotes, is Node.File -> true
        else -> false
    }

    private fun inlineText(list: List<Node>, names: NameLookup?, tr: (String) -> String): String =
        list.joinToString("") { nodeText(it, names, tr) }

    private fun nodeText(node: Node, names: NameLookup?, tr: (String) -> String): String = when (node) {
        is Node.Text -> node.text
        is Node.Br -> "\n"
        is Node.Code -> node.text
        is Node.CodeBlock -> node.text
        is Node.Spoiler -> tr("render.spoiler")
        is Node.Alert -> {
            val body = plainText(node.children, names, tr)
            alertTitle(node.kind, tr) + (if (body.isNotEmpty()) ": $body" else "")
        }
        is Node.Link -> node.url
        is Node.Container -> inlineText(node.children, names, tr)
        is Node.ListBlock -> node.items.joinToString("\n") { item ->
            item.joinToString("") { child -> if (child is Node.ListBlock) "\n" + nodeText(child, names, tr) else nodeText(child, names, tr) }
        }
        is Node.Task -> if (node.checked) "☑ " else "☐ "
        is Node.Hr -> "---"
        is Node.File -> node.name
        is Node.Table -> (listOf(node.head) + node.rows).joinToString("\n") { row -> row.joinToString(" | ") { inlineText(it, names, tr) } }
        is Node.Details -> {
            val summary = inlineText(node.summary, names, tr).ifEmpty { tr("render.details") }
            val body = plainText(node.children, names, tr)
            summary + (if (body.isNotEmpty()) "\n" + body else "")
        }
        is Node.FootnoteRef -> "[" + node.n + "]"
        is Node.Footnotes -> node.notes.joinToString("\n") { "[" + it.n + "] " + inlineText(it.children, names, tr) }
        is Node.Mention -> when (node.kind) {
            MentionKind.EVERYONE -> "@everyone"
            MentionKind.HERE -> "@here"
            MentionKind.CHANNEL -> "#" + (if (names != null) names.channel(node.id!!)?.takeIf { it.isNotEmpty() } ?: tr("render.unknownChannel") else node.id)
            MentionKind.USER -> {
                if (names == null) "@" + node.id
                else {
                    val user = names.user(node.id!!)
                    "@" + (if (user != null) user.displayName.ifEmpty { user.username }.ifEmpty { tr("render.unknownUser") } else tr("render.unknownUser"))
                }
            }
            MentionKind.ROLE -> "@" + (if (names != null) names.role(node.id!!)?.takeIf { it.isNotEmpty() } ?: tr("render.unknownRole") else node.id)
        }
        is Node.Emoji -> ":" + node.name + ":"
        is Node.UnicodeEmoji -> node.text
        is Node.Timestamp -> "<t:" + Js.numberToString(node.unix) + ":" + node.style + ">"
    }

    /** The http(s) links that would produce an embed, in order, each once, at most five. */
    fun extractUrls(src: String): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        fun walk(list: List<Node>) {
            for (node in list) {
                if (out.size >= MAX_URLS) return
                when (node) {
                    is Node.Link -> if (!node.noEmbed && isHttp(node.url) && seen.add(node.url)) out += node.url
                    // a preview would show what the spoiler hides, or open what the author folded away
                    is Node.Spoiler -> Unit
                    is Node.Container -> walk(node.children)
                    is Node.ListBlock -> for (item in node.items) walk(item)
                    is Node.Table -> {
                        for (cell in node.head) walk(cell)
                        for (row in node.rows) for (cell in row) walk(cell)
                    }
                    is Node.Footnotes -> for (note in node.notes) walk(note.children)
                    else -> Unit
                }
            }
        }
        walk(parse(src))
        return out
    }

    /**
     * Whether a masked link's label names a different site from the one it
     * goes to ("[bank.example](https://elsewhere.example)"). Shown masked, the
     * label is all anyone sees on a phone.
     */
    fun misleadingLabel(label: String, url: String): Boolean {
        val shownRaw = labelHost(Js.trim(label)) ?: return false
        val real = WebUrl.parse(url)?.hostname?.let(::bareHost) ?: return true
        val shown = bareHost(shownRaw)
        return shown != real && !real.endsWith(".$shown")
    }

    /** The site a link goes to, as people know it: no scheme, no "www."; null when it is no address. */
    fun linkHost(url: String): String? = WebUrl.parse(url)?.hostname?.lowercase()?.removePrefix("www.")?.ifEmpty { null }

    /**
     * The site a masked link names after its words, unless they already name
     * it (render.tsx): the tooltip that would say so shows on no phone.
     */
    fun maskedHost(link: Node.Link): String? {
        if (!link.masked) return null
        val host = linkHost(link.url) ?: return null
        val words = Js.lower(plainText(link.children, null) { it }).replace(WWW_WORD, "")
        return if (words.contains(host)) null else host
    }

    private val WWW_WORD = Regex("(?<![A-Za-z0-9_])www\\.")

    private fun bareHost(host: String): String = Js.lower(host).removePrefix("www.")

    internal fun isHttp(url: String): Boolean {
        // /^https?:\/\/\S/i
        var j = 0
        if (!Js.regionMatchesAsciiIgnoreCase(url, 0, "http")) return false
        j = 4
        if (j < url.length && (url[j] == 's' || url[j] == 'S')) j++
        if (!url.startsWith("://", j)) {
            // `https?` gives back its s when `://` does not follow it
            if (j == 5 && url.startsWith("://", 4)) j = 4 else return false
        }
        j += 3
        return j < url.length && !Js.isSpace(url[j])
    }

    /**
     * RE_LABEL_HOST: the first host name written into a label, with or without
     * its scheme, as /(?:^|[\s(<[])(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?=[/:\s)>\]?#]|$)/iu finds it.
     */
    private fun labelHost(s: String): String? {
        var p = 0
        while (p <= s.length) {
            // the start of the string, then one of [\s(<[] consumed
            if (p == 0) hostFrom(s, 0)?.let { return it }
            if (p < s.length) {
                val c = s[p]
                if (Js.isSpace(c) || c == '(' || c == '<' || c == '[') hostFrom(s, p + 1)?.let { return it }
            }
            p += if (p < s.length && Character.isHighSurrogate(s[p]) && p + 1 < s.length && Character.isLowSurrogate(s[p + 1])) 2 else 1
        }
        return null
    }

    private fun hostFrom(s: String, at: Int): String? {
        // (?:https?:\/\/)? is greedy: with the scheme first, then without it
        val scheme = schemeLength(s, at)
        if (scheme > 0) hostAt(s, at + scheme)?.let { return it }
        return hostAt(s, at)
    }

    private fun schemeLength(s: String, at: Int): Int {
        if (!Js.regionMatchesAsciiIgnoreCase(s, at, "http")) return 0
        var j = at + 4
        if (j < s.length && (s[j] == 's' || s[j] == 'S') && s.startsWith("://", j + 1)) return j + 4 - at
        return if (s.startsWith("://", j)) j + 3 - at else 0
    }

    private fun cpAt(s: String, i: Int): Int = s.codePointAt(i)

    private fun isHostChar(cp: Int) = cp == '-'.code || (cp != '_'.code && Js.isWordCodePoint(cp))

    /** `((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?=[/:\s)>\]?#]|$)` at `at`. */
    private fun hostAt(s: String, at: Int): String? {
        // the ends of each `label.` in turn
        val ends = ArrayList<Int>()
        var q = at
        while (true) {
            var j = q
            while (j < s.length) {
                val cp = cpAt(s, j)
                if (!isHostChar(cp)) break
                j += Character.charCount(cp)
            }
            if (j == q || j >= s.length || s[j] != '.') break
            q = j + 1
            ends += q
        }
        for (k in ends.indices.reversed()) {
            val from = ends[k]
            var j = from
            var letters = 0
            while (j < s.length) {
                val cp = cpAt(s, j)
                if (!Js.isLetterCodePoint(cp)) break
                j += Character.charCount(cp)
                letters++
            }
            if (letters < 2) continue
            val ok = j == s.length || s[j].let { it == '/' || it == ':' || Js.isSpace(it) || it == ')' || it == '>' || it == ']' || it == '?' || it == '#' }
            if (ok) return s.substring(at, j)
        }
        return null
    }

    internal fun translate(key: String): String = fish.nexa.ui.t(key)

    // -----------------------------------------------------------------------
    // one parse
    // -----------------------------------------------------------------------

    /** A footnote's definition, kept where it was written until we know whether anything points at it. */
    internal class Note(val node: Node, val shown: MutableList<Node>, val parent: MutableList<Node>, val children: MutableList<Node>)

    private class ListFrame(val ordered: Boolean, val start: Int, val items: MutableList<MutableList<Node>>, val indent: Int)

    private class AlertLines(val kind: AlertKind, val lines: MutableList<String>)

    private class Hit(val nodes: List<Node>, val end: Int)

    private class Fence(val lang: String?, val from: Int, val to: Int, val end: Int)

    @Suppress("UNCHECKED_CAST")
    private fun List<Node>.mut(): MutableList<Node> = this as MutableList<Node>

    /** The state of one parse: whether file lines are read, and whether line-end spaces are kept. */
    private class Parser(val filesOn: Boolean, val exactOn: Boolean) {
        /** Trims what the editor gives back exactly: only the spaces at the start. */
        fun trimRead(s: String): String = if (exactOn) s.trimStart(' ', '\t') else Js.trim(s)

        fun parseBlocks(src: String, depth: Int, notes: LinkedHashMap<String, Note>): MutableList<Node> {
            val out = ArrayList<Node>()
            var paraLines = ArrayList<String>()
            var quoteLines: ArrayList<String>? = null
            var alert: AlertLines? = null
            var lists: ArrayList<ListFrame>? = null
            val nested = depth < MAX_BLOCK_DEPTH

            fun flushPara() {
                if (paraLines.isEmpty()) return
                out += Node.Paragraph(parseInline(paraLines.joinToString("\n"), 0))
                paraLines = ArrayList()
            }

            fun flushQuote() {
                alert?.let {
                    out += Node.Alert(it.kind, parseBlocks(trimBlankLines(it.lines.joinToString("\n")), depth + 1, notes))
                    alert = null
                }
                val q = quoteLines ?: return
                out += Node.Quote(parseInline(q.joinToString("\n"), 0))
                quoteLines = null
            }

            fun flushList() {
                val stack = lists ?: return
                while (stack.size > 1) closeFrame(stack)
                stack.firstOrNull()?.let { out += listNode(it) }
                lists = null
            }

            fun flushAll() {
                flushPara()
                flushQuote()
                flushList()
            }

            var i = 0
            var atLineStart = true
            while (i < src.length) {
                val eol = src.indexOf('\n', i)
                val lineEnd = if (eol < 0) src.length else eol
                val line = src.substring(i, lineEnd)

                if (atLineStart) {
                    // fenced code block
                    if (line.startsWith("```")) {
                        flushAll()
                        val next = readFence(src, i, out)
                        if (next >= src.length) {
                            i = src.length
                        } else if (src[next] == '\n') {
                            i = next + 1
                        } else {
                            i = next
                            atLineStart = false
                        }
                        continue
                    }
                    // >>> block quote: swallows the rest of the message
                    if (line == ">>>" || line.startsWith(">>> ")) {
                        flushAll()
                        val body = src.substring(i + if (line == ">>>") 3 else 4)
                        val callout = if (nested && line != ">>>") alertLine(line.substring(4)) else null
                        if (callout != null) {
                            val rest = (callout.second ?: "") + src.substring(lineEnd)
                            out += Node.Alert(callout.first, parseBlocks(trimBlankLines(rest), depth + 1, notes))
                        } else {
                            out += Node.Quote(parseInline(body, 0))
                        }
                        i = src.length
                        continue
                    }
                    // > quote, and a quote whose first line is [!NOTE] is a callout
                    if (line == ">" || line.startsWith("> ")) {
                        flushPara()
                        flushList()
                        val content = if (line == ">") "" else line.substring(2)
                        val a = alert
                        val q = quoteLines
                        if (a != null) a.lines += content
                        else if (q != null) q += content
                        else {
                            val callout = if (nested) alertLine(content) else null
                            if (callout != null) alert = AlertLines(callout.first, arrayListOf(callout.second ?: ""))
                            else quoteLines = arrayListOf(content)
                        }
                        i = lineEnd + 1
                        continue
                    }
                    val heading = headingLine(line)
                    if (heading != null) {
                        flushAll()
                        val words = stripHeadingClose(trimRead(heading.second))
                        out += Node.Heading(heading.first, parseInline(words, 0))
                        i = lineEnd + 1
                        continue
                    }
                    val subtext = subtextLine(line)
                    if (subtext != null) {
                        flushAll()
                        out += Node.Subtext(parseInline(trimRead(subtext), 0))
                        i = lineEnd + 1
                        continue
                    }
                    // a note's file, on a line of its own
                    val file = if (filesOn && line.startsWith("![")) fileLine(line) else null
                    if (file != null) {
                        flushAll()
                        out += file
                        i = lineEnd + 1
                        continue
                    }
                    // a rule: --- or *** or ___, before lists so that `- - -` is one too
                    if (isRule(line)) {
                        flushAll()
                        out += Node.Hr
                        i = lineEnd + 1
                        continue
                    }
                    val item = listLine(line)
                    if (item != null) {
                        val indent = columns(item.indent)
                        val ordered = item.number != null
                        val start = if (ordered) item.number!!.toInt() else 1
                        val content = itemContent(trimRead(item.content))
                        flushPara()
                        flushQuote()
                        val stack = lists
                        if (stack == null) {
                            lists = arrayListOf(ListFrame(ordered, start, arrayListOf(content), indent))
                        } else {
                            // back out of the lists this item is not further in than
                            while (stack.size > 1 && indent <= stack[stack.size - 2].indent) closeFrame(stack)
                            val top = stack[stack.size - 1]
                            if (indent > top.indent && stack.size < MAX_LIST_DEPTH) {
                                stack += ListFrame(ordered, start, arrayListOf(content), indent)
                            } else {
                                if (top.ordered == ordered) top.items += content
                                else if (stack.size == 1) {
                                    // switching marker kind starts a new list
                                    flushList()
                                    lists = arrayListOf(ListFrame(ordered, start, arrayListOf(content), indent))
                                } else {
                                    closeFrame(stack)
                                    stack += ListFrame(ordered, start, arrayListOf(content), indent)
                                }
                            }
                        }
                        i = lineEnd + 1
                        continue
                    }
                    // ::: details Summary … :::
                    val details = if (nested) detailsOpen(line) else null
                    if (details != null) {
                        flushAll()
                        val body = detailsBody(src, lineEnd)
                        out += Node.Details(parseInline(trimRead(details.summary ?: ""), 0), parseBlocks(trimBlankLines(body.first), depth + 1, notes))
                        i = body.second
                        continue
                    }
                    // [^1]: a footnote
                    val def = footnoteDef(line)
                    if (def != null) {
                        flushAll()
                        val label = Js.lower(def.first)
                        val children = parseInline(line.substring(def.second), 0)
                        // shown as typed until something refers to it
                        val shown = ArrayList<Node>(children.size + 1)
                        shown += Node.Text(line.substring(0, def.second))
                        shown += children
                        mergeText(shown)
                        val node = Node.Paragraph(shown)
                        out += node
                        if (!notes.containsKey(label)) notes[label] = Note(node, shown, out, children)
                        i = lineEnd + 1
                        continue
                    }
                    // | a | b | over |---|---| is a table
                    val table = readTable(src, i, lineEnd)
                    if (table != null) {
                        flushAll()
                        out += table.first
                        i = table.second
                        continue
                    }
                }

                // plain paragraph line
                flushQuote()
                flushList()
                paraLines += line
                i = lineEnd + 1
                atLineStart = true
            }

            flushAll()
            return out
        }

        private fun listNode(frame: ListFrame): Node = Node.ListBlock(frame.ordered, frame.start, frame.items)

        /** Closes the innermost open list into its parent's last item. */
        private fun closeFrame(stack: ArrayList<ListFrame>) {
            val done = stack.removeAt(stack.size - 1)
            val parent = stack.lastOrNull() ?: return
            val last = parent.items.lastOrNull()
            if (last != null) last += listNode(done) else parent.items += arrayListOf(listNode(done))
        }

        /** How many columns of indentation a line starts with; a tab reaches the next multiple of four. */
        private fun columns(indent: String): Int {
            var col = 0
            for (c in indent) col = if (c == '\t') col + 4 - col % 4 else col + 1
            return col
        }

        /** A list item's words: a task box first, when it starts with `[ ]` or `[x]`. */
        private fun itemContent(raw: String): MutableList<Node> {
            // /^\[([ xX])\](?:[ \t]+(.*))?$/
            if (raw.length >= 3 && raw[0] == '[' && (raw[1] == ' ' || raw[1] == 'x' || raw[1] == 'X') && raw[2] == ']') {
                val checked = raw[1] != ' '
                if (raw.length == 3) return arrayListOf<Node>(Node.Task(checked)).apply { addAll(parseInline(trimRead(""), 0)) }
                if (raw[3] == ' ' || raw[3] == '\t') {
                    var j = 3
                    while (j < raw.length && (raw[j] == ' ' || raw[j] == '\t')) j++
                    val rest = raw.substring(j)
                    if (Js.noLineTerminator(rest)) {
                        val out = arrayListOf<Node>(Node.Task(checked))
                        out.addAll(parseInline(trimRead(rest), 0))
                        return out
                    }
                }
            }
            return parseInline(raw, 0)
        }

        /** The inside of a callout or collapsible section, without the blank lines around it. */
        private fun trimBlankLines(src: String): String {
            val end = if (exactOn && Js.trim(src).isNotEmpty()) dropTrailingBlankLines(src) else Js.trimEnd(src)
            return dropLeadingBlankLines(end)
        }

        /** `/(?:\n[ \t]*)+$/` replaced by nothing. */
        private fun dropTrailingBlankLines(s: String): String {
            var k = s.length
            while (k > 0 && (s[k - 1] == ' ' || s[k - 1] == '\t' || s[k - 1] == '\n')) k--
            val nl = s.indexOf('\n', k)
            return if (nl < 0) s else s.substring(0, nl)
        }

        /** `/^(?:[ \t]*\n)+/` replaced by nothing. */
        private fun dropLeadingBlankLines(s: String): String {
            var k = 0
            var lastNl = -1
            while (k < s.length && (s[k] == ' ' || s[k] == '\t' || s[k] == '\n')) {
                if (s[k] == '\n') lastNl = k
                k++
            }
            return if (lastNl < 0) s else s.substring(lastNl + 1)
        }

        /**
         * A fenced code block starting at `start`. Three backticks close at the
         * next three; a longer fence waits for a run as long as itself.
         */
        private fun scanFence(src: String, start: Int): Fence {
            val width = maxOf(3, runOf(src, start, '`'))
            val afterFence = start + width
            var langEnd = afterFence
            while (langEnd < src.length && isLangChar(src[langEnd])) langEnd++
            val langRaw = src.substring(afterFence, langEnd)
            val eol = src.indexOf('\n', langEnd)
            val lineEnd = if (eol < 0) src.length else eol
            val lang: String?
            val from: Int
            if (Js.trim(src.substring(langEnd, lineEnd)).isEmpty()) {
                lang = langRaw.ifEmpty { null }
                from = if (eol < 0) src.length else eol + 1
            } else {
                // not a language token, e.g. ```code``` on a single line: it is content
                lang = null
                from = afterFence
            }
            val close = src.indexOf("`".repeat(width), from)
            return if (close < 0) Fence(lang, from, src.length, src.length) else Fence(lang, from, close, close + width)
        }

        private fun isLangChar(c: Char) = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '+' || c == '-'

        /** Reads a fenced code block starting at `start`; returns the index after it. */
        private fun readFence(src: String, start: Int, out: MutableList<Node>): Int {
            val fence = scanFence(src, start)
            var text = src.substring(fence.from, fence.to)
            if (text.endsWith("\n")) text = text.substring(0, text.length - 1)
            out += Node.CodeBlock(fence.lang, text)
            return fence.end
        }

        /**
         * The lines of a `::: details` section up to the `:::` that closes it:
         * sections inside it are counted and code blocks stepped over.
         */
        private fun detailsBody(src: String, lineEnd: Int): Pair<String, Int> {
            val from = lineEnd + 1
            var open = 1
            var k = from
            while (k < src.length) {
                val eol = src.indexOf('\n', k)
                val le = if (eol < 0) src.length else eol
                val l = src.substring(k, le)
                if (l.startsWith("```")) {
                    val after = scanFence(src, k).end
                    val next = src.indexOf('\n', after)
                    k = if (next < 0) src.length else next + 1
                    continue
                }
                if (detailsOpen(l) != null) open++
                else if (isDetailsClose(l)) {
                    open--
                    if (open == 0) return src.substring(from, maxOf(from, k - 1)) to le + 1
                }
                k = le + 1
            }
            return (if (from <= src.length) src.substring(from) else "") to src.length
        }

        // -------------------------------------------------------------------
        // tables
        // -------------------------------------------------------------------

        /** Whether a line has a `|` that is not escaped. */
        private fun hasPipe(line: String): Boolean {
            var j = line.indexOf('|')
            while (j >= 0) {
                var slashes = 0
                while (j - slashes - 1 >= 0 && line[j - slashes - 1] == '\\') slashes++
                if (slashes % 2 == 0) return true
                j = line.indexOf('|', j + 1)
            }
            return false
        }

        /** A table row's cells: a pipe in inline code, an escaped `\|` and a ||spoiler|| do not split a cell. */
        private fun splitRow(line: String): List<String> {
            var s = Js.trim(line)
            if (s.startsWith("|")) s = s.substring(1)
            if (s.endsWith("|") && !s.endsWith("\\|")) s = s.substring(0, s.length - 1)
            val cells = ArrayList<String>()
            var cur = 0
            var j = 0
            while (j < s.length && cells.size <= MAX_TABLE_COLS) {
                val c = s[j]
                if (c == '\\') {
                    j += 2
                    continue
                }
                if (c == '`') {
                    j = skipCode(s, j)
                    continue
                }
                if (c == '|') {
                    if (Js.at(s, j + 1) == '|' && isNonSpace(Js.at(s, j + 2)) && Js.at(s, j + 2) != '|') {
                        val close = findPair(s, j + 2, '|')
                        if (close > j + 2) {
                            j = close + 2
                            continue
                        }
                    }
                    cells += cellText(s.substring(cur, j))
                    cur = j + 1
                    j++
                    continue
                }
                j++
            }
            if (cells.size <= MAX_TABLE_COLS) cells += cellText(s.substring(minOf(cur, s.length)))
            return cells
        }

        /** A cell's words: shown messages trim them; the editor takes off exactly one space each side. */
        private fun cellText(raw: String): String {
            if (!exactOn || Js.trim(raw).isEmpty()) return Js.trim(raw)
            var s = raw
            if (s.startsWith(" ")) s = s.substring(1)
            if (s.endsWith(" ")) s = s.substring(0, s.length - 1)
            return s
        }

        /** The alignment row under a table's header, or null when the line is not one. */
        private fun delimiterRow(line: String): List<Align?>? {
            if (!hasPipe(line) || !line.contains('-')) return null
            val out = ArrayList<Align?>()
            for (cell in splitRow(line)) {
                if (!isDelimiterCell(cell)) return null
                val left = cell.startsWith(":")
                val right = cell.endsWith(":")
                out += if (left && right) Align.CENTER else if (left) Align.LEFT else if (right) Align.RIGHT else null
            }
            return out
        }

        /** /^:?-+:?$/ */
        private fun isDelimiterCell(cell: String): Boolean {
            var j = 0
            if (j < cell.length && cell[j] == ':') j++
            val dashes = j
            while (j < cell.length && cell[j] == '-') j++
            if (j == dashes) return false
            if (j < cell.length && cell[j] == ':') j++
            return j == cell.length
        }

        /** Whether a line would start a block of its own, which ends a table. */
        private fun startsBlock(line: String): Boolean =
            (filesOn && fileLine(line) != null) || line.startsWith("```") || line == ">" || line.startsWith("> ") ||
                line.startsWith(">>>") || headingLine(line) != null || subtextLine(line) != null || isRule(line) ||
                listLine(line) != null || detailsOpen(line) != null || isDetailsClose(line)

        /** A GitHub table: a header row, the row of dashes, and the rows under them up to the first line without a pipe. */
        private fun readTable(src: String, i: Int, lineEnd: Int): Pair<Node, Int>? {
            val header = src.substring(i, lineEnd)
            if (lineEnd >= src.length || !hasPipe(header)) return null
            val nextEnd = src.indexOf('\n', lineEnd + 1)
            val second = src.substring(lineEnd + 1, if (nextEnd < 0) src.length else nextEnd)
            val align = delimiterRow(second) ?: return null
            val headCells = splitRow(header)
            // wider than the cap, it stays text rather than losing columns
            if (headCells.size != align.size || headCells.size > MAX_TABLE_COLS) return null
            val width = align.size
            fun cells(raw: List<String>): List<List<Node>> {
                val row = ArrayList<List<Node>>(width)
                for (c in 0 until width) row += parseLine(raw.getOrNull(c) ?: "", 0)
                return row
            }
            val rows = ArrayList<List<List<Node>>>()
            var k = if (nextEnd < 0) src.length else nextEnd + 1
            while (k < src.length) {
                val eol = src.indexOf('\n', k)
                val le = if (eol < 0) src.length else eol
                val l = src.substring(k, le)
                if (Js.trim(l).isEmpty() || !hasPipe(l) || startsBlock(l)) break
                rows += cells(splitRow(l))
                k = le + 1
            }
            return Node.Table(align, cells(headCells), rows) to minOf(k, src.length + 1)
        }

        // -------------------------------------------------------------------
        // line shapes (the web's anchored expressions)
        // -------------------------------------------------------------------

        /** RE_HEADING: /^(#{1,6})[ \t](.*)$/ */
        fun headingLine(line: String): Pair<Int, String>? {
            var n = 0
            while (n < line.length && line[n] == '#') n++
            if (n < 1 || n > 6 || n >= line.length || (line[n] != ' ' && line[n] != '\t')) return null
            val rest = line.substring(n + 1)
            return if (Js.noLineTerminator(rest)) n to rest else null
        }

        /** RE_HEADING_CLOSE replaced by nothing: a heading's optional closing hashes. */
        private fun stripHeadingClose(words: String): String {
            var t = words.length
            while (t > 0 && (words[t - 1] == ' ' || words[t - 1] == '\t')) t--
            var h = t
            while (h > 0 && words[h - 1] == '#') h--
            if (h == t) return words
            if (h == 0) return ""
            var w = h
            while (w > 0 && (words[w - 1] == ' ' || words[w - 1] == '\t')) w--
            return if (w == h) words else words.substring(0, w)
        }

        /** RE_SUBTEXT: /^-# (.*)$/ */
        fun subtextLine(line: String): String? {
            if (!line.startsWith("-# ")) return null
            val rest = line.substring(3)
            return if (Js.noLineTerminator(rest)) rest else null
        }

        /** RE_HR: up to three spaces, then three or more of one of - * _, spaces between. */
        fun isRule(line: String): Boolean {
            var j = 0
            while (j < line.length && (line[j] == ' ' || line[j] == '\t')) j++
            if (j > 3 || j >= line.length) return false
            val c = line[j]
            if (c != '-' && c != '*' && c != '_') return false
            var count = 0
            while (j < line.length) {
                val d = line[j]
                if (d == c) count++ else if (d != ' ' && d != '\t') return false
                j++
            }
            return count >= 3
        }

        class ListLine(val indent: String, val number: String?, val content: String)

        /** RE_LIST: /^([ \t]*)(?:([-*])|(\d{1,9})([.)]))[ \t]+(.*)$/ */
        fun listLine(line: String): ListLine? {
            var j = 0
            while (j < line.length && (line[j] == ' ' || line[j] == '\t')) j++
            if (j >= line.length) return null
            val indent = line.substring(0, j)
            var number: String? = null
            val c = line[j]
            var k: Int
            if (c == '-' || c == '*') {
                k = j + 1
            } else if (c in '0'..'9') {
                k = j
                while (k < line.length && line[k] in '0'..'9') k++
                if (k - j > 9 || k >= line.length || (line[k] != '.' && line[k] != ')')) return null
                number = line.substring(j, k)
                k++
            } else return null
            if (k >= line.length || (line[k] != ' ' && line[k] != '\t')) return null
            while (k < line.length && (line[k] == ' ' || line[k] == '\t')) k++
            val content = line.substring(k)
            return if (Js.noLineTerminator(content)) ListLine(indent, number, content) else null
        }

        class DetailsOpen(val summary: String?)

        /** RE_DETAILS_OPEN: /^:::[ \t]*details(?:[ \t]+(.*))?$/i */
        fun detailsOpen(line: String): DetailsOpen? {
            if (!line.startsWith(":::")) return null
            var j = 3
            while (j < line.length && (line[j] == ' ' || line[j] == '\t')) j++
            if (!Js.regionMatchesAsciiIgnoreCase(line, j, "details")) return null
            j += 7
            if (j == line.length) return DetailsOpen(null)
            if (line[j] != ' ' && line[j] != '\t') return null
            while (j < line.length && (line[j] == ' ' || line[j] == '\t')) j++
            val rest = line.substring(j)
            return if (Js.noLineTerminator(rest)) DetailsOpen(rest) else null
        }

        /** RE_DETAILS_CLOSE: /^:::[ \t]*$/ */
        fun isDetailsClose(line: String): Boolean {
            if (!line.startsWith(":::")) return false
            for (k in 3 until line.length) if (line[k] != ' ' && line[k] != '\t') return false
            return true
        }

        /** RE_FOOTNOTE_DEF: `[^label]:` and the spaces after it, at the start (the label and the length of the match). */
        fun footnoteDef(line: String): Pair<String, Int>? {
            if (!line.startsWith("[^")) return null
            var j = 2
            while (j < line.length && line[j] != ']' && !Js.isSpace(line[j])) j++
            val len = j - 2
            if (len < 1 || len > 64 || j + 1 >= line.length || line[j] != ']' || line[j + 1] != ':') return null
            val label = line.substring(2, j)
            var k = j + 2
            while (k < line.length && (line[k] == ' ' || line[k] == '\t')) k++
            return label to k
        }

        /** RE_ALERT: /^\[!(note|tip|important|warning|caution)\](?:[ \t]+(.*))?$/i (kind, the words after it). */
        fun alertLine(s: String): Pair<AlertKind, String?>? {
            if (!s.startsWith("[!")) return null
            val close = s.indexOf(']', 2)
            if (close < 0) return null
            val name = s.substring(2, close)
            val kind = AlertKind.entries.firstOrNull { it.key.length == name.length && Js.regionMatchesAsciiIgnoreCase(name, 0, it.key) } ?: return null
            var j = close + 1
            if (j == s.length) return kind to null
            if (s[j] != ' ' && s[j] != '\t') return null
            while (j < s.length && (s[j] == ' ' || s[j] == '\t')) j++
            val rest = s.substring(j)
            return if (Js.noLineTerminator(rest)) kind to rest else null
        }

        /** RE_FILE: a note's file, alone on its line. */
        fun fileLine(line: String): Node.File? {
            if (!line.startsWith("![")) return null
            var k = 2
            while (k < line.length && line[k] != '[' && line[k] != ']' && line[k] != '\n') k++
            if (k >= line.length || line[k] != ']' || k - 2 > 200) return null
            val name = line.substring(2, k)
            val prefix = "(nexa-file:"
            if (!line.startsWith(prefix, k + 1)) return null
            var j = k + 1 + prefix.length
            val idStart = j
            while (j < line.length && (line[j].isAsciiLetterOrDigit() || line[j] == '_' || line[j] == '-')) j++
            if (j == idStart || j - idStart > 64) return null
            val id = line.substring(idStart, j)
            var width: String? = null
            if (j < line.length && line[j] == '?') {
                if (!line.startsWith("?w=", j)) return null
                var d = j + 3
                while (d < line.length && line[d] in '0'..'9') d++
                if (d == j + 3 || d - (j + 3) > 3 || d >= line.length || line[d] != ')') return null
                width = line.substring(j + 3, d)
                j = d
            }
            if (j >= line.length || line[j] != ')') return null
            j++
            while (j < line.length && (line[j] == ' ' || line[j] == '\t')) j++
            if (j != line.length) return null
            return Node.File(id, name, fileWidth(width?.toDouble()))
        }

        private fun Char.isAsciiLetterOrDigit() = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'

        // -------------------------------------------------------------------
        // footnotes
        // -------------------------------------------------------------------

        /**
         * Numbers the references in the order they are first met, moves the
         * notes they point to into a list at the end, and turns a reference
         * with no note back into its text. A note nothing refers to stays where
         * it was written, as typed.
         */
        fun resolveFootnotes(nodes: MutableList<Node>, notes: LinkedHashMap<String, Note>): List<Node> {
            val numbers = HashMap<String, Int>()
            val order = ArrayList<String>()
            // the notes as written are read after the text, so references in the text come first
            val written: MutableSet<Node> = Collections.newSetFromMap(IdentityHashMap())
            for (note in notes.values) written += note.node
            fun walk(list: MutableList<Node>, level: Int) {
                if (level > 64) return
                var merge = false
                for (k in list.indices) {
                    val node = list[k]
                    if (node in written) continue
                    when (node) {
                        is Node.FootnoteRef -> {
                            val label = Js.lower(node.label)
                            if (!notes.containsKey(label)) {
                                list[k] = Node.Text("[^" + node.label + "]")
                                merge = true
                            } else {
                                var n = numbers[label]
                                if (n == null) {
                                    n = order.size + 1
                                    numbers[label] = n
                                    order += label
                                }
                                list[k] = Node.FootnoteRef(node.label, n)
                            }
                        }
                        is Node.ListBlock -> for (item in node.items) walk(item.mut(), level + 1)
                        is Node.Table -> {
                            for (cell in node.head) walk(cell.mut(), level + 1)
                            for (row in node.rows) for (cell in row) walk(cell.mut(), level + 1)
                        }
                        is Node.Details -> {
                            walk(node.summary.mut(), level + 1)
                            walk(node.children.mut(), level + 1)
                        }
                        is Node.Container -> walk(node.children.mut(), level + 1)
                        else -> Unit
                    }
                }
                if (merge) mergeText(list)
            }
            walk(nodes, 0)
            // a note may refer to a note too: each numbered note is read in turn
            var read = 0
            fun drain() {
                while (read < order.size) {
                    walk(notes[order[read]]!!.children, 1)
                    read++
                }
            }
            drain()
            for ((label, note) in notes) {
                if (numbers.containsKey(label)) continue
                // left as typed, but what it refers to still works
                walk(note.shown, 1)
                drain()
            }
            if (order.isEmpty()) return nodes
            val found = ArrayList<Footnote>()
            for (label in order) {
                val note = notes[label]!!
                val at = note.parent.indexOfFirst { it === note.node }
                if (at >= 0) note.parent.removeAt(at)
                found += Footnote(label, numbers[label]!!, note.children)
            }
            nodes += Node.Footnotes(found)
            return nodes
        }

        /** Joins neighbouring text nodes. */
        fun mergeText(list: MutableList<Node>) {
            var k = list.size - 1
            while (k > 0) {
                val a = list[k - 1]
                val b = list[k]
                if (a is Node.Text && b is Node.Text) {
                    list[k - 1] = Node.Text(a.text + b.text)
                    list.removeAt(k)
                }
                k--
            }
        }

        // -------------------------------------------------------------------
        // inline level
        // -------------------------------------------------------------------

        fun parseInline(src: String, depth: Int): MutableList<Node> {
            val out = ArrayList<Node>()
            var start = 0
            while (true) {
                val nl = src.indexOf('\n', start)
                val line = if (nl < 0) src.substring(start) else src.substring(start, nl)
                out.addAll(parseLine(line, depth))
                if (nl < 0) break
                out += Node.Br
                start = nl + 1
            }
            return out
        }

        private fun wrapEmphasis(ch: Char, want: Int, children: List<Node>): Node {
            if (ch == '*') {
                if (want >= 3) return Node.Strong(arrayListOf(Node.Em(children)))
                return if (want == 2) Node.Strong(children) else Node.Em(children)
            }
            if (want >= 3) return Node.U(arrayListOf(Node.Em(children)))
            return if (want == 2) Node.U(children) else Node.Em(children)
        }

        fun parseLine(line: String, depth: Int): MutableList<Node> {
            val out = ArrayList<Node>()
            val buf = StringBuilder()
            fun flush() {
                if (buf.isNotEmpty()) {
                    out += Node.Text(buf.toString())
                    buf.setLength(0)
                }
            }
            // the earliest place a closer search failed from; a later search for the same marker fails too
            val failed = HashMap<String, Int>()

            var i = 0
            while (i < line.length) {
                val c = line[i]

                // escapes
                if (c == '\\' && i + 1 < line.length) {
                    val next = line[i + 1]
                    if (isAsciiPunct(next)) {
                        buf.append(next)
                        i += 2
                        continue
                    }
                }

                // inline code
                if (c == '`') {
                    val run = runOf(line, i, '`')
                    val close = findBacktickClose(line, i + run, run)
                    if (close >= 0) {
                        flush()
                        out += Node.Code(line.substring(i + run, close))
                        i = close + run
                        continue
                    }
                    buf.append(line, i, i + run)
                    i += run
                    continue
                }

                // <...> constructs
                if (c == '<') {
                    val hit = readAngle(line, i)
                    if (hit != null) {
                        flush()
                        out += hit.nodes
                        i = hit.end
                        continue
                    }
                }

                // :shortcode: names
                if (c == ':') {
                    val run = shortcodeRun(line, i + 1)
                    if (run in 1..60 && Js.at(line, i + 1 + run) == ':') {
                        val emoji = Shortcodes.toEmoji(line.substring(i + 1, i + 1 + run))
                        if (emoji != null) {
                            flush()
                            out += Node.UnicodeEmoji(emoji)
                            i += run + 2
                            continue
                        }
                    }
                }

                // unicode emoji (before markers so that *⃣ keycaps win)
                val cc = c.code
                if (cc == 35 || cc == 42 || (cc in 48..57) || cc >= 0xA9) {
                    val len = EmojiMatch.at(line, i)
                    if (len > 0) {
                        flush()
                        out += Node.UnicodeEmoji(line.substring(i, i + len))
                        i += len
                        continue
                    }
                }

                // ^{superscript} and _{subscript}
                if ((c == '^' || c == '_') && Js.at(line, i + 1) == '{' && depth < MAX_DEPTH) {
                    val close = closeBrace(line, i + 1)
                    if (close > i + 2 && Js.trim(line.substring(i + 2, close)).isNotEmpty()) {
                        flush()
                        val kids = parseLine(line.substring(i + 2, close), depth + 1)
                        out += if (c == '^') Node.Sup(kids) else Node.Sub(kids)
                        i = close + 1
                        continue
                    }
                }

                // * _ emphasis
                if ((c == '*' || c == '_') && depth < MAX_DEPTH) {
                    val run = runOf(line, i, c)
                    val want = minOf(run, 3)
                    var canOpen = isNonSpace(Js.at(line, i + want))
                    if (c == '_') canOpen = canOpen && !isWordChar(Js.at(line, i - 1))
                    if (canOpen) {
                        val close = findCloser(line, i + want, c, want, failed)
                        if (close >= 0) {
                            flush()
                            out += wrapEmphasis(c, want, parseLine(line.substring(i + want, close), depth + 1))
                            i = close + want
                            continue
                        }
                    }
                    buf.append(line, i, i + run)
                    i += run
                    continue
                }

                // ~~strike~~ and ||spoiler||
                if ((c == '~' || c == '|') && Js.at(line, i + 1) == c && depth < MAX_DEPTH) {
                    val close = findPair(line, i + 2, c)
                    if (close >= 0) {
                        flush()
                        val kids = parseLine(line.substring(i + 2, close), depth + 1)
                        out += if (c == '~') Node.S(kids) else Node.Spoiler(kids)
                        i = close + 2
                        continue
                    }
                    buf.append(c).append(c)
                    i += 2
                    continue
                }

                // ==highlight==, only between words' edges
                if (c == '=' && Js.at(line, i + 1) == '=') {
                    val run = runOf(line, i, '=')
                    val next = Js.at(line, i + 2)
                    if (run == 2 && depth < MAX_DEPTH && isNonSpace(next) && !isWordChar(Js.at(line, i - 1))) {
                        val close = findMarkClose(line, i + 2, failed)
                        if (close >= 0) {
                            flush()
                            out += Node.Mark(parseLine(line.substring(i + 2, close), depth + 1))
                            i = close + 2
                            continue
                        }
                    }
                    buf.append(line, i, i + run)
                    i += run
                    continue
                }

                // @everyone / @here
                if (c == '@' && !isWordChar(Js.at(line, i - 1))) {
                    if (line.startsWith("@everyone", i)) {
                        flush()
                        out += Node.Mention(MentionKind.EVERYONE, null)
                        i += 9
                        continue
                    }
                    if (line.startsWith("@here", i)) {
                        flush()
                        out += Node.Mention(MentionKind.HERE, null)
                        i += 5
                        continue
                    }
                }

                // [words]{colour}, [masked](link) and [^footnote]
                if (c == '[' && depth < MAX_DEPTH) {
                    val hit = readBracket(line, i, depth)
                    if (hit != null) {
                        flush()
                        out += hit.nodes
                        i = hit.end
                        continue
                    }
                }

                // bare url
                if (c == 'h' || c == 'H') {
                    val m = urlAt(line, i, '<')
                    if (m != null) {
                        val url = trimUrl(m)
                        if (isHttp(url)) {
                            flush()
                            out += Node.Link(url, arrayListOf(Node.Text(url)), masked = false, noEmbed = false)
                            i += url.length
                            continue
                        }
                    }
                }

                buf.append(c)
                i++
            }
            flush()
            return out
        }

        private fun shortcodeRun(s: String, from: Int): Int {
            var j = from
            while (j < s.length) {
                val c = s[j]
                if (c in 'a'..'z' || c in '0'..'9' || c == '_' || c == '+' || c == '-') j++ else break
            }
            return j - from
        }

        /**
         * What a `[` starts: coloured words, a masked link or a footnote
         * reference. Both a colour's words and a link's label may hold one
         * level of [brackets].
         */
        private fun readBracket(line: String, i: Int, depth: Int): Hit? {
            val close = closeBracket(line, i)
            if (close > i && Js.at(line, close + 1) == '{') {
                // RE_COLOR_BRACES: /\{([a-zA-Z0-9# ]{1,40})\}/y
                var j = close + 2
                while (j < line.length && (line[j].isAsciiLetterOrDigit() || line[j] == '#' || line[j] == ' ')) j++
                val len = j - (close + 2)
                if (len in 1..40 && Js.at(line, j) == '}') {
                    val spec = MarkdownColors.parseSpec(line.substring(close + 2, j))
                    if (spec != null) {
                        return Hit(listOf(Node.Color(spec.fg, spec.bg, parseLine(line.substring(i + 1, close), depth + 1))), j + 1)
                    }
                }
            }
            val masked = maskedAt(line, i)
            if (masked != null) {
                maskedLink(masked.first, masked.second, masked.third, depth)?.let { return it }
            }
            if (close > i && Js.at(line, close + 1) == '(') {
                val dest = destAt(line, close + 1)
                if (dest != null) {
                    maskedLink(line.substring(i + 1, close), dest.first, dest.second, depth)?.let { return it }
                }
            }
            if (Js.at(line, i + 1) == '^') {
                // RE_FOOTNOTE_REF: /\[\^([^\]\s]{1,64})\]/y
                var j = i + 2
                while (j < line.length && line[j] != ']' && !Js.isSpace(line[j])) j++
                val len = j - (i + 2)
                // numbered, or turned back into text, once the whole message is read
                if (len in 1..64 && Js.at(line, j) == ']') return Hit(listOf(Node.FootnoteRef(line.substring(i + 2, j), 0)), j + 1)
            }
            return null
        }

        /** RE_MASKED: /\[([^\]\n]{0,512})\]\(\s*(<[^>\s]{1,2048}>|[^()\s]{1,2048})\s*\)/y (label, destination, end). */
        private fun maskedAt(line: String, i: Int): Triple<String, String, Int>? {
            var j = i + 1
            while (j < line.length && line[j] != ']' && line[j] != '\n') j++
            if (j - (i + 1) > 512 || j >= line.length || line[j] != ']') return null
            val label = line.substring(i + 1, j)
            if (Js.at(line, j + 1) != '(') return null
            val dest = destination(line, j + 2, parens = false) ?: return null
            return Triple(label, dest.first, dest.second)
        }

        /** RE_DEST at the `(`: one level of balanced parentheses may be part of the address. */
        private fun destAt(line: String, open: Int): Pair<String, Int>? = destination(line, open + 1, parens = true)

        /** `\s*(<…>|…)\s*\)` from `from`: the destination as written and the index after the `)`. */
        private fun destination(line: String, from: Int, parens: Boolean): Pair<String, Int>? {
            var j = from
            while (j < line.length && Js.isSpace(line[j])) j++
            val start = j
            // <[^>\s]{1,2048}>
            if (Js.at(line, start) == '<') {
                var k = start + 1
                while (k < line.length && line[k] != '>' && !Js.isSpace(line[k])) k++
                val len = k - (start + 1)
                if (len in 1..2048 && Js.at(line, k) == '>') {
                    val end = closeParen(line, k + 1)
                    if (end >= 0) return line.substring(start, k + 1) to end
                }
            }
            val k = if (parens) balancedRun(line, start) else plainRun(line, start)
            if (k <= start) return null
            val end = closeParen(line, k)
            return if (end >= 0) line.substring(start, k) to end else null
        }

        /** [^()\s]{1,2048}: where the run ends, or -1 when it is longer than allowed. */
        private fun plainRun(line: String, start: Int): Int {
            var k = start
            while (k < line.length && line[k] != '(' && line[k] != ')' && !Js.isSpace(line[k])) k++
            return if (k - start > 2048) -1 else k
        }

        /** (?:[^()\s]|\([^()\s]{0,2048}\)){1,2048} */
        private fun balancedRun(line: String, start: Int): Int {
            var k = start
            var items = 0
            while (k < line.length && items < 2048) {
                val c = line[k]
                if (c == '(') {
                    var g = k + 1
                    while (g < line.length && line[g] != '(' && line[g] != ')' && !Js.isSpace(line[g])) g++
                    if (g - (k + 1) > 2048 || g >= line.length || line[g] != ')') break
                    k = g + 1
                } else if (c != ')' && !Js.isSpace(c)) {
                    k++
                } else break
                items++
            }
            return k
        }

        /** `\s*\)` at `k`: the index after the `)`, or -1. */
        private fun closeParen(line: String, k: Int): Int {
            var j = k
            while (j < line.length && Js.isSpace(line[j])) j++
            return if (Js.at(line, j) == ')') j + 1 else -1
        }

        private fun maskedLink(label: String, raw: String, end: Int, depth: Int): Hit? {
            val angled = raw.startsWith("<") && raw.endsWith(">")
            val url = if (angled) raw.substring(1, raw.length - 1) else raw
            if (!isHttp(url)) return null
            if (misleadingLabel(label, url)) {
                // the label says one site and the link goes to another: both are shown
                val nodes = ArrayList<Node>()
                nodes += parseLine(label, depth + 1)
                nodes += Node.Text(" (")
                nodes += Node.Link(url, arrayListOf(Node.Text(url)), masked = false, noEmbed = angled)
                nodes += Node.Text(")")
                return Hit(nodes, end)
            }
            return Hit(listOf(Node.Link(url, parseLine(label, depth + 1), masked = true, noEmbed = angled)), end)
        }

        /** The `]` closing the `[` at `i` within MAX_LABEL, one level of brackets inside; -1 if none. */
        private fun closeBracket(line: String, i: Int): Int {
            val end = minOf(line.length, i + MAX_LABEL + 2)
            var depth = 0
            var j = i
            while (j < end) {
                when (line[j]) {
                    '\\' -> j++
                    '[' -> {
                        depth++
                        if (depth > 2) return -1
                    }
                    ']' -> {
                        depth--
                        if (depth == 0) return j
                    }
                }
                j++
            }
            return -1
        }

        /** The `}` closing the `{` at `i` within MAX_BRACE, counting braces and skipping escapes and code; -1 if none. */
        private fun closeBrace(line: String, i: Int): Int {
            val window = line.substring(i, minOf(line.length, i + MAX_BRACE + 2))
            var depth = 0
            var j = 0
            while (j < window.length) {
                when (window[j]) {
                    '\\' -> j++
                    '`' -> j = skipCode(window, j) - 1
                    '{' -> depth++
                    '}' -> {
                        depth--
                        if (depth == 0) return i + j
                    }
                }
                j++
            }
            return -1
        }

        private fun readAngle(line: String, i: Int): Hit? {
            // RE_ROLE /<@&(\d{1,32})>/y
            if (line.startsWith("<@&", i)) {
                val e = digitsThen(line, i + 3, 32, '>')
                if (e >= 0) return Hit(listOf(Node.Mention(MentionKind.ROLE, line.substring(i + 3, e - 1))), e)
            }
            // RE_USER /<@!?(\d{1,32})>/y
            if (line.startsWith("<@", i)) {
                var j = i + 2
                if (Js.at(line, j) == '!') {
                    val e = digitsThen(line, j + 1, 32, '>')
                    if (e >= 0) return Hit(listOf(Node.Mention(MentionKind.USER, line.substring(j + 1, e - 1))), e)
                } else {
                    val e = digitsThen(line, j, 32, '>')
                    if (e >= 0) return Hit(listOf(Node.Mention(MentionKind.USER, line.substring(j, e - 1))), e)
                }
            }
            // RE_CHANNEL /<#(\d{1,32})>/y
            if (line.startsWith("<#", i)) {
                val e = digitsThen(line, i + 2, 32, '>')
                if (e >= 0) return Hit(listOf(Node.Mention(MentionKind.CHANNEL, line.substring(i + 2, e - 1))), e)
            }
            // RE_CUSTOM_EMOJI /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,32})>/y
            customEmojiAt(line, i, true)?.let { return it }
            customEmojiAt(line, i, false)?.let { return it }
            // RE_TIMESTAMP /<t:(-?\d{1,19})(?::([tTdDfFR]))?>/y
            if (line.startsWith("<t:", i)) {
                var j = i + 3
                if (Js.at(line, j) == '-') j++
                val ds = j
                while (j < line.length && line[j] in '0'..'9') j++
                val n = j - ds
                if (n in 1..19) {
                    val unix = line.substring(i + 3, j).toDouble()
                    val styleChar = Js.at(line, j + 1)
                    if (Js.at(line, j) == ':' && styleChar != null && styleChar in "tTdDfFR" && Js.at(line, j + 2) == '>') {
                        return Hit(listOf(Node.Timestamp(unix, styleChar)), j + 3)
                    }
                    if (Js.at(line, j) == '>') return Hit(listOf(Node.Timestamp(unix, 'f')), j + 1)
                }
            }
            // RE_ANGLE_URL /<(https?:\/\/[^\s>]+)>/iy
            val url = urlAt(line, i + 1, '>')
            if (url != null && Js.at(line, i + 1 + url.length) == '>') {
                return Hit(listOf(Node.Link(url, arrayListOf(Node.Text(url)), masked = false, noEmbed = true)), i + 2 + url.length)
            }
            return null
        }

        private fun customEmojiAt(line: String, i: Int, animated: Boolean): Hit? {
            val prefix = if (animated) "<a:" else "<:"
            if (!line.startsWith(prefix, i)) return null
            val ns = i + prefix.length
            var j = ns
            while (j < line.length && (line[j].isAsciiLetterOrDigit() || line[j] == '_')) j++
            if (j - ns !in 2..32 || Js.at(line, j) != ':') return null
            val e = digitsThen(line, j + 1, 32, '>')
            if (e < 0) return null
            return Hit(listOf(Node.Emoji(line.substring(ns, j), line.substring(j + 1, e - 1), animated)), e)
        }

        /** `\d{1,max}` then `end` at `from`: the index after `end`, or -1. */
        private fun digitsThen(line: String, from: Int, max: Int, end: Char): Int {
            var j = from
            while (j < line.length && line[j] in '0'..'9') j++
            val n = j - from
            return if (n in 1..max && Js.at(line, j) == end) j + 1 else -1
        }

        /** `https?:\/\/[^\s<stop>]+` at `i`, case-insensitive: the text it covers, or null. */
        private fun urlAt(line: String, i: Int, stop: Char): String? {
            if (!Js.regionMatchesAsciiIgnoreCase(line, i, "http")) return null
            var j = i + 4
            if (Js.at(line, j) == 's' || Js.at(line, j) == 'S') {
                if (line.startsWith("://", j + 1)) j += 1
            }
            if (!line.startsWith("://", j)) return null
            j += 3
            val bodyStart = j
            while (j < line.length && line[j] != stop && !Js.isSpace(line[j])) j++
            return if (j > bodyStart) line.substring(i, j) else null
        }

        private fun isAsciiPunct(c: Char) = c in '!'..'/' || c in ':'..'@' || c in '['..'`' || c in '{'..'~'

        private fun isWordChar(c: Char?): Boolean = c != null && Js.isWordUnit(c)

        private fun isNonSpace(c: Char?): Boolean = c != null && !Js.isSpace(c)

        private fun runOf(s: String, i: Int, ch: Char): Int {
            var n = 0
            while (i + n < s.length && s[i + n] == ch) n++
            return n
        }

        private fun findBacktickClose(line: String, from: Int, run: Int): Int {
            var j = from
            while (j < line.length) {
                val k = line.indexOf('`', j)
                if (k < 0) return -1
                val len = runOf(line, k, '`')
                if (len == run) return k
                j = k + len
            }
            return -1
        }

        /** Skips over an inline code span so markers inside it never close a run. */
        private fun skipCode(line: String, j: Int): Int {
            val run = runOf(line, j, '`')
            val close = findBacktickClose(line, j + run, run)
            return if (close >= 0) close + run else j + run
        }

        private fun findCloser(line: String, from: Int, ch: Char, want: Int, failed: HashMap<String, Int>): Int {
            val key = ch.toString() + want
            val mark = failed[key]
            if (mark != null && from >= mark) return -1
            var j = from
            while (j < line.length) {
                val cj = line[j]
                if (cj == '\\') {
                    j += 2
                    continue
                }
                if (cj == '`') {
                    j = skipCode(line, j)
                    continue
                }
                if (cj != ch) {
                    j++
                    continue
                }
                val run = runOf(line, j, ch)
                if (run >= want) {
                    var ok = isNonSpace(Js.at(line, j - 1))
                    if (ch == '_') ok = ok && !isWordChar(Js.at(line, j + run))
                    val startOfCloser = j + run - want
                    if (ok && startOfCloser >= from) return startOfCloser
                }
                j += run
            }
            failed[key] = if (mark == null) from else minOf(mark, from)
            return -1
        }

        /** The `==` closing a highlight: exactly two, after a non-space and not before a word. */
        private fun findMarkClose(line: String, from: Int, failed: HashMap<String, Int>): Int {
            val mark = failed["="]
            if (mark != null && from >= mark) return -1
            var j = from
            while (j < line.length) {
                val cj = line[j]
                if (cj == '\\') {
                    j += 2
                    continue
                }
                if (cj == '`') {
                    j = skipCode(line, j)
                    continue
                }
                if (cj != '=') {
                    j++
                    continue
                }
                val run = runOf(line, j, '=')
                if (run == 2 && j > from && isNonSpace(Js.at(line, j - 1)) && !isWordChar(Js.at(line, j + 2))) return j
                j += run
            }
            failed["="] = if (mark == null) from else minOf(mark, from)
            return -1
        }

        private fun findPair(line: String, from: Int, ch: Char): Int {
            var j = from
            while (j < line.length) {
                val cj = line[j]
                if (cj == '\\') {
                    j += 2
                    continue
                }
                if (cj == '`') {
                    j = skipCode(line, j)
                    continue
                }
                if (cj == ch && Js.at(line, j + 1) == ch) {
                    if (j > from) return j
                    j += 2
                    continue
                }
                j++
            }
            return -1
        }
    }
}

/** Names for mentions in [Markdown.plainText]; without them a mention flattens to its raw id. */
interface NameLookup {
    /** A person's display name and username, or null when unknown. */
    fun user(id: String): UserName?

    /** A channel's name, or null when unknown. */
    fun channel(id: String): String?

    /** A role's name, or null when unknown. */
    fun role(id: String): String?
}

data class UserName(val displayName: String, val username: String)

/** A [NameLookup] over plain maps. */
class MapNames(
    private val users: Map<String, UserName> = emptyMap(),
    private val channels: Map<String, String> = emptyMap(),
    private val roles: Map<String, String> = emptyMap(),
) : NameLookup {
    override fun user(id: String) = users[id]
    override fun channel(id: String) = channels[id]
    override fun role(id: String) = roles[id]
}
