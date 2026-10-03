package fish.nexa.ui.theme.look

import fish.nexa.ui.theme.look.Colour.Oklch
import fish.nexa.ui.theme.look.Colour.Side
import fish.nexa.ui.theme.look.Colour.ensureContrast
import fish.nexa.ui.theme.look.Colour.flatten
import fish.nexa.ui.theme.look.Colour.hexToOklch
import fish.nexa.ui.theme.look.Colour.luminance
import fish.nexa.ui.theme.look.Colour.mixOk
import fish.nexa.ui.theme.look.Colour.oklchToHex
import fish.nexa.ui.theme.look.Colour.parseColour
import fish.nexa.ui.theme.look.Colour.readableOn
import fish.nexa.ui.theme.look.Colour.toHex
import fish.nexa.ui.theme.look.Colour.toThemeHex
import fish.nexa.ui.theme.look.Colour.withLuminance

/** A few colours the rest of a theme is worked out from; `text` null to have it worked out too. */
data class SimpleColours(val background: String, val accent: String, val text: String?, val scheme: String)

/** What deriveTheme made: the palette, and what it had to move to keep everything readable. */
data class Derived(val tokens: TokenMap, val scheme: String, val background: String, val adjustedBackground: Boolean, val adjustedAccent: Boolean, val adjustedText: Boolean)

/**
 * lib/look/derive.ts: a whole theme from a background, an accent and maybe a
 * text colour, every piece of text at WCAG AA or better on every surface it
 * is drawn on. The simple theme builder and the gallery's colour presets both
 * come out of it.
 */
object Derive {
    private val RANGE = mapOf("dark" to (0.0 to 0.07), "light" to (0.6 to 1.0))
    private val HIGH_RANGE = mapOf("dark" to (0.0 to 0.02), "light" to (0.8 to 1.0))
    private val FLIP_TO = mapOf("dark" to 0.03, "light" to 0.93)

    /** The side of the middle grey a background is on. */
    fun schemeOf(background: String): String = if (luminance(background) > 0.18) "light" else "dark"

    /** The background moved just far enough to sit in its scheme's range, keeping its hue. */
    fun fitBackground(background: String, scheme: String, high: Boolean = false): String {
        val c = parseColour(background)
        val hex = c?.let { toHex(it.rgb) } ?: "#000000"
        val y = luminance(hex)
        val (lo, hi) = (if (high) HIGH_RANGE else RANGE).getValue(scheme)
        if (y >= lo && y <= hi) return hex
        return if (y < lo) withLuminance(hex, lo, Side.AT_LEAST) else withLuminance(hex, hi, Side.AT_MOST)
    }

    /** The same background in the other scheme, at the lightness that scheme's backgrounds have. */
    fun flipBackground(background: String, scheme: String): String {
        val c = parseColour(background)
        return withLuminance(c?.let { toHex(it.rgb) } ?: "#000000", FLIP_TO.getValue(scheme))
    }

    private fun stepFrom(from: String, ratio: Double): String {
        val y = luminance(from)
        return withLuminance(from, minOf(1.0, maxOf(0.0, (y + 0.05) * ratio - 0.05)))
    }

    private fun shadeKeeping(fill: String, fg: String, delta: Double, target: Double = 4.5): String {
        val o = hexToOklch(fill) ?: return fill
        for (i in 10 downTo 1) {
            val out = oklchToHex(o.copy(l = o.l + (delta * i) / 10))
            if (Colour.contrast(out, fg) >= target) return out
        }
        return fill
    }

    private fun whiteTextFill(colour: String): Pair<String, String> {
        val fill = ensureContrast(colour, listOf("#ffffff"), 4.6)
        val o = hexToOklch(fill)!!
        return fill to oklchToHex(o.copy(l = maxOf(0.0, o.l - 0.07)))
    }

    /** The accent's family: fill, what goes on it, hover and pressed, ring, mention pill, the accent as text. */
    fun brandTokens(accent: String, scheme: String, surfaces: List<String>, raised: String, high: Boolean = false, keepAccent: Boolean = false, page: List<String>? = null): Map<String, String> {
        val picked = parseColour(accent)
        var brand = picked?.let { toHex(it.rgb) } ?: "#8000ff"
        // a button the colour of the page it sits on is a label floating in space
        if (!keepAccent && !page.isNullOrEmpty()) brand = ensureContrast(brand, page, if (high) 3.0 else 2.0)
        val fg = readableOn(brand)
        val dir = if ((hexToOklch(brand)?.l ?: 0.5) > 0.32) -1 else 1
        val hover = shadeKeeping(brand, fg, dir * 0.06)
        val active = shadeKeeping(brand, fg, dir * 0.11)
        val rgb = parseColour(brand)!!.rgb
        val bound = if (scheme == "dark") maxOf(0.1, luminance(raised)) else minOf(0.5, luminance(raised))
        fun thin(alpha: Double): Double {
            var a = alpha
            fun past(x: Double): Boolean {
                val y = luminance(flatten(toThemeHex(rgb, x), raised))
                return if (scheme == "dark") y > bound else y < bound
            }
            while (a > 0.06 && past(a)) a -= 0.02
            return Colour.jsRound(a * 100) / 100
        }
        val rest: Double
        val hovered: Double
        if (scheme == "light") {
            rest = thin(0.16)
            hovered = thin(0.32)
        } else {
            rest = thin(0.26)
            hovered = thin(0.42)
        }
        val pill = toThemeHex(rgb, hovered)
        val pillRest = toThemeHex(rgb, rest)
        val pills = listOf(flatten(pill, raised), flatten(pillRest, raised)) + surfaces.map { flatten(pill, it) }
        return linkedMapOf(
            "brand" to brand,
            "brand-hover" to hover,
            "brand-active" to active,
            "on-brand" to fg,
            "text-brand" to ensureContrast(brand, surfaces, if (high) 7.0 else 4.5),
            "focus-ring" to ensureContrast(brand, surfaces, if (high) 4.5 else 3.0),
            "mention-bg" to pillRest,
            "mention-bg-hover" to pill,
            "mention-fg" to ensureContrast(brand, pills, if (high) 7.0 else 4.5),
        )
    }

