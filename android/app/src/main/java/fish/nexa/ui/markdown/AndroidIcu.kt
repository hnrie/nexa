package fish.nexa.ui.markdown

import android.icu.text.CompactDecimalFormat
import android.icu.text.DateTimePatternGenerator
import android.icu.text.DisplayContext
import android.icu.text.MeasureFormat
import android.icu.text.NumberFormat
import android.icu.text.RelativeDateTimeFormatter
import android.icu.text.SimpleDateFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import android.icu.util.ULocale
import android.os.Build
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

/**
 * [IcuFormats] with the phone's own ICU (android.icu), the same library and
 * data the web's Intl is built on. Patterns and formatters are made once per
 * language and kept, since a message list asks for hundreds of dates.
 */
object AndroidIcu : IcuFormats {
    private val patterns = ConcurrentHashMap<String, String>()
    private val dates = ConcurrentHashMap<String, SimpleDateFormat>()
    private val relatives = ConcurrentHashMap<Locale, RelativeDateTimeFormatter>()

    private fun pattern(skeleton: String, locale: Locale): String = patterns.getOrPut("${locale.toLanguageTag()}|$skeleton") {
        DateTimePatternGenerator.getInstance(ULocale.forLocale(locale)).getBestPattern(skeleton, DateTimePatternGenerator.MATCH_HOUR_FIELD_LENGTH)
    }

    override fun date(skeleton: String, locale: Locale, zone: TimeZone, epochMs: Long): String {
        val key = "${locale.toLanguageTag()}|${zone.id}|$skeleton"
        val f = dates.getOrPut(key) {
            SimpleDateFormat(pattern(skeleton, locale), ULocale.forLocale(locale)).apply {
                timeZone = android.icu.util.TimeZone.getTimeZone(zone.id)
            }
        }
        // a SimpleDateFormat is not to be shared between threads at once
        return webSpaces(synchronized(f) { f.format(java.util.Date(epochMs)) })
    }

    /**
     * Browsers turn the narrow no-break space ICU puts before "PM" back into an
     * ordinary space (V8 does it for every date it formats), so dates read the
     * same here as on the web.
     */
    fun webSpaces(s: String): String = s.replace(' ', ' ')

    override fun relative(value: Double, unit: String, locale: Locale): String {
        val f = relatives.getOrPut(locale) {
            RelativeDateTimeFormatter.getInstance(ULocale.forLocale(locale), null, RelativeDateTimeFormatter.Style.LONG, DisplayContext.CAPITALIZATION_NONE)
        }
        return synchronized(f) {
            if (Build.VERSION.SDK_INT >= 28) {
                val u = when (unit) {
                    "year" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.YEAR
                    "month" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.MONTH
                    "week" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.WEEK
                    "day" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.DAY
                    "hour" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.HOUR
                    "minute" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.MINUTE
                    else -> RelativeDateTimeFormatter.RelativeDateTimeUnit.SECOND
                }
                f.format(value, u)
            } else legacyRelative(f, value, unit)
        }
    }

    /** Android 8: the older calls, with the words a language has for yesterday, now and next week. */
    private fun legacyRelative(f: RelativeDateTimeFormatter, value: Double, unit: String): String {
        val absolute = when (unit) {
            "day" -> RelativeDateTimeFormatter.AbsoluteUnit.DAY
            "week" -> RelativeDateTimeFormatter.AbsoluteUnit.WEEK
            "month" -> RelativeDateTimeFormatter.AbsoluteUnit.MONTH
            "year" -> RelativeDateTimeFormatter.AbsoluteUnit.YEAR
            else -> null
        }
        if (value == 0.0 && unit == "second") return f.format(RelativeDateTimeFormatter.Direction.PLAIN, RelativeDateTimeFormatter.AbsoluteUnit.NOW)
        if (absolute != null && (value == 1.0 || value == -1.0 || value == 0.0)) {
            val dir = when (value) {
                1.0 -> RelativeDateTimeFormatter.Direction.NEXT
                -1.0 -> RelativeDateTimeFormatter.Direction.LAST
                else -> RelativeDateTimeFormatter.Direction.THIS
            }
            return f.format(dir, absolute)
        }
        val relative = when (unit) {
            "year" -> RelativeDateTimeFormatter.RelativeUnit.YEARS
            "month" -> RelativeDateTimeFormatter.RelativeUnit.MONTHS
            "week" -> RelativeDateTimeFormatter.RelativeUnit.WEEKS
            "day" -> RelativeDateTimeFormatter.RelativeUnit.DAYS
            "hour" -> RelativeDateTimeFormatter.RelativeUnit.HOURS
            "minute" -> RelativeDateTimeFormatter.RelativeUnit.MINUTES
            else -> RelativeDateTimeFormatter.RelativeUnit.SECONDS
        }
        val dir = if (value < 0 || (value == 0.0 && 1 / value < 0)) RelativeDateTimeFormatter.Direction.LAST else RelativeDateTimeFormatter.Direction.NEXT
        return f.format(kotlin.math.abs(value), dir, relative)
    }

    // Intl rounds halves away from zero; ICU's own default is to the even neighbour.
    // From Android 11 the number formatter Intl itself uses is there, grouping rules and all.

    override fun compact(n: Double, locale: Locale): String {
        if (Build.VERSION.SDK_INT >= 30) {
            return android.icu.number.NumberFormatter.withLocale(locale)
                .notation(android.icu.number.Notation.compactShort())
                .precision(android.icu.number.Precision.maxFraction(1))
                .roundingMode(java.math.RoundingMode.HALF_UP)
                .format(n).toString()
        }
        val f = CompactDecimalFormat.getInstance(ULocale.forLocale(locale), CompactDecimalFormat.CompactStyle.SHORT)
        f.setSignificantDigitsUsed(false)
        f.maximumFractionDigits = 1
        f.roundingMode = android.icu.math.BigDecimal.ROUND_HALF_UP
        return f.format(n)
    }

    override fun percent(fraction: Double, locale: Locale): String {
        if (Build.VERSION.SDK_INT >= 30) {
            return android.icu.number.NumberFormatter.withLocale(locale)
                .unit(MeasureUnit.PERCENT)
                .scale(android.icu.number.Scale.powerOfTen(2))
                .precision(android.icu.number.Precision.maxFraction(0))
                .roundingMode(java.math.RoundingMode.HALF_UP)
                .format(fraction).toString()
        }
        val f = NumberFormat.getPercentInstance(ULocale.forLocale(locale))
        f.maximumFractionDigits = 0
        f.roundingMode = android.icu.math.BigDecimal.ROUND_HALF_UP
        return f.format(fraction)
    }

    override fun unitNarrow(value: Double, unit: String, locale: Locale): String {
        val u = when (unit) {
            "hour" -> MeasureUnit.HOUR
            "minute" -> MeasureUnit.MINUTE
            else -> MeasureUnit.SECOND
        }
        if (Build.VERSION.SDK_INT >= 30) {
            return android.icu.number.NumberFormatter.withLocale(locale)
                .unit(u)
                .unitWidth(android.icu.number.NumberFormatter.UnitWidth.NARROW)
                .roundingMode(java.math.RoundingMode.HALF_UP)
                .format(value).toString()
        }
        val number: Number = if (value == Math.floor(value) && kotlin.math.abs(value) < 1e15) value.toLong() else value
        return MeasureFormat.getInstance(ULocale.forLocale(locale), MeasureFormat.FormatWidth.NARROW).format(Measure(number, u))
    }
}
