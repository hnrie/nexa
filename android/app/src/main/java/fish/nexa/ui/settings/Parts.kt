package fish.nexa.ui.settings

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxToggle
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay

/*
 * The building blocks every settings page is made of (Settings.module.css and
 * Toggle.module.css on a phone): the page title, section headings, switch
 * rows, option cards, list rows, the red box for what cannot be undone, and
 * the save bar of pages with an explicit Save.
 */

/** `.title`: the page's own heading, 26 sp display, 22 dp above what follows. */
@Composable
fun PageTitle(text: String) {
    Txt(
        text,
        style = Nx.type.title.copy(fontSize = Nx.type.sp(26f), lineHeight = Nx.type.sp(29.9f), fontWeight = FontWeight(700)),
        color = Nx.colors.textStrong,
        modifier = Modifier.padding(bottom = 22.dp).semantics { heading() },
    )
}

/** `.h5`: a section heading, 14.5 sp bold, 28 dp above and 10 below. */
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier, first: Boolean = false, icon: String? = null, trailing: (@Composable RowScope.() -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().padding(top = if (first) 0.dp else 28.dp, bottom = 10.dp).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, Nx.colors.textBrand, size = 18.dp)
        Txt(text, style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(700)), color = Nx.colors.textStrong, modifier = Modifier.weight(1f))
        trailing?.invoke(this)
    }
}

/** `.hint`: a short muted sentence under a control or a heading. */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(19.6f)), color = Nx.colors.textMuted, modifier = modifier.padding(top = 4.dp))
}

/**
 * Toggle.module.css: a sentence-case label (and an optional description)
 * with the switch at the end; the whole row is the target, a hairline under it.
 */
@Composable
fun ToggleRow(
    label: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    description: String? = null,
    enabled: Boolean = true,
    anchor: String? = null,
    divider: Boolean = true,
) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    Column(Modifier.fillMaxWidth().settingAnchor(anchor)) {
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (enabled) 1f else 0.5f)
                .pressable(interaction, enabled = enabled, role = Role.Switch) { onChange(!checked) }
                .padding(vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = c.text)
                if (description != null) Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f)), color = c.textMuted)
            }
            NxToggle(checked, onChange, enabled = enabled, label = label)
        }
        if (divider) Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
    }
}

/**
 * `.radio`: an option card; chosen, it is tinted with the accent and ringed in it.
 * With [tick] it is one of several that can all be on, with a checkbox for its dot.
 */
@Composable
fun RadioCard(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    description: String? = null,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    tick: Boolean = false,
) {
    val c = Nx.colors
    val shape = Radii.Md
    val interaction = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .then(
                if (selected) Modifier
                    .boxShadow(shape, 8f, 20f, c.brand.copy(alpha = 0.8f), spread = -12f)
                    .ring(shape, c.brand.copy(alpha = 0.8f), 2.dp)
                    .background(mixSrgb(c.bgSurface, c.brand, 0.10f), shape)
                else Modifier.ring(shape, c.borderSubtle).background(c.bgSurface, shape),
            )
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(interaction, enabled = enabled, role = if (tick) Role.Checkbox else Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }
            .heightIn(min = 52.dp)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (tick) fish.nexa.ui.components.TickBox(selected) else RadioDot(selected)
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Txt(label, style = Nx.type.body, color = if (enabled) c.text else c.textMuted)
            if (description != null) Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17.5f)), color = c.textMuted)
        }
    }
}

