package fish.nexa.ui.markdown

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** An sRGB colour as three 0-255 numbers, fractions allowed (lib/color.ts Rgb). */
data class Rgb(val r: Double, val g: Double, val b: Double) {
    constructor(r: Int, g: Int, b: Int) : this(r.toDouble(), g.toDouble(), b.toDouble())

    operator fun get(i: Int): Double = when (i) {
        0 -> r
        1 -> g
        else -> b
    }

    /** As 0xRRGGBB, each channel rounded and clamped. */
    fun toInt(): Int = (ColorMath.channel(r) shl 16) or (ColorMath.channel(g) shl 8) or ColorMath.channel(b)

    companion object {
        fun of(argb: Int) = Rgb((argb shr 16) and 255, (argb shr 8) and 255, argb and 255)
    }
}

/**
 * The colour maths coloured text needs, as lib/color.ts does it: WCAG 2.x
 * relative luminance and contrast, blending, HSL steps, and the tuning that
 * moves a colour along its own lightness until it reads at a given contrast.
 */
object ColorMath {
    private const val AA_TEXT = 4.5
    /** The near-black the tooltip uses; softer on a fill than pure black. */
    private const val SOFT_BLACK = "#111214"

    fun parseHex(hex: String): Rgb? {
        val t = Js.trim(hex)
        val s = if (t.startsWith("#")) t.substring(1) else t
        if (s.length != 3 && s.length != 6) return null
        if (!s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
        val full = if (s.length == 3) s.map { "$it$it" }.joinToString("") else s
        val n = full.toInt(16)
        return Rgb((n shr 16) and 255, (n shr 8) and 255, n and 255)
    }

    internal fun channel(v: Double): Int = Math.round(min(255.0, max(0.0, v))).toInt()

    fun toHex(rgb: Rgb): String = "#" + listOf(rgb.r, rgb.g, rgb.b).joinToString("") { channel(it).toString(16).padStart(2, '0') }

    private fun lin(v: Double): Double {
        val c = v / 255
        return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }

    /** WCAG 2.x relative luminance, 0 for black and 1 for white. */
    fun luminance(rgb: Rgb): Double = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)

    fun luminance(hex: String): Double = parseHex(hex)?.let { luminance(it) } ?: 0.0

    /** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). */
    fun contrast(a: Rgb, b: Rgb): Double = ratio(luminance(a), luminance(b))

    fun contrast(a: String, b: String): Double = ratio(luminance(a), luminance(b))

    fun contrast(a: Rgb, b: String): Double = ratio(luminance(a), luminance(b))