    fun deriveTheme(colours: SimpleColours, highContrast: Boolean = false): Derived {
        val high = highContrast
        val scheme = colours.scheme
        val dark = scheme == "dark"
        val pickedBg = parseColour(colours.background)
        val raised = fitBackground(colours.background, scheme, high)
        val o = hexToOklch(raised)!!
        fun tint(l: Double, cMax: Double = 0.025) = oklchToHex(Oklch(l, minOf(o.c, cMax), o.h))

        val base = stepFrom(raised, if (dark) 1 / 1.08 else 1 / 1.1)
        val surface = stepFrom(raised, if (dark) 1.1 else 1 / 1.19)
        val floating = if (dark) stepFrom(raised, 1.045) else stepFrom(raised, 1.06)
        val y = luminance(raised)
        val input = if (!dark) surface else if (y < 0.005) stepFrom(raised, 1.05) else withLuminance(raised, maxOf(0.0025, (y + 0.05) / 1.2 - 0.05))

        val veil = if (high) (if (dark) "#ffffff" else "#000000") else if (dark) tint(0.7) else tint(0.52)
        val lines = if (high) (if (dark) "#ffffff" else "#000000") else tint(0.7)
        fun a(hex: String, alpha: Double) = toThemeHex(parseColour(hex)!!.rgb, alpha)
        val overlays = when {
            high -> linkedMapOf("bg-hover" to a(veil, 0.1), "bg-selected" to a(veil, 0.16), "bg-active" to a(veil, 0.22), "bg-message-hover" to a(veil, 0.07))
            dark -> linkedMapOf("bg-hover" to a(veil, 0.08), "bg-selected" to a(veil, 0.12), "bg-active" to a(veil, 0.16), "bg-message-hover" to a(veil, 0.06))
            else -> linkedMapOf("bg-hover" to a(veil, 0.1), "bg-selected" to a(veil, 0.16), "bg-active" to a(veil, 0.22), "bg-message-hover" to a(veil, 0.06))
        }
        val borders = when {
            high -> linkedMapOf("border-subtle" to a(lines, if (dark) 0.26 else 0.22), "border" to a(lines, if (dark) 0.42 else 0.36), "border-strong" to a(lines, if (dark) 0.66 else 0.6))
            dark -> linkedMapOf("border-subtle" to a(lines, 0.12), "border" to a(lines, 0.2), "border-strong" to a(lines, 0.44))
            else -> linkedMapOf("border-subtle" to a(lines, 0.28), "border" to a(lines, 0.4), "border-strong" to a(lines, 0.52))
        }

        val embed = if (dark) surface else base
        val codeBg = if (dark) input else base
        val revealed = if (dark) input else surface
        val panels = listOf(base, raised, surface, floating, input, embed, revealed)

        // the accent comes before the text: a mention lights a whole message up in it
        val sorted = listOf(surface, raised, base, floating, input, embed).sortedWith { p, q ->
            val d = if (dark) luminance(q) - luminance(p) else luminance(p) - luminance(q)
            if (d < 0) -1 else if (d > 0) 1 else 0
        }
        val brand = brandTokens(colours.accent, scheme, sorted, raised, high = high, page = listOf(base, raised))

        val on = panels + listOf(
            flatten(overlays.getValue("bg-selected"), base),
            flatten(overlays.getValue("bg-active"), surface),
            flatten(overlays.getValue("bg-message-hover"), raised),
            flatten(overlays.getValue("bg-hover"), floating),
            flatten(brand.getValue("mention-bg"), raised),
        )
        val reading = listOf(raised, surface, floating, embed, flatten(overlays.getValue("bg-message-hover"), raised))
        val sidebar = listOf(base, flatten(overlays.getValue("bg-selected"), base), flatten(overlays.getValue("bg-hover"), base))
        val textTarget = if (high) 7.0 else 4.5

        val textTint = minOf(o.c * 0.35, 0.012)
        val autoText = oklchToHex(Oklch(if (dark) 0.96 else 0.29, textTint, o.h))
        val pickedText = colours.text?.takeIf { it.isNotEmpty() }?.let { parseColour(it) }
        val text = if (pickedText != null) ensureContrast(toHex(pickedText.rgb), on, textTarget)
        else ensureContrast(if (high) (if (dark) "#ffffff" else "#000000") else autoText, on, if (high) 12.0 else 7.0)
        val strong = if (dark) "#ffffff" else ensureContrast(oklchToHex(Oklch(0.22, textTint, o.h)), on, if (high) 12.0 else 7.0)
        fun shade(amount: Double, toward: String = raised) = mixOk(text, toward, amount)

        val link = ensureContrast(oklchToHex(if (dark) Oklch(0.77, 0.12, 255.0) else Oklch(0.5, 0.17, 255.0)), reading, textTarget)
        fun status(d: String, l: String) = ensureContrast(if (dark) d else l, listOf(raised, base, surface, floating), textTarget)
        val positive = whiteTextFill(if (dark) "#3d9e60" else "#269153")
        val danger = whiteTextFill(if (dark) "#da3e44" else "#d6363f")
        val warning = ensureContrast(if (dark) "#fdb833" else "#c98300", listOf(Colour.SOFT_BLACK), 4.6)
        val tooltipBg = if (dark) oklchToHex(Oklch(0.17, minOf(o.c, 0.015), o.h)) else "#ffffff"
        fun code(d: String, l: String) = ensureContrast(if (dark) d else l, listOf(codeBg), textTarget)

        val tokens = LinkedHashMap<String, String>()
        tokens["bg-base"] = base
        tokens["bg-raised"] = raised
        tokens["bg-surface"] = surface
        tokens["bg-floating"] = floating
        tokens["bg-input"] = input
        tokens["bg-composer"] = surface
        tokens["embed-bg"] = embed
        tokens["bg-overlay"] = a("#000000", if (dark) (if (high) 0.8 else 0.7) else 0.55)
        tokens.putAll(overlays)
        tokens["scroll-thumb"] = a(veil, if (high) 0.45 else if (dark) 0.28 else 0.35)
        tokens["scroll-thumb-hover"] = a(veil, if (high) 0.65 else if (dark) 0.45 else 0.55)
        tokens["text-strong"] = strong
        tokens["text"] = text
        tokens["text-subtle"] = ensureContrast(shade(0.2), on, textTarget)
        tokens["text-muted"] = ensureContrast(shade(0.34), on, textTarget)
        tokens["text-channel"] = ensureContrast(shade(0.42, base), sidebar, textTarget)
        tokens["text-placeholder"] = ensureContrast(shade(0.46, input), listOf(input, surface), textTarget)
        tokens["icon"] = ensureContrast(shade(0.26), on, textTarget)
        tokens["link"] = link
        tokens.putAll(brand)
        tokens.putAll(borders)
        tokens["positive"] = positive.first
        tokens["positive-hover"] = positive.second
        tokens["on-positive"] = "#ffffff"
        tokens["warning"] = warning
        tokens["text-warning"] = ensureContrast(if (dark) "#fdb833" else "#8a5500", on, textTarget)
        tokens["on-warning"] = Colour.SOFT_BLACK
        tokens["danger"] = danger.first
        tokens["danger-hover"] = danger.second
        tokens["on-danger"] = "#ffffff"
        tokens["text-danger"] = ensureContrast(if (dark) "#fc8387" else "#c33139", on, textTarget)
        tokens["status-online"] = status("#3d9e60", "#307d4c")
        tokens["status-idle"] = status("#f0b232", "#93660b")
        tokens["status-dnd"] = status("#e5484e", "#d42b35")
        tokens["status-offline"] = ensureContrast(mixOk(text, raised, 0.45), listOf(raised, base, surface, floating), textTarget)
        tokens["tooltip-bg"] = tooltipBg
        tokens["tooltip-text"] = ensureContrast(if (dark) "#f2f3f5" else "#060607", listOf(tooltipBg), 7.0)
        tokens["spoiler"] = tint(if (dark) 0.62 else 0.66, 0.02)
        tokens["spoiler-revealed"] = revealed
        tokens["code-bg"] = codeBg
        tokens["code-border"] = borders.getValue("border-subtle")
        tokens["code-keyword"] = code("#c678dd", "#cf222e")
        tokens["code-string"] = code("#98c379", "#0a3069")
        tokens["code-number"] = code("#d19a66", "#0550ae")
        tokens["code-comment"] = code("#8d939e", "#636b75")
        tokens["code-title"] = code("#61afef", "#7a3fd4")
        tokens["code-type"] = code("#e5c07b", "#116329")
        tokens["code-variable"] = code("#e06c75", "#953800")

        val pickedHex = pickedBg?.let { toHex(it.rgb) } ?: raised
        val accentHex = parseColour(colours.accent)
        return Derived(
            tokens = tokens,
            scheme = scheme,
            background = raised,
            adjustedBackground = raised != pickedHex,
            adjustedAccent = accentHex != null && brand.getValue("brand") != toHex(accentHex.rgb),
            adjustedText = pickedText != null && text != toHex(pickedText.rgb),
        )
    }
}