/** An 18 dp radio button in the accent. */
@Composable
fun RadioDot(selected: Boolean) {
    val c = Nx.colors
    Box(
        Modifier
            .size(18.dp)
            .border(2.dp, if (selected) c.brand else c.borderStrong, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Box(Modifier.size(9.dp).background(c.brand, CircleShape))
    }
}

/**
 * `.device`: a list row of sessions, packs and the like: a well with an
 * icon, the name over a muted line, and its buttons beside the words, or
 * under them when they would take too much of the row.
 */
@Composable
fun DeviceRow(
    title: String,
    subtitle: String? = null,
    icon: String? = null,
    current: Boolean = false,
    badge: String? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = Nx.colors
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .then(if (onClick != null) Modifier.pressable(remember { MutableInteractionSource() }, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val main: @Composable () -> Unit = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                if (icon != null) Box(Modifier.size(40.dp).sunken(Radii.Sm, c).ring(Radii.Sm, c.borderSubtle), contentAlignment = Alignment.Center) {
                    Icon(icon, if (current) c.textBrand else c.icon, size = 20.dp)
                }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt(title, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.text, modifier = Modifier.weight(1f, fill = false))
                        if (badge != null) Box(
                            Modifier.background(c.positive.copy(alpha = 0.18f), RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 1.dp),
                        ) { Txt(badge, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1) }
                    }
                    if (subtitle != null) Txt(subtitle, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                }
            }
        }
        if (actions == null) main() else {
            val buttons: @Composable () -> Unit = { Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { actions() } }
            // Beside the words while the buttons take under 40% of the row, as the web's wrapping row does.
            Layout(contents = listOf(main, buttons)) { (m, b), cons ->
                val gap = 12.dp.roundToPx()
                val bp = b.first().measure(cons.copy(minWidth = 0, minHeight = 0))
                if (bp.width <= cons.maxWidth * 0.4f) {
                    val mp = m.first().measure(cons.copy(minWidth = 0, maxWidth = (cons.maxWidth - bp.width - gap).coerceAtLeast(0)))
                    val h = maxOf(mp.height, bp.height)
                    layout(cons.maxWidth, h) {
                        mp.place(0, (h - mp.height) / 2)
                        bp.place(cons.maxWidth - bp.width, (h - bp.height) / 2)
                    }
                } else {
                    val mp = m.first().measure(cons.copy(minWidth = 0))
                    layout(cons.maxWidth, mp.height + gap + bp.height) {
                        mp.place(0, 0)
                        bp.place(cons.maxWidth - bp.width, mp.height + gap)
                    }
                }
            }
        }
    }
}

/** `.dangerBox`: what cannot be undone, in a faintly red box with its button. */
@Composable
fun DangerBox(title: String?, body: String?, button: String, onClick: () -> Unit, anchor: String? = null, loading: Boolean = false) {
    val c = Nx.colors
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .settingAnchor(anchor)
            .background(c.danger.copy(alpha = 0.06f), shape)
            .border(1.dp, c.danger.copy(alpha = 0.45f), shape)
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (title != null) Txt(title, style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong)
            if (body != null) Txt(body, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20f)), color = if (title == null) c.text else c.textMuted)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            NxButton(button, onClick, kind = ButtonKind.DANGER, size = ButtonSize.SM, loading = loading)
        }
    }
}

/** A box of words in a dialog: red for what cannot be undone, amber to warn, green for good news. */
@Composable
fun NoticeBox(text: String, tone: Color, modifier: Modifier = Modifier, icon: String? = null) {
    val c = Nx.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(tone.copy(alpha = 0.12f), Radii.Sm)
            .border(1.dp, tone.copy(alpha = 0.5f), Radii.Sm)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) Icon(icon, tone, size = 18.dp)
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.text, modifier = Modifier.weight(1f))
    }
}

/** A sunken box of monospace text (keys, codes), which can be selected and copied. */
@Composable
fun MonoBox(text: String, modifier: Modifier = Modifier, center: Boolean = false, size: Float = 15f) {
    val c = Nx.colors
    Box(
        modifier
            .fillMaxWidth()
            .sunken(Radii.Md, c)
            .border(1.dp, c.borderSubtle, Radii.Md)
            .padding(16.dp),
        contentAlignment = if (center) Alignment.Center else Alignment.CenterStart,
    ) {
        androidx.compose.foundation.text.selection.SelectionContainer {
            Txt(
                text,
                style = Nx.type.code.copy(fontSize = Nx.type.sp(size), lineHeight = Nx.type.sp(size * 1.7f), letterSpacing = androidx.compose.ui.unit.TextUnit(0.04f, androidx.compose.ui.unit.TextUnitType.Em)),
                color = c.textStrong,
                align = if (center) androidx.compose.ui.text.style.TextAlign.Center else null,
            )
        }
    }
}