    private fun ratio(la: Double, lb: Double) = (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

    /** What `a` looks like at `alpha` over `b`: the flat colour a screen shows. */
    fun blend(a: Rgb, b: Rgb, alpha: Double): Rgb =
        Rgb(a.r * alpha + b.r * (1 - alpha), a.g * alpha + b.g * (1 - alpha), a.b * alpha + b.b * (1 - alpha))

    fun blend(a: String, b: Rgb, alpha: Double): Rgb = blend(parseHex(a) ?: Rgb(0, 0, 0), b, alpha)

    class Hsl(val h: Double, val s: Double, val l: Double)

    fun rgbToHsl(rgb: Rgb): Hsl {
        val r = rgb.r / 255
        val g = rgb.g / 255
        val b = rgb.b / 255
        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        val l = (mx + mn) / 2
        if (mx == mn) return Hsl(0.0, 0.0, l)
        val d = mx - mn
        val s = if (l > 0.5) d / (2 - mx - mn) else d / (mx + mn)
        val h = when (mx) {
            r -> (g - b) / d + (if (g < b) 6 else 0)
            g -> (b - r) / d + 2
            else -> (r - g) / d + 4
        }
        return Hsl(h * 60, s, l)
    }

    fun hslToRgb(h: Double, s: Double, l: Double): Rgb {
        val c = (1 - abs(2 * l - 1)) * s
        val hp = (((h % 360) + 360) % 360) / 60
        val x = c * (1 - abs((hp % 2) - 1))
        val m = l - c / 2
        val (r, g, b) = when {
            hp < 1 -> Triple(c, x, 0.0)
            hp < 2 -> Triple(x, c, 0.0)
            hp < 3 -> Triple(0.0, c, x)
            hp < 4 -> Triple(0.0, x, c)
            hp < 5 -> Triple(x, 0.0, c)
            else -> Triple(c, 0.0, x)
        }
        return Rgb((r + m) * 255, (g + m) * 255, (b + m) * 255)
    }

    /** The text colour to print on a fill: whichever of white and black is further, black softened when it can be. */
    fun readableOn(background: String): String {
        val white = contrast(background, "#ffffff")
        val black = contrast(background, "#000000")
        if (white >= black) return "#ffffff"
        return if (contrast(background, SOFT_BLACK) >= AA_TEXT) SOFT_BLACK else "#000000"
    }

    /**
     * `colour` moved along its own lightness until it reads at `target`
     * against `background`, keeping its hue: away from the background first,
     * then back the other way; the best found when neither reaches it.
     */
    fun tuneForContrast(colour: String, background: String, target: Double): String {
        if (contrast(colour, background) >= target) return colour
        val rgb = parseHex(colour) ?: return colour
        val hsl = rgbToHsl(rgb)
        val away = if (luminance(background) > 0.5) -1 else 1
        var best = colour
        var bestRatio = contrast(colour, background)
        for (dir in intArrayOf(away, -away)) {
            for (step in 1..100) {
                val candidate = toHex(hslToRgb(hsl.h, hsl.s, min(1.0, max(0.0, hsl.l + dir * step * 0.01))))
                val ratio = contrast(candidate, background)
                if (ratio > bestRatio) {
                    best = candidate
                    bestRatio = ratio
                }
                if (ratio >= target) return candidate
            }
        }
        return best
    }
}

/**
 * Coloured text: `[words]{red}`, `[words]{#ff8800}`, `[words]{on yellow}`,
 * `[words]{red on yellow}` (web/src/markdown/colors.ts). Whatever colour is
 * asked for, what is painted is measured against the surface under it: a
 * named colour takes the shade made for that kind of background, and anything
 * that would read at under 4.5:1 is moved along its own lightness until it
 * does, so an author's hex code can never make words disappear.
 */
object MarkdownColors {
    /** The palette, in the order the formatting editor offers it. */
    val NAMES = listOf("red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "purple", "pink", "brown", "gray")

    /** Each name's shade for dark surfaces and for light ones. */
    val PALETTE: Map<String, Pair<String, String>> = mapOf(
        "red" to ("#ff8077" to "#cb212d"),
        "orange" to ("#ffa657" to "#b24800"),
        "yellow" to ("#e3b341" to "#8a6100"),
        "lime" to ("#a5d63f" to "#4a7500"),
        "green" to ("#56d364" to "#197934"),
        "teal" to ("#39c5bb" to "#0f766e"),
        "cyan" to ("#56d4f5" to "#0a6f8f"),
        "blue" to ("#79c0ff" to "#0965d3"),
        "purple" to ("#d2a8ff" to "#7c47dd"),
        "pink" to ("#ff9bce" to "#b53682"),
        "brown" to ("#d4a373" to "#8b5a2b"),
        "gray" to ("#b1bac4" to "#59636e"),
    )

    /** Body text contrast, WCAG AA. */
    private const val READABLE = 4.5
    /** How strongly a highlight's colour shows over the surface. */
    private const val TINT = 0.5

    /** What the braces ask for: a text colour, a highlight, or both (a palette name or "#rrggbb"). */
    data class Spec(val fg: String?, val bg: String?)

    /** What surrounds a coloured run: the background it sits on and the text colour it would otherwise have. */
    data class Surface(val bg: Rgb, val text: Rgb)

    /** The colours to paint with: text (null keeps the surrounding colour) and a highlight fill, as "#rrggbb". */
    data class Paint(val color: String?, val background: String?)

    /** The dark theme's message background and text, for when nothing can be measured. */
    val FALLBACK_SURFACE = Surface(Rgb(0x2c, 0x2d, 0x32), Rgb(0xf3, 0xf3, 0xf4))

    /** A palette name ("grey" is "gray") or a #rgb / #rrggbb code, normalised; null for anything else. */
    fun token(word: String): String? {
        val w = Js.lower(word)
        if (w == "grey") return "gray"
        if (w in PALETTE) return w
        if (!w.startsWith("#") || (w.length != 4 && w.length != 7)) return null
        val hex = w.substring(1)
        if (!hex.all { it in '0'..'9' || it in 'a'..'f' }) return null
        return "#" + if (hex.length == 3) hex.map { "$it$it" }.joinToString("") else hex
    }

    /** What the braces of `[words]{…}` ask for, or null when it is not a colour (the text stays as typed). */
    fun parseSpec(raw: String): Spec? {
        val words = splitSpace(Js.lower(Js.trim(raw)))
        if (words.size == 1) return token(words[0])?.let { Spec(it, null) }
        if (words.size == 2 && words[0] == "on") return token(words[1])?.let { Spec(null, it) }
        if (words.size == 3 && words[1] == "on") {
            val fg = token(words[0])
            val bg = token(words[2])
            return if (fg != null && bg != null) Spec(fg, bg) else null
        }
        return null
    }

    /** `s.split(/\s+/)`. */
    private fun splitSpace(s: String): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (Js.isSpace(s[i])) {
                out += cur.toString()
                cur.setLength(0)
                while (i < s.length && Js.isSpace(s[i])) i++
            } else {
                cur.append(s[i])
                i++
            }
        }
        out += cur.toString()
        return out
    }

