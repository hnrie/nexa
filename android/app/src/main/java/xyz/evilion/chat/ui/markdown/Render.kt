package xyz.evilion.chat.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import coil3.compose.AsyncImage
import xyz.evilion.chat.i18n.Strings
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.media.Twemoji
import xyz.evilion.chat.ui.theme.ChatColors
import xyz.evilion.chat.ui.theme.Radius
import xyz.evilion.chat.ui.theme.chatColors
import java.util.Date
import java.util.Locale

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
 * Blocks become composables (quotes get their bar, code blocks their panel) and
 * everything inline becomes one annotated string per block, with emoji and
 * avatars as inline content.
 *
 * Every size here is the value web/src/styles/markdown.css uses, expressed the
 * same way: a multiple of the surrounding text where the stylesheet says `em`,
 * and a fixed dp where it says px. Reading a message on a phone and on the
 * browser should be the same experience, not a similar one.
 */
@Composable
fun MarkdownBlocks(
    nodes: List<Node>,
    ctx: MdContext,
    modifier: Modifier = Modifier,
    emojiSize: Dp? = null,
    style: TextStyle = LocalTextStyle.current,
    /**
     * The "(edited)" note, if there is one. The web client tucks it onto the
     * end of the last paragraph rather than on a line of its own
     * (`.content > .md-paragraph:last-of-type { display: inline }`), so a
     * two-word message does not become two lines tall for having been fixed.
     */
    edited: String? = null,
) {
    val last = nodes.lastIndex
    val inlineEdit = edited.takeIf { nodes.lastOrNull().let { it is Node.Styled && it.style == Style.PARAGRAPH } }
    Column(modifier) {
        nodes.forEachIndexed { index, node ->
            MarkdownBlock(node, ctx, emojiSize, style, first = index == 0, edited = if (index == last) inlineEdit else null)
        }
        if (edited != null && inlineEdit == null) {
            Text(edited, style = style.copy(fontSize = 10.sp, color = chatColors.textMuted))
        }
    }
}