/**
 * A setting picked from a short list (the web's `<select>`): the label (and
 * a line under it) with the chosen option at the end; a tap lists them all.
 */
@Composable
fun <T> SelectRow(
    label: String,
    value: T,
    options: List<Pair<String, T>>,
    onPick: (T) -> Unit,
    sub: String? = null,
    anchor: String? = null,
    divider: Boolean = true,
    /** Shown when no option is the value (a list that only fills things in, like Start From). */
    placeholder: String? = null,
) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val current = options.firstOrNull { it.second == value }?.first ?: placeholder ?: ""
    Column(Modifier.fillMaxWidth().settingAnchor(anchor)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(if (pressed) c.bgHover else Color.Transparent)
                .pressable(interaction) {
                    fish.nexa.ui.layers.openMenu(
                        options.map { (name, v) -> fish.nexa.ui.layers.MenuItem.Action(name, checked = v == value) { onPick(v) } },
                        title = label,
                    )
                }
                .semantics { contentDescription = "$label, $current" }
                .padding(vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = c.text)
                if (sub != null) Txt(sub, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f)), color = c.textMuted)
            }
            Row(
                Modifier
                    .sunken(Radii.Sm, c)
                    .ring(Radii.Sm, c.borderSubtle)
                    .padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Txt(current, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(550)), color = c.text, maxLines = 1)
                Icon("ChevronDown", c.textMuted, size = 16.dp)
            }
        }
        if (divider) Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
    }
}

/**
 * A dialog's sheet whose title, footer and closability follow its steps: a
 * dialog that ends on a key or codes to save cannot be swiped or tapped away.
 */
class SheetCtl(title: String?) {
    var title by mutableStateOf(title)
    var closable by mutableStateOf(true)
    var footer by mutableStateOf(true)
    internal var closeFn: () -> Unit = {}

    /** Closes it, even from a step that could not be dismissed. */
    fun close() {
        closable = true
        closeFn()
    }
}

fun openSettingsSheet(
    key: String,
    ctl: SheetCtl,
    footer: (@Composable RowScope.(SheetCtl) -> Unit)? = null,
    content: @Composable ColumnScope.(SheetCtl) -> Unit,
) {
    lateinit var layer: fish.nexa.ui.layers.Layer
    layer = fish.nexa.ui.layers.Layer(key, canClose = { ctl.closable }) { close ->
        ctl.closeFn = close
        fish.nexa.ui.layers.Sheet(
            layer,
            title = ctl.title,
            closeButton = ctl.closable,
            footer = if (footer != null && ctl.footer) {
                { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) { footer(ctl) } }
            } else null,
        ) { content(ctl) }
    }
    fish.nexa.ui.layers.Layers.open(layer)
}

/** Copies [text]; a key or codes are marked sensitive, so the keyboard's clipboard strip hides them. */
fun copyText(context: android.content.Context, text: String, sensitive: Boolean = false): Boolean = try {
    val cm = context.getSystemService(android.content.ClipboardManager::class.java)
    val clip = android.content.ClipData.newPlainText("Nexa", text)
    if (sensitive) clip.description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    cm.setPrimaryClip(clip)
    true
} catch (_: Exception) {
    false
}

/** Saves text as a file the person picks a place for (the web's download). */
@Composable
fun rememberTextFileSaver(onDone: (Boolean) -> Unit = {}): (name: String, text: String) -> Unit {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val pending = remember { mutableStateOf<String?>(null) }
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        val text = pending.value
        pending.value = null
        if (uri != null && text != null) {
            val ok = runCatching { ctx.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } != null }.getOrDefault(false)
            onDone(ok)
        }
    }
    return { name, text ->
        pending.value = text
        launcher.launch(name)
    }
}

