package fish.nexa.ui.format

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.Align
import fish.nexa.ui.markdown.MarkdownColors
import fish.nexa.ui.markdown.Rgb
import fish.nexa.ui.markdown.format.AtomKind
import fish.nexa.ui.markdown.format.Block
import fish.nexa.ui.markdown.format.CodeBlock
import fish.nexa.ui.markdown.format.FileBlock
import fish.nexa.ui.markdown.format.Inline
import fish.nexa.ui.markdown.format.ListInfo
import fish.nexa.ui.markdown.format.Marks
import fish.nexa.ui.markdown.format.RuleBlock
import fish.nexa.ui.markdown.format.TableBlock
import fish.nexa.ui.markdown.format.TextBlock
import fish.nexa.ui.markdown.format.TextKind
import fish.nexa.ui.markdown.format.Wrap
import fish.nexa.ui.t
import fish.nexa.ui.theme.NexaColors
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb

/**
 * The writing page (FormatEditor.module.css `.surface`): the chat's own
 * background and type, so what is written looks as it will when it is sent.
 * Quotes, callouts and folded sections are the runs of lines that share a
 * bar; lists keep their marker, number or box in the start padding.
 */
@Composable
fun FormatPage(surface: FormatSurface, placeholder: String, modifier: Modifier = Modifier) {
    val blocks = surface.blocks
    // ordered lists count per depth, starting again after anything that is not an item
    val numbers = HashMap<Int, Int>()
    val counters = ArrayList<Int>()
    for (block in blocks) {
        val list = (block as? TextBlock)?.list
        if (block is TextBlock && block.textKind == TextKind.LI && list != null) {
            while (counters.size > list.indent + 1) counters.removeAt(counters.lastIndex)
            while (counters.size < list.indent + 1) counters += 0
            val n = if (list.ordered) list.start ?: (counters[list.indent] + 1) else 0
            counters[list.indent] = n
            numbers[block.id] = n
        } else counters.clear()
    }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp)) {
            var i = 0
            while (i < blocks.size) {
                val wrap = blocks[i].wrap
                if (wrap == null) {
                    val block = blocks[i]
                    key(block.id) { BlockView(surface, block, numbers[block.id], first = i == 0, placeholder = placeholder.takeIf { blocks.size == 1 }) }
                    i++
                    continue
                }
                val start = i
                while (i < blocks.size && blocks[i].wrap == wrap) i++
                val run = blocks.subList(start, i)
                key(run.first().id, "wrap") {
                    WrapBox(wrap) {
                        run.forEachIndexed { k, block ->
                            key(block.id) {
                                BlockView(
                                    surface, block, numbers[block.id], first = k == 0,
                                    summary = wrap == Wrap.DETAILS && k == 0,
                                    placeholder = if (wrap == Wrap.DETAILS && k == 0) t("composer.format.summaryPlaceholder") else placeholder.takeIf { blocks.size == 1 },
                                )
                            }
                        }
                    }
                }
            }
        }
        // the page goes on below the last line: a tap there writes at the end
        Spacer(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 160.dp)
                .pressable(remember { MutableInteractionSource() }) { surface.focusEnd() },
        )
    }
}

private fun wrapColour(c: NexaColors, wrap: Wrap): Color = when (wrap) {
    Wrap.NOTE -> c.link
    Wrap.TIP -> c.positive
    Wrap.IMPORTANT -> c.textBrand
    Wrap.WARNING -> c.textWarning
    Wrap.CAUTION -> c.textDanger
    Wrap.QUOTE, Wrap.DETAILS -> c.borderStrong
}

/** A quote, callout or folded section: a 4 dp bar in its colour, a 7% tint for callouts, and its title. */
@Composable
private fun WrapBox(wrap: Wrap, content: @Composable () -> Unit) {
    val c = Nx.colors
    val bar = wrapColour(c, wrap)
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val tint = when (wrap) {
        Wrap.QUOTE -> Color.Transparent
        Wrap.DETAILS -> c.text.copy(alpha = 0.03f)
        else -> bar.copy(alpha = 0.07f)
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(tint)
            .drawBehind {
                val w = 4.dp.toPx()
                val x = if (rtl) size.width - w else 0f
                drawRect(bar, topLeft = Offset(x, 0f), size = androidx.compose.ui.geometry.Size(w, size.height))
            }
            .padding(start = 18.dp, end = if (wrap == Wrap.QUOTE) 0.dp else 12.dp, top = 6.dp, bottom = 6.dp),
    ) {
        if (wrap != Wrap.QUOTE && wrap != Wrap.DETAILS) {
            Txt(
                t("render.alert.${wrap.key}"),
                style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)),
                color = mixSrgb(c.textStrong, bar, 0.8f),
                modifier = Modifier.padding(bottom = 2.dp),
            )
        }
        content()
    }
}

