package fish.nexa.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxSlider
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.NexaColors
import fish.nexa.ui.theme.NexaFonts
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.look.Colour
import fish.nexa.ui.theme.look.CustomTheme
import fish.nexa.ui.theme.look.CustomThemes
import fish.nexa.ui.theme.look.Looks
import fish.nexa.ui.theme.look.Presets
import fish.nexa.ui.theme.look.Season
import fish.nexa.ui.theme.look.Seasonal
import fish.nexa.ui.theme.look.SimpleColours
import fish.nexa.ui.theme.look.ThemeSource
import fish.nexa.ui.theme.look.Tokens
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.roundToInt

/** The accent the app uses until one is picked; the Default swatch stands for it. */
private const val DEFAULT_ACCENT = "#8000ff"
private val ACCENTS = listOf("#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#3498db", "#e91e63")

/** The name a theme is shown under, whatever kind it is (themeName). */
fun themeName(id: String, customs: List<CustomTheme>): String {
    if (id == "system") return t("settings.appearance.themeSystem")
    Presets.byId(id)?.let { return t(it.nameKey) }
    Seasonal.byId(id)?.let { return t(it.nameKey) }
    val custom = customs.firstOrNull { it.id == id }
    return custom?.let { it.name.ifEmpty { t("settings.themeBuilder.untitled") } } ?: t("settings.appearance.themeDark")
}

/** A theme's own few colours, for a new theme or Start From (startingColours). */
fun startingColours(id: String): SimpleColours? {
    Presets.colours(id)?.let { return it }
    // a seasonal theme gives its own, so a new theme made while wearing one can keep its colours after the season
    Seasonal.byId(id)?.let { return SimpleColours(it.background, it.accent, null, it.scheme) }
    val classic = Tokens.CLASSIC[id] ?: return null
    return SimpleColours(classic.getValue("bg-raised"), classic.getValue("brand"), null, if (id == "light") "light" else "dark")
}

/** The custom themes in the settings, checked: they arrive from every device of the account. */
@Composable
fun customThemes(doc: JsonObject): List<CustomTheme> = remember(doc["customThemes"]) { CustomThemes.sanitizeAll(doc["customThemes"]) }