/** A QR code drawn black on white (for a phone camera to read), with what it holds as its description. */
@Composable
fun QrCode(text: String, size: Dp, label: String, modifier: Modifier = Modifier) {
    val matrix = remember(text) {
        runCatching {
            com.google.zxing.qrcode.QRCodeWriter().encode(
                text, com.google.zxing.BarcodeFormat.QR_CODE, 0, 0,
                mapOf(com.google.zxing.EncodeHintType.MARGIN to 0, com.google.zxing.EncodeHintType.ERROR_CORRECTION to com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M),
            )
        }.getOrNull()
    }
    Box(
        modifier
            .size(size)
            .background(Color.White, Radii.Sm)
            .padding(10.dp)
            .semantics { contentDescription = label },
    ) {
        androidx.compose.foundation.Canvas(Modifier.matchParentSize()) {
            val m = matrix ?: return@Canvas
            val cell = this.size.minDimension / m.width
            for (y in 0 until m.height) for (x in 0 until m.width) {
                if (m.get(x, y)) drawRect(
                    Color.Black,
                    androidx.compose.ui.geometry.Offset(kotlin.math.floor(x * cell), kotlin.math.floor(y * cell)),
                    androidx.compose.ui.geometry.Size(kotlin.math.ceil(cell) + 0.5f, kotlin.math.ceil(cell) + 0.5f),
                )
            }
        }
    }
}

/** `.card` on a phone: a raised card holding a group of rows. */
@Composable
fun SettingsCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Nx.colors
    val shape = Radii.Lg
    Column(
        modifier
            .fillMaxWidth()
            .shadowMedium(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape),
        content = content,
    )
}

/** `.rows` inside a card: a well holding label/value pairs. */
@Composable
fun FieldRow(label: String, value: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    val c = Nx.colors
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            Txt(label, style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700)), color = c.textMuted)
            Txt(value, style = Nx.type.body, color = c.text, modifier = Modifier.padding(top = 2.dp))
        }
        action?.invoke()
    }
}

/** A separator between parts of a page (`.sep`): a hairline with 28 dp around it. */
@Composable
fun SettingsSeparator() {
    Box(Modifier.fillMaxWidth().padding(vertical = 28.dp).size(1.dp).background(Nx.colors.borderSubtle))
}

/**
 * stores/unsaved.ts: pages with an explicit Save hold the settings open
 * while their form differs from what is saved. Leaving is refused instead:
 * the save bar shakes and turns red.
 */
/**
 * Keeps something being typed in on screen: brought into view as it changes,
 * with room below it for the save bar while the bar shows (the bar comes up
 * over the page after the first key, right where the keyboard leaves the field).
 */
@Composable
fun Modifier.keptAboveSaveBar(key: Any?, active: Boolean): Modifier {
    val bring = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val room = with(androidx.compose.ui.platform.LocalDensity.current) { 96.dp.toPx() }
    val bar = Unsaved.blocking
    LaunchedEffect(key, active, bar) {
        if (!active) return@LaunchedEffect
        // after the keyboard and the bar have taken their places
        kotlinx.coroutines.delay(120)
        bring.bringIntoView(androidx.compose.ui.geometry.Rect(0f, 0f, size.width.toFloat(), size.height + if (bar) room else 0f))
    }
    return this
        .bringIntoViewRequester(bring)
        .onSizeChanged { size = it }
}

object Unsaved {
    /** The forms holding the settings open right now. */
    val holds = mutableStateListOf<Any>()
    var nudge by mutableIntStateOf(0)
        private set

    val blocking get() = holds.isNotEmpty()

    /** Runs [fn] unless a form has unsaved changes, in which case its bar says so. */
    fun unlessUnsaved(fn: () -> Unit) {
        if (holds.isEmpty()) fn() else nudge += 1
    }

    fun clear() = holds.clear()
}

/**
 * `.saveBar`: "You have unsaved changes." with Reset and Save Changes,
 * floating above the bottom while [dirty]. It holds the settings open while
 * shown, and shakes red when leaving is tried.
 */