/** One block as it is drawn on the page. */
@Composable
private fun BlockView(surface: FormatSurface, block: Block, number: Int?, first: Boolean, summary: Boolean = false, placeholder: String? = null) {
    when (block) {
        is TextBlock -> TextBlockView(surface, block, number, first, summary, placeholder)
        is CodeBlock -> CodeBlockView(surface, block)
        is RuleBlock -> Box(Modifier.fillMaxWidth().padding(vertical = 10.dp).height(1.dp).background(Nx.colors.borderStrong))
        is TableBlock -> TableView(surface, block)
        is FileBlock -> Row(
            Modifier.padding(vertical = 6.dp).background(Nx.colors.bgSurface, Radii.Xs).padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("Paperclip", Nx.colors.textMuted, size = 16.dp)
            Txt(block.name, style = Nx.type.bodySmall, color = Nx.colors.text, maxLines = 1)
        }
    }
}

/** The type of each kind of line (FormatEditor.module.css `[data-b]`). */
@Composable
private fun kindStyle(kind: TextKind): TextStyle {
    val c = Nx.colors
    val body = Nx.type.body.copy(color = c.text)
    val sp = Nx.type::sp
    return when (kind) {
        TextKind.H1 -> body.copy(fontSize = sp(24f), lineHeight = sp(30f), fontWeight = FontWeight(700))
        TextKind.H2 -> body.copy(fontSize = sp(20f), lineHeight = sp(25f), fontWeight = FontWeight(700))
        TextKind.H3 -> body.copy(fontWeight = FontWeight(700))
        TextKind.H4 -> body.copy(fontSize = sp(15f), fontWeight = FontWeight(700))
        TextKind.H5 -> body.copy(fontSize = sp(14f), lineHeight = sp(20f), fontWeight = FontWeight(700))
        TextKind.H6 -> body.copy(fontSize = sp(14f), lineHeight = sp(20f), fontWeight = FontWeight(600), color = c.textMuted)
        TextKind.SUBTEXT -> body.copy(fontSize = sp(13f), lineHeight = sp(18f), color = c.textMuted)
        else -> body
    }
}

private fun headingGap(kind: TextKind, first: Boolean): Pair<Int, Int> = when (kind) {
    TextKind.H1, TextKind.H2 -> (if (first) 0 else 12) to 6
    TextKind.H3, TextKind.H4, TextKind.H5, TextKind.H6 -> (if (first) 0 else 10) to 4
    else -> 0 to 0
}

@Composable
private fun TextBlockView(surface: FormatSurface, block: TextBlock, number: Int?, first: Boolean, summary: Boolean, placeholder: String?) {
    val c = Nx.colors
    val key = FieldKey(block.id)
    var style = kindStyle(block.textKind)
    if (summary) style = style.copy(fontWeight = FontWeight(600))
    val (top, bottom) = headingGap(block.textKind, first)
    Row(Modifier.fillMaxWidth().padding(top = top.dp, bottom = bottom.dp)) {
        val list = block.list
        if (block.textKind == TextKind.LI && list != null) ListMarker(surface, block.id, list, number ?: 0)
        if (summary) Box(Modifier.height(22.dp).padding(end = 6.dp), contentAlignment = Alignment.Center) { Icon("ChevronDown", c.textMuted, size = 14.dp) }
        if (block.textKind == TextKind.NOTE) {
            Txt("[${block.label ?: ""}] ", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600), lineHeight = Nx.type.sp(22f)), color = c.link)
        }
        EditField(surface, key, style, block.content, placeholder, Modifier.weight(1f))
    }
}