@Composable
private fun MarkdownBlock(
    node: Node,
    ctx: MdContext,
    emojiSize: Dp?,
    style: TextStyle,
    first: Boolean,
    edited: String? = null,
) {
    val colors = chatColors
    when (node) {
        is Node.Styled -> when (node.style) {
            Style.PARAGRAPH -> InlineMarkdown(node.children, ctx, emojiSize, style, edited = edited)
            // border-inline-start: 4px, then padding-inline: 12px 8px
            Style.QUOTE -> Row(
                Modifier.padding(vertical = 2.dp).height(IntrinsicSize.Min),
                verticalAlignment = Alignment.Top,
            ) {
                Box(Modifier.width(4.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(colors.borderStrong))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.padding(end = 8.dp)) {
                    node.children.forEachIndexed { index, child ->
                        MarkdownBlock(child, ctx, emojiSize, style, first = index == 0)
                    }
                }
            }
            else -> InlineMarkdown(listOf(node), ctx, emojiSize, style)
        }
        // .md-h1/2/3: 1.5em, 1.25em and 1em, all bold, with 16px above — except
        // when the heading opens the message, where the stylesheet drops that
        // to 4px so a message does not start with a hole in it.
        is Node.Heading -> InlineMarkdown(
            node.children, ctx, emojiSize,
            style.copy(
                fontSize = style.fontSize * when (node.level) {
                    1 -> 1.5f
                    2 -> 1.25f
                    else -> 1f
                },
                lineHeight = style.fontSize * when (node.level) {
                    1 -> 1.5f * 1.25f
                    2 -> 1.25f * 1.25f
                    else -> 1.25f
                },
                fontWeight = FontWeight.Bold,
                color = colors.textStrong,
            ),
            Modifier.padding(top = if (first) 4.dp else 16.dp, bottom = if (node.level == 3) 4.dp else 8.dp),
        )
        is Node.Subtext -> InlineMarkdown(
            node.children, ctx, emojiSize,
            style.copy(fontSize = style.fontSize * 0.8125f, color = colors.textMuted),
        )
        is Node.CodeBlock -> CodeBlock(node, style)
        // .md-list: padding-inline-start 24px, .md-list-item: margin 2px 0
        is Node.ListBlock -> Column(Modifier.padding(start = (node.depth * 24).dp, top = 4.dp, bottom = 4.dp)) {
            node.items.forEachIndexed { index, item ->
                Row(Modifier.padding(vertical = 2.dp), verticalAlignment = Alignment.Top) {
                    if (node.ordered) {
                        Text(
                            "${node.start + index}.",
                            style = style,
                            textAlign = TextAlign.End,
                            modifier = Modifier.width(24.dp).padding(end = 5.dp),
                        )
                    } else {
                        // A browser's `disc` marker, which is a filled circle of
                        // about a third of the text size sitting on the middle
                        // of the first line — not the mid-dot character, which
                        // is a fifth of that and reads as a speck.
                        val line = if (style.lineHeight.isSpecified) style.lineHeight.value else style.fontSize.value * 1.375f
                        Box(Modifier.width(24.dp).height(line.dp), Alignment.Center) {
                            Box(
                                Modifier.size((style.fontSize.value * 0.34f).dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(style.color.takeIf { it != Color.Unspecified } ?: colors.text),
                            )
                        }
                    }
                    InlineMarkdown(item, ctx, emojiSize, style, Modifier.weight(1f))
                }
            }
        }
        else -> InlineMarkdown(listOf(node), ctx, emojiSize, style)
    }
}

/**
 * A fenced block: one rounded panel around the whole thing.
 *
 * It used to be drawn as an inline run with a background per line fragment,
 * which left a fenced block looking like torn paper — steps down both edges
 * and gaps where a line happened to be short.
 */
@Composable
private fun CodeBlock(node: Node.CodeBlock, style: TextStyle) {
    val colors = chatColors
    val text = remember(node.text, node.lang, colors) { highlight(node.text, node.lang, colors) }
    Box(
        Modifier.padding(top = 6.dp).fillMaxWidth(0.9f)
            .clip(RoundedCornerShape(Radius.xs))
            .background(colors.codeBg)
            .border(1.dp, colors.codeBorder, RoundedCornerShape(Radius.xs))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(
            text,
            style = style.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = style.fontSize * 0.875f,
                lineHeight = style.fontSize * 0.875f * 1.35f,
                color = colors.text,
            ),
            modifier = Modifier.horizontalScroll(rememberScrollState()),
        )
    }
}

/** One run of inline markdown as a single annotated string. */
@Composable
fun InlineMarkdown(
    nodes: List<Node>,
    ctx: MdContext,
    emojiSize: Dp? = null,
    style: TextStyle = LocalTextStyle.current,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    edited: String? = null,
) {
    val colors = chatColors
    var revealed by remember(nodes) { mutableStateOf(setOf<Int>()) }
    val emoji = remember(nodes) { customEmojiIn(nodes) }
    val plain = remember(nodes) { unicodeEmojiIn(nodes).distinctBy { it.text } }
    LaunchedEffect(Unit) { Twemoji.ensureIndex() }

    // .md-emoji is 1.375em, so emoji in a heading are bigger than emoji in
    // subtext without anyone having to say so; a jumbo size overrides it.
    val glyph = emojiSize ?: (style.fontSize.value * 1.375f).dp

    val built = remember(nodes, revealed, colors, style, edited) {
        val chips = mutableListOf<Chip>()
        val text = buildAnnotatedString {
            appendNodes(nodes, SpanStyle(), Render(ctx, colors, style, revealed, chips) { revealed = revealed + it }, IntArray(1))
            if (edited != null) {
                withStyle(SpanStyle(fontSize = 10.sp, color = colors.textMuted)) { append(" $edited") }
            }
        }
        text to chips.toList()
    }
    val (text, chips) = built

    val inline = remember(emoji, plain, glyph) {
        buildMap<String, InlineTextContent> {
            for (node in emoji) {
                put(
                    "emoji:${node.id}",
                    InlineTextContent(Placeholder((glyph.value + 2).sp, (glyph.value + 2).sp, PlaceholderVerticalAlign.TextCenter)) {
                        EmojiImage(Media.emoji(node.id, if (glyph.value > 32) 128 else 64), ":${node.name}:", glyph, style.fontSize)
                    },
                )
            }
            for (node in plain) {
                val url = Twemoji.url(node.text) ?: continue
                // Centred on the text rather than sitting on its baseline, so a
                // line of emoji does not push the line apart.
                put(
                    "uemoji:${node.text}",
                    InlineTextContent(Placeholder((glyph.value + 2).sp, (glyph.value + 2).sp, PlaceholderVerticalAlign.Center)) {
                        EmojiImage(url, node.text, glyph, style.fontSize)
                    },
                )
            }
        }
    }

    // The chips are drawn from the finished layout rather than as a span
    // background, because a span background is a rectangle per line *fragment*
    // that stops where the run stops: inline code, spoilers and timestamps came
    // out as ragged partial rectangles that covered half a word and stepped at
    // every wrap. Drawn here they are the rounded, correctly padded chips the
    // stylesheet asks for, and they follow the wrap.
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text = text,
        style = style,
        inlineContent = inline,
        maxLines = maxLines,
        overflow = overflow,
        onTextLayout = { layout = it },
        modifier = modifier.drawBehind { layout?.let { drawChips(it, chips) } },
    )
}

