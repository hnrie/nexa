package fish.nexa.ui.theme.look

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import fish.nexa.ui.theme.NexaColors
import fish.nexa.ui.theme.Palettes

/** What a theme choice comes to on this device right now (lib/theme.ts Look). */
data class ResolvedLook(
    /** The theme drawn: Sync with System is already one of its pair. */
    val id: String,
    val scheme: String,
    /** The classic theme underneath: its own palette for a classic theme, dark or light otherwise. */
    val classic: String,
    /** The palette; null for a classic theme, which [Palettes] holds as the stylesheet declares it. */
    val tokens: TokenMap?,
    val underlineLinks: Boolean,
)

/**
 * A theme being edited in the builder: the whole app wears it until it is
 * saved or dropped (lib/look/draft.ts).
 */
object LookDraft {
    var theme by mutableStateOf<ResolvedTheme?>(null)
}

/** lib/theme.ts: from the settings' theme, accent and custom themes to the palette the app draws with. */
object Looks {
    /** The panel of each classic theme that is hardest to read on, for anything worked out from the accent. */
    val SURFACE_BG = mapOf("dark" to "#2b2636", "light" to "#eae8f3", "ash" to "#27282e", "onyx" to "#16141b")

    private fun shadeKeeping(brand: String, fg: String, delta: Double): String {
        for (i in 10 downTo 1) {
            val out = Colour.shade(brand, (delta * i) / 10)
            if (Colour.contrast(out, fg) >= 4.5) return out
        }
        return brand
    }

    /** `rgb(r g b / a)`, as the web writes a see-through accent. */
    private fun withAlpha(hex: String, alpha: Double): String {
        val rgb = Colour.parseHex(hex) ?: return hex
        val a = if (alpha == Math.floor(alpha)) alpha.toLong().toString() else alpha.toString()
        return "rgb(${Colour.jsRound(rgb.r).toInt()} ${Colour.jsRound(rgb.g).toInt()} ${Colour.jsRound(rgb.b).toInt()} / $a)"
    }

    /**
     * Every colour a chosen accent implies (accentVarsOn), in HSL steps as the
     * web has always made them; null when the accent is not a colour.
     */
    fun accentVarsOn(accent: String, surface: String, scheme: String): Map<String, String>? {
        val rgb = Colour.parseHex(accent) ?: return null
        val brand = Colour.toHex(rgb)
        val fg = Colour.readableOn(brand)
        val dir = if (Colour.rgbToHsl(rgb).l > 0.22) -1 else 1
        val hover = shadeKeeping(brand, fg, dir * 0.1)
        val active = shadeKeeping(brand, fg, dir * 0.18)
        val (rest, hovered) = if (scheme == "light") 0.16 to 0.32 else 0.26 to 0.42
        val pill = Colour.toHex(Colour.blend(brand, surface, hovered))
        return linkedMapOf(
            "brand" to brand,
            "brand-hover" to hover,
            "brand-active" to active,
            "on-brand" to fg,
            "focus-ring" to Colour.tuneForContrast(brand, surface, 3.0),
            "mention-bg" to withAlpha(brand, rest),
            "mention-bg-hover" to withAlpha(brand, hovered),
            "mention-fg" to Colour.tuneForContrast(brand, pill, 4.5),
            "text-brand" to Colour.tuneForContrast(brand, surface, 4.5),
        )
    }

    private fun lookOf(id: String, customs: List<CustomTheme>): ResolvedLook? {
        if (Tokens.isClassic(id)) return ResolvedLook(id, if (id == "light") "light" else "dark", id, null, false)
        Presets.byId(id)?.let { p -> return ResolvedLook(id, p.scheme, p.scheme, Presets.tokens(id), p.underlineLinks) }
        // a seasonal theme out of its season is not there to draw, so it comes out as Dark below
        Seasonal.active(id, java.time.LocalDate.now())?.let { s -> return ResolvedLook(id, s.scheme, s.scheme, Seasonal.tokens(id), false) }
        val custom = if (CustomThemes.isCustomId(id)) customs.firstOrNull { it.id == id } else null
        custom ?: return null
        val r = CustomThemes.resolve(custom)
        return ResolvedLook(id, r.scheme, r.scheme, r.tokens, CustomThemes.underlines(custom))
    }

    /** The theme to draw; one that is not there any more (deleted on another device, or out of its season) draws as Dark. */
    fun resolve(theme: String, prefersLight: Boolean, pairDark: String?, pairLight: String?, customs: List<CustomTheme>): ResolvedLook {
        val id = if (theme == "system") (if (prefersLight) pairLight ?: "light" else pairDark ?: "dark") else theme
        return lookOf(id, customs) ?: lookOf(if (prefersLight && theme == "system") "light" else "dark", emptyList())!!
    }

