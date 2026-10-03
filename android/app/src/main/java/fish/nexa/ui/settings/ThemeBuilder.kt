package fish.nexa.ui.settings

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxSlider
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.look.Colour
import fish.nexa.ui.theme.look.Contrast
import fish.nexa.ui.theme.look.CustomTheme
import fish.nexa.ui.theme.look.CustomThemes
import fish.nexa.ui.theme.look.Derive
import fish.nexa.ui.theme.look.LookDraft
import fish.nexa.ui.theme.look.Looks
import fish.nexa.ui.theme.look.Presets
import fish.nexa.ui.theme.look.SimpleColours
import fish.nexa.ui.theme.look.ThemeSource
import fish.nexa.ui.theme.look.Tokens
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A custom theme being made or changed: what is on screen, what was last saved, and which editor shows it. */
class ThemeBuild(initial: CustomTheme, isNew: Boolean) {
    var draft by mutableStateOf(initial)
    var saved by mutableStateOf(initial)
    var fresh by mutableStateOf(isNew)
    var tab by mutableStateOf(if (initial.source is ThemeSource.Simple && initial.overrides.isEmpty()) "simple" else "advanced")
    /** The simple colours last used, so Advanced can go back to them after trying a preset. */
    var lastSimple by mutableStateOf(initial.source as? ThemeSource.Simple)
    val dirty get() = fresh || draft != saved
}

/** The Theme Builder over the Appearance page, while it is open; the whole app wears its draft meanwhile. */
object ThemeEditing {
    var build by mutableStateOf<ThemeBuild?>(null)
        private set

    fun open(theme: CustomTheme, isNew: Boolean) {
        build = ThemeBuild(theme, isNew)
    }

    fun close() {
        build = null
        LookDraft.theme = null
    }

    /** New Theme: a copy of the custom theme on screen, or the colours of the theme on screen. */
    fun startNew(shown: String, customs: List<CustomTheme>) {
        val from = customs.firstOrNull { it.id == shown }
        open(
            from?.copy(id = CustomThemes.newId(), name = t("settings.themeBuilder.copyOf", "name" to from.name.ifEmpty { t("settings.themeBuilder.untitled") }))
                ?: CustomTheme(CustomThemes.newId(), t("settings.themeBuilder.defaultName"), ThemeSource.Simple(startingColours(shown) ?: startingColours("dark")!!), emptyMap()),
            isNew = true,
        )
    }
}

private fun tokenLabel(token: String): String = t("look.tokens." + token.split("-").mapIndexed { i, p -> if (i == 0) p else p.replaceFirstChar { it.uppercase() } }.joinToString(""))