/**
 * One emoji picture, with the glyph as the fallback.
 *
 * A custom emoji the server no longer has, or a sprite the network never
 * delivered, used to leave a hole the size of an emoji in the middle of a
 * sentence with nothing to say what had been there.
 */
@Composable
private fun EmojiImage(model: Any?, alt: String, size: Dp, fallback: TextUnit) {
    var failed by remember(model) { mutableStateOf(false) }
    if (model == null || failed) {
        Text(alt, fontSize = fallback, maxLines = 1, overflow = TextOverflow.Clip)
        return
    }
    AsyncImage(
        model = model,
        contentDescription = alt,
        onError = { failed = true },
        modifier = Modifier.size(size),
    )
}

/** A rounded background behind one inline run, drawn from the finished layout. */
private class Chip(
    val start: Int,
    val end: Int,
    val color: Color,
    /** Corner radius, in dp. */
    val radius: Float,
    /** Horizontal padding, in dp. */
    val padX: Float,
    /** How tall the chip is as a multiple of the run's own font size. */
    val heightEm: Float,
    /** The run's font size in sp, so a chip around small text is small. */
    val fontSize: Float,
    /** An outline, where the stylesheet gives the chip a border. */
    val border: Color? = null,
)

private fun DrawScope.drawChips(layout: TextLayoutResult, chips: List<Chip>) {
    // A chip is decoration. Asking a layout about an offset it ellipsised away
    // throws, and the shapes here are used in places that clip to one line —
    // the reply bar, a channel topic — so a chip that cannot be measured is
    // simply not drawn rather than taking the conversation down with it.
    for (chip in chips) {
        try {
            drawChip(layout, chip)
        } catch (_: IllegalArgumentException) {
            continue
        } catch (_: IndexOutOfBoundsException) {
            continue
        }
    }
}

private fun DrawScope.drawChip(layout: TextLayoutResult, chip: Chip) {
    val length = layout.layoutInput.text.length
    val start = chip.start.coerceIn(0, length)
    val end = chip.end.coerceIn(start, length)
    if (end <= start) return
    val firstLine = layout.getLineForOffset(start)
    val lastLine = layout.getLineForOffset(end - 1)
    val height = chip.fontSize.sp.toPx() * chip.heightEm
    val padX = chip.padX.dp.toPx()
    val corner = CornerRadius(chip.radius.dp.toPx())
    for (line in firstLine..lastLine) {
        if (line >= layout.lineCount) break
        val from = maxOf(start, layout.getLineStart(line))
        val to = minOf(end, layout.getLineEnd(line, visibleEnd = true))
        if (to <= from) continue
        val left = layout.getBoundingBox(from).left
        val right = layout.getBoundingBox(to - 1).right
        if (right <= left) continue
        val middle = (layout.getLineTop(line) + layout.getLineBottom(line)) / 2f
        val topLeft = Offset(left - padX, middle - height / 2f)
        val box = Size(right - left + padX * 2f, height)
        drawRoundRect(color = chip.color, topLeft = topLeft, size = box, cornerRadius = corner)
        val outline = chip.border ?: continue
        val stroke = 1.dp.toPx()
        drawRoundRect(
            color = outline,
            topLeft = Offset(topLeft.x + stroke / 2f, topLeft.y + stroke / 2f),
            size = Size(box.width - stroke, box.height - stroke),
            cornerRadius = corner,
            style = Stroke(width = stroke),
        )
    }
}