    /** The panel anything worked out from the accent has to be read against. */
    fun hardestSurface(look: ResolvedLook): String {
        val t = look.tokens ?: return SURFACE_BG.getValue(look.classic)
        val panels = listOf("bg-surface", "bg-raised", "bg-base", "bg-floating").map { Colour.toHex(Colour.parseColour(t.getValue(it))?.rgb ?: Colour.Rgb(0.0, 0.0, 0.0)) }
        return panels.reduce { worst, p ->
            if (if (look.scheme == "dark") Colour.luminance(p) > Colour.luminance(worst) else Colour.luminance(p) < Colour.luminance(worst)) p else worst
        }
    }

    /** A theme value as a colour to draw with. */
    fun color(value: String): Color {
        val c = Colour.parseColour(value) ?: return Color.Magenta
        return Color((c.rgb.r / 255).toFloat(), (c.rgb.g / 255).toFloat(), (c.rgb.b / 255).toFloat(), c.alpha.toFloat())
    }

    /** A palette as the app's colours. */
    fun fromTokens(name: String, light: Boolean, t: TokenMap): NexaColors {
        fun c(k: String) = color(t.getValue(k))
        return NexaColors(
            name = name, isLight = light,
            bgBase = c("bg-base"), bgRaised = c("bg-raised"), bgSurface = c("bg-surface"), bgFloating = c("bg-floating"),
            bgInput = c("bg-input"), bgComposer = c("bg-composer"), bgHover = c("bg-hover"), bgSelected = c("bg-selected"),
            bgActive = c("bg-active"), bgMessageHover = c("bg-message-hover"), bgOverlay = c("bg-overlay"),
            text = c("text"), textStrong = c("text-strong"), textSubtle = c("text-subtle"), textMuted = c("text-muted"),
            textChannel = c("text-channel"), textPlaceholder = c("text-placeholder"), icon = c("icon"),
            brand = c("brand"), brandHover = c("brand-hover"), brandActive = c("brand-active"), onBrand = c("on-brand"),
            onDanger = c("on-danger"), onPositive = c("on-positive"), onWarning = c("on-warning"), focusRing = c("focus-ring"),
            link = c("link"), textBrand = c("text-brand"), mentionBg = c("mention-bg"), mentionBgHover = c("mention-bg-hover"),
            mentionFg = c("mention-fg"), positive = c("positive"), positiveHover = c("positive-hover"), warning = c("warning"),
            textWarning = c("text-warning"), danger = c("danger"), dangerHover = c("danger-hover"), textDanger = c("text-danger"),
            statusOnline = c("status-online"), statusIdle = c("status-idle"), statusDnd = c("status-dnd"), statusOffline = c("status-offline"),
            borderSubtle = c("border-subtle"), border = c("border"), borderStrong = c("border-strong"),
            spoiler = c("spoiler"), spoilerRevealed = c("spoiler-revealed"), codeBg = c("code-bg"), codeBorder = c("code-border"),
            codeKeyword = c("code-keyword"), codeString = c("code-string"), codeNumber = c("code-number"), codeComment = c("code-comment"),
            codeTitle = c("code-title"), codeType = c("code-type"), codeVariable = c("code-variable"),
            embedBg = c("embed-bg"), tooltipBg = c("tooltip-bg"), tooltipText = c("tooltip-text"),
        )
    }

    /** The colours to draw a look with, the accent laid over it when one is chosen. */
    fun colors(look: ResolvedLook, accent: String?): NexaColors {
        val base = look.tokens?.let { fromTokens(look.id, look.scheme == "light", it) } ?: Palettes.byName(look.classic)
        val v = accent?.let { accentVarsOn(it, hardestSurface(look), look.scheme) } ?: return base
        fun c(k: String) = color(v.getValue(k))
        return base.copy(
            brand = c("brand"), brandHover = c("brand-hover"), brandActive = c("brand-active"), onBrand = c("on-brand"),
            focusRing = c("focus-ring"), mentionBg = c("mention-bg"), mentionBgHover = c("mention-bg-hover"),
            mentionFg = c("mention-fg"), textBrand = c("text-brand"),
        )
    }

    /** The colours of a theme for its picture in the gallery: its own, no accent over it. */
    fun preview(id: String, customs: List<CustomTheme>): NexaColors? = lookOf(id, customs)?.let { colors(it, null) }
}