/** 3.12 Appearance: the theme, the accent, the font and the text size; or the Theme Builder over it. */
@Composable
fun AppearancePage() {
    val doc = settingsDoc()
    val customs = customThemes(doc)
    DisposableEffect(Unit) { onDispose { ThemeEditing.close() } }
    val editing = ThemeEditing.build
    if (editing != null) {
        ThemeBuilder(editing, customs)
        return
    }
    val c = Nx.colors
    val me = Nexa.users.me.collectAsState().value
    val theme = doc.str("theme") ?: "dark"
    val pair = doc.obj("systemThemes")
    val pairDark = pair?.str("dark") ?: "dark"
    val pairLight = pair?.str("light") ?: "light"
    val accentSet = doc.str("accent")
    // the default picked by hand is still the default
    val accent = accentSet?.takeIf { it != DEFAULT_ACCENT }
    val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
    val shown = remember(theme, pairDark, pairLight, customs, systemDark) { Looks.resolve(theme, !systemDark, pairDark, pairLight, customs) }
    val themeAccent = CustomThemes.themeTokens(shown.id, customs)?.get("brand") ?: DEFAULT_ACCENT

    PageTitle(t("settings.appearance.appearance"))
    Hint(t("settings.appearance.lead"), Modifier.padding(bottom = 4.dp).graphicsLayer { translationY = -8f * density })
    SectionHeading(t("settings.appearance.theme"), Modifier.settingAnchor("theme"))
    ThemeGallery(theme, shown.id, shown.scheme, pairDark, pairLight, customs)

    SectionHeading(t("settings.appearance.accentColour"), Modifier.settingAnchor("accent"))
    Hint(t("settings.appearance.accentHint"), Modifier.padding(bottom = 10.dp))
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val fill = Looks.color(themeAccent)
        Swatch(fill, accent == null, t("settings.appearance.accentDefault"), { setSetting("accent", null as String?) }) {
            if (accent == null) Icon("Check", Looks.color(Colour.readableOn(themeAccent)), size = 20.dp)
        }
        ACCENTS.forEachIndexed { i, hex ->
            Swatch(Looks.color(hex), accent == hex, t("server.roles.colourIndexOfCount", "index" to i + 1, "count" to ACCENTS.size), { setSetting("accent", hex) }) {
                if (accent == hex) Icon("Check", Looks.color(Colour.readableOn(hex)), size = 20.dp)
            }
        }
        val custom = accent != null && accent !in ACCENTS
        Swatch(if (custom) Looks.color(accent!!) else c.bgSurface, custom, t("settings.appearance.custom"), {
            openColourPicker(t("settings.appearance.custom"), accent ?: themeAccent, alpha = false) { setSetting("accent", it) }
        }) {
            if (custom) Icon("Check", Looks.color(Colour.readableOn(accent!!)), size = 20.dp) else Icon("Pipette", c.icon, size = 18.dp)
        }
    }

    SectionHeading(t("settings.appearance.font"), Modifier.settingAnchor("font"))
    val face = doc.str("fontFace") ?: "default"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for (f in listOf("default", "classic")) FontTile(f, face == f, Modifier.weight(1f)) { setSetting("fontFace", f) }
    }

    val scale = ((doc["fontScale"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it > 0 } ?: 1.0)
    val px = (scale * 16).roundToInt()
    SectionHeading(t("settings.appearance.textSize"), Modifier.settingAnchor("textSize")) {
        Txt(t("settings.appearance.textSizeValue", "px" to px), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.textMuted)
    }
    NxSlider(px.toFloat(), { v ->
        val next = v.roundToInt().coerceIn(12, 20)
        if (next != px) setSetting("fontScale", kotlinx.serialization.json.JsonPrimitive(next / 16.0))
    }, 12f..20f, modifier = Modifier.heightIn(min = 48.dp), label = t("settings.appearance.fontSize"))
    // what the slider promises: a message at that size
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        val name = me?.displayName?.ifEmpty { null } ?: "You"
        Avatar(me?.id ?: "0", name, me?.avatarId, 40.dp)
        Column {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(name, style = Nx.type.name, color = c.textStrong)
                Txt(t("settings.appearance.todayAt420Pm"), style = Nx.type.timestamp, color = c.textMuted, modifier = Modifier.padding(bottom = 2.dp))
            }
            Txt(t("settings.appearance.lookAtMeIMA"), style = Nx.type.body, color = c.text)
            Txt(t("settings.appearance.waitingForTheDayWhen"), style = Nx.type.body, color = c.text)
        }
    }
}

// ---- the gallery ----

// a theme's light version shares its dark one's card, so the colour themes are one group rather than a dark and a light one
private val GROUPS = listOf(
    "classic" to "settings.appearance.groupClassic",
    "colours" to "settings.appearance.groupColours",
    "plain" to "settings.appearance.groupPlain",
)
private val GROUP_PRESETS = mapOf("classic" to listOf("classic"), "colours" to listOf("dark", "light"), "plain" to listOf("plain"))

