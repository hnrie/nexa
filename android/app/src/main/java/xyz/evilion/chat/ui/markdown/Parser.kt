package xyz.evilion.chat.ui.markdown

/**
 * The parser. It follows web/src/markdown/parse.ts closely enough that a
 * message reads the same in both clients: same emphasis runs, same fences,
 * same mention and timestamp forms.
 */
object Markdown {
    /** Only this much of a message is parsed; a hand-built one can be far longer. */
    private const val MAX_SOURCE = 8000

    private val RE_USER = Regex("^<@!?(\\d{1,32})>")
    private val RE_CHANNEL = Regex("^<#(\\d{1,32})>")
    private val RE_ROLE = Regex("^<@&(\\d{1,32})>")
    private val RE_CUSTOM_EMOJI = Regex("^<(a)?:([a-zA-Z0-9_]{2,32}):(\\d{1,32})>")
    private val RE_TIMESTAMP = Regex("^<t:(-?\\d{1,19})(?::([tTdDfFR]))?>")
    private val RE_ANGLE_URL = Regex("^<(https?://[^\\s>]+)>", RegexOption.IGNORE_CASE)
    private val RE_URL = Regex("^https?://[^\\s<]+", RegexOption.IGNORE_CASE)
    private val RE_MASKED = Regex("^\\[([^\\]\\n]{0,512})\\]\\(\\s*(<[^>\\s]{1,2048}>|[^()\\s]{1,2048})\\s*\\)")
    private val RE_HEADING = Regex("^(#{1,3}) (.*)$")
    private val RE_SUBTEXT = Regex("^-# (.*)$")
    private val RE_LIST = Regex("^( *)(?:([-*])|(\\d{1,9})\\.) +(.*)$")
    /**
     * One emoji: a flag pair, a keycap, or a pictograph with its modifiers and
     * any zero-width-joined parts. Written out in code points rather than
     * Unicode properties, which Java and Android's regex engines disagree on.
     */
    private val RE_EMOJI = Regex(
        "^(?:[\\x{1F1E6}-\\x{1F1FF}]{2}" +
            "|[0-9#*]\\x{FE0F}?\\x{20E3}" +
            "|(?:[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}\\x{2190}-\\x{21FF}" +
            "\\x{00A9}\\x{00AE}\\x{203C}\\x{2049}\\x{2122}\\x{2139}\\x{2934}\\x{2935}\\x{3030}\\x{303D}\\x{3297}\\x{3299}]" +
            "(?:\\x{FE0F}|[\\x{1F3FB}-\\x{1F3FF}])?" +
            "(?:\\x{200D}[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}](?:\\x{FE0F}|[\\x{1F3FB}-\\x{1F3FF}])?)*))",
    )

    fun parse(source: String): List<Node> = blocks(source.take(MAX_SOURCE))

    /** Inline-only, for places with no room for blocks: names, topics, the reply bar. */
    fun parseInline(source: String): List<Node> = inline(source.take(MAX_SOURCE))

    // --- blocks ------------------------------------------------------------

