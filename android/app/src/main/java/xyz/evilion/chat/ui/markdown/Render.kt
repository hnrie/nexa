package xyz.evilion.chat.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import coil3.compose.AsyncImage
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.ui.theme.ChatColors
import xyz.evilion.chat.ui.theme.Radius
import xyz.evilion.chat.ui.theme.chatColors
import java.text.DateFormat
import java.util.Date

/** Everything the renderer needs to turn ids into something readable. */
data class MdContext(
    val nameOfUser: (String) -> String? = { null },
    val nameOfChannel: (String) -> String? = { null },
    val roleName: (String) -> Pair<String, Int>? = { null },
    val onUser: (String) -> Unit = {},
    val onChannel: (String) -> Unit = {},
    val onLink: (String) -> Unit = {},
    /** Mentions of this account are highlighted. */
    val meId: String? = null,
    val myRoleIds: Set<String> = emptySet(),
)

/**
 * Draws parsed markdown.
 *
 * Blocks become composables (quotes get their bar, code blocks their box) and
 * everything inline becomes one annotated string per block, with emoji and
 * avatars as inline content.
 */
@Composable
fun MarkdownBlocks(
    nodes: List<Node>,
    ctx: MdContext,
    modifier: Modifier = Modifier,
    emojiSize: Int = 20,
    style: TextStyle = LocalTextStyle.current,
) {
    Column(modifier) {
        for (node in nodes) MarkdownBlock(node, ctx, emojiSize, style)
    }
}