@Composable
private fun ThemeGallery(theme: String, shownId: String, mode: String, pairDark: String, pairLight: String, customs: List<CustomTheme>) {
    // A card that comes in light and dark shows, and puts on, the version in the
    // mode being worn now ([mode], the shown look's scheme): from a dark theme
    // every such card offers its dark version, so going from one to another never
    // switches light and dark.
    val colorsOf = remember(customs) { HashMap<String, NexaColors>() }
    fun colors(id: String): NexaColors = colorsOf.getOrPut(id) { Looks.preview(id, customs) ?: Looks.preview("dark", emptyList())!! }
    fun schemeOf(id: String): String = customs.firstOrNull { it.id == id }?.let { CustomThemes.resolve(it).scheme } ?: Presets.byId(id)?.scheme ?: "dark"
    val pick = { id: String -> setSetting("theme", id) }

    // only while a season is on: offered alongside the rest, never put on by itself
    val today by Seasonal.today.collectAsState()
    val seasons = remember(today) { Seasonal.on(today) }
    if (seasons.isNotEmpty()) {
        GroupTitle(t("settings.appearance.groupSeasonal"))
        CardGrid { w ->
            for ((light, dark) in Seasonal.cards(seasons)) {
                val x = if (dark != null && mode == "dark") dark else light
                val until = t("settings.appearance.seasonUntil", "date" to Seasonal.end(x, today).format(java.time.format.DateTimeFormatter.ofPattern(android.text.format.DateFormat.getBestDateTimePattern(fish.nexa.ui.I18n.locale, "MMMMd"), fish.nexa.ui.I18n.locale)))
                ThemeCard(t(light.nameKey), theme == x.id, w, { pick(x.id) }, note = until) {
                    Miniature(colors(x.id))
                    SeasonOnMiniature(x)
                    if (dark != null) ThemeModes(light.id, dark.id, x.id, pick) { colors(it).bgRaised }
                }
            }
        }
        Hint(t("settings.appearance.seasonalHint"), Modifier.padding(top = 10.dp))
        if (seasons.any { it.snow }) {
            val doc = settingsDoc()
            ToggleRow(
                t("settings.appearance.seasonalSnow"), doc.bool("seasonalSnow", true), { setSetting("seasonalSnow", it) },
                t("settings.appearance.seasonalSnowHint"), anchor = "seasonalSnow",
            )
        }
    }

    for ((group, label) in GROUPS) {
        GroupTitle(t(label))
        CardGrid { w ->
            for ((p, light, dark) in Presets.cards(GROUP_PRESETS.getValue(group))) {
                val x = if (light != null && mode == "light") light else p
                ThemeCard(t(p.nameKey), theme == x.id, w, { pick(x.id) }) {
                    Miniature(colors(x.id))
                    if (light != null && dark != null) ThemeModes(light.id, dark.id, x.id, pick) { colors(it).bgRaised }
                }
            }
            if (group == "classic") ThemeCard(t("settings.appearance.themeSystem"), theme == "system", w, { pick("system") }) {
                SplitMiniature(colors(pairDark), colors(pairLight))
            }
        }
        if (group == "classic" && theme == "system") PairPanel(pairDark, pairLight, customs, ::schemeOf)
    }

    GroupTitle(t("settings.appearance.groupYours")) {
        NxButton(t("settings.appearance.importTheme"), { openImportSheet() }, kind = ButtonKind.GHOST, size = ButtonSize.SM, icon = "Upload")
    }
    val full = customs.size >= CustomThemes.MAX
    CardGrid { w ->
        for (ct in customs) {
            val name = ct.name.ifEmpty { t("settings.themeBuilder.untitled") }
            ThemeCard(name, theme == ct.id, w, { pick(ct.id) }, edit = { ThemeEditing.open(ct, isNew = false) }, editLabel = t("settings.appearance.editTheme", "name" to name)) {
                Miniature(colors(ct.id))
            }
        }
        if (!full) NewThemeCard(w) { ThemeEditing.startNew(shownId, customs) }
    }
    if (full) Hint(t("settings.themeBuilder.limit", "max" to CustomThemes.MAX), Modifier.padding(top = 8.dp))
}

@Composable
private fun GroupTitle(text: String, actions: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(text, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = Nx.colors.textSubtle, modifier = Modifier.weight(1f))
        actions?.invoke()
    }
}

/** Two cards a row, as the web lays them out on a phone; [content] hears how wide each is. */
@Composable
private fun CardGrid(content: @Composable (Dp) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        // whole pixels, or two halves can round to a hair over the row and wrap one card a row
        val density = androidx.compose.ui.platform.LocalDensity.current
        val w = with(density) { (((maxWidth - 10.dp).toPx() / 2).toInt()).toDp() }
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(12.dp), maxItemsInEachRow = 2) {
            content(w)
        }
    }
}