    private fun blocks(source: String): List<Node> {
        val out = mutableListOf<Node>()
        val lines = source.split("\n")
        val paragraph = mutableListOf<String>()
        var i = 0

        fun flush() {
            if (paragraph.isEmpty()) return
            out += Node.Styled(Style.PARAGRAPH, inline(paragraph.joinToString("\n")))
            paragraph.clear()
        }

        while (i < lines.size) {
            val line = lines[i]

            // ```lang … ``` — only a fence that is closed makes a code block
            if (line.trimStart().startsWith("```")) {
                val lang = line.trimStart().removePrefix("```").trim()
                    .takeIf { it.isNotEmpty() && it.all { c -> c.isLetterOrDigit() || c in "+-_#" } }
                var j = i + 1
                val body = mutableListOf<String>()
                var closed = false
                while (j < lines.size) {
                    if (lines[j].trim() == "```") {
                        closed = true
                        break
                    }
                    body += lines[j]
                    j++
                }
                if (closed) {
                    flush()
                    out += Node.CodeBlock(lang, body.joinToString("\n").trim('\n'))
                    i = j + 1
                    continue
                }
            }

            val heading = RE_HEADING.find(line)
            if (heading != null) {
                flush()
                out += Node.Heading(heading.groupValues[1].length, inline(heading.groupValues[2].trim()))
                i++
                continue
            }

            val subtext = RE_SUBTEXT.find(line)
            if (subtext != null) {
                flush()
                out += Node.Subtext(inline(subtext.groupValues[1].trim()))
                i++
                continue
            }

            if (line.startsWith(">>> ")) {
                flush()
                val quoted = mutableListOf(line.removePrefix(">>> "))
                i++
                while (i < lines.size) {
                    quoted += lines[i]
                    i++
                }
                out += Node.Styled(Style.QUOTE, blocks(quoted.joinToString("\n")))
                continue
            }

            if (line.startsWith("> ") || line == ">") {
                flush()
                val quoted = mutableListOf<String>()
                while (i < lines.size && (lines[i].startsWith("> ") || lines[i] == ">")) {
                    quoted += lines[i].removePrefix(">").removePrefix(" ")
                    i++
                }
                out += Node.Styled(Style.QUOTE, blocks(quoted.joinToString("\n")))
                continue
            }

            val bullet = RE_LIST.find(line)
            if (bullet != null) {
                flush()
                val ordered = bullet.groupValues[3].isNotEmpty()
                val depth = bullet.groupValues[1].length / 2
                val start = bullet.groupValues[3].toIntOrNull() ?: 1
                val items = mutableListOf<List<Node>>()
                while (i < lines.size) {
                    val m = RE_LIST.find(lines[i]) ?: break
                    if (m.groupValues[3].isNotEmpty() != ordered || m.groupValues[1].length / 2 != depth) break
                    items += inline(m.groupValues[4])
                    i++
                }
                out += Node.ListBlock(ordered, start, items, depth)
                continue
            }

            if (line.isBlank()) {
                flush()
                i++
                continue
            }

            paragraph += line
            i++
        }
        flush()
        return out
    }

    // --- inline ------------------------------------------------------------

    private fun inline(source: String): List<Node> {
        val out = mutableListOf<Node>()
        val buf = StringBuilder()
        var i = 0

        fun flush() {
            if (buf.isNotEmpty()) {
                out += Node.Text(buf.toString())
                buf.clear()
            }
        }

        fun take(node: Node, length: Int) {
            flush()
            out += node
            i += length
        }

        while (i < source.length) {
            val c = source[i]
            val rest = source.substring(i)

            if (c == '\n') {
                take(Node.Break, 1)
                continue
            }

            // a backslash takes the punctuation after it literally
            if (c == '\\' && i + 1 < source.length && !source[i + 1].isLetterOrDigit()) {
                buf.append(source[i + 1])
                i += 2
                continue
            }

            if (c == '`') {
                val run = runOf(source, i, '`')
                val close = source.indexOf("`".repeat(run), i + run)
                if (close > 0) {
                    take(Node.Code(source.substring(i + run, close).trim()), close + run - i)
                    continue
                }
            }

            if (c == '<') {
                val angle = angleAt(rest)
                if (angle != null) {
                    take(angle.first, angle.second)
                    continue
                }
            }

            if (c == '[') {
                val masked = RE_MASKED.find(rest)
                val url = masked?.groupValues?.get(2)?.removeSurrounding("<", ">")
                if (masked != null && url != null && RE_URL.containsMatchIn(url)) {
                    take(Node.Link(url, inline(masked.groupValues[1]), masked = true), masked.value.length)
                    continue
                }
            }

            if ((c == 'h' || c == 'H') && (rest.startsWith("http://", true) || rest.startsWith("https://", true))) {
                val match = RE_URL.find(rest)
                if (match != null) {
                    val url = match.value.trimEnd('.', ',', ')', '!', '?', ';', ':')
                    take(Node.Link(url, listOf(Node.Text(url)), masked = false), url.length)
                    continue
                }
            }

            if (c == '@' && (rest.startsWith("@everyone") || rest.startsWith("@here"))) {
                val here = rest.startsWith("@here")
                take(Node.Mention(if (here) MentionKind.HERE else MentionKind.EVERYONE), if (here) 5 else 9)
                continue
            }

            if (c == '*' || c == '_' || c == '~' || c == '|') {
                val emphasis = emphasisAt(source, i)
                if (emphasis != null) {
                    take(emphasis.first, emphasis.second - i)
                    continue
                }
            }

            if (c.code > 0x1000 || c.isHighSurrogate()) {
                val emoji = RE_EMOJI.find(rest)
                if (emoji != null && emoji.value.isNotEmpty()) {
                    take(Node.UnicodeEmoji(emoji.value), emoji.value.length)
                    continue
                }
            }

            buf.append(c)
            i++
        }
        flush()
        return out
    }