    /** The braces' contents for a spec, as the formatting editor writes them. */
    fun formatSpec(spec: Spec): String = when {
        spec.fg != null && spec.bg != null -> "${spec.fg} on ${spec.bg}"
        spec.bg != null -> "on ${spec.bg}"
        else -> spec.fg ?: ""
    }

    private fun isLight(surface: Rgb) = ColorMath.luminance(surface) > 0.4

    /** The colour a token starts from on this surface: a name's shade for it, or the code as written. */
    private fun base(token: String, surface: Rgb): String {
        val named = PALETTE[token] ?: return token
        return if (isLight(surface)) named.second else named.first
    }

    /** The colours to paint a run with on this surface; every pair that comes out reads at 4.5:1. */
    fun paint(spec: Spec, surface: Surface): Paint {
        val page = ColorMath.toHex(surface.bg)
        if (spec.bg == null) {
            return Paint(spec.fg?.let { ColorMath.tuneForContrast(base(it, surface.bg), page, READABLE) }, null)
        }
        // a tint of the chosen colour over the page: the deeper shade on a dark page, the paler on a light one
        val named = PALETTE[spec.bg]
        val fill = if (named != null) (if (isLight(surface.bg)) named.first else named.second) else spec.bg
        val tint = ColorMath.toHex(ColorMath.blend(fill, surface.bg, TINT))
        val color = if (spec.fg != null) {
            ColorMath.tuneForContrast(base(spec.fg, ColorMath.parseHex(tint) ?: surface.bg), tint, READABLE)
        } else if (ColorMath.contrast(surface.text, tint) >= READABLE) null else ColorMath.readableOn(tint)
        return Paint(color, tint)
    }

    fun paint(fg: String?, bg: String?, surface: Surface): Paint = paint(Spec(fg, bg), surface)

    /** A swatch's colour for the editor's palette: the name as it will be painted here. */
    fun swatch(token: String, surface: Surface): String = paint(Spec(token, null), surface).color ?: ColorMath.toHex(surface.text)
}