@Composable
private fun MarkdownBlock(node: Node, ctx: MdContext, emojiSize: Int, style: TextStyle) {
    val colors = chatColors
    when (node) {
        is Node.Styled -> when (node.style) {
            Style.PARAGRAPH -> InlineMarkdown(node.children, ctx, emojiSize, style)
            Style.QUOTE -> Row(
                Modifier.padding(vertical = 2.dp).height(IntrinsicSize.Min),
                verticalAlignment = Alignment.Top,
            ) {
                Box(Modifier.width(4.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(colors.borderStrong))
                Spacer(Modifier.width(8.dp))
                Column { for (child in node.children) MarkdownBlock(child, ctx, emojiSize, style) }
            }
            else -> InlineMarkdown(listOf(node), ctx, emojiSize, style)
        }
        is Node.Heading -> InlineMarkdown(
            node.children, ctx, emojiSize + 2,
            style.copy(
                fontSize = when (node.level) {
                    1 -> style.fontSize * 1.5f
                    2 -> style.fontSize * 1.25f
                    else -> style.fontSize * 1.1f
                },
                fontWeight = FontWeight.Bold,
            ),
            Modifier.padding(top = 8.dp, bottom = 2.dp),
        )
        is Node.Subtext -> InlineMarkdown(
            node.children, ctx, emojiSize - 4,
            style.copy(fontSize = style.fontSize * 0.85f, color = colors.textMuted),
        )
        is Node.CodeBlock -> Box(
            Modifier.padding(vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(Radius.xs))
                .background(colors.codeBg).padding(10.dp),
        ) {
            Text(
                node.text,
                style = style.copy(fontFamily = FontFamily.Monospace, fontSize = style.fontSize * 0.9f, color = colors.textSubtle),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            )
        }
        is Node.ListBlock -> Column(Modifier.padding(start = (node.depth * 12).dp, top = 2.dp, bottom = 2.dp)) {
            node.items.forEachIndexed { index, item ->
                Row(verticalAlignment = Alignment.Top) {
                    Text(
                        if (node.ordered) "${node.start + index}." else "•",
                        style = style.copy(color = colors.textMuted),
                        modifier = Modifier.width(if (node.ordered) 22.dp else 14.dp),
                    )
                    InlineMarkdown(item, ctx, emojiSize, style)
                }
            }
        }
        else -> InlineMarkdown(listOf(node), ctx, emojiSize, style)
    }
}

/** One run of inline markdown as a single annotated string. */
@Composable
fun InlineMarkdown(
    nodes: List<Node>,
    ctx: MdContext,
    emojiSize: Int = 20,
    style: TextStyle = LocalTextStyle.current,
    modifier: Modifier = Modifier,
) {
    val colors = chatColors
    var revealed by remember(nodes) { mutableStateOf(setOf<Int>()) }
    val emoji = remember(nodes) { customEmojiIn(nodes) }

    val text = remember(nodes, revealed, colors, style) {
        buildAnnotatedString {
            appendNodes(nodes, SpanStyle(), Render(ctx, colors, style, revealed) { revealed = revealed + it }, IntArray(1))
        }
    }

    val inline = remember(emoji, emojiSize) {
        emoji.associate { node ->
            "emoji:${node.id}" to InlineTextContent(
                Placeholder((emojiSize + 4).sp, (emojiSize + 4).sp, PlaceholderVerticalAlign.TextCenter),
            ) {
                AsyncImage(
                    model = Media.emoji(node.id, if (emojiSize > 32) 128 else 64),
                    contentDescription = ":${node.name}:",
                    modifier = Modifier.size(emojiSize.dp),
                )
            }
        }
    }

    Text(text = text, style = style, inlineContent = inline, modifier = modifier)
}

/** What the builder needs that does not come from the tree itself. */
private class Render(
    val ctx: MdContext,
    val colors: ChatColors,
    val style: TextStyle,
    val revealed: Set<Int>,
    val reveal: (Int) -> Unit,
)

/**
 * Appends one inline tree. `counter` carries the spoiler index between
 * branches, so each spoiler in a message reveals on its own.
 */
private fun AnnotatedString.Builder.appendNodes(
    nodes: List<Node>,
    span: SpanStyle,
    render: Render,
    counter: IntArray,
) {
    val colors = render.colors
    for (node in nodes) {
        when (node) {
            is Node.Text -> withStyle(span) { append(node.text) }
            is Node.Break -> append("\n")
            is Node.Code -> withStyle(
                span.copy(
                    fontFamily = FontFamily.Monospace,
                    background = colors.codeBg,
                    fontSize = render.style.fontSize * 0.92f,
                ),
            ) { append(" ${node.text} ") }

            is Node.Styled -> {
                if (node.style == Style.SPOILER) {
                    val index = counter[0]++
                    val open = index in render.revealed
                    val spoilerSpan = if (open) span else span.copy(color = Color.Transparent, background = colors.spoiler)
                    withLink(
                        LinkAnnotation.Clickable("spoiler:$index", TextLinkStyles(style = spoilerSpan)) {
                            render.reveal(index)
                        },
                    ) { appendNodes(node.children, spoilerSpan, render, counter) }
                } else {
                    val next = when (node.style) {
                        Style.STRONG -> span.copy(fontWeight = FontWeight.Bold)
                        Style.EM -> span.copy(fontStyle = FontStyle.Italic)
                        Style.UNDERLINE -> span.copy(textDecoration = TextDecoration.Underline)
                        Style.STRIKE -> span.copy(textDecoration = TextDecoration.LineThrough)
                        else -> span
                    }
                    appendNodes(node.children, next, render, counter)
                }
            }

            is Node.Link -> withLink(
                LinkAnnotation.Clickable("url:${node.url}", TextLinkStyles(style = span.copy(color = colors.link))) {
                    render.ctx.onLink(node.url)
                },
            ) { appendNodes(node.children, span.copy(color = colors.link), render, counter) }

            is Node.Mention -> {
                val label = when (node.kind) {
                    MentionKind.USER -> "@" + (render.ctx.nameOfUser(node.id) ?: "unknown")
                    MentionKind.CHANNEL -> "#" + (render.ctx.nameOfChannel(node.id) ?: "unknown")
                    MentionKind.ROLE -> "@" + (render.ctx.roleName(node.id)?.first ?: "deleted-role")
                    MentionKind.EVERYONE -> "@everyone"
                    MentionKind.HERE -> "@here"
                }
                val pingsMe = when (node.kind) {
                    MentionKind.USER -> node.id == render.ctx.meId
                    MentionKind.ROLE -> node.id in render.ctx.myRoleIds
                    MentionKind.EVERYONE, MentionKind.HERE -> true
                    else -> false
                }
                val mentionSpan = span.copy(
                    color = if (pingsMe) colors.mentionFg else colors.textBrand,
                    background = if (pingsMe) colors.mentionBg else Color.Transparent,
                    fontWeight = FontWeight.Medium,
                )
                withLink(
                    LinkAnnotation.Clickable("mention:${node.id}", TextLinkStyles(style = mentionSpan)) {
                        when (node.kind) {
                            MentionKind.USER -> render.ctx.onUser(node.id)
                            MentionKind.CHANNEL -> render.ctx.onChannel(node.id)
                            else -> Unit
                        }
                    },
                ) { append(label) }
            }

            is Node.CustomEmoji -> appendInlineContent("emoji:${node.id}", ":${node.name}:")
            is Node.UnicodeEmoji -> withStyle(span.copy(fontSize = render.style.fontSize * 1.15f)) { append(node.text) }
            is Node.Timestamp -> withStyle(span.copy(background = colors.bgActive)) {
                append(formatTimestamp(node.unix, node.style))
            }
            else -> Unit
        }
    }
}

/** Every custom emoji in a tree, so the inline content map can be built once. */
private fun customEmojiIn(nodes: List<Node>): List<Node.CustomEmoji> = buildList {
    fun walk(list: List<Node>) {
        for (node in list) when (node) {
            is Node.CustomEmoji -> add(node)
            is Node.Styled -> walk(node.children)
            is Node.Link -> walk(node.children)
            is Node.Heading -> walk(node.children)
            is Node.Subtext -> walk(node.children)
            is Node.ListBlock -> node.items.forEach { walk(it) }
            else -> Unit
        }
    }
    walk(nodes)
}

/** Discord's timestamp styles: t, T, d, D, f, F and R. */
fun formatTimestamp(unix: Long, style: Char): String {
    val date = Date(unix * 1000)
    return when (style) {
        't' -> DateFormat.getTimeInstance(DateFormat.SHORT).format(date)
        'T' -> DateFormat.getTimeInstance(DateFormat.MEDIUM).format(date)
        'd' -> DateFormat.getDateInstance(DateFormat.SHORT).format(date)
        'D' -> DateFormat.getDateInstance(DateFormat.LONG).format(date)
        'F' -> DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT).format(date)
        'R' -> relative(unix * 1000)
        else -> DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.SHORT).format(date)
    }
}

/** "in 5 minutes", "3 hours ago". */
fun relative(millis: Long): String {
    val delta = millis - System.currentTimeMillis()
    val ahead = delta >= 0
    val seconds = kotlin.math.abs(delta) / 1000
    val (value, unit) = when {
        seconds < 60 -> seconds to "second"
        seconds < 3600 -> seconds / 60 to "minute"
        seconds < 86400 -> seconds / 3600 to "hour"
        seconds < 2592000 -> seconds / 86400 to "day"
        seconds < 31536000 -> seconds / 2592000 to "month"
        else -> seconds / 31536000 to "year"
    }
    val plural = if (value == 1L) unit else "${unit}s"
    return if (ahead) "in $value $plural" else "$value $plural ago"
}