/** 3.12.3: making or changing a custom theme. Nothing is kept until Save. */
@Composable
fun ThemeBuilder(build: ThemeBuild, customs: List<CustomTheme>) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val host = LocalAnchors.current
    val doc = settingsDoc()
    val draft = build.draft
    val resolved = remember(draft) { CustomThemes.resolve(draft) }
    val simple = (draft.source as? ThemeSource.Simple)?.colours
    val derived = remember(simple) { simple?.let { Derive.deriveTheme(it) } }
    val issues = remember(resolved) { Contrast.issues(resolved.tokens) }
    // the whole app wears the draft while it is open
    LaunchedEffect(resolved) { LookDraft.theme = resolved }
    // back (and the swipe) closes the builder before the page; the page starts at its top again
    DisposableEffect(build) {
        host?.inner = { ThemeEditing.close() }
        onDispose { host?.inner = null }
    }
    LaunchedEffect(build) { host?.scroll?.scrollTo(0) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri != null) runCatching { ctx.contentResolver.openOutputStream(uri)?.use { it.write(CustomThemes.export(build.draft).toByteArray()) } }
    }

    BackRow(t("settings.appearance.appearance")) { Unsaved.unlessUnsaved { ThemeEditing.close() } }
    PageTitle(if (build.fresh) t("settings.themeBuilder.titleNew") else t("settings.themeBuilder.titleEdit"))
    NxTextField(
        draft.name, { build.draft = draft.copy(name = it.take(CustomThemes.MAX_NAME)) },
        label = t("settings.themeBuilder.name"), placeholder = t("settings.themeBuilder.untitled"), capitalize = true,
    )
    Segmented(
        listOf(t("settings.themeBuilder.simple") to "simple", t("settings.themeBuilder.advanced") to "advanced"), build.tab,
        { k ->
            if (k == "advanced") build.tab = "advanced"
            else {
                // Simple works from a few colours; a theme built on a preset brings its own over
                if (draft.source !is ThemeSource.Simple) {
                    val tk = resolved.tokens
                    build.draft = draft.copy(source = build.lastSimple ?: ThemeSource.Simple(SimpleColours(tk.getValue("bg-raised"), tk.getValue("brand"), null, resolved.scheme)))
                }
                build.tab = "simple"
            }
        },
        Modifier.padding(top = 14.dp),
        label = t("settings.themeBuilder.modeLabel"),
    )
    if (doc.str("accent") != null) InfoNotice(t("settings.themeBuilder.accentOverride"), Modifier.padding(top = 14.dp)) {
        NxButton(t("settings.themeBuilder.useThemeAccent"), { setSetting("accent", null as String?) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
    }
    // on a phone the preview comes first, above the editor
    Column(Modifier.padding(top = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Specimen()
        Txt(t("settings.themeBuilder.previewHint"), style = Nx.type.hint, color = c.textMuted)
    }
    Column(Modifier.padding(top = 18.dp)) {
        if (build.tab == "simple" && simple != null && derived != null) SimpleEditor(build, simple, derived)
        else AdvancedEditor(build, resolved.tokens, issues)
    }
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(Modifier.fillMaxWidth().padding(top = 22.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        NxButton(t("settings.themeBuilder.export"), { export.launch(CustomThemes.fileName(build.draft.name)) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Download")
        NxButton(t("settings.themeBuilder.copy"), {
            val ok = copyText(ctx, CustomThemes.export(build.draft))
            Nexa.ui.toast(if (ok) t("settings.themeBuilder.copied") else t("common.copyFailed"), if (ok) "success" else "error")
        }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Copy")
        if (!build.fresh) NxButton(t("settings.themeBuilder.delete"), { deleteTheme(build, customs) }, kind = ButtonKind.GHOST, size = ButtonSize.SM, icon = "Trash2")
    }
}

/** The way back to the page a level is opened over. */
@Composable
private fun BackRow(label: String, onBack: () -> Unit) {
    val c = Nx.colors
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Row(
        Modifier
            .padding(bottom = 10.dp)
            .heightIn(min = 44.dp)
            .clip(Radii.Sm)
            .pressable(remember { MutableInteractionSource() }, onClick = onBack)
            .semantics { contentDescription = t("server.settingsLayer.backTo", "name" to label) }
            .padding(end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(if (rtl) "ChevronRight" else "ChevronLeft", c.textMuted, size = 18.dp)
        Txt(label, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.textMuted)
    }
}

/** Two or three choices side by side in a sunken strip (the builder's tabs, Dark and Light). */
@Composable
fun <T> Segmented(options: List<Pair<String, T>>, value: T, onPick: (T) -> Unit, modifier: Modifier = Modifier, label: String? = null) {
    val c = Nx.colors
    val shape = Radii.Sm
    Row(
        modifier
            .fillMaxWidth()
            .sunken(shape, c)
            .ring(shape, c.borderSubtle)
            .padding(3.dp)
            .semantics { if (label != null) contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for ((name, v) in options) {
            val on = v == value
            val inner = RoundedCornerShape(8.dp)
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .then(if (on) Modifier.ring(inner, c.panelEdge).background(c.bgFloating, inner) else Modifier)
                    .clip(inner)
                    .pressable(remember { MutableInteractionSource() }, role = Role.Tab) { onPick(v) }
                    .semantics { selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Txt(name, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.textMuted, maxLines = 1)
            }
        }
    }
}

/** `.notice`: a note in the builder, with its button. */
@Composable
private fun InfoNotice(text: String, modifier: Modifier = Modifier, warn: Boolean = false, action: (@Composable () -> Unit)? = null) {
    val c = Nx.colors
    val tone = if (warn) c.warning else c.textBrand
    Column(
        modifier
            .fillMaxWidth()
            .background(tone.copy(alpha = 0.10f), Radii.Sm)
            .border(1.dp, tone.copy(alpha = 0.40f), Radii.Sm)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (warn) "TriangleAlert" else "Info", if (warn) c.textWarning else c.textBrand, size = 16.dp)
            Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20f)), color = c.text, modifier = Modifier.weight(1f))
        }
        if (action != null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { action() }
    }
}

// ---- Simple mode ----

@Composable
private fun SimpleEditor(build: ThemeBuild, value: SimpleColours, derived: fish.nexa.ui.theme.look.Derived) {
    fun set(v: SimpleColours) {
        build.draft = build.draft.copy(source = ThemeSource.Simple(v))
        build.lastSimple = ThemeSource.Simple(v)
    }
    Hint(t("settings.themeBuilder.simpleHint"), Modifier.padding(bottom = 12.dp))
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Txt(t("settings.themeBuilder.mode"), style = Nx.type.body.copy(fontWeight = FontWeight(550)), color = Nx.colors.text)
        Segmented(listOf(t("settings.themeBuilder.modeDark") to "dark", t("settings.themeBuilder.modeLight") to "light"), value.scheme, { scheme ->
            // the same tint, carried over to a background of the other kind
            if (scheme != value.scheme) set(value.copy(scheme = scheme, background = Derive.flipBackground(value.background, scheme)))
        }, Modifier.weight(1f), label = t("settings.themeBuilder.mode"))
    }
    // a background picked on the other side of middle grey takes its scheme with it
    ColourField(t("settings.themeBuilder.background"), value.background, { set(value.copy(background = it, scheme = Derive.schemeOf(it))) }, hint = t("settings.themeBuilder.backgroundHint"))
    ColourField(t("settings.themeBuilder.accent"), value.accent, { set(value.copy(accent = it)) }, hint = t("settings.themeBuilder.accentHint"))
    ToggleRow(
        t("settings.themeBuilder.textOwn"), value.text != null,
        { on -> set(value.copy(text = if (on) derived.tokens.getValue("text") else null)) },
        if (value.text == null) t("settings.themeBuilder.textAuto") else null,
        divider = value.text == null,
    )
    value.text?.let { text -> ColourField(t("settings.themeBuilder.text"), text, { set(value.copy(text = it)) }) }
    val moved = listOfNotNull(
        t("settings.themeBuilder.adjustedBackground").takeIf { derived.adjustedBackground },
        t("settings.themeBuilder.adjustedAccent").takeIf { derived.adjustedAccent },
        t("settings.themeBuilder.adjustedText").takeIf { derived.adjustedText },
    )
    if (moved.isNotEmpty()) InfoNotice(moved.joinToString("\n"), Modifier.padding(top = 12.dp))
    val handSet = build.draft.overrides.size
    if (handSet > 0) InfoNotice(t("settings.themeBuilder.handSet", "count" to handSet), Modifier.padding(top = 12.dp)) {
        NxButton(t("settings.themeBuilder.clearHandSet"), { build.draft = build.draft.copy(overrides = emptyMap()) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
    }
    SelectRow(
        t("settings.themeBuilder.startFrom"), "", Presets.ALL.map { t(it.nameKey) to it.id },
        { id -> startingColours(id)?.let { set(it) } },
        sub = t("settings.themeBuilder.startFromHint"), divider = false, placeholder = t("settings.themeBuilder.chooseTheme"),
    )
}

// ---- Advanced mode ----

@Composable
private fun AdvancedEditor(build: ThemeBuild, tokens: Map<String, String>, issues: List<Contrast.Issue>) {
    val c = Nx.colors
    val theme = build.draft
    val base = remember(theme.source) { CustomThemes.sourceTokens(theme.source) }
    val byToken = issues.associateBy { it.token }
    // the first group and any with a problem open by themselves; nothing closes on its own
    val open = remember { mutableStateOf(setOf(Tokens.GROUPS[0].first) + issues.map { Tokens.groupOf(it.token) }) }
    LaunchedEffect(issues) {
        val flagged = issues.map { Tokens.groupOf(it.token) }
        if (flagged.any { it !in open.value }) open.value = open.value + flagged
    }
    fun set(token: String, value: String) {
        val o = LinkedHashMap(theme.overrides)
        // set back to the source's own colour is not set by hand any more
        if (base[token] == value) o.remove(token) else o[token] = value
        build.draft = theme.copy(overrides = o)
    }
    fun reset(token: String) {
        build.draft = theme.copy(overrides = LinkedHashMap(theme.overrides).apply { remove(token) })
    }
    Hint(t("settings.themeBuilder.advancedHint"), Modifier.padding(bottom = 4.dp))
    val sourceValue = (theme.source as? ThemeSource.FromPreset)?.id ?: "simple"
    SelectRow(
        t("settings.themeBuilder.builtOn"), sourceValue,
        (if (build.lastSimple != null) listOf(t("settings.themeBuilder.yourColours") to "simple") else emptyList()) + Presets.ALL.map { t(it.nameKey) to it.id },
        { v ->
            if (v == "simple") build.lastSimple?.let { build.draft = theme.copy(source = it) }
            else build.draft = theme.copy(source = ThemeSource.FromPreset(v))
        },
        sub = t("settings.themeBuilder.builtOnHint"), divider = false,
    )
    if (issues.isNotEmpty()) InfoNotice(t("settings.themeBuilder.issues", "count" to issues.size), Modifier.padding(vertical = 10.dp), warn = true) {
        NxButton(t("settings.themeBuilder.fixIssues"), {
            val fixed = Contrast.fix(tokens)
            val o = LinkedHashMap(theme.overrides)
            for ((k, v) in fixed) if (v != tokens[k]) o[k] = v
            build.draft = theme.copy(overrides = o)
        }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Sparkles")
    }
    for ((group, list) in Tokens.GROUPS) {
        val changed = list.count { it in theme.overrides }
        val bad = list.count { it in byToken }
        val isOpen = group in open.value
        val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 6.dp)
                .heightIn(min = 48.dp)
                .clip(Radii.Sm)
                .pressable(remember { MutableInteractionSource() }) { open.value = if (isOpen) open.value - group else open.value + group }
                .semantics { heading() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(if (isOpen) "ChevronDown" else if (rtl) "ChevronLeft" else "ChevronRight", c.textMuted, size = 16.dp)
            Txt(t("settings.themeBuilder.group.$group"), style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong, modifier = Modifier.weight(1f))
            if (bad > 0) Txt(t("settings.themeBuilder.groupIssues", "count" to bad), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textWarning)
            else if (changed > 0) Txt(t("settings.themeBuilder.groupChanged", "count" to changed), style = Nx.type.hint, color = c.textMuted)
        }
        if (isOpen) for (token in list) {
            val issue = byToken[token]
            ColourField(
                tokenLabel(token), tokens.getValue(token), { set(token, it) },
                name = "--$token", alpha = token in Tokens.ALPHA, changed = token in theme.overrides, onReset = { reset(token) },
                // rounded down, so a 4.46 that fails is never shown as a 4.5 that should pass
                issue = issue?.let { t("settings.themeBuilder.lowContrast", "ratio" to Math.floor(it.ratio * 10) / 10, "min" to it.min) },
            )
        }
    }
}

// ---- one colour ----

/**
 * ColourField: a chip that opens the colour picker, the colour's name (and
 * the web's name for it), its hex code to type, a way back to the source's
 * colour, and for a see-through colour how see-through it is.
 */
@Composable
private fun ColourField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    hint: String? = null,
    name: String? = null,
    alpha: Boolean = false,
    changed: Boolean = false,
    onReset: (() -> Unit)? = null,
    issue: String? = null,
) {
    val c = Nx.colors
    val parsed = Colour.parseColour(value)
    var text by remember { mutableStateOf(value) }
    var bad by remember { mutableStateOf(false) }
    // a change from outside (a reset, the other editor) shows here too
    LaunchedEffect(value) {
        text = value
        bad = false
    }
    fun commit(raw: String) {
        val p = Colour.parseColour(raw)
        if (p == null) {
            bad = raw.isNotBlank()
            return
        }
        bad = false
        onChange(Colour.toThemeHex(p.rgb, if (alpha) p.alpha else 1.0))
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(Radii.Sm)
                    .ring(Radii.Sm, c.borderStrong)
                    .pressable(remember { MutableInteractionSource() }) { openColourPicker(label, value, alpha, onChange) }
                    .semantics { contentDescription = t("settings.themeBuilder.pick", "name" to label) },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    val cell = 6.dp.toPx()
                    drawRect(Color.White)
                    var y = 0f
                    var row = 0
                    while (y < size.height) {
                        var x = if (row % 2 == 0) 0f else cell
                        while (x < size.width) {
                            drawRect(Color(0xFFCCCCCC), androidx.compose.ui.geometry.Offset(x, y), androidx.compose.ui.geometry.Size(cell, cell))
                            x += cell * 2
                        }
                        y += cell
                        row++
                    }
                    drawRect(Looks.color(value))
                }
            }
            Column(Modifier.weight(1f)) {
                Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = c.text)
                if (name != null) Txt(name, style = Nx.type.code.copy(fontSize = Nx.type.sp(12f)), color = c.textMuted)
                if (hint != null) Txt(hint, style = Nx.type.hint, color = c.textMuted)
                if (issue != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon("TriangleAlert", c.textWarning, size = 13.dp)
                    Txt(issue, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textWarning)
                }
            }
        }
        // on a phone the hex code and the way back sit on their own row under the name
        Row(Modifier.padding(start = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            NxTextField(
                text,
                {
                    text = it
                    // taken as soon as it is a whole colour, so the preview follows the typing
                    if (Regex("^#?([0-9a-f]{6}|[0-9a-f]{8})$", RegexOption.IGNORE_CASE).matches(it.trim())) commit(it)
                },
                modifier = Modifier.width(132.dp).semantics { contentDescription = t("settings.themeBuilder.hexFor", "name" to label) },
                error = if (bad) "" else null,
                mono = true,
                imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                onIme = {
                    commit(text)
                    if (Colour.parseColour(text) == null) text = value
                },
            )
            if (onReset != null && changed) fish.nexa.ui.components.IconButton("RotateCcw", t("settings.themeBuilder.resetNamed", "name" to label), onReset, tint = c.textMuted, size = 40.dp, iconSize = 16.dp)
        }
        if (alpha && parsed != null) {
            val pct = Colour.jsRound(parsed.alpha * 100).toInt()
            Column(Modifier.padding(start = 56.dp)) {
                Txt(t("settings.themeBuilder.opacity", "value" to pct), style = Nx.type.hint, color = c.textMuted)
                NxSlider(pct.toFloat(), { v ->
                    val next = v.toInt().coerceIn(0, 100)
                    if (next != pct) onChange(Colour.toThemeHex(parsed.rgb, next / 100.0))
                }, 0f..100f, modifier = Modifier.heightIn(min = 44.dp), label = t("settings.themeBuilder.opacityOf", "name" to label))
            }
        }
    }
}

// ---- the specimen: a slice of a conversation in the theme being made ----

/** ThemeSpecimen; the app already wears the draft, so the theme's colours are the app's own here. */
@Composable
private fun Specimen() {
    val c = Nx.colors
    val shape = Radii.Md
    val small = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f))
    Column(Modifier.fillMaxWidth().clip(shape).ring(shape, c.borderSubtle).background(c.bgRaised, shape)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("Hash", c.icon, size = 15.dp)
            Txt(t("settings.themeBuilder.sampleChannel"), style = small.copy(fontWeight = FontWeight(600)), color = c.textStrong)
        }
        Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
        Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SpecMessage("R", "Robin", c.brand, c.onBrand, Modifier.background(c.bgMessageHover)) {
                androidx.compose.foundation.text.BasicText(
                    buildAnnotatedString {
                        append(t("settings.themeBuilder.sampleHello"))
                        append(" ")
                        withStyle(SpanStyle(background = c.mentionBg, color = c.mentionFg, fontWeight = FontWeight(500))) { append("@Sam") }
                        append(" ")
                        withStyle(SpanStyle(background = c.codeBg, fontFamily = Nx.type.mono, fontSize = Nx.type.sp(11.5f))) { append("theme.css") }
                        append(" ")
                        withStyle(SpanStyle(color = c.link, textDecoration = TextDecoration.Underline)) { append("nexa.example") }
                    },
                    style = small.copy(color = c.text),
                )
            }
            val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
            SpecMessage(
                "S", "Sam", c.positive, c.onPositive,
                Modifier.background(c.brand.copy(alpha = 0.09f)).then(Modifier.ringEdge(c.focusRing, rtl)),
            ) {
                Txt(t("settings.themeBuilder.sampleReply"), style = small, color = c.text)
                androidx.compose.foundation.text.BasicText(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = c.codeComment)) { append("// " + t("settings.themeBuilder.sampleComment")) }
                        append("\n")
                        withStyle(SpanStyle(color = c.codeKeyword)) { append("const") }
                        append(" ")
                        withStyle(SpanStyle(color = c.codeVariable)) { append("theme") }
                        append(" = ")
                        withStyle(SpanStyle(color = c.codeTitle)) { append("make") }
                        append("(")
                        withStyle(SpanStyle(color = c.codeString)) { append("\"dusk\"") }
                        append(", ")
                        withStyle(SpanStyle(color = c.codeNumber)) { append("4.5") }
                        append(");\n")
                        withStyle(SpanStyle(color = c.codeKeyword)) { append("type") }
                        append(" ")
                        withStyle(SpanStyle(color = c.codeType)) { append("Look") }
                        append(" = ")
                        withStyle(SpanStyle(color = c.codeType)) { append("Theme") }
                        append(";")
                    },
                    style = Nx.type.code.copy(fontSize = Nx.type.sp(11.5f), lineHeight = Nx.type.sp(17f), color = c.text),
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .background(c.codeBg, RoundedCornerShape(6.dp))
                        .border(1.dp, c.codeBorder, RoundedCornerShape(6.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }
        }
        Box(
            Modifier
                .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 10.dp)
                .fillMaxWidth()
                .background(c.bgComposer, Radii.Sm)
                .padding(horizontal = 12.dp, vertical = 9.dp),
        ) { Txt(t("settings.themeBuilder.samplePlaceholder"), style = small, color = c.textPlaceholder) }
        Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(Modifier.fillMaxWidth().background(c.bgBase).padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SpecButton(t("settings.themeBuilder.sampleSave"), c.brand, c.onBrand)
            SpecButton(t("settings.themeBuilder.sampleCancel"), c.bgSurface, c.text, c.border)
            SpecButton(t("settings.themeBuilder.sampleAccept"), c.positive, c.onPositive)
            SpecButton(t("settings.themeBuilder.sampleDelete"), c.danger, c.onDanger)
        }
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(Modifier.fillMaxWidth().background(c.bgBase).padding(start = 12.dp, end = 12.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val tiny = Nx.type.hint
            for ((dot, word) in listOf(c.statusOnline to t("shell.user.online"), c.statusIdle to t("shell.user.idle"), c.statusDnd to t("settings.themeBuilder.sampleBusy"))) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Box(Modifier.size(8.dp).background(dot, CircleShape))
                    Txt(word, style = tiny, color = c.text)
                }
            }
            Txt(t("settings.themeBuilder.sampleWarning"), style = tiny, color = c.textWarning)
            Txt(t("settings.themeBuilder.sampleError"), style = tiny, color = c.textDanger)
        }
    }
}