/** A list's marker in the start padding: a bullet by depth, a number, or a box to tick. */
@Composable
private fun ListMarker(surface: FormatSurface, id: Int, list: ListInfo, number: Int) {
    val c = Nx.colors
    Spacer(Modifier.width((24 * list.indent).dp))
    Box(Modifier.width(24.dp).height(22.dp), contentAlignment = if (list.ordered && !list.task) Alignment.CenterEnd else Alignment.Center) {
        when {
            list.task -> {
                val shape = RoundedCornerShape(4.dp)
                Box(
                    Modifier
                        .size(32.dp)
                        .pressable(remember { MutableInteractionSource() }, role = Role.Checkbox) { surface.toggleChecked(id) }
                        .semantics {
                            contentDescription = t("composer.format.done")
                            stateDescription = if (list.checked) "on" else "off"
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(15.dp)
                            .then(if (list.checked) Modifier.background(c.brand, shape) else Modifier.border(1.5.dp, c.textMuted, shape)),
                        contentAlignment = Alignment.Center,
                    ) { if (list.checked) Icon("Check", Color.White, size = 11.dp) }
                }
            }
            list.ordered -> Txt("$number.", style = Nx.type.body.copy(fontFeatureSettings = "tnum"), color = c.textMuted, modifier = Modifier.padding(end = 6.dp))
            else -> {
                val glyph = when (list.indent % 3) {
                    1 -> "◦"
                    2 -> "▪"
                    else -> "•"
                }
                Txt(glyph, style = Nx.type.body.copy(fontSize = if (list.indent % 3 == 2) Nx.type.sp(12f) else Nx.type.sp(16f)), color = c.textMuted)
            }
        }
    }
}

@Composable
private fun CodeBlockView(surface: FormatSurface, block: CodeBlock) {
    val c = Nx.colors
    val shape = Radii.Xs
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(c.codeBg, shape)
            .border(1.dp, c.codeBorder, shape)
            .padding(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 8.dp),
    ) {
        // the language (or "Code") in small type at the top
        Txt(
            block.lang.ifEmpty { t("composer.format.codeLabel") },
            style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f), fontWeight = FontWeight(600), lineHeight = Nx.type.sp(16f)),
            color = c.textMuted,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        EditField(
            surface, FieldKey(block.id),
            Nx.type.code.copy(color = c.text, fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f), textAlign = TextAlign.Left),
            null, null, Modifier.fillMaxWidth(), code = true,
        )
    }
}

/** A table: a header row and its cells, each a field; columns as wide as their widest cell, 72 dp at least. */
@Composable
private fun TableView(surface: FormatSurface, block: TableBlock) {
    val c = Nx.colors
    val cols = block.align.size
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp).horizontalScroll(rememberScrollState())) {
        Layout(
            content = {
                block.rows.forEachIndexed { r, row ->
                    for (col in 0 until cols) {
                        val cell = row.getOrNull(col) ?: emptyList()
                        val head = r == 0
                        Box(
                            Modifier
                                .border(0.5.dp, c.border)
                                .background(if (head) c.text.copy(alpha = 0.06f) else Color.Transparent)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            val base = Nx.type.body.copy(color = c.text, fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f))
                            val align = when (block.align.getOrNull(col)) {
                                Align.CENTER -> TextAlign.Center
                                Align.RIGHT -> TextAlign.End
                                else -> TextAlign.Start
                            }
                            EditField(
                                surface, FieldKey(block.id, r to col),
                                base.copy(fontWeight = if (head) FontWeight(600) else FontWeight(400), textAlign = align),
                                cell, null, Modifier.widthIn(min = 52.dp, max = 220.dp),
                            )
                        }
                    }
                }
            },
        ) { measurables, constraints ->
            val rows = block.rows.size
            val min = 72.dp.roundToPx()
            val widths = IntArray(cols) { min }
            for (k in measurables.indices) {
                val w = measurables[k].maxIntrinsicWidth(Constraints.Infinity)
                widths[k % cols] = maxOf(widths[k % cols], w)
            }
            val placeables = measurables.mapIndexed { k, m -> m.measure(Constraints.fixedWidth(widths[k % cols])) }
            val heights = IntArray(rows) { r -> (0 until cols).maxOf { col -> placeables[r * cols + col].height } }
            val placed = measurables.mapIndexed { k, m -> m.measure(Constraints.fixed(widths[k % cols], heights[k / cols])) }
            val width = widths.sum()
            val height = heights.sum()
            layout(width, height) {
                var y = 0
                for (r in 0 until rows) {
                    var x = 0
                    for (col in 0 until cols) {
                        placed[r * cols + col].placeRelative(x, y)
                        x += widths[col]
                    }
                    y += heights[r]
                }
            }
        }
    }
}

/**
 * One field: the text of a block, a code block or a cell. What it shows is
 * the model's runs drawn with their marks (an atom shows its label); what the
 * keyboard does goes to the surface, which keeps the model.
 */