/** What the builder needs that does not come from the tree itself. */
private class Render(
    val ctx: MdContext,
    val colors: ChatColors,
    val style: TextStyle,
    val revealed: Set<Int>,
    val chips: MutableList<Chip>,
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
    val base = render.style.fontSize.value
    for (node in nodes) {
        when (node) {
            is Node.Text -> withStyle(span) { append(node.text) }
            is Node.Break -> append("\n")
            // .md-inline-code: 0.875em monospace, 0.2em/0.35em of padding and a
            // 4px radius. The padding is the chip's, not spaces in the text —
            // the spaces used to be part of the string, so a copy of a message
            // carried them and a line break could land inside one.
            is Node.Code -> {
                val size = base * 0.875f
                val start = length
                withStyle(
                    span.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = size.sp,
                        color = colors.text,
                    ),
                ) { append(node.text) }
                render.chips += Chip(
                    start, length, colors.codeBg,
                    radius = 4f, padX = size * 0.35f, heightEm = 1.55f, fontSize = size,
                    border = colors.codeBorder,
                )
            }

            is Node.Styled -> {
                if (node.style == Style.SPOILER) {
                    val index = counter[0]++
                    val open = index in render.revealed
                    val spoilerSpan = if (open) span else span.copy(color = Color.Transparent)
                    val start = length
                    withLink(
                        LinkAnnotation.Clickable("spoiler:$index", TextLinkStyles(style = spoilerSpan)) {
                            render.reveal(index)
                        },
                    ) { appendNodes(node.children, spoilerSpan, render, counter) }
                    render.chips += Chip(
                        start, length,
                        if (open) colors.spoilerRevealed else colors.spoiler,
                        radius = 4f, padX = 2f, heightEm = 1.15f, fontSize = base,
                    )
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

            // .md-mention is a chip whatever it points at — a mention that is
            // only coloured text reads as a typo in the middle of a sentence.
            // Only the colour changes when it is a role with a colour of its own.
            is Node.Mention -> {
                val role = if (node.kind == MentionKind.ROLE) render.ctx.roleName(node.id) else null
                // the three fallbacks are the web renderer's own literals
                // (web/src/markdown/render.tsx), which it does not translate
                val label = when (node.kind) {
                    MentionKind.USER -> "@" + (render.ctx.nameOfUser(node.id) ?: "unknown-user")
                    MentionKind.CHANNEL -> "#" + (render.ctx.nameOfChannel(node.id) ?: "deleted-channel")
                    MentionKind.ROLE -> "@" + (role?.first ?: "unknown-role")
                    MentionKind.EVERYONE -> t("render.everyone")
                    MentionKind.HERE -> t("render.here")
                }
                val tint = role?.second?.takeIf { it != 0 }?.let { Color(0xFF000000.toInt() or it) }
                val mentionSpan = span.copy(
                    color = tint ?: colors.mentionFg,
                    fontWeight = FontWeight.Medium,
                )
                val start = length
                withLink(
                    LinkAnnotation.Clickable("mention:${node.id}", TextLinkStyles(style = mentionSpan)) {
                        when (node.kind) {
                            MentionKind.USER -> render.ctx.onUser(node.id)
                            MentionKind.CHANNEL -> render.ctx.onChannel(node.id)
                            else -> Unit
                        }
                    },
                ) { append(label) }
                render.chips += Chip(
                    start, length,
                    tint?.copy(alpha = 0.1f) ?: colors.mentionBg,
                    radius = 3f, padX = 2f, heightEm = 1.15f, fontSize = base,
                )
            }

            is Node.CustomEmoji -> appendInlineContent("emoji:${node.id}", ":${node.name}:")
            // The picture stands in for the glyph, so every phone draws what
            // the browser draws. The glyph itself is the alternative text, so
            // a copy of the message still carries the emoji, and it is what
            // shows if the picture never arrives.
            is Node.UnicodeEmoji ->
                if (Twemoji.code(node.text) != null) appendInlineContent("uemoji:${node.text}", node.text)
                else withStyle(span.copy(fontSize = render.style.fontSize * 1.15f)) { append(node.text) }
            is Node.Timestamp -> {
                val start = length
                withStyle(span) { append(formatTimestamp(node.unix, node.style)) }
                render.chips += Chip(start, length, colors.bgActive, radius = 3f, padX = 2f, heightEm = 1.15f, fontSize = base)
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

/** Every plain emoji in a tree, so the same artwork the browser draws can be put in its place. */
private fun unicodeEmojiIn(nodes: List<Node>): List<Node.UnicodeEmoji> = buildList {
    fun walk(list: List<Node>) {
        for (node in list) when (node) {
            is Node.UnicodeEmoji -> add(node)
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

/**
 * Discord's timestamp styles: t, T, d, D, f, F and R.
 *
 * The skeletons are the ones web/src/lib/time.ts hands Intl, and the locale is
 * the app's rather than the phone's — someone reading Nexa in Arabic on an
 * English phone wants an Arabic date in the middle of an Arabic sentence.
 */
fun formatTimestamp(unix: Long, style: Char): String {
    val date = Date(unix * 1000)
    val locale = Locale.forLanguageTag(Strings.tag)
    if (style == 'R') return relative(unix * 1000)
    val skeleton = when (style) {
        't' -> "jmm"
        'T' -> "jmmss"
        'd' -> "yMMdd"
        'D' -> "yMMMMd"
        'f' -> "yMMMMdjmm"
        else -> "yMMMMEEEEdjmm"
    }
    return runCatching {
        android.icu.text.SimpleDateFormat(
            android.icu.text.DateTimePatternGenerator.getInstance(locale).getBestPattern(skeleton),
            locale,
        ).format(date)
    }.getOrElse { java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.LONG, java.text.DateFormat.SHORT, locale).format(date) }
}

/**
 * "in 5 minutes", "3 hours ago", in the app's language.
 *
 * This used to build the English plural by appending an "s", which is wrong in
 * most of the languages the app ships and wrong in English for "1 hour".
 */
fun relative(millis: Long): String {
    val delta = millis - System.currentTimeMillis()
    val seconds = delta / 1000.0
    val absolute = kotlin.math.abs(seconds)
    val (value, unit) = when {
        absolute >= 31557600 -> seconds / 31557600 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.YEARS
        absolute >= 2629800 -> seconds / 2629800 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.MONTHS
        absolute >= 604800 -> seconds / 604800 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.WEEKS
        absolute >= 86400 -> seconds / 86400 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.DAYS
        absolute >= 3600 -> seconds / 3600 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.HOURS
        absolute >= 60 -> seconds / 60 to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.MINUTES
        else -> seconds to android.icu.text.RelativeDateTimeFormatter.RelativeUnit.SECONDS
    }
    val rounded = kotlin.math.round(value)
    return runCatching {
        android.icu.text.RelativeDateTimeFormatter
            .getInstance(android.icu.util.ULocale.forLanguageTag(Strings.tag))
            .format(
                kotlin.math.abs(rounded),
                if (rounded >= 0) android.icu.text.RelativeDateTimeFormatter.Direction.NEXT
                else android.icu.text.RelativeDateTimeFormatter.Direction.LAST,
                unit,
            )
    }.getOrElse {
        val n = kotlin.math.abs(rounded).toLong()
        val name = unit.name.lowercase().let { u -> if (n == 1L) u.dropLast(1) else u }
        if (rounded >= 0) "in $n $name" else "$n $name ago"
    }
}