@Composable
fun BoxScope.SaveBar(
    dirty: Boolean,
    saving: Boolean,
    onReset: () -> Unit,
    onSave: () -> Unit,
    text: String = t("server.settingsLayer.carefulYouHaveUnsavedChanges"),
    resetLabel: String = t("common.imageCrop.reset"),
    saveLabel: String = t("server.settingsLayer.saveChanges"),
) {
    val c = Nx.colors
    val key = remember { Any() }
    LaunchedEffect(dirty) {
        if (dirty) {
            if (key !in Unsaved.holds) Unsaved.holds += key
        } else Unsaved.holds.remove(key)
    }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { Unsaved.holds.remove(key) } }
    if (!dirty) return
    val reduced = Nx.motion.reduced
    val spring = Nx.motion.spring
    val enter = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(260, easing = spring)) }
    val shake = remember { Animatable(0f) }
    var red by remember { mutableStateOf(false) }
    val nudge = Unsaved.nudge
    LaunchedEffect(nudge) {
        if (nudge == 0) return@LaunchedEffect
        red = true
        if (!reduced) {
            for (x in listOf(-8f, 8f, -8f, 8f, 0f)) shake.animateTo(x, tween(84))
        }
        delay(if (reduced) 900 else 420)
        red = false
    }
    val shape = Radii.Md
    Row(
        Modifier
            .align(Alignment.BottomCenter)
            .padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            .fillMaxWidth()
            .graphicsLayer {
                translationX = shake.value * density
                translationY = (1f - enter.value) * 12f * density
                alpha = enter.value.coerceIn(0f, 1f)
            }
            .shadowHigh(shape, c)
            .ring(shape, c.panelEdge)
            .background(if (red) c.danger else c.bgFloating.copy(alpha = 0.96f), shape)
            .topEdge(shape, c.edgeLight)
            .padding(start = 18.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Txt(
            text,
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(550)),
            color = if (red) c.onDanger else c.text,
            modifier = Modifier.weight(1f),
        )
        NxButton(resetLabel, onReset, kind = ButtonKind.GHOST, size = ButtonSize.SM)
        NxButton(saveLabel, onSave, kind = ButtonKind.POSITIVE, size = ButtonSize.SM, loading = saving)
    }
}

/** A small chip-like count or state pill beside a heading. */
@Composable
fun StatePill(text: String, tint: Color, modifier: Modifier = Modifier) {
    Box(modifier.background(tint.copy(alpha = 0.16f), RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Txt(text, style = Nx.type.hint.copy(fontWeight = FontWeight(650)), color = tint, maxLines = 1)
    }
}

/** A row that opens something: label, an optional value, and a chevron. */
@Composable
fun LinkRow(label: String, value: String? = null, icon: String? = null, danger: Boolean = false, divider: Boolean = true, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val rtl = androidx.compose.ui.platform.LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(if (pressed) c.bgHover else Color.Transparent)
                .pressable(interaction, onClick = onClick)
                .heightIn(min = 52.dp)
                .padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (icon != null) Icon(icon, if (danger) c.textDanger else c.icon, size = 20.dp)
            Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = if (danger) c.textDanger else c.text, modifier = Modifier.weight(1f))
            if (value != null) Txt(value, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
            Icon(if (rtl) "ChevronLeft" else "ChevronRight", c.textMuted, size = 18.dp)
        }
        if (divider) Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
    }
}

/** A colour swatch tile (`.swatch`): 42 dp, rounded 12, lit; chosen, ringed in the text colour. */
@Composable
fun Swatch(color: Color, selected: Boolean, label: String, onClick: () -> Unit, size: Dp = 42.dp, content: (@Composable BoxScope.() -> Unit)? = null) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(size)
            .graphicsLayer { translationY = if (pressed) 1f * density else 0f }
            .then(if (selected) Modifier.ring(shape, c.textStrong, 4.dp).ring(shape, c.bgRaised, 2.dp) else Modifier.ring(shape, c.panelEdge))
            .shadowLow(shape, c)
            .background(color, shape)
            .topEdge(shape, Color.White.copy(alpha = 0.22f))
            .clip(shape)
            .pressable(interaction, role = Role.RadioButton, onClick = onClick)
            .semantics {
                this.selected = selected
                contentDescription = label
            },
        contentAlignment = Alignment.Center,
    ) { content?.invoke(this) }
}
