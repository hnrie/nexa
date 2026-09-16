package xyz.evilion.chat.ui.markdown

/**
 * Discord-flavoured markdown, the same tree web/src/markdown/ast.ts describes.
 *
 * Block nodes (paragraph, quote, heading, subtext, list, codeblock) only ever
 * appear at the top level; everything else is inline and may nest.
 */
sealed interface Node {
    data class Text(val text: String) : Node
    data class Styled(val style: Style, val children: List<Node>) : Node
    data class Code(val text: String) : Node
    data class CodeBlock(val lang: String?, val text: String) : Node
    data class Heading(val level: Int, val children: List<Node>) : Node
    data class Subtext(val children: List<Node>) : Node
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<Node>>, val depth: Int = 0) : Node
    data class Link(val url: String, val children: List<Node>, val masked: Boolean) : Node
    data class Mention(val kind: MentionKind, val id: String = "") : Node
    data class CustomEmoji(val name: String, val id: String, val animated: Boolean) : Node
    data class UnicodeEmoji(val text: String) : Node
    data class Timestamp(val unix: Long, val style: Char) : Node
    data object Break : Node
}

enum class Style { STRONG, EM, UNDERLINE, STRIKE, SPOILER, PARAGRAPH, QUOTE }

enum class MentionKind { USER, CHANNEL, ROLE, EVERYONE, HERE }