/** The 2 dp bar a message that mentions you carries on its starting edge. */
private fun Modifier.ringEdge(color: Color, rtl: Boolean): Modifier = this.then(
    Modifier.drawBehind {
        val w = 2.dp.toPx()
        drawRect(color, androidx.compose.ui.geometry.Offset(if (rtl) size.width - w else 0f, 0f), androidx.compose.ui.geometry.Size(w, size.height))
    },
)

@Composable
private fun SpecMessage(initial: String, name: String, fill: Color, onFill: Color, modifier: Modifier, body: @Composable () -> Unit) {
    val c = Nx.colors
    Row(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(28.dp).background(fill, CircleShape), contentAlignment = Alignment.Center) {
            Txt(initial, style = Nx.type.hint.copy(fontWeight = FontWeight(700)), color = onFill)
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textStrong)
                Txt(t("settings.appearance.todayAt420Pm"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f)), color = c.textMuted)
            }
            body()
        }
    }
}

@Composable
private fun SpecButton(text: String, fill: Color, fg: Color, edge: Color? = null) {
    val shape = Radii.Xs
    Box(
        Modifier
            .heightIn(min = 26.dp)
            .background(fill, shape)
            .then(if (edge != null) Modifier.border(1.dp, edge, shape) else Modifier)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(text, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = fg) }
}