/** `.card`: the theme's picture and its name; chosen, ringed in the accent with a tick. */
@Composable
private fun ThemeCard(name: String, on: Boolean, width: Dp, onPick: () -> Unit, edit: (() -> Unit)? = null, editLabel: String? = null, note: String? = null, art: @Composable BoxScope.() -> Unit) {
    val c = Nx.colors
    val shape = Radii.Md
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Column(
        Modifier
            .width(width)
            .pressable(interaction, role = Role.RadioButton, onClick = onPick)
            .semantics {
                selected = on
                contentDescription = name
            },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .graphicsLayer { translationY = if (pressed) 1f * density else 0f }
                .then(if (on) Modifier.ring(shape, c.brand, 4.dp).ring(shape, c.bgRaised, 2.dp) else Modifier.shadowLow(shape, c))
                .clip(shape)
                .border(1.dp, c.borderSubtle, shape),
        ) {
            art()
            if (on) Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(22.dp)
                    .ring(CircleShape, c.bgRaised, 2.dp)
                    .background(brandGradient(c), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon("Check", c.onBrand, size = 14.dp) }
            if (edit != null) Box(
                Modifier
                    .align(Alignment.TopStart)
                    .size(40.dp)
                    .pressable(remember { MutableInteractionSource() }, onClick = edit)
                    .semantics { contentDescription = editLabel ?: "" },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(30.dp).shadowLow(Radii.Xs, c).background(c.bgFloating, Radii.Xs), contentAlignment = Alignment.Center) {
                    Icon("Pencil", c.text, size = 15.dp)
                }
            }
        }
        Txt(name, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600), lineHeight = Nx.type.sp(18f)), color = if (on) c.textStrong else c.text, modifier = Modifier.padding(horizontal = 2.dp))
        if (note != null) Txt(note, style = Nx.type.hint, color = c.textMuted, modifier = Modifier.padding(horizontal = 2.dp).graphicsLayer { translationY = -6f * density })
    }
}

/**
 * A theme's light and dark versions as two swatches in its card's corner
 * (ModeCard, `.modes`): each is that version's own background and puts it on,
 * and the one the card shows is ringed in the accent.
 */
@Composable
private fun BoxScope.ThemeModes(light: String, dark: String, on: String, pick: (String) -> Unit, swatch: (String) -> Color) {
    val c = Nx.colors
    Row(Modifier.align(Alignment.TopStart).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (m in listOf(light, dark)) {
            val selected = m == on
            val label = t(if (m == dark) "settings.appearance.themeDark" else "settings.appearance.themeLight")
            Box(
                Modifier
                    .size(28.dp)
                    .then(if (selected) Modifier.ring(CircleShape, c.brand, 4.dp).ring(CircleShape, c.bgRaised, 2.dp) else Modifier.ring(CircleShape, c.borderStrong, 1.5.dp))
                    .background(swatch(m), CircleShape)
                    .pressable(remember { MutableInteractionSource() }, role = Role.RadioButton) { pick(m) }
                    .semantics {
                        this.selected = selected
                        contentDescription = label
                    },
            )
        }
    }
}

/** A seasonal theme's picture perched on its miniature's message box, as it sits on the real one (`.seasonArt`). */
@Composable
private fun BoxScope.SeasonOnMiniature(s: Season) {
    BoxWithConstraints(Modifier.matchParentSize()) {
        coil3.compose.AsyncImage(s.art, null, Modifier.align(Alignment.BottomEnd).padding(end = maxWidth * 0.09f, bottom = maxHeight * 0.24f - 3.dp).size(maxWidth * 0.19f))
    }
}

@Composable
private fun NewThemeCard(width: Dp, onClick: () -> Unit) {
    val c = Nx.colors
    Column(
        Modifier.width(width).pressable(remember { MutableInteractionSource() }, onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .clip(Radii.Md)
                .dashedBorder(c.borderStrong, 14.dp),
            contentAlignment = Alignment.Center,
        ) { Icon("Plus", c.textMuted, size = 22.dp) }
        Txt(t("settings.appearance.newTheme"), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.text, modifier = Modifier.padding(horizontal = 2.dp))
    }
}

/** A 1.5 dp dashed outline, for the card that makes something new. */
private fun Modifier.dashedBorder(color: Color, radius: Dp): Modifier = this.drawBehind {
    val stroke = 1.5.dp.toPx()
    drawRoundRect(
        color,
        topLeft = Offset(stroke / 2, stroke / 2),
        size = Size(size.width - stroke, size.height - stroke),
        cornerRadius = CornerRadius(radius.toPx()),
        style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
    )
}

