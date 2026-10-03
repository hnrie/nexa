package fish.nexa.ui.markdown

/**
 * Zalgo: letters buried under stacks of combining marks (lib/zalgo.ts). Only
 * the general-purpose marks count, so the marks of a script of its own never
 * do, and any accented letter needs at most two of them. The server keeps the
 * same limit.
 */
object Zalgo {
    /** How many of those marks one letter may carry. */
    const val MOST_STACKED_MARKS = 3

    private fun isMark(c: Char): Boolean =
        c in '̀'..'ͯ' || c in '҃'..'҉' || c in '᪰'..'᫿' || c in '᷀'..'᷿' || c in '⃐'..'⃿' || c in '︠'..'︯'

    /** Whether any letter in `text` carries more marks than one ever needs. */
    fun has(text: String): Boolean {
        var run = 0
        for (c in text) {
            run = if (isMark(c)) run + 1 else 0
            if (run > MOST_STACKED_MARKS) return true
        }
        return false
    }

    /** `text` with each letter's marks cut back to as many as one ever needs. */
    fun clamp(text: String): String {
        if (!has(text)) return text
        val out = StringBuilder(text.length)
        var run = 0
        for (c in text) {
            if (isMark(c)) {
                run++
                if (run <= MOST_STACKED_MARKS) out.append(c)
            } else {
                run = 0
                out.append(c)
            }
        }
        return out.toString()
    }
}

/**
 * A message's markdown laid flat into one line, for a preview of it such as
 * the line over a reply (markdown/flatten.ts). Its formatting stays: bold,
 * italics, underline, strikethrough, colour, spoilers, emoji and mentions. Its
 * blocks give up their shape and keep their words: headings, quotes, lists,
 * callouts and collapsible sections read as their words, a code block as
 * inline code, and rules, footnotes and task boxes go.
 */
object Flatten {
    private val SPACE = Node.Text(" ")

    /** An inline node with any line break inside it turned into a space. */
    private fun oneLine(node: Node): Node {
        if (node is Node.Br) return SPACE
        return if (node is Node.Container) node.withChildren(node.children.map(::oneLine)) else node
    }

    fun inline(nodes: List<Node>): List<Node> {
        val out = ArrayList<Node>()
        fun gap() {
            val last = out.lastOrNull()
            if (last != null && !(last is Node.Text && last.text.isNotEmpty() && Js.isSpace(last.text[last.text.length - 1]))) out += SPACE
        }
        fun walk(list: List<Node>) {
            for (node in list) {
                when (node) {
                    is Node.Paragraph, is Node.Heading, is Node.Subtext, is Node.Quote, is Node.Alert -> {
                        gap()
                        walk((node as Node.Container).children)
                    }
                    is Node.ListBlock -> for (item in node.items) {
                        gap()
                        walk(item)
                    }
                    is Node.Details -> {
                        gap()
                        walk(node.summary)
                        gap()
                        walk(node.children)
                    }
                    is Node.Table -> for (row in listOf(node.head) + node.rows) for (cell in row) {
                        gap()
                        walk(cell)
                    }
                    is Node.CodeBlock -> {
                        val text = Js.trim(collapseSpace(node.text))
                        if (text.isNotEmpty()) {
                            gap()
                            out += Node.Code(text)
                        }
                    }
                    is Node.Br -> gap()
                    is Node.Hr, is Node.File, is Node.Footnotes, is Node.FootnoteRef, is Node.Task -> Unit
                    else -> out += oneLine(node)
                }
            }
        }
        walk(nodes)
        while (out.isNotEmpty() && out[0] === SPACE) out.removeAt(0)
        return out
    }

    /** `text.replace(/\s+/g, " ")`. */
    private fun collapseSpace(s: String): String {
        val out = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            if (Js.isSpace(s[i])) {
                out.append(' ')
                while (i < s.length && Js.isSpace(s[i])) i++
            } else {
                out.append(s[i])
                i++
            }
        }
        return out.toString()
    }
}