// ---- saving and deleting ----

private fun saveTheme(build: ThemeBuild, customs: List<CustomTheme>) {
    val d = build.draft
    val next = d.copy(name = d.name.trim().take(CustomThemes.MAX_NAME).ifEmpty { t("settings.themeBuilder.untitled") })
    val list = if (customs.any { it.id == next.id }) customs.map { if (it.id == next.id) next else it } else customs + next
    // saving is choosing: the theme on screen stays on screen
    Nexa.settings.patch(buildJsonObject {
        put("customThemes", JsonArray(list.map { CustomThemes.toJson(it) }))
        put("theme", next.id)
    })
    build.draft = next
    build.saved = next
    build.fresh = false
    Nexa.ui.toast(t("settings.themeBuilder.saved"), "success")
}

private fun deleteTheme(build: ThemeBuild, customs: List<CustomTheme>) {
    val saved = build.saved
    fish.nexa.ui.shell.confirm(
        t("settings.themeBuilder.deleteTitle", "name" to saved.name.ifEmpty { t("settings.themeBuilder.untitled") }),
        t("settings.themeBuilder.deleteBody"),
        t("settings.themeBuilder.delete"),
    ) {
        val doc = Nexa.settings.doc.value
        val gone = saved.id
        val pair = doc.obj("systemThemes")
        val pairDark = pair?.str("dark") ?: "dark"
        val pairLight = pair?.str("light") ?: "light"
        Nexa.settings.patch(buildJsonObject {
            put("customThemes", JsonArray(customs.filter { it.id != gone }.map { CustomThemes.toJson(it) }))
            if (doc.str("theme") == gone) put("theme", "dark")
            if (pairDark == gone || pairLight == gone) put("systemThemes", buildJsonObject {
                put("dark", if (pairDark == gone) "dark" else pairDark)
                put("light", if (pairLight == gone) "light" else pairLight)
            })
        })
        // nothing is left to be unsaved about
        build.saved = build.draft
        build.fresh = false
        ThemeEditing.close()
    }
}

