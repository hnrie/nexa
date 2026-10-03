package fish.nexa.ui.theme.look

/**
 * web/src/lib/color.ts, line for line: WCAG 2.x luminance and contrast, the
 * HSL steps of the accent override and the OKLCH maths themes are derived
 * with. Colours travel as the web's strings ("#rrggbb", "#rrggbbaa") so a
 * value worked out here is the very value the web works out; the arithmetic
 * uses JavaScript's own rounding and the fdlibm functions V8 uses.
 */
object Colour {
    /** A colour as three channels, 0–255, not necessarily whole numbers. */
    class Rgb(val r: Double, val g: Double, val b: Double) {
        operator fun get(i: Int) = when (i) {
            0 -> r
            1 -> g
            else -> b
        }
    }

    data class Parsed(val rgb: Rgb, val alpha: Double)
    data class Oklch(val l: Double, val c: Double, val h: Double)

    private const val AA_TEXT = 4.5
    const val SOFT_BLACK = "#111214"

    // ---- JavaScript's arithmetic ----

    /** Math.round: halves go up, towards +∞. */
    fun jsRound(x: Double): Double {
        val f = Math.floor(x)
        return if (x - f >= 0.5) f + 1 else f
    }

    private fun pow(a: Double, b: Double) = StrictMath.pow(a, b)

    /** Math.hypot as V8 computes it: scaled, with Kahan summation. */
    fun hypot(a: Double, b: Double): Double {
        val x = Math.abs(a)
        val y = Math.abs(b)
        val max = maxOf(x, y)
        if (max == 0.0) return 0.0
        var sum = 0.0
        var compensation = 0.0
        for (v in doubleArrayOf(x, y)) {
            val n = v / max
            val summand = n * n - compensation
            val preliminary = sum + summand
            compensation = (preliminary - sum) - summand
            sum = preliminary
        }
        return Math.sqrt(sum) * max
    }

    private fun hex2(n: Int) = Integer.toHexString(n).padStart(2, '0')

    // ---- parsing and writing ----

    private val HEX = Regex("^#?([0-9a-f]{3}|[0-9a-f]{6})$", RegexOption.IGNORE_CASE)