/** The two themes Sync with System moves between. */
@Composable
private fun PairPanel(pairDark: String, pairLight: String, customs: List<CustomTheme>, schemeOf: (String) -> String) {
    val c = Nx.colors
    val ids = Presets.ALL.map { it.id } + customs.map { it.id }
    fun choices(scheme: String) = ids.filter { schemeOf(it) == scheme }.map { themeName(it, customs) to it }
    val shape = Radii.Md
    Column(
        Modifier
            .padding(top = 14.dp)
            .fillMaxWidth()
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .padding(horizontal = 14.dp, vertical = 4.dp),
    ) {
        SelectRow(t("settings.appearance.systemDark"), if (schemeOf(pairDark) == "dark") pairDark else "dark", choices("dark"), { patchNested("systemThemes", mapOf("dark" to JsonPrimitive(it), "light" to JsonPrimitive(pairLight))) })
        SelectRow(t("settings.appearance.systemLight"), if (schemeOf(pairLight) == "light") pairLight else "light", choices("light"), { patchNested("systemThemes", mapOf("dark" to JsonPrimitive(pairDark), "light" to JsonPrimitive(it))) }, divider = false)
        Hint(t("settings.appearance.systemHint"), Modifier.padding(bottom = 12.dp))
    }
}

// ---- a theme drawn as a very small Nexa (ThemeMiniature) ----

@Composable
fun Miniature(colors: NexaColors) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Canvas(Modifier.fillMaxSize().graphicsLayer { if (rtl) scaleX = -1f }) { drawMiniature(colors) }
}

/** Sync with System: the dark one of the pair with the light one laid across it. */
@Composable
private fun SplitMiniature(dark: NexaColors, light: NexaColors) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Canvas(Modifier.fillMaxSize().graphicsLayer { if (rtl) scaleX = -1f }) {
        drawMiniature(dark)
        val cut = Path().apply {
            moveTo(size.width, 0f)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        clipPath(cut) { drawMiniature(light) }
    }
}