/** The builder's save bar, over the bottom of the Appearance page while a theme is being made or changed. */
@Composable
fun BoxScope.ThemeBuilderSaveBar() {
    val build = ThemeEditing.build
    val customs = customThemes(settingsDoc())
    SaveBar(
        dirty = build?.dirty == true,
        saving = false,
        onReset = { build?.let { if (it.fresh) ThemeEditing.close() else it.draft = it.saved } },
        onSave = { build?.let { saveTheme(it, customs) } },
        text = if (build?.fresh == true) t("settings.themeBuilder.unsavedNew") else t("settings.themeBuilder.unsaved"),
        resetLabel = if (build?.fresh == true) t("settings.themeBuilder.discard") else t("settings.themeBuilder.reset"),
        saveLabel = t("settings.themeBuilder.save"),
    )
}

// ---- Import Theme ----

/** A theme someone shared, pasted or from its file; it opens in the builder first, unsaved. */
fun openImportSheet() {
    val ctl = SheetCtl(t("settings.themeBuilder.importTitle"))
    var text by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    fun go(raw: String) {
        if (raw.isBlank()) return
        when (val r = CustomThemes.import(raw, t("settings.themeBuilder.importedName"))) {
            is CustomThemes.Imported.Ok -> {
                ctl.close()
                ThemeEditing.open(r.theme, isNew = true)
            }
            is CustomThemes.Imported.Failed -> error = when (r.error) {
                "notJson" -> t("settings.themeBuilder.importNotJson")
                "newer" -> t("settings.themeBuilder.importNewer")
                else -> t("settings.themeBuilder.importNotTheme")
            }
        }
    }
    openSettingsSheet("theme-import", ctl, footer = {
        NxButton(t("look.common.cancel"), { it.close() }, kind = ButtonKind.GHOST)
        NxButton(t("settings.themeBuilder.importGo"), { go(text) }, enabled = text.isNotBlank())
    }) {
        val ctx = LocalContext.current
        val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { readAtMost(it, 256 * 1024 + 1) } }.getOrNull()
            when {
                bytes == null -> error = t("settings.themeBuilder.importNotTheme")
                bytes.size > 256 * 1024 -> error = t("settings.themeBuilder.importTooBig")
                else -> {
                    text = bytes.decodeToString()
                    error = null
                    go(text)
                }
            }
        }
        Hint(t("settings.themeBuilder.importHint"))
        NxTextField(
            text,
            {
                text = it
                error = null
            },
            label = t("settings.themeBuilder.importPaste"),
            error = error,
            singleLine = false,
            minLines = 8,
            mono = true,
            imeAction = androidx.compose.ui.text.input.ImeAction.Default,
        )
        NxButton(t("settings.themeBuilder.importFile"), { pick.launch("*/*") }, kind = ButtonKind.SECONDARY, icon = "FileUp")
    }
}

/** Up to [limit] bytes of a stream: enough to tell a theme from a file far too big to be one. */
private fun readAtMost(input: java.io.InputStream, limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(16 * 1024)
    while (out.size() < limit) {
        val n = input.read(buf, 0, minOf(buf.size, limit - out.size()))
        if (n < 0) break
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