    /** The `<…>` forms: custom emoji, mentions, timestamps and bare links. */
    private fun angleAt(rest: String): Pair<Node, Int>? {
        RE_CUSTOM_EMOJI.find(rest)?.let {
            return Node.CustomEmoji(it.groupValues[2], it.groupValues[3], it.groupValues[1] == "a") to it.value.length
        }
        RE_USER.find(rest)?.let { return Node.Mention(MentionKind.USER, it.groupValues[1]) to it.value.length }
        RE_ROLE.find(rest)?.let { return Node.Mention(MentionKind.ROLE, it.groupValues[1]) to it.value.length }
        RE_CHANNEL.find(rest)?.let { return Node.Mention(MentionKind.CHANNEL, it.groupValues[1]) to it.value.length }
        RE_TIMESTAMP.find(rest)?.let {
            return Node.Timestamp(it.groupValues[1].toLongOrNull() ?: 0, it.groupValues[2].firstOrNull() ?: 'f') to it.value.length
        }
        RE_ANGLE_URL.find(rest)?.let {
            return Node.Link(it.groupValues[1], listOf(Node.Text(it.groupValues[1])), masked = false) to it.value.length
        }
        return null
    }

    /**
     * `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `||spoiler||`.
     * Runs of asterisks give italic, bold, then both; underscores give italic,
     * underline, then both, exactly as the web client reads them.
     */
    private fun emphasisAt(source: String, start: Int): Pair<Node, Int>? {
        val ch = source[start]
        val run = runOf(source, start, ch)
        if (ch == '~' && run < 2) return null
        if (ch == '|' && run < 2) return null
        val want = when (ch) {
            '~', '|' -> 2
            else -> minOf(run, 3)
        }
        val marker = ch.toString().repeat(want)
        // the closing run has to be at least as long, and cannot open a word
        var at = start + want
        while (at < source.length) {
            val next = source.indexOf(marker, at)
            if (next < 0) return null
            if (next > start + want && source[next - 1] != ' ') {
                val inner = source.substring(start + want, next)
                if (inner.isNotBlank()) {
                    val children = inline(inner)
                    val node = when (ch) {
                        '~' -> Node.Styled(Style.STRIKE, children)
                        '|' -> Node.Styled(Style.SPOILER, children)
                        '*' -> when (want) {
                            1 -> Node.Styled(Style.EM, children)
                            2 -> Node.Styled(Style.STRONG, children)
                            else -> Node.Styled(Style.STRONG, listOf(Node.Styled(Style.EM, children)))
                        }
                        else -> when (want) {
                            1 -> Node.Styled(Style.EM, children)
                            2 -> Node.Styled(Style.UNDERLINE, children)
                            else -> Node.Styled(Style.UNDERLINE, listOf(Node.Styled(Style.EM, children)))
                        }
                    }
                    return node to next + want
                }
            }
            at = next + want
        }
        return null
    }

    private fun runOf(s: String, at: Int, ch: Char): Int {
        var n = 0
        while (at + n < s.length && s[at + n] == ch) n++
        return n
    }

    /** Every link in a message, for the previews the sender generates. */
    fun links(source: String): List<String> =
        Regex("https?://[^\\s<>\"]+", RegexOption.IGNORE_CASE).findAll(source.take(MAX_SOURCE))
            .map { it.value.trimEnd('.', ',', ')', '!', '?', ';', ':') }
            .distinct().toList()

    /** True when a message is only emoji, which the web client draws larger. */
    fun onlyEmoji(nodes: List<Node>): Int {
        var count = 0
        for (node in flatten(nodes)) {
            when (node) {
                is Node.CustomEmoji, is Node.UnicodeEmoji -> count++
                is Node.Text -> if (node.text.isNotBlank()) return 0
                is Node.Break -> Unit
                else -> return 0
            }
        }
        return count
    }

    private fun flatten(nodes: List<Node>): List<Node> = nodes.flatMap { node ->
        when (node) {
            is Node.Styled -> if (node.style == Style.PARAGRAPH) flatten(node.children) else listOf(node)
            else -> listOf(node)
        }
    }
}