private fun DrawScope.drawMiniature(k: NexaColors) {
    val w = size.width
    val h = size.height
    // the web draws it about 170 px wide; its fixed sizes scale with the card here
    val u = w / 170f
    fun pill(color: Color, x: Float, y: Float, width: Float, height: Float, r: Float = height / 2, alpha: Float = 1f) =
        drawRoundRect(color.copy(alpha = color.alpha * alpha), Offset(x, y), Size(width, height), CornerRadius(r))
    // the canvas, with a faint accent glow from the top corner
    drawRect(k.bgRail)
    drawRect(Brush.radialGradient(listOf(k.brand.copy(alpha = 0.14f), Color.Transparent), center = Offset.Zero, radius = maxOf(w, h) * 0.7f))
    val pad = 0.035f * w
    val inner = w - pad
    val railW = 0.11f * inner
    val gap = 0.03f * inner
    val sideW = 0.27f * inner
    val mainX = railW + gap + sideW + gap
    val mainW = w - pad - mainX
    val top = pad
    val bodyH = h - 2 * pad
    // rail: the logo in the accent and two servers
    val icon = 0.62f * railW
    var y = top + 0.14f * railW
    pill(k.brand, (railW - icon) / 2, y, icon, icon, icon * 0.3f)
    repeat(2) {
        y += icon + 0.05f * bodyH
        pill(k.bgSurface, (railW - icon) / 2, y, icon, icon, icon * 0.32f)
    }
    // channel list
    val sideX = railW + gap
    drawRoundRect(k.bgBase, Offset(sideX, top), Size(sideW, bodyH), CornerRadius(5 * u))
    drawRoundRect(k.textStrong.copy(alpha = 0.08f), Offset(sideX, top), Size(sideW, bodyH), CornerRadius(5 * u), style = androidx.compose.ui.graphics.drawscope.Stroke(0.5f * u))
    val lx = sideX + 0.08f * sideW
    val lw = sideW * 0.82f
    var ly = top + 0.2f * sideW
    val line = 5 * u
    val step = line + 0.09f * bodyH
    pill(k.textChannel, lx, ly, lw * 0.70f, line, alpha = 0.85f)
    ly += step
    drawRoundRect(k.bgSelected, Offset(sideX + 0.02f * sideW, ly - 3 * u), Size(sideW * 0.96f, 11 * u), CornerRadius(3 * u))
    pill(k.textStrong, lx, ly, lw * 0.72f, line)
    ly += step + 3 * u
    pill(k.textChannel, lx, ly, lw * 0.60f, line, alpha = 0.85f)
    ly += step
    pill(k.textChannel, lx, ly, lw * 0.76f, line, alpha = 0.85f)
    // the conversation
    drawRoundRect(k.bgRaised, Offset(mainX, top), Size(mainW, bodyH), CornerRadius(5 * u))
    drawRoundRect(k.textStrong.copy(alpha = 0.08f), Offset(mainX, top), Size(mainW, bodyH), CornerRadius(5 * u), style = androidx.compose.ui.graphics.drawscope.Stroke(0.5f * u))
    val mx = mainX + 0.08f * mainW
    val av = 13 * u
    val tx = mx + av + 0.07f * (mainW * 0.84f)
    val tw = mainX + mainW - 0.08f * mainW - tx
    var my = top + 0.12f * mainW
    drawCircle(k.brandActive, av / 2, Offset(mx + av / 2, my + av / 2))
    pill(k.textStrong, tx, my, tw * 0.42f, 5 * u)
    var rowY = my + 5 * u + 4 * u
    pill(k.textMuted, tx, rowY + 1.5f * u, tw * 0.34f, 4 * u)
    val chipX = tx + tw * 0.34f + 4 * u
    drawRoundRect(k.mentionBgHover, Offset(chipX, rowY), Size(tw * 0.26f, 7 * u), CornerRadius(2 * u))
    drawRect(k.mentionFg, Offset(chipX, rowY + 7 * u - 2.5f * u), Size(tw * 0.26f, 2.5f * u))
    pill(k.textMuted, chipX + tw * 0.26f + 4 * u, rowY + 1.5f * u, tw * 0.22f, 4 * u)
    rowY += 7 * u + 4 * u
    pill(k.link, tx, rowY, tw * 0.38f, 4 * u)
    pill(k.textMuted, tx + tw * 0.38f + 4 * u, rowY, tw * 0.30f, 4 * u)
    my = rowY + 4 * u + 0.08f * bodyH
    drawCircle(k.statusOnline, av / 2, Offset(mx + av / 2, my + av / 2))
    pill(k.textStrong, tx, my, tw * 0.30f, 5 * u)
    pill(k.textMuted, tx, my + 9 * u, tw * 0.58f, 4 * u)
    // the message box
    val cw = mainW * 0.84f
    val ch = bodyH * 0.16f
    val cy = top + bodyH - 0.08f * mainW - ch
    drawRoundRect(k.bgComposer, Offset(mainX + 0.08f * mainW, cy), Size(cw, ch), CornerRadius(4 * u))
    pill(k.textPlaceholder, mainX + 0.08f * mainW + 0.05f * cw, cy + ch / 2 - 2 * u, cw * 0.44f, 4 * u)
}

// ---- the font and text size ----

@Composable
private fun FontTile(face: String, on: Boolean, modifier: Modifier, onPick: () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Md
    Row(
        modifier
            .then(
                if (on) Modifier.ring(shape, c.brand.copy(alpha = 0.8f), 2.dp).background(mixOklab(c.bgSurface, c.brand, 0.10f), shape)
                else Modifier.ring(shape, c.borderSubtle).background(c.bgSurface, shape),
            )
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, role = Role.RadioButton, onClick = onPick)
            .semantics { selected = on }
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Txt(
            "Aa",
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = if (face == "classic") NexaFonts.classicDisplay else NexaFonts.display,
                fontWeight = FontWeight(if (face == "classic") 800 else 700),
                fontSize = Nx.type.sp(30f),
            ),
            color = c.textStrong,
        )
        Column(Modifier.weight(1f)) {
            Txt(t(if (face == "classic") "settings.appearance.fontClassic" else "settings.appearance.fontDefault"), style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
            Txt(if (face == "classic") "Onest, Mona Sans" else "Wix Madefor", style = Nx.type.hint, color = c.textMuted, maxLines = 1)
        }
        if (on) Icon("Check", c.textBrand, size = 16.dp)
        else Spacer(Modifier.size(16.dp))
    }
}