@Composable
private fun EditField(
    surface: FormatSurface,
    key: FieldKey,
    style: TextStyle,
    content: List<Inline>?,
    placeholder: String?,
    modifier: Modifier,
    code: Boolean = false,
) {
    val c = Nx.colors
    val value = surface.values[key] ?: androidx.compose.ui.text.input.TextFieldValue("")
    val focus = remember { FocusRequester() }
    val target = surface.focusTo
    LaunchedEffect(target) { if (target?.key == key) runCatching { focus.requestFocus() } }
    val mono = Nx.type.mono
    val transformation = remember(content, c, mono) { if (content == null) VisualTransformation.None else RunsTransformation(content, c, mono) }
    BasicTextField(
        value = value,
        onValueChange = { surface.onValue(key, it) },
        modifier = modifier
            .focusRequester(focus)
            .onFocusChanged { if (it.isFocused) surface.focused(key) }
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val v = surface.values[key] ?: return@onPreviewKeyEvent false
                val mod = e.isCtrlPressed || e.isMetaPressed
                val ch = e.nativeKeyEvent.unicodeChar
                when {
                    e.key == Key.Tab && key.cell != null -> { surface.moveCell(key, if (e.isShiftPressed) -1 else 1); true }
                    // the keyboard's composing stays the field's; everything else goes to the model first
                    v.composition != null -> false
                    e.key == Key.Backspace && !mod -> surface.hardKey(key, null, enter = false, backspace = true, delete = false)
                    e.key == Key.Delete && !mod -> surface.hardKey(key, null, enter = false, backspace = false, delete = true)
                    (e.key == Key.Enter || e.key == Key.NumPadEnter) && !mod -> surface.hardKey(key, null, enter = true, backspace = false, delete = false)
                    !mod && !e.nativeKeyEvent.isAltPressed && ch != 0 && !Character.isISOControl(ch) -> surface.hardKey(key, String(Character.toChars(ch)), enter = false, backspace = false, delete = false)
                    e.key == Key.Escape -> { surface.onEscape?.invoke(); true }
                    mod && e.key == Key.Enter -> { surface.onSubmit?.invoke(); true }
                    mod && e.key == Key.B -> { surface.command(Cmd.Mark(fish.nexa.ui.markdown.format.Flag.B)); true }
                    mod && e.key == Key.I -> { surface.command(Cmd.Mark(fish.nexa.ui.markdown.format.Flag.I)); true }
                    mod && e.key == Key.U -> { surface.command(Cmd.Mark(fish.nexa.ui.markdown.format.Flag.U)); true }
                    mod && e.key == Key.E -> { surface.command(Cmd.Mark(fish.nexa.ui.markdown.format.Flag.CODE)); true }
                    mod && e.isShiftPressed && e.key == Key.X -> { surface.command(Cmd.Mark(fish.nexa.ui.markdown.format.Flag.S)); true }
                    mod && e.key == Key.K -> { surface.onLinkKey?.invoke(); true }
                    mod && e.key == Key.Z -> { surface.command(if (e.isShiftPressed) Cmd.Redo else Cmd.Undo); true }
                    mod && e.key == Key.Y -> { surface.command(Cmd.Redo); true }
                    mod && e.key == Key.Backslash -> { surface.command(Cmd.Clear); true }
                    else -> false
                }
            },
        textStyle = style,
        cursorBrush = SolidColor(c.textBrand),
        visualTransformation = transformation,
        keyboardOptions = KeyboardOptions(capitalization = if (code) KeyboardCapitalization.None else KeyboardCapitalization.Sentences, autoCorrectEnabled = !code),
        decorationBox = { inner ->
            Box {
                if (value.text.isEmpty() && placeholder != null) {
                    Txt(placeholder, style = style.copy(fontWeight = if (style.fontWeight == FontWeight(600)) FontWeight(600) else FontWeight(400)), color = c.textPlaceholder, maxLines = 1)
                }
                inner()
            }
        },
    )
}

/**
 * Draws a field's runs with their marks (FormatEditor.module.css, "marks,
 * drawn as a message draws them"): atoms, one character in the field, show
 * their label, so offsets are mapped across them.
 */