    fun parseHex(hex: String): Rgb? {
        val m = HEX.find(hex.trim()) ?: return null
        val s = m.groupValues[1].let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it }
        val n = s.toInt(16)
        return Rgb(((n shr 16) and 255).toDouble(), ((n shr 8) and 255).toDouble(), (n and 255).toDouble())
    }

    fun toHex(rgb: Rgb): String = "#" + (0..2).joinToString("") { hex2(jsRound(minOf(255.0, maxOf(0.0, rgb[it]))).toInt()) }

    /** WCAG 2.x relative luminance, 0 for black and 1 for white. */
    fun luminance(colour: String): Double = parseHex(colour)?.let { luminance(it) } ?: 0.0

    fun luminance(rgb: Rgb): Double {
        fun lin(v: Double): Double {
            val c = v / 255
            return if (c <= 0.04045) c / 12.92 else pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
    }

    /** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). */
    fun contrast(a: String, b: String): Double {
        val la = luminance(a)
        val lb = luminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    /** What `a` looks like at `alpha` over `b`. */
    fun blend(a: Rgb, b: Rgb, alpha: Double): Rgb =
        Rgb(a.r * alpha + b.r * (1 - alpha), a.g * alpha + b.g * (1 - alpha), a.b * alpha + b.b * (1 - alpha))

    fun blend(a: String, b: String, alpha: Double): Rgb = blend(parseHex(a) ?: Rgb(0.0, 0.0, 0.0), parseHex(b) ?: Rgb(0.0, 0.0, 0.0), alpha)

    data class Hsl(val h: Double, val s: Double, val l: Double)

    fun rgbToHsl(rgb: Rgb): Hsl {
        val r = rgb.r / 255
        val g = rgb.g / 255
        val b = rgb.b / 255
        val max = maxOf(r, g, b)
        val min = minOf(r, g, b)
        val l = (max + min) / 2
        if (max == min) return Hsl(0.0, 0.0, l)
        val d = max - min
        val s = if (l > 0.5) d / (2 - max - min) else d / (max + min)
        val h = when (max) {
            r -> (g - b) / d + (if (g < b) 6 else 0)
            g -> (b - r) / d + 2
            else -> (r - g) / d + 4
        }
        return Hsl(h * 60, s, l)
    }

    fun hslToRgb(h: Double, s: Double, l: Double): Rgb {
        val c = (1 - Math.abs(2 * l - 1)) * s
        // JavaScript's % keeps the sign of the dividend, as Kotlin's does
        val hp = (((h % 360) + 360) % 360) / 60
        val x = c * (1 - Math.abs((hp % 2) - 1))
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

    /** The same hue and saturation, `delta` further up or down the HSL lightness scale. */
    fun shade(colour: String, delta: Double): String {
        val rgb = parseHex(colour) ?: return colour
        val (h, s, l) = rgbToHsl(rgb)
        return toHex(hslToRgb(h, s, minOf(1.0, maxOf(0.0, l + delta))))
    }

    /** The text colour for a fill: whichever of white and black is further, the softer black where it still reads. */
    fun readableOn(background: String): String {
        val white = contrast(background, "#ffffff")
        val black = contrast(background, "#000000")
        if (white >= black) return "#ffffff"
        return if (contrast(background, SOFT_BLACK) >= AA_TEXT) SOFT_BLACK else "#000000"
    }

    private val HEX_ANY = Regex("^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$")
    private val RGB_FN = Regex("^rgba?\\(\\s*([\\d.]+)[\\s,]+([\\d.]+)[\\s,]+([\\d.]+)\\s*(?:[,/]\\s*([\\d.]+%?))?\\s*\\)$")

    /** A colour in any of the forms a theme may hold: 3, 4, 6 or 8 hex digits, or rgb()/rgba(). */
    fun parseColour(value: String): Parsed? {
        val v = value.trim().lowercase()
        HEX_ANY.find(v)?.let { m ->
            val raw = m.groupValues[1].let { if (it.length <= 4) it.map { c -> "$c$c" }.joinToString("") else it }
            fun n(i: Int) = raw.substring(i, i + 2).toInt(16)
            val alpha = if (raw.length == 8) jsRound((n(6) / 255.0) * 1000) / 1000 else 1.0
            return Parsed(Rgb(n(0).toDouble(), n(2).toDouble(), n(4).toDouble()), alpha)
        }
        val m = RGB_FN.find(v) ?: return null
        val ch = (1..3).map { jsNumber(m.groupValues[it]) }
        if (ch.any { it == null || it.isNaN() || it.isInfinite() || it > 255 }) return null
        var alpha = 1.0
        val a = m.groups[4]?.value
        if (a != null) alpha = (if (a.endsWith("%")) jsNumber(a.dropLast(1))?.div(100) else jsNumber(a)) ?: Double.NaN
        if (alpha.isNaN() || alpha.isInfinite() || alpha < 0 || alpha > 1) return null
        return Parsed(Rgb(ch[0]!!, ch[1]!!, ch[2]!!), alpha)
    }

    /** Number() of a run of digits and dots: NaN (null) for "", "." or "1.2.3". */
    private fun jsNumber(s: String): Double? = if (s.isEmpty() || s == ".") null else s.toDoubleOrNull()

    /** #rrggbb, or #rrggbbaa below full strength. */
    fun toThemeHex(rgb: Rgb, alpha: Double = 1.0): String {
        val hex = toHex(rgb)
        val a = jsRound(minOf(1.0, maxOf(0.0, alpha)) * 255).toInt()
        return if (a >= 255) hex else hex + hex2(a)
    }

    /** What a possibly see-through colour looks like over an opaque one. */
    fun flatten(value: String, over: String): String {
        val c = parseColour(value) ?: return over
        val bg = parseColour(over)
        if (c.alpha >= 1 || bg == null) return toHex(c.rgb)
        return toHex(blend(c.rgb, bg.rgb, c.alpha))
    }

    // ---- OKLCH (Björn Ottosson's matrices) ----

    private fun toLinear(v: Double): Double {
        val c = v / 255
        return if (c <= 0.04045) c / 12.92 else pow((c + 0.055) / 1.055, 2.4)
    }

    private fun fromLinear(v: Double): Double =
        255 * (if (v <= 0.0031308) 12.92 * v else 1.055 * Math.signum(v) * pow(Math.abs(v), 1 / 2.4) - 0.055)

    fun rgbToOklch(rgb: Rgb): Oklch {
        val r = toLinear(rgb.r)
        val g = toLinear(rgb.g)
        val b = toLinear(rgb.b)
        val l = StrictMath.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = StrictMath.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = StrictMath.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        val bigL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        val bigA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        val bigB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        val c = hypot(bigA, bigB)
        val h = if (c < 1e-6) 0.0 else ((StrictMath.atan2(bigB, bigA) * 180) / Math.PI + 360) % 360
        return Oklch(bigL, c, h)
    }

    private fun oklchToRawRgb(o: Oklch): Rgb {
        val hr = (o.h * Math.PI) / 180
        val a = o.c * StrictMath.cos(hr)
        val b = o.c * StrictMath.sin(hr)
        val l3 = pow(o.l + 0.3963377774 * a + 0.2158037573 * b, 3.0)
        val m3 = pow(o.l - 0.1055613458 * a - 0.0638541728 * b, 3.0)
        val s3 = pow(o.l - 0.0894841775 * a - 1.291485548 * b, 3.0)
        return Rgb(
            fromLinear(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
            fromLinear(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
            fromLinear(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
        )
    }

    private fun inGamut(rgb: Rgb) = (0..2).all { rgb[it] >= -0.5 && rgb[it] <= 255.5 }

    /** The OKLCH colour as hex, giving up chroma rather than hue or lightness when the screen cannot show it. */
    fun oklchToHex(o: Oklch): String {
        val l = minOf(1.0, maxOf(0.0, o.l))
        var rgb = oklchToRawRgb(Oklch(l, o.c, o.h))
        if (!inGamut(rgb)) {
            var lo = 0.0
            var hi = o.c
            for (i in 0 until 20) {
                val mid = (lo + hi) / 2
                if (inGamut(oklchToRawRgb(Oklch(l, mid, o.h)))) lo = mid else hi = mid
            }
            rgb = oklchToRawRgb(Oklch(l, lo, o.h))
        }
        return toHex(rgb)
    }

    fun hexToOklch(hex: String): Oklch? = parseHex(hex)?.let { rgbToOklch(it) }

    enum class Side { NEAREST, AT_LEAST, AT_MOST }

    /** The colour with the same hue and chroma whose relative luminance is `target`. */
    fun withLuminance(colour: String, target: Double, side: Side = Side.NEAREST): String {
        val o = hexToOklch(colour) ?: return colour
        val want = minOf(1.0, maxOf(0.0, target))
        var lo = 0.0
        var hi = 1.0
        for (i in 0 until 24) {
            val mid = (lo + hi) / 2
            if (luminance(oklchToHex(o.copy(l = mid))) < want) lo = mid else hi = mid
        }
        return when (side) {
            Side.AT_LEAST -> oklchToHex(o.copy(l = hi))
            Side.AT_MOST -> oklchToHex(o.copy(l = lo))
            Side.NEAREST -> oklchToHex(o.copy(l = (lo + hi) / 2))
        }
    }

    fun worstContrast(colour: String, backgrounds: List<String>): Double = backgrounds.fold(21.0) { worst, bg -> minOf(worst, contrast(colour, bg)) }

    /** `colour` made lighter or darker, keeping its hue, until it reads at `target` against every background. */
    fun ensureContrast(colour: String, backgrounds: List<String>, target: Double): String {
        if (parseHex(colour) == null || backgrounds.isEmpty()) return colour
        if (worstContrast(colour, backgrounds) >= target) return colour
        val o = hexToOklch(colour)!!
        val lightest = backgrounds.maxOf { luminance(it) }
        val darkest = backgrounds.minOf { luminance(it) }
        val up = (1.05 / (lightest + 0.05)) >= ((darkest + 0.05) / 0.05)
        val edge = if (up) 1.0 else 0.0
        if (worstContrast(oklchToHex(o.copy(l = edge)), backgrounds) < target) {
            val white = worstContrast("#ffffff", backgrounds)
            val black = worstContrast("#000000", backgrounds)
            return if (white >= black) "#ffffff" else "#000000"
        }
        var near = o.l
        var far = edge
        for (i in 0 until 24) {
            val mid = (near + far) / 2
            if (worstContrast(oklchToHex(o.copy(l = mid)), backgrounds) >= target) far = mid else near = mid
        }
        return oklchToHex(o.copy(l = far))
    }

    /** `a` moved `amount` of the way towards `b` in OKLab. */
    fun mixOk(a: String, b: String, amount: Double): String {
        val x = parseHex(a) ?: return a
        val y = parseHex(b) ?: return a
        fun lab(rgb: Rgb): DoubleArray {
            val o = rgbToOklch(rgb)
            val hr = (o.h * Math.PI) / 180
            return doubleArrayOf(o.l, o.c * StrictMath.cos(hr), o.c * StrictMath.sin(hr))
        }
        val p = lab(x)
        val q = lab(y)
        val l = p[0] + (q[0] - p[0]) * amount
        val aa = p[1] + (q[1] - p[1]) * amount
        val bb = p[2] + (q[2] - p[2]) * amount
        return oklchToHex(Oklch(l, hypot(aa, bb), ((StrictMath.atan2(bb, aa) * 180) / Math.PI + 360) % 360))
    }

    /** `colour` moved along its HSL lightness until it reads at `target` on `background` (the accent override's way). */
    fun tuneForContrast(colour: String, background: String, target: Double): String {
        if (contrast(colour, background) >= target) return colour
        val rgb = parseHex(colour) ?: return colour
        val (h, s, l) = rgbToHsl(rgb)
        val away = if (luminance(background) > 0.5) -1 else 1
        var best = colour
        var bestRatio = contrast(colour, background)
        for (dir in intArrayOf(away, -away)) {
            for (step in 1..100) {
                val candidate = toHex(hslToRgb(h, s, minOf(1.0, maxOf(0.0, l + dir * step * 0.01))))
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