private class RunsTransformation(private val runs: List<Inline>, private val c: NexaColors, private val mono: androidx.compose.ui.text.font.FontFamily) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val plain = FormatSurface.textOf(runs)
        if (plain != text.text) return TransformedText(text, OffsetMapping.Identity)
        val out = AnnotatedString.Builder()
        // original offset -> transformed offset, at each run's start
        val starts = ArrayList<Pair<Int, Int>>()
        val ends = ArrayList<Pair<Int, Int>>()
        var o = 0
        val surface = MarkdownColors.Surface(Rgb.of(c.bgBase.toArgb()), Rgb.of(c.text.toArgb()))
        for (r in runs) {
            val shown = if (r is Inline.Text) r.text else atomLabel(r as Inline.Atom)
            val from = out.length
            out.append(shown)
            val span = spanOf(r.marks, surface)
            if (span != null) out.addStyle(span, from, out.length)
            if (r is Inline.Atom) out.addStyle(atomStyle(r), from, out.length)
            starts += o to from
            o += if (r is Inline.Text) r.text.length else 1
            ends += o to out.length
        }
        val shownText = out.toAnnotatedString()
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int {
                if (offset <= 0) return 0
                for (k in starts.indices) {
                    val (os, ts) = starts[k]
                    val (oe, te) = ends[k]
                    if (offset in os..oe) {
                        val atom = runs[k] is Inline.Atom
                        return if (atom) (if (offset == oe) te else ts) else ts + (offset - os)
                    }
                }
                return shownText.length
            }

            override fun transformedToOriginal(offset: Int): Int {
                if (offset <= 0) return 0
                for (k in starts.indices) {
                    val (os, ts) = starts[k]
                    val (oe, te) = ends[k]
                    if (offset in ts..te) {
                        val atom = runs[k] is Inline.Atom
                        return if (atom) (if (offset - ts > (te - ts) / 2) oe else os) else os + (offset - ts)
                    }
                }
                return plain.length
            }
        }
        return TransformedText(shownText, mapping)
    }

    private fun atomLabel(a: Inline.Atom): String = when (a.atom) {
        AtomKind.EMOJI -> a.label.ifEmpty { a.raw }
        else -> a.label.ifEmpty { a.raw }
    }

    private fun atomStyle(a: Inline.Atom): SpanStyle = when (a.atom) {
        AtomKind.EMOJI -> SpanStyle()
        AtomKind.TIME -> SpanStyle(background = c.bgActive, color = c.text)
        AtomKind.LINK -> SpanStyle(color = c.link, textDecoration = TextDecoration.Underline)
        AtomKind.FNREF -> SpanStyle(color = c.link, fontSize = 0.75.em, baselineShift = BaselineShift.Superscript)
        else -> SpanStyle(background = c.mentionBg, color = c.mentionFg, fontWeight = FontWeight(500))
    }

    private fun spanOf(m: Marks, surface: MarkdownColors.Surface): SpanStyle? {
        if (m == Marks.NONE) return null
        var s = SpanStyle()
        if (m.b) s = s.merge(SpanStyle(fontWeight = FontWeight(700)))
        if (m.i) s = s.merge(SpanStyle(fontStyle = FontStyle.Italic))
        val lines = buildList {
            if (m.u || m.link != null) add(TextDecoration.Underline)
            if (m.s) add(TextDecoration.LineThrough)
        }
        if (lines.isNotEmpty()) s = s.merge(SpanStyle(textDecoration = TextDecoration.combine(lines)))
        if (m.link != null) s = s.merge(SpanStyle(color = c.link))
        if (m.code) s = s.merge(SpanStyle(fontFamily = mono, fontSize = 0.875.em, background = c.codeBg))
        if (m.mark) s = s.merge(SpanStyle(background = c.warning.copy(alpha = 0.32f)))
        if (m.spoiler) s = s.merge(SpanStyle(background = c.spoiler.copy(alpha = 0.38f)))
        if (m.sup) s = s.merge(SpanStyle(fontSize = 0.75.em, baselineShift = BaselineShift.Superscript))
        if (m.sub) s = s.merge(SpanStyle(fontSize = 0.75.em, baselineShift = BaselineShift(-0.25f)))
        m.color?.let { col ->
            val paint = MarkdownColors.paint(col.fg, col.bg, surface)
            paint.color?.let { hex -> s = s.merge(SpanStyle(color = hexColour(hex))) }
            paint.background?.let { hex -> s = s.merge(SpanStyle(background = hexColour(hex))) }
        }
        return s
    }

    private fun hexColour(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

    override fun equals(other: Any?): Boolean = other is RunsTransformation && other.runs == runs && other.c == c && other.mono == mono
    override fun hashCode(): Int = runs.hashCode()
}
